// v1 API (works with firebase-functions v4, v5 and v6+)
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();
const MAX_ATTEMPTS = 3;

// Throws unless the caller is a signed-in member whose Firestore doc has the 'admin' role.
async function requireAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  }
  const snap = await db.collection('members').doc(context.auth.uid).get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Not a member.');
  }
  const data = snap.data();
  const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
  if (!roles.includes('admin')) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
}

// ---- Admin: set (or reset) any member's password at any time, without needing their old one ----
exports.adminSetPassword = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { uid, newPassword } = data || {};
  if (!uid || !newPassword || String(newPassword).length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'uid and a password of at least 6 characters are required.');
  }
  await admin.auth().updateUser(uid, { password: newPassword });
  await db.collection('members').doc(uid).set({ failedAttempts: 0, locked: false }, { merge: true });
  return { success: true };
});

// ---- Admin: unlock a locked member (and optionally set a fresh password in the same step) ----
exports.adminUnlockMember = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { uid, newPassword } = data || {};
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid is required.');
  if (newPassword && String(newPassword).length < 6) {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters.');
  }
  const updatePayload = { disabled: false };
  if (newPassword) updatePayload.password = newPassword;
  await admin.auth().updateUser(uid, updatePayload);
  await db.collection('members').doc(uid).set({ failedAttempts: 0, locked: false }, { merge: true });
  return { success: true };
});

// ---- Called by the client after a failed login (wrong password). Locks the account
// (disables Firebase Auth sign-in entirely) after 3 consecutive failures. ----
exports.recordFailedLogin = functions.https.onCall(async (data) => {
  const { mobile } = data || {};
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid 10-digit mobile number required.');
  }
  const email = `${mobile}@msskadle.app`;
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    // Unknown mobile number — don't reveal whether an account exists for it
    return { locked: false, attemptsRemaining: MAX_ATTEMPTS };
  }

  const memberRef = db.collection('members').doc(userRecord.uid);
  const memberSnap = await memberRef.get();
  const current = memberSnap.exists ? (memberSnap.data().failedAttempts || 0) : 0;
  const attempts = current + 1;

  if (attempts >= MAX_ATTEMPTS) {
    await admin.auth().updateUser(userRecord.uid, { disabled: true });
    await memberRef.set({ failedAttempts: attempts, locked: true }, { merge: true });
    return { locked: true, attemptsRemaining: 0 };
  }

  await memberRef.set({ failedAttempts: attempts }, { merge: true });
  return { locked: false, attemptsRemaining: MAX_ATTEMPTS - attempts };
});

// ---- Called by the client right after a successful login, to clear the counter ----
exports.resetFailedLogin = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  await db.collection('members').doc(context.auth.uid).set({ failedAttempts: 0 }, { merge: true });
  return { success: true };
});

// ---- PUBLIC (read-only) data for the website: gallery photos, events and committee ----
// The website calls this URL. It returns ONLY these three lists — never member,
// payment or login data. Runs with admin rights, so no Firestore rules change is needed.
const MAX_PHOTOS = 60; // newest photos only, keeps the response small
exports.publicSiteData = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).send('GET only');
  try {
    const [g, e, c] = await Promise.all([
      db.collection('gallery').orderBy('createdAt', 'desc').limit(MAX_PHOTOS).get(),
      db.collection('countdownEvents').orderBy('order', 'asc').get(),
      db.collection('committee').orderBy('order', 'asc').get(),
    ]);
    const gallery = g.docs.map(d => {
      const p = d.data();
      return { url: p.url || '', captionKn: p.captionKn || '', captionEn: p.captionEn || '', year: String(p.year || '2025') };
    }).filter(p => p.url);
    const events = e.docs.map(d => {
      const x = d.data();
      return { nameEn: x.nameEn || '', nameKn: x.nameKn || '', date: x.date || '', expiry: x.expiry || '', order: x.order || 99 };
    });
    const committee = c.docs.map(d => {
      const x = d.data();
      return { roleKn: x.roleKn || '', name: x.name || '', order: x.order || 99 };
    });
    res.set('Cache-Control', 'public, max-age=120');
    return res.json({ gallery, events, committee });
  } catch (err) {
    console.error('publicSiteData failed', err);
    return res.status(500).json({ error: 'failed' });
  }
});


// =====================================================================
// OTP LOGIN SUPPORT
// Members log in by SMS OTP with their mobile number. For OTP to open the
// member's EXISTING account (same data, payments, roles), that account must
// carry their phone number. These functions keep it in sync.
// =====================================================================

// Puts +91<mobile> on the member's login. Returns 'ok' | 'conflict' | 'skipped'.
async function setPhone(uid, mobile) {
  mobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(mobile)) return 'skipped';
  const phone = '+91' + mobile;
  let user;
  try { user = await admin.auth().getUser(uid); } catch (e) { return 'skipped'; } // e.g. name-only member, no login yet
  if (user.phoneNumber === phone) return 'ok';
  try {
    const other = await admin.auth().getUserByPhoneNumber(phone);
    if (other.uid !== uid) {
      const otherDoc = await db.collection('members').doc(other.uid).get();
      if (otherDoc.exists) {
        console.warn(`Mobile ${mobile} is used by two members: ${other.uid} and ${uid}`);
        return 'conflict';
      }
      // stray/abandoned login holding this number (e.g. old login after a mobile change) → free it
      await admin.auth().updateUser(other.uid, { phoneNumber: null });
    }
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
  await admin.auth().updateUser(uid, { phoneNumber: phone });
  return 'ok';
}

// Runs automatically whenever a member is added or their mobile number changes.
exports.onMemberMobileChange = functions.firestore.document('members/{uid}').onWrite(async (change, context) => {
  if (!change.after.exists) return null;
  const after = change.after.data();
  const before = change.before.exists ? change.before.data() : null;
  if (before && before.mobile === after.mobile) return null; // e.g. lastLogin update — nothing to do
  try { await setPhone(context.params.uid, after.mobile); } catch (e) { console.error('onMemberMobileChange', e); }
  return null;
});

// Called by the app after a member logs in with their password.
exports.linkMyPhone = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be signed in.');
  const snap = await db.collection('members').doc(context.auth.uid).get();
  if (!snap.exists) return { status: 'no-member' };
  return { status: await setPhone(context.auth.uid, snap.data().mobile) };
});

// Admin-only: link ALL members' numbers at once (the app runs this when an admin logs in).
exports.syncMemberPhones = functions.runWith({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  await requireAdmin(context);
  const snap = await db.collection('members').get();
  const result = { ok: 0, conflict: 0, skipped: 0 };
  for (const d of snap.docs) {
    try { result[await setPhone(d.id, d.data().mobile)]++; }
    catch (e) { console.error('sync', d.id, e.message); result.skipped++; }
  }
  return result;
});

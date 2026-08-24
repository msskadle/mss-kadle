const functions = require('firebase-functions');
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

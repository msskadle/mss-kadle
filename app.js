// ============ FIREBASE SETUP ============
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB6OwS_FOwW0VGTuBBI20y4kkH3a26xu64",
  authDomain: "mss-kadle-e328f.firebaseapp.com",
  databaseURL: "https://mss-kadle-e328f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mss-kadle-e328f",
  storageBucket: "mss-kadle-e328f.firebasestorage.app",
  messagingSenderId: "618234353316",
  appId: "1:618234353316:web:d5b7ca0340cca1a5993831"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ============ CONSTANTS ============
const UPI = 'shreem9916106@barodampay';
const PAYEE = 'Shree Mahaganapati Seva Sangha';

// ============ UPI PAYMENT HELPER ============
let pendingUpiParams = null;

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function launchUpiPayment(params) {
  if (isAndroid()) {
    // Android: intent:// forces the system app chooser
    window.location.href = `intent://pay?${params}#Intent;scheme=upi;end`;
  } else if (isIOS()) {
    // iOS: no universal upi:// handler — show our own app picker
    pendingUpiParams = params;
    openModal('upi-modal');
  } else {
    window.location.href = `upi://pay?${params}`;
  }
}

// Per-app URL schemes for iOS (and as fallback elsewhere)
const UPI_APP_SCHEMES = {
  gpay:    p => `gpay://upi/pay?${p}`,
  phonepe: p => `phonepe://pay?${p}`,
  paytm:   p => `paytmmp://pay?${p}`,
  bhim:    p => `bhim://pay?${p}`
};

window.openUpiApp = function(appKey) {
  if (!pendingUpiParams) return;
  const url = UPI_APP_SCHEMES[appKey](pendingUpiParams);
  closeModal('upi-modal');
  window.location.href = url;
  // If the app isn't installed, iOS does nothing — offer the UPI ID as fallback
  setTimeout(() => {
    showToast('If nothing opened, tap "Copy UPI ID" and pay manually · ಏನೂ ತೆರೆಯದಿದ್ದರೆ UPI ID ಕಾಪಿ ಮಾಡಿ');
  }, 1500);
};

window.copyUpiId = function() {
  closeModal('upi-modal');
  navigator.clipboard?.writeText(UPI);
  showToast(`UPI ID copied: ${UPI} · UPI ID ನಕಲಿಸಲಾಗಿದೆ`);
};

// ============ STATE ============
let currentUser = null;
let currentProfile = null;
let isAdmin = false;
let unsubMembers = null, unsubAnns = null, unsubMyReqs = null, unsubMyTxns = null, unsubGallery = null, unsubAllReqs = null;

// ============ UTIL ============
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
function showLoader(show) {
  document.getElementById('loader').classList.toggle('show', show);
}
function fmtMoney(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}
function fmtDate(ts) {
  if (!ts) return '--';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
function fmtDateTime(ts) {
  if (!ts) return '--';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

// Logo/QR images are set inline in app.html before this module loads

// ============ AUTH ============
window.doLogin = function() {
  const mobile = document.getElementById('li-email').value.trim();
  const pass = document.getElementById('li-pass').value;
  const errEl = document.getElementById('login-err');
  errEl.classList.remove('show');
  if (!mobile || !pass) {
    errEl.textContent = 'Please enter mobile number and password · ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಮತ್ತು ಪಾಸ್‌ವರ್ಡ್ ನಮೂದಿಸಿ';
    errEl.classList.add('show');
    return;
  }
  // Mobile-based login: convert to synthetic email if a 10-digit number was entered
  const email = /^\d{10}$/.test(mobile) ? `${mobile}@msskadle.app` : mobile;
  showLoader(true);
  signInWithEmailAndPassword(auth, email, pass)
    .then(() => {})
    .catch(err => {
      showLoader(false);
      let msg = 'Login failed · ಲಾಗಿನ್ ವಿಫಲ';
      if (['auth/invalid-credential','auth/wrong-password','auth/user-not-found','auth/invalid-email'].includes(err.code)) {
        msg = 'Invalid mobile number or password · ತಪ್ಪಾದ ಮೊಬೈಲ್/ಪಾಸ್‌ವರ್ಡ್';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Too many attempts. Try again later.';
      }
      errEl.textContent = msg;
      errEl.classList.add('show');
    });
};

window.doForgotPass = function() {
  const email = document.getElementById('li-email').value.trim();
  if (!email) { showToast('Enter your email first · ಇಮೇಲ್ ನಮೂದಿಸಿ'); return; }
  showLoader(true);
  sendPasswordResetEmail(auth, email)
    .then(() => { showLoader(false); showToast('Password reset email sent · ಇಮೇಲ್ ಕಳುಹಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Could not send reset email'); });
};

window.doLogout = function() { signOut(auth); };

// ============ REGISTRATION ============
window.showReg = function() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('reg-screen').style.display = 'flex';
};
window.hideReg = function() {
  document.getElementById('reg-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
};

window.doRegister = function() {
  const name = document.getElementById('rg-name').value.trim();
  const nameKn = document.getElementById('rg-name-kn').value.trim();
  const dob = document.getElementById('rg-dob').value;
  const mobile = document.getElementById('rg-mobile').value.trim();
  const pass = document.getElementById('rg-pass').value;
  const pass2 = document.getElementById('rg-pass2').value;
  const errEl = document.getElementById('reg-err');
  errEl.classList.remove('show');

  if (!name || !pass || !mobile) {
    errEl.textContent = 'Please fill all required fields · ಎಲ್ಲಾ ಮಾಹಿತಿ ತುಂಬಿರಿ';
    errEl.classList.add('show'); return;
  }
  if (!/^\d{10}$/.test(mobile)) {
    errEl.textContent = 'Enter a valid 10-digit mobile number · ಸರಿಯಾದ 10 ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ';
    errEl.classList.add('show'); return;
  }
  if (pass.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters';
    errEl.classList.add('show'); return;
  }
  if (pass !== pass2) {
    errEl.textContent = 'Passwords do not match · ಪಾಸ್‌ವರ್ಡ್ ಹೊಂದಿಕೆಯಾಗುತ್ತಿಲ್ಲ';
    errEl.classList.add('show'); return;
  }

  const email = `${mobile}@msskadle.app`;
  showLoader(true);
  createUserWithEmailAndPassword(auth, email, pass)
    .then(async (cred) => {
      const uid = cred.user.uid;
      await setDoc(doc(db, 'members', uid), {
        name, nameKn, dob, mobile, email,
        role: 'member',
        status: 'pending',
        totalSavings: 0,
        membershipFeePaid: 0,
        loanRepaid: 0,
        memberSince: serverTimestamp(),
        createdAt: serverTimestamp()
      });
      showLoader(false);
      showToast('✅ Registration submitted! Awaiting admin approval · ನೋಂದಣಿ ಸಲ್ಲಿಸಲಾಗಿದೆ');
      hideReg();
      document.getElementById('li-email').value = email;
      signOut(auth);
    })
    .catch(err => {
      showLoader(false);
      let msg = 'Registration failed';
      if (err.code === 'auth/email-already-in-use') msg = 'Mobile number already registered · ಈ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಈಗಾಗಲೇ ನೋಂದಣಿ ಆಗಿದೆ';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid mobile number';
      else if (err.code === 'auth/weak-password') msg = 'Password too weak';
      errEl.textContent = msg;
      errEl.classList.add('show');
    });
};

// ============ AUTH STATE LISTENER ============
onAuthStateChanged(auth, async (user) => {
  if (user) {
    showLoader(true);
    currentUser = user;
    const snap = await getDoc(doc(db, 'members', user.uid));
    if (!snap.exists()) {
      showLoader(false);
      showToast('Profile not found. Contact admin.');
      signOut(auth);
      return;
    }
    currentProfile = { id: user.uid, ...snap.data() };

    if (currentProfile.status === 'pending') {
      showLoader(false);
      showToast('⏳ Your account is pending admin approval · ಅನುಮೋದನೆ ಬಾಕಿಯಿದೆ');
      signOut(auth);
      return;
    }
    if (currentProfile.status === 'rejected') {
      showLoader(false);
      showToast('Your registration was not approved. Contact admin.');
      signOut(auth);
      return;
    }

    isAdmin = currentProfile.role === 'admin';
    enterApp();
    showLoader(false);
  } else {
    currentUser = null;
    currentProfile = null;
    isAdmin = false;
    exitApp();
  }
});

// ============ APP ENTER/EXIT ============
function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('reg-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  const greetName = document.getElementById('greet-name');
  greetName.innerHTML = `Welcome, ${currentProfile.name} 🙏<span class="k"> · ಸ್ವಾಗತ</span>`;

  document.getElementById('pname').textContent = currentProfile.name;
  document.getElementById('pid').textContent = currentProfile.email;
  document.getElementById('pav').textContent = isAdmin ? '⚙️' : '👤';
  document.getElementById('pbadge').textContent = isAdmin ? 'Admin' : 'Active Member';
  document.getElementById('m-admin').style.display = isAdmin ? 'flex' : 'none';

  document.getElementById('m-total').textContent = fmtMoney(currentProfile.totalSavings);
  document.getElementById('m-fee').textContent = fmtMoney(currentProfile.membershipFeePaid);
  document.getElementById('m-loan').textContent = fmtMoney(currentProfile.loanRepaid);
  document.getElementById('m-since').textContent = 'Member since ' + fmtDate(currentProfile.memberSince);

  checkBirthdays();
  listenAnnouncements();
  listenGallery();
  listenMyTransactions();
  listenMyRequests();
  if (isAdmin) {
    listenAllMembers();
    listenAllRequests();
  }

  goTab('home');
  tick();
}

function exitApp() {
  document.getElementById('app').style.display = 'none';
  document.getElementById('reg-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('li-email').value = '';
  document.getElementById('li-pass').value = '';
  [unsubMembers, unsubAnns, unsubMyReqs, unsubMyTxns, unsubGallery, unsubAllReqs].forEach(u => { if (u) u(); });
}

// ============ NAVIGATION ============
window.goTab = function(t) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('s-' + t).classList.add('active');
  const nb = document.getElementById('bn-' + t);
  if (nb) nb.classList.add('active');
  document.getElementById('s-' + t).scrollTop = 0;
};

window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };

// ============ BIRTHDAY CHECK ============
function checkBirthdays() {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const banner = document.getElementById('bday-banner');

  getDocs(collection(db, 'members')).then(snap => {
    const todays = [];
    snap.forEach(d => {
      const m = d.data();
      if (m.dob && m.status === 'approved') {
        const parts = m.dob.split('-');
        if (parts.length === 3 && parts[1] === mm && parts[2] === dd) todays.push(m);
      }
    });
    if (todays.length > 0) {
      const names = todays.map(m => (m.nameKn || m.name)).join(', ');
      banner.innerHTML = `
        <div class="bday-card">
          <div class="bi">🎂</div>
          <div class="bt">
            <strong>Happy Birthday! · ಹುಟ್ಟುಹಬ್ಬದ ಶುಭಾಶಯಗಳು</strong>
            <span>${names} 🎉</span>
          </div>
        </div>`;
    } else {
      banner.innerHTML = '';
    }
  }).catch(() => { banner.innerHTML = ''; });
}

// ============ COUNTDOWN ============
const EVTS = [new Date('2026-09-14T00:30:00Z'), new Date('2026-09-18T10:30:00Z'), new Date('2026-11-01T12:00:00Z')];
function pad(n) { return String(n).padStart(2, '0'); }
function tick() {
  const now = new Date();
  EVTS.forEach((ev, i) => {
    const diff = ev - now;
    const ids = ['d' + i, 'h' + i, 'm' + i, 's' + i];
    if (diff <= 0) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '00'; }); return; }
    const v = [Math.floor(diff / 86400000), Math.floor((diff % 86400000) / 3600000), Math.floor((diff % 3600000) / 60000), Math.floor((diff % 60000) / 1000)];
    ids.forEach((id, j) => { const el = document.getElementById(id); if (el) el.textContent = pad(v[j]); });
  });
}
setInterval(() => { if (currentUser) tick(); }, 1000);

// ============ GALLERY ============
window.showYr = function(yr, btn) {
  document.querySelectorAll('#s-gallery .ytab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['2025', '2026'].forEach(y => document.getElementById('gy-' + y).style.display = y === yr ? 'grid' : 'none');
};

function listenGallery() {
  if (unsubGallery) unsubGallery();
  unsubGallery = onSnapshot(query(collection(db, 'gallery'), orderBy('createdAt', 'desc')), snap => {
    const g2025 = document.getElementById('gy-2025');
    const g2026 = document.getElementById('gy-2026');
    g2025.innerHTML = ''; g2026.innerHTML = '';
    let c25 = 0, c26 = 0;
    snap.forEach(d => {
      const p = d.data();
      const target = p.year === '2026' ? g2026 : g2025;
      if (p.year === '2026') c26++; else c25++;
      const card = document.createElement('div');
      card.className = 'gc';
      card.onclick = () => openLB(p.url, (p.captionKn || '') + (p.captionEn ? ' · ' + p.captionEn : ''));
      card.innerHTML = `<img src="${p.url}" alt="" loading="lazy"><div class="gc-ov"><div><span class="gc-kn">${p.captionKn || ''}</span><span class="gc-en">${p.captionEn || ''}</span></div></div>`;
      target.appendChild(card);
    });
    if (c25 === 0) g2025.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="ei">📸</div><div class="et">No photos yet</div></div>';
    if (c26 === 0) g2026.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="ei">📸</div><div class="et">No photos yet</div></div>';
  });
}

// ============ LIGHTBOX ============
window.openLB = function(src, cap) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-cap').textContent = cap || '';
  document.getElementById('lb').classList.add('open');
};
window.closeLB = function() { document.getElementById('lb').classList.remove('open'); };

// ============ ANNOUNCEMENTS ============
let annFirstLoad = true;
function listenAnnouncements() {
  if (unsubAnns) unsubAnns();
  unsubAnns = onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('ann-list');
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">📢</div><div class="et">No announcements yet</div><div class="ek">ಯಾವುದೇ ಘೋಷಣೆಗಳಿಲ್ಲ</div></div>';
    } else {
      list.innerHTML = items.map(a => `
        <div class="ann-item">
          <div class="ann-tag">📢 Announcement</div>
          <div class="ann-t-kn">${a.titleKn || ''}</div>
          <div class="ann-t-en">${a.titleEn || ''}</div>
          <div class="ann-b">${a.body || ''}</div>
          <div class="ann-time">🕐 ${fmtDateTime(a.createdAt)}</div>
        </div>`).join('');
    }

    if (items.length > 0) {
      document.getElementById('ndot').classList.add('show');
      if (annFirstLoad) {
        const recent = items.slice(0, 2);
        document.getElementById('ipop-content').innerHTML = recent.map(a => `
          <div class="ipop-item">
            <div class="ipop-tkn">${a.titleKn || ''}</div>
            <div class="ipop-ten">${a.titleEn || ''}</div>
            <div class="ipop-body">${a.body || ''}</div>
          </div>`).join('');
        if (!sessionStorage.getItem('pop_shown')) {
          setTimeout(() => document.getElementById('ipop').classList.add('open'), 800);
          sessionStorage.setItem('pop_shown', '1');
        }
      }
    }
    annFirstLoad = false;
  });
}
window.closeP = function() { document.getElementById('ipop').classList.remove('open'); };

window.postAnn = function() {
  const tkn = document.getElementById('a-tkn').value.trim();
  const ten = document.getElementById('a-ten').value.trim();
  const body = document.getElementById('a-body').value.trim();
  if (!tkn || !ten) { showToast('Please fill title fields · ಶೀರ್ಷಿಕೆ ನಮೂದಿಸಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'announcements'), {
    titleKn: tkn, titleEn: ten, body, createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('a-tkn').value = '';
    document.getElementById('a-ten').value = '';
    document.getElementById('a-body').value = '';
    showToast('✅ Posted! · ಪ್ರಕಟಿಸಲಾಗಿದೆ');
  }).catch(() => { showLoader(false); showToast('Failed to post'); });
};

// ============ DONATE ============
window.selAmt = function(el, val) {
  document.querySelectorAll('#s-donate .ab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const inp = document.getElementById('amt');
  inp.value = val; if (!val) inp.focus();
};
window.payNow = function() {
  const amt = document.getElementById('amt').value;
  if (!amt || isNaN(amt) || Number(amt) < 1) { showToast('Enter a valid amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }
  const donorName = (currentProfile && currentProfile.name) ? currentProfile.name : 'Donation';
  const note = `Donation - ${donorName}`;
  const params = `pa=${UPI}&pn=${encodeURIComponent(PAYEE)}&am=${amt}&cu=INR&tn=${encodeURIComponent(note)}`;
  launchUpiPayment(params);
  setTimeout(() => showToast('Opening payment app... · ಪಾವತಿ ಆಪ್ ತೆರೆಯುತ್ತಿದೆ'), 300);
};

// ============ MEMBERSHIP PAYMENTS ============
let currentPType = 'Membership Fee';
window.selPType = function(el, type) {
  document.querySelectorAll('#s-membership .pt').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  currentPType = type;
  updatePayBtn();
};
function updatePayBtn() {
  const btn = document.getElementById('btn-mem-pay');
  const amt = document.getElementById('mem-amt').value || '0';
  btn.textContent = `💳 PAY ₹${Number(amt).toLocaleString('en-IN')} · ಪಾವತಿಸಿ`;
}
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'mem-amt') updatePayBtn(); });

window.memPay = async function() {
  const amt = document.getElementById('mem-amt').value;
  if (!amt || isNaN(amt) || Number(amt) < 1) { showToast('Enter a valid amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }

  const docRef = await addDoc(collection(db, 'transactions'), {
    memberId: currentUser.uid,
    memberName: currentProfile.name,
    type: currentPType,
    amount: Number(amt),
    status: 'initiated',
    createdAt: serverTimestamp()
  }).catch(() => null);

  if (!docRef) { showToast('Failed to record payment'); return; }

  const typeLabel = currentPType === 'Loan Repayment' ? 'Loan Repayment' : 'Membership Fee';
  const refId = docRef.id.slice(-6).toUpperCase();
  const note = `${typeLabel} - ${currentProfile.name} - Ref ${refId}`;
  const params = `pa=${UPI}&pn=${encodeURIComponent(PAYEE)}&am=${amt}&cu=INR&tn=${encodeURIComponent(note)}`;
  launchUpiPayment(params);
  setTimeout(() => showToast('Payment recorded. Opening UPI app... · ಪಾವತಿ ದಾಖಲಾಗಿದೆ'), 300);
};

function listenMyTransactions() {
  if (unsubMyTxns) unsubMyTxns();
  unsubMyTxns = onSnapshot(query(collection(db, 'transactions'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('txn-list');
    const items = [];
    let totalFee = 0, totalLoan = 0;
    snap.forEach(d => {
      const t = d.data();
      if (t.memberId === currentUser.uid) {
        items.push(t);
        if (t.status === 'confirmed') {
          if (t.type === 'Loan Repayment') totalLoan += t.amount;
          else totalFee += t.amount;
        }
      }
    });

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">💳</div><div class="et">No transactions yet</div><div class="ek">ಯಾವುದೇ ಪಾವತಿಗಳಿಲ್ಲ</div></div>';
    } else {
      list.innerHTML = items.map(t => {
        const isLoan = t.type === 'Loan Repayment';
        const statusLabel = t.status === 'confirmed' ? '✅' : (t.status === 'rejected' ? '❌' : '⏳');
        return `<div class="txn-item">
          <div class="txn-icon ${isLoan ? 'loan' : ''}">${isLoan ? '🏦' : '💰'}</div>
          <div class="txn-mid"><strong>${t.type} ${statusLabel}</strong><span>${fmtDateTime(t.createdAt)} · ${t.status}</span></div>
          <div class="txn-amt ${isLoan ? 'loan' : ''}">${fmtMoney(t.amount)}</div>
        </div>`;
      }).join('');
    }

    document.getElementById('m-fee').textContent = fmtMoney(totalFee + (currentProfile.membershipFeePaid || 0));
    document.getElementById('m-loan').textContent = fmtMoney(totalLoan + (currentProfile.loanRepaid || 0));
    const total = totalFee + totalLoan + (currentProfile.totalSavings || 0);
    document.getElementById('m-total').textContent = fmtMoney(total);
  });
}

// ============ REQUESTS ============
window.submitRequest = function() {
  const title = document.getElementById('req-title').value.trim();
  const body = document.getElementById('req-body').value.trim();
  if (!title || !body) { showToast('Please fill all fields · ಎಲ್ಲಾ ಮಾಹಿತಿ ತುಂಬಿರಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'requests'), {
    memberId: currentUser.uid,
    memberName: currentProfile.name,
    title, body,
    status: 'pending',
    createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('req-title').value = '';
    document.getElementById('req-body').value = '';
    closeModal('req-modal');
    showToast('✅ Request submitted · ಮನವಿ ಸಲ್ಲಿಸಲಾಗಿದೆ');
  }).catch(() => { showLoader(false); showToast('Failed to submit'); });
};

function listenMyRequests() {
  if (unsubMyReqs) unsubMyReqs();
  unsubMyReqs = onSnapshot(query(collection(db, 'requests'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('req-list');
    const items = [];
    snap.forEach(d => { const r = d.data(); if (r.memberId === currentUser.uid) items.push(r); });
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">📋</div><div class="et">No requests yet</div><div class="ek">+ ಒತ್ತಿ ಹೊಸ ಮನವಿ ಸಲ್ಲಿಸಿ</div></div>';
    } else {
      list.innerHTML = items.map(r => `
        <div class="req-card">
          <span class="req-status ${r.status}">${r.status}</span>
          <div class="req-title">${r.title}</div>
          <div class="req-body">${r.body}</div>
          ${r.adminReply ? `<div class="req-body" style="margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--border);"><strong>Admin reply:</strong> ${r.adminReply}</div>` : ''}
          <div class="req-time">🕐 ${fmtDateTime(r.createdAt)}</div>
        </div>`).join('');
    }
  });
}

// ============ ADMIN: MEMBERS ============
function listenAllMembers() {
  if (unsubMembers) unsubMembers();
  unsubMembers = onSnapshot(collection(db, 'members'), snap => {
    const list = document.getElementById('admin-member-list');
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">👥</div><div class="et">No members yet</div></div>';
      return;
    }

    list.innerHTML = items.map(m => `
      <div class="member-row">
        <div class="mr-av">${m.role === 'admin' ? '⚙️' : '👤'}</div>
        <div class="mr-mid">
          <strong>${m.name} ${m.role === 'admin' ? '<span class="admin-badge">ADMIN</span>' : ''}</strong>
          <span>${m.email} · ${m.mobile || ''} ${m.dob ? '· DOB: ' + m.dob : ''}</span>
        </div>
        ${m.status === 'pending' ?
          `<button onclick="approveMember('${m.id}')" style="background:var(--green);color:white;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;">Approve</button>`
          : `<span class="mr-badge approved">Active</span>`
        }
      </div>`).join('');
  });
}

window.approveMember = function(uid) {
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { status: 'approved' })
    .then(() => { showLoader(false); showToast('✅ Member approved · ಸದಸ್ಯ ಅನುಮೋದಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Failed'); });
};

// ============ ADMIN: REQUESTS ============
function listenAllRequests() {
  if (unsubAllReqs) unsubAllReqs();
  unsubAllReqs = onSnapshot(query(collection(db, 'requests'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('admin-req-list');
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">📋</div><div class="et">No requests</div></div>';
      return;
    }
    list.innerHTML = items.map(r => `
      <div class="req-card">
        <span class="req-status ${r.status}">${r.status}</span>
        <div class="req-title">${r.title}</div>
        <div class="req-body"><strong>${r.memberName}</strong>: ${r.body}</div>
        <div class="req-time">🕐 ${fmtDateTime(r.createdAt)}</div>
        ${r.status === 'pending' ? `
          <div style="display:flex;gap:.5rem;margin-top:.6rem;">
            <button onclick="updateReq('${r.id}','approved')" style="flex:1;background:var(--green);color:white;border:none;padding:.5rem;border-radius:6px;font-size:.7rem;font-weight:700;cursor:pointer;">✓ Approve</button>
            <button onclick="updateReq('${r.id}','rejected')" style="flex:1;background:var(--red);color:white;border:none;padding:.5rem;border-radius:6px;font-size:.7rem;font-weight:700;cursor:pointer;">✕ Reject</button>
          </div>` : ''}
      </div>`).join('');
  });
}
window.updateReq = function(id, status) {
  updateDoc(doc(db, 'requests', id), { status })
    .then(() => showToast('Updated · ಅಪ್‌ಡೇಟ್ ಆಗಿದೆ'))
    .catch(() => showToast('Failed'));
};

// ============ ADMIN TABS ============
window.showAdminTab = function(tab, btn) {
  document.querySelectorAll('#s-admin .ytabs .ytab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ['members', 'requests', 'ann', 'gallery'].forEach(t => {
    document.getElementById('admin-' + t).style.display = t === tab ? 'block' : 'none';
  });
};

// ============ ADMIN: GALLERY UPLOAD ============
let uploadYear = '2025';
window.setUploadYear = function(yr, btn) {
  document.querySelectorAll('#admin-gallery .ytab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  uploadYear = yr;
};

window.handleUpload = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const captionKn = document.getElementById('g-kn').value.trim();
  const captionEn = document.getElementById('g-en').value.trim();

  showLoader(true);
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

      addDoc(collection(db, 'gallery'), {
        url: dataUrl, captionKn, captionEn, year: uploadYear, createdAt: serverTimestamp()
      }).then(() => {
        showLoader(false);
        document.getElementById('g-kn').value = '';
        document.getElementById('g-en').value = '';
        document.getElementById('admin-file').value = '';
        showToast('✅ Photo uploaded · ಚಿತ್ರ ಅಪ್‌ಲೋಡ್ ಆಗಿದೆ');
      }).catch(() => { showLoader(false); showToast('Upload failed (image may be too large)'); });
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

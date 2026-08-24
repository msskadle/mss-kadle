// ============ FIREBASE SETUP ============
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, deleteField,
  collection, addDoc, query, orderBy, where, onSnapshot, serverTimestamp, Timestamp,
  getCountFromServer
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
const UPI_MAX_AMOUNT = 2000;
let pendingUpiParams = null;

// Bank of Baroda signed MERCHANT QR (bob World Merchant) for SHREE MAHAGANAPATI SEVA SANGHA.
// This is a VERIFIED P2M payee, which is what lets prefilled amounts and the in-app
// Google Pay / PhonePe / Paytm buttons go through. The sign= signature covers the payee
// identity only; the amount is filled in by the payer, so injecting am= keeps it valid.
// Do NOT reorder, edit, or re-encode any field below — it must match the bank QR exactly.
const MERCHANT_UPI_BASE = 'pa=shreem9916106@barodampay&pn=SHREE MAHAGANAPATI SEVA SANGHA&mc=&tn=UPI&am=&cu=INR&url=&mode=02&orgid=159012&mid=&msid=&mtid=&sign=MEUCIH1J0O9bDy1VNa0zP3aMQsR0WkDQRVU8MoI0JFTTU2qpAiEAoI3rH1AEAi4nwRTCeSXeUwYrs4M6jyRWYYNdFejHNiU=';

// Build the merchant payment string with the amount filled in (2-decimal format).
function buildMerchantUpiParams(amount) {
  const amtFmt = Number(amount).toFixed(2);
  return MERCHANT_UPI_BASE.replace('&am=&', `&am=${amtFmt}&`);
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

// Android: upi:// opens the system app chooser (GPay/PhonePe/Paytm/etc).
// iOS: no generic upi:// chooser exists, so we show app-specific scheme
// buttons plus a QR (incl. "upload from gallery to scan" fallback).
function launchUpiPayment(params) {
  if (isAndroid()) {
    window.location.href = `upi://pay?${params}`;
  }
  pendingUpiParams = params;
  showUpiOptions(params);
}

function parseQueryParams(qs) {
  const out = {};
  qs.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    out[k] = decodeURIComponent(v || '');
  });
  return out;
}

// App-specific custom URL schemes — each maps the same UPI params onto its
// own scheme. If the app isn't installed, iOS silently does nothing.
const UPI_APP_SCHEMES = [
  { label: 'Google Pay', icon: '🟢', scheme: 'gpay://upi/pay?' },
  { label: 'PhonePe',    icon: '🟣', scheme: 'phonepe://pay?' },
  { label: 'Paytm',      icon: '🔵', scheme: 'paytmmp://pay?' },
  { label: 'BHIM',       icon: '🟠', scheme: 'bhim://pay?' }
];

window.tryUpiApp = function(scheme) {
  if (!pendingUpiParams) return;
  // pendingUpiParams is the bank's signed MERCHANT string (verified P2M payee),
  // so the prefilled amount is accepted. Pass it through unchanged.
  window.location.href = `${scheme}${pendingUpiParams}`;
};

function showUpiOptions(params) {
  const p = parseQueryParams(params);
  const upiUri = `upi://pay?${params}`;
  document.getElementById('upi-modal-amt').textContent = `₹${p.am}`;
  document.getElementById('upi-modal-id').textContent = p.pa;
  document.getElementById('upi-modal-name').textContent = p.pn || '';
  document.getElementById('upi-modal-note').textContent = p.tn || '';
  document.getElementById('upi-modal-limit').textContent = `Max ₹${UPI_MAX_AMOUNT.toLocaleString('en-IN')} per transaction · ಗರಿಷ್ಠ ₹${UPI_MAX_AMOUNT.toLocaleString('en-IN')}`;

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}`;
  document.getElementById('upi-modal-qr').src = qrUrl;

  const wrap = document.getElementById('upi-app-buttons');
  wrap.innerHTML = UPI_APP_SCHEMES.map(a =>
    `<button onclick="tryUpiApp('${a.scheme}')" class="upi-app-btn">${a.icon} ${a.label}</button>`
  ).join('');

  openModal('upi-modal');
}

// ---- Scan QR from a photo (gallery upload) ----
window.handleQrUpload = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = (ev) => {
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, canvas.width, canvas.height);
        if (code && code.data.startsWith('upi://')) {
          window.location.href = code.data;
        } else {
          showToast('No valid UPI QR found in image · UPI QR ಸಿಗಲಿಲ್ಲ');
        }
      } catch (err) {
        showToast('Could not read QR from image');
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

window.copyUpiId = function() {
  navigator.clipboard?.writeText(UPI);
  showToast(`UPI ID copied: ${UPI} · UPI ID ನಕಲಿಸಲಾಗಿದೆ`);
};

window.copyUpiAmount = function() {
  if (!pendingUpiParams) return;
  const p = parseQueryParams(pendingUpiParams);
  navigator.clipboard?.writeText(p.am);
  showToast(`Amount copied: ₹${p.am} · ಮೊತ್ತ ನಕಲಿಸಲಾಗಿದೆ`);
};

// ============ STATE ============
let currentUser = null;
let currentProfile = null;
let isAdmin = false;
let isTreasurer = false; // kept as alias for "can manage loans" — cosmetic/display use only, see isLoanManager for gating
let isLoanManager = false;   // admin OR has role treasurer/secretary — can manage member loans (given & collected) only
let isElectionOfficer = false; // admin OR has role election_officer — can create/manage elections

const ROLES = {
  admin:               { en: 'Admin',               kn: 'ಆಡಳಿತ' },
  president:           { en: 'President',            kn: 'ಅಧ್ಯಕ್ಷರು' },
  treasurer:           { en: 'Treasurer',            kn: 'ಖಜಾಂಚಿ' },
  secretary:           { en: 'Secretary',             kn: 'ಕಾರ್ಯದರ್ಶಿ' },
  executive_committee: { en: 'Executive Committee',  kn: 'ಕಾರ್ಯಕಾರಿ ಸಮಿತಿ' },
  election_officer:    { en: 'Election Officer',     kn: 'ಚುನಾವಣಾ ಅಧಿಕಾರಿ' },
  member:              { en: 'Member',                kn: 'ಸದಸ್ಯ' }
};

// Backward compatible: old docs have a single `role` string; new docs have a `roles` array.
function rolesOf(m) {
  if (!m) return ['member'];
  if (Array.isArray(m.roles) && m.roles.length) return m.roles;
  if (m.role) return [m.role];
  return ['member'];
}
function hasRole(m, r) { return rolesOf(m).includes(r); }
function isTreasurerOrSecretary(m) { return hasRole(m, 'treasurer') || hasRole(m, 'secretary'); }
function roleBadgesHtml(m) {
  const rs = rolesOf(m).filter(r => r !== 'member');
  const colors = { admin: 'var(--red,#c0392b)', treasurer: 'var(--nv)', secretary: '#8e44ad', president: '#b8860b', executive_committee: '#16a085', election_officer: '#2c3e50' };
  return rs.map(r => `<span class="admin-badge" style="background:${colors[r] || '#6c757d'};">${(ROLES[r] && ROLES[r].en.toUpperCase()) || r.toUpperCase()}</span>`).join(' ');
}

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

// ============ PWA HOME SCREEN ICON FIX ============
// Replaces the generic "M" PWA icon with the association logo already on the page.
// Call this once the logo <img> element is loaded in app.html (id="assoc-logo").
(function injectPwaIcon() {
  function doInject() {
    const logoImg = document.getElementById('assoc-logo');
    if (!logoImg) return; // logo element not present in this build
    const src = logoImg.src || logoImg.getAttribute('src');
    if (!src) return;

    // Update apple-touch-icon (iOS Add to Home Screen)
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = src;

    // Update or create manifest shortcut icon dynamically
    // (manifest.json icons require a separate file, but we can override via theme-color and og:image)
    let ogImage = document.querySelector('meta[property="og:image"]');
    if (!ogImage) {
      ogImage = document.createElement('meta');
      ogImage.setAttribute('property', 'og:image');
      document.head.appendChild(ogImage);
    }
    ogImage.setAttribute('content', src);

    // If src is a base64 data URL (logo stored inline), also set favicon
    let favicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = src;
    favicon.type = src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doInject);
  } else {
    doInject();
  }
})();

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
  const errEl = document.getElementById('login-err');
  errEl.innerHTML = 'Forgot your password? Please contact the admin to reset it · '
    + 'ಪಾಸ್‌ವರ್ಡ್ ಮರೆತಿರಾ? ಮರುಹೊಂದಿಸಲು ಆಡಮಿನ್ ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ:<br>'
    + '📞 <a href="tel:9880166445">9880166445</a> &nbsp;·&nbsp; '
    + '<a href="tel:7975745092">7975745092</a>';
  errEl.classList.add('show');
};

window.doLogout = function() { signOut(auth); };

// ============ PROFILE PICTURE ============
window.changeProfilePic = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showLoader(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        canvas.width = 200; canvas.height = 200;
        const ctx = canvas.getContext('2d');
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        updateDoc(doc(db, 'members', currentUser.uid), { profilePic: dataUrl })
          .then(() => {
            currentProfile.profilePic = dataUrl;
            updateProfilePicUI(dataUrl);
            showLoader(false);
            showToast('✅ Profile photo updated · ಫೋಟೋ ಬದಲಾಯಿಸಲಾಗಿದೆ');
          })
          .catch(() => { showLoader(false); showToast('Failed to update photo'); });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
};

function updateProfilePicUI(dataUrl) {
  const av = document.getElementById('pav');
  if (dataUrl) {
    av.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="Profile">`;
  } else {
    av.textContent = isAdmin ? '⚙️' : (isTreasurer ? '💰' : '👤');
  }
}

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
        role: 'member', roles: ['member'],
        status: 'pending',
        totalSavings: 0,
        membershipFeePaid: 0,
        loanRepaid: 0,
        currentLoan: 0,
        monthlyHistory: {},
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

    { const myRoles = rolesOf(currentProfile);
      isAdmin = myRoles.includes('admin');
      isLoanManager = isAdmin || myRoles.includes('treasurer') || myRoles.includes('secretary');
      isElectionOfficer = isAdmin || myRoles.includes('election_officer');
      isTreasurer = isLoanManager; // display-only alias
    }
    enterApp();
    showLoader(false);
  } else {
    currentUser = null;
    currentProfile = null;
    isAdmin = false;
    isTreasurer = false;
    isLoanManager = false;
    isElectionOfficer = false;
    exitApp();
  }
});

// ============ APP ENTER/EXIT ============
function enterApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('reg-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  refreshBurstConfig();

  const greetName = document.getElementById('greet-name');
  greetName.innerHTML = `Welcome, ${currentProfile.name} 🙏<span class="k"> · ಸ್ವಾಗತ</span>`;

  document.getElementById('pname').textContent = currentProfile.name;
  document.getElementById('pid').textContent = currentProfile.email;
  // Profile pic: all members can tap avatar to change photo
  const avEl = document.getElementById('pav');
  avEl.style.cursor = 'pointer';
  avEl.title = 'Tap to change photo';
  avEl.onclick = window.changeProfilePic;
  updateProfilePicUI(currentProfile.profilePic || null);
  { const myRoles = rolesOf(currentProfile).filter(r => r !== 'member');
    document.getElementById('pbadge').textContent = myRoles.length ? myRoles.map(r => ROLES[r] ? ROLES[r].en : r).join(', ') : 'Active Member'; }
  document.getElementById('m-admin').style.display = isAdmin ? 'flex' : 'none';

  {
    let feeFromHistory = 0;
    const history = currentProfile.monthlyHistory || {};
    Object.values(history).forEach(h => { feeFromHistory += Number(h.fee || 0); });
    const pastSavings = (currentProfile.pastSavings && currentProfile.pastSavings.status === 'approved')
      ? Number(currentProfile.pastSavings.amount || 0) : 0;
    document.getElementById('m-total').textContent = fmtMoney(feeFromHistory + pastSavings);
    // Membership fee = sum of fee entries in monthlyHistory (source of truth)
    document.getElementById('m-fee').textContent = fmtMoney(feeFromHistory);
  }
  // Loan repaid = sum of loanReturned entries in monthlyHistory
  {
    let loanFromHistory = 0;
    const history = currentProfile.monthlyHistory || {};
    Object.values(history).forEach(h => { loanFromHistory += Number(h.loanReturned || 0); });
    document.getElementById('m-loan').textContent = fmtMoney(loanFromHistory);
  }
  document.getElementById('m-since').textContent = 'Member since ' + fmtDate(currentProfile.memberSince);

  // ----- Home screen financial summary boxes (for this member) -----
  {
    const hist = currentProfile.monthlyHistory || {};
    let feeSum = 0, loanRetSum = 0;
    Object.values(hist).forEach(h => { feeSum += Number(h.fee || 0); loanRetSum += Number(h.loanReturned || 0); });
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmtMoney(v); };
    setTxt('h-loan', Number(currentProfile.currentLoan || 0));
    setTxt('h-loanret', loanRetSum);
    setTxt('h-fee', feeSum);
  }
  listenDividend();

  checkBirthdays();
  listenAnnouncements();
  listenGallery();
  listenCommittee();
  listenCountdown();
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
  [unsubMembers, unsubAnns, unsubMyReqs, unsubMyTxns, unsubGallery, unsubAllReqs, unsubMpayMembers, unsubMpayRequests].forEach(u => { if (u) u(); });
}

// ============ NAVIGATION ============
window.goTab = function(t) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.bn').forEach(b => b.classList.remove('active'));
  document.getElementById('s-' + t).classList.add('active');
  const nb = document.getElementById('bn-' + t);
  if (nb) nb.classList.add('active');
  // Members lives under Association now, so keep Association highlighted there
  if (t === 'members') { const a = document.getElementById('bn-assoc'); if (a) a.classList.add('active'); }
  document.getElementById('s-' + t).scrollTop = 0;
  if (t === 'mpay') initMpayTab();
  if (t === 'assoc') loadAssocData();
  if (t === 'donations') loadDonationsTab();
  if (t === 'members') loadMembersTab();
  if (t === 'admin') { if (isAdmin) { listenAdminAnn(); listenAdminApprovals(); listenAnnTemplates(); } }
};

window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };

// ============ RECORD-PURPOSE DISCLAIMER (shown on every tab) ============
function injectDisclaimers() {
  const enText = "For member record-keeping only. All actual transactions are made through the association's nationalised bank account.";
  const knText = "ಇದು ಕೇವಲ ಸದಸ್ಯರ ದಾಖಲೆ ಉದ್ದೇಶಕ್ಕಾಗಿ ಮಾತ್ರ. ಎಲ್ಲಾ ನಿಜವಾದ ವ್ಯವಹಾರಗಳು ಸಂಘದ ರಾಷ್ಟ್ರೀಕೃತ ಬ್ಯಾಂಕ್ ಖಾತೆಯ ಮೂಲಕ ನಡೆಯುತ್ತವೆ.";
  document.querySelectorAll('.screen').forEach(s => {
    if (s.querySelector('.record-disclaimer')) return;
    const d = document.createElement('div');
    d.className = 'record-disclaimer';
    d.style.cssText = "margin:1.2rem 1rem 6rem;padding:.6rem .7rem;background:#fff8f0;border:1px solid #ffd580;border-radius:8px;font-size:.6rem;line-height:1.4;color:var(--sub);text-align:center;";
    d.innerHTML = '<div style="font-weight:700;color:var(--or);margin-bottom:.25rem;">\u2139\ufe0f ' + enText + '</div>'
      + '<div style="font-family:\'Noto Sans Kannada\',sans-serif;">' + knText + '</div>';
    s.appendChild(d);
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectDisclaimers);
} else {
  injectDisclaimers();
}

// ============ CELEBRATION BURST PHOTO (admin-set, e.g. birthdays) ============
// Admin uploads a photo + validity window; while valid the fireworks burst that
// photo, otherwise they burst the association logo. Config lives in Firestore
// (settings/burst) and is cached locally so it shows instantly on app open.
let burstCfg = (function () {
  try { return JSON.parse(localStorage.getItem('mssBurstCfg')) || {}; }
  catch (e) { return {}; }
})();

function cacheBurstCfg(cfg) {
  burstCfg = cfg || {};
  try { localStorage.setItem('mssBurstCfg', JSON.stringify(burstCfg)); } catch (e) {}
}

function burstIsValid(cfg) {
  if (!cfg || !cfg.photo) return false;
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  if (cfg.from && today < cfg.from) return false;
  if (cfg.until && today > cfg.until) return false;
  return true;
}

// The image the fireworks should burst right now.
function getBurstSrc() {
  return burstIsValid(burstCfg) ? burstCfg.photo : window.LOGO_B64;
}

// Pull the latest config from Firestore and cache it for next open.
function refreshBurstConfig() {
  try {
    getDoc(doc(db, 'settings', 'burst')).then(snap => {
      cacheBurstCfg(snap.exists() ? snap.data() : {});
    }).catch(() => {});
  } catch (e) {}
}

// ============ FIRECRACKER BURST ON APP OPEN ============
function playFireworks() {
  if (document.getElementById('fx-canvas')) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'fx-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:99999;pointer-events:none;transition:opacity .7s ease;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const W = canvas.width, H = canvas.height;
  const colors = ['#FFD700', '#FF8C00', '#FF3B30', '#34C759', '#FF6B9D', '#4FC3F7', '#FFFFFF'];
  let parts = [], rockets = [];
  // Association logo, or the admin's celebration photo while it's valid
  let logoImg = null;
  const burstSrc = getBurstSrc();
  if (burstSrc) { logoImg = new Image(); logoImg.src = burstSrc; }
  let logoBursts = [];

  function addBurst(x, y) {
    const n = 46 + Math.floor(Math.random() * 26);
    const base = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2) * (i / n) + Math.random() * 0.2;
      const sp = (1.5 + Math.random() * 4) * dpr;
      parts.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 1, decay: 0.010 + Math.random() * 0.012,
        color: Math.random() < 0.25 ? '#FFFFFF' : base, size: (1.4 + Math.random() * 1.8) * dpr });
    }
    // Pop the association logo out of this burst
    if (logoImg) logoBursts.push({ x: x, y: y, t: 0, dur: 64, rot: (Math.random() - 0.5) * 0.5 });
  }
  function launch() {
    const tx = (0.15 + Math.random() * 0.7) * W;
    const ty = (0.18 + Math.random() * 0.32) * H;
    rockets.push({ x: tx, y: H, tx: tx, ty: ty, vy: -(9 + Math.random() * 3) * dpr,
      color: colors[Math.floor(Math.random() * colors.length)] });
  }

  const launches = 7;
  for (let b = 0; b < launches; b++) setTimeout(launch, 150 + b * 320);

  const grav = 0.045 * dpr, start = Date.now();
  function frame() {
    ctx.clearRect(0, 0, W, H);
    rockets.forEach(r => {
      r.y += r.vy;
      ctx.globalAlpha = 0.9; ctx.fillStyle = r.color;
      ctx.beginPath(); ctx.arc(r.x, r.y, 2.2 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(r.x, r.y + 6 * dpr, 1.4 * dpr, 0, Math.PI * 2); ctx.fill();
    });
    rockets = rockets.filter(r => { if (r.y <= r.ty) { addBurst(r.tx, r.ty); return false; } return true; });
    parts.forEach(p => {
      p.vy += grav; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.vy *= 0.99; p.life -= p.decay;
      if (p.life > 0) {
        ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    parts = parts.filter(p => p.life > 0);
    // Draw the logo bursting out of each explosion
    if (logoImg && logoImg.complete && logoImg.naturalWidth) {
      logoBursts.forEach(b => {
        b.t++;
        const p = b.t / b.dur;                              // 0 -> 1
        const ease = 1 - Math.pow(1 - Math.min(p, 1), 3);   // fast-out grow
        const s = (0.18 + 0.82 * ease) * 84 * dpr;          // grows in
        const alpha = p < 0.15 ? (p / 0.15) : Math.max(0, 1 - (p - 0.15) / 0.85);
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.translate(b.x, b.y - 12 * dpr * ease);          // drifts up
        ctx.rotate(b.rot * ease);
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 22 * dpr;
        ctx.drawImage(logoImg, -s / 2, -s / 2, s, s);
        ctx.restore();
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      logoBursts = logoBursts.filter(b => b.t < b.dur);
    }
    if (Date.now() - start < 3400 || parts.length || rockets.length || logoBursts.length) requestAnimationFrame(frame);
    else done();
  }
  function done() { canvas.style.opacity = '0'; setTimeout(() => canvas.remove(), 800); }
  setTimeout(() => { if (document.getElementById('fx-canvas')) done(); }, 5000);
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', playFireworks);
} else {
  playFireworks();
}

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

// ============ COUNTDOWN + COMMITTEE (live from Firestore) ============
let countdownTimers = [];   // [{id, date:Date}]
let cdCache = {};           // id -> event data (for edit prefill)
let cmCache = {};           // id -> committee data (for edit prefill)
let unsubCountdown = null, unsubCommittee = null;
let unsubDividend = null;

// ----- Dividend (admin sets TOTAL; split equally among approved members) -----
function listenDividend() {
  if (unsubDividend) unsubDividend();
  unsubDividend = onSnapshot(doc(db, 'settings', 'association'), snap => {
    const data = snap.exists() ? snap.data() : {};
    const per = Number(data.dividendPerMember || 0); // this member's equal share
    const total = Number(data.dividend || 0);
    const n = Number(data.dividendMemberCount || 0);

    // Home box: EVERY member (admin included) sees their equal share. Display-only.
    const el = document.getElementById('h-div');
    if (el) el.textContent = fmtMoney(per);
    const pen = document.getElementById('h-div-edit');
    if (pen) pen.style.display = 'none';
    const box = document.getElementById('h-div-box');
    if (box) { box.style.cursor = 'default'; box.onclick = null; }

    // Admin Panel info line (editing lives here now)
    const info = document.getElementById('adm-div-info');
    if (info) {
      info.innerHTML = total > 0
        ? `Total ${fmtMoney(total)} ÷ ${n || '—'} members = <strong>${fmtMoney(per)}</strong> each · ತಲಾ`
        : 'No dividend set yet · ಇನ್ನೂ ನಿಗದಿಯಾಗಿಲ್ಲ';
    }

    // Association tab: dated dividend history, visible to all members
    const list = document.getElementById('assoc-dividend-list');
    if (list) {
      const hist = Array.isArray(data.dividendHistory) ? data.dividendHistory : [];
      if (hist.length === 0) {
        list.innerHTML = '<div style="font-size:.68rem;color:var(--sub);text-align:center;padding:.5rem;">No dividend announced yet · ಇನ್ನೂ ಲಾಭಾಂಶ ಘೋಷಿಸಿಲ್ಲ</div>';
      } else {
        list.innerHTML = hist.slice().reverse().map(h => `
          <div style="background:var(--bg);border-radius:8px;padding:.55rem .6rem;display:flex;justify-content:space-between;align-items:center;gap:.5rem;">
            <div>
              <div style="font-size:.72rem;font-weight:700;">📅 ${h.date || '—'}</div>
              <div style="font-size:.58rem;color:var(--sub);">${h.count || '—'} members · ತಲಾ <strong>${fmtMoney(h.perMember || 0)}</strong></div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:.55rem;color:var(--sub);">Total · ಒಟ್ಟು</div>
              <div style="font-size:.85rem;font-weight:800;color:var(--or);">${fmtMoney(h.total || 0)}</div>
            </div>
          </div>`).join('');
      }
    }
  });
}

window.editDividend = function() {
  if (!isAdmin) return;
  const val = prompt('Enter TOTAL dividend given by the association (₹).\nIt will be split equally among all approved members.\nಒಟ್ಟು ಲಾಭಾಂಶ ಮೊತ್ತ ನಮೂದಿಸಿ (ಎಲ್ಲಾ ಸದಸ್ಯರಿಗೆ ಸಮಾನವಾಗಿ ಹಂಚಲಾಗುವುದು):', '');
  if (val === null) return;
  const total = Number(val);
  if (isNaN(total) || total < 0) { alert('Please enter a valid amount.'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = prompt('Date announced (YYYY-MM-DD) · ಘೋಷಿಸಿದ ದಿನಾಂಕ:', today);
  if (dateStr === null) return;
  showLoader(true);
  getDocs(collection(db, 'members')).then(snap => {
    let n = 0;
    snap.forEach(d => { const m = d.data(); if ((m.status || 'approved') === 'approved') n++; });
    if (n === 0) n = 1; // safety: avoid divide-by-zero
    const perMember = Math.round((total / n) * 100) / 100; // 2-decimal share
    return getDoc(doc(db, 'settings', 'association')).then(s => {
      const cur = s.exists() ? s.data() : {};
      const hist = Array.isArray(cur.dividendHistory) ? cur.dividendHistory.slice() : [];
      hist.push({ date: (dateStr || today).trim(), total: total, perMember: perMember, count: n });
      return setDoc(doc(db, 'settings', 'association'),
        { dividend: total, dividendPerMember: perMember, dividendMemberCount: n, dividendHistory: hist },
        { merge: true });
    }).then(() => {
      showLoader(false);
      showToast(`✅ ${fmtMoney(total)} ÷ ${n} = ${fmtMoney(perMember)} each · ತಲಾ`);
    });
  }).catch(e => { showLoader(false); showToast('Update failed: ' + e.message); });
};
let _seededCD = false, _seededCM = false;

function pad(n) { return String(n).padStart(2, '0'); }
function tick() {
  const now = new Date();
  countdownTimers.forEach(ev => {
    const ids = ['cd-d-' + ev.id, 'cd-h-' + ev.id, 'cd-m-' + ev.id, 'cd-s-' + ev.id];
    const diff = ev.date - now;
    if (isNaN(ev.date) || diff <= 0) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '00'; }); return; }
    const v = [Math.floor(diff / 86400000), Math.floor((diff % 86400000) / 3600000), Math.floor((diff % 3600000) / 60000), Math.floor((diff % 60000) / 1000)];
    ids.forEach((id, j) => { const el = document.getElementById(id); if (el) el.textContent = pad(v[j]); });
  });
}
setInterval(() => { if (currentUser) tick(); }, 1000);

// One-time seed data (only written if the collection is empty and an admin opens the app)
const DEFAULT_COUNTDOWN = [
  { nameEn: 'GANESH CHATURTHI', nameKn: 'ಗಣೇಶ ಚತುರ್ಥಿ', date: '2026-09-14', order: 1 },
  { nameEn: 'VISARJAN', nameKn: 'ವಿಸರ್ಜನ', date: '2026-09-18', order: 2 },
  { nameEn: 'RAJYOTSAVA', nameKn: 'ರಾಜ್ಯೋತ್ಸವ', date: '2026-11-01', order: 3 }
];
const DEFAULT_COMMITTEE = [
  { roleKn: 'ಅಧ್ಯಕ್ಷರು', name: 'ಶ್ರೀ ಈಶ್ವರ ನಾಗಪ್ಪ ನಾಯ್ಕ', order: 1 },
  { roleKn: 'ಉಪಾಧ್ಯಕ್ಷರು', name: 'ಶ್ರೀ ವಿನಾಯಕ ಮಂಜಯ್ಯ ನಾಯ್ಕ', order: 2 },
  { roleKn: 'ಕಾರ್ಯದರ್ಶಿ', name: 'ಶ್ರೀ ರಾಜೇಶ್ ಬೀರಪ್ಪ ನಾಯ್ಕ', order: 3 },
  { roleKn: 'ಖಜಾಂಚಿ', name: 'ಶ್ರೀ ಬೀರಪ್ಪ ಮಹಾದೇವ ನಾಯ್ಕ', order: 4 },
  { roleKn: 'ಸದಸ್ಯರು', name: 'ಶ್ರೀ ಶ್ರೀಧರ ಶಿವು ನಾಯ್ಕ', order: 5 },
  { roleKn: 'ಸದಸ್ಯರು', name: 'ಶ್ರೀ ಸುನಿಲ್ ಗಣಪತಿ ನಾಯ್ಕ', order: 6 },
  { roleKn: 'ಸದಸ್ಯರು', name: 'ಶ್ರೀ ವಿನಾಯಕ ಮಹಾದೇವ ನಾಯ್ಕ', order: 7 }
];

function listenCountdown() {
  if (unsubCountdown) unsubCountdown();
  unsubCountdown = onSnapshot(query(collection(db, 'countdownEvents'), orderBy('order', 'asc')), snap => {
    const row = document.getElementById('countdown-row');
    if (!row) return;

    // Seed to the database once (admin only) so edits persist across the team
    if (snap.empty && isAdmin && !_seededCD) {
      _seededCD = true;
      DEFAULT_COUNTDOWN.forEach(e => addDoc(collection(db, 'countdownEvents'), { ...e, createdAt: serverTimestamp() }));
    }

    // Build the list to display. If the collection is empty (e.g. not yet
    // seeded, or the viewer is a non-admin), fall back to the built-in
    // defaults so the countdown ALWAYS shows for everyone.
    const usingDefaults = snap.empty;
    const items = [];
    if (usingDefaults) {
      DEFAULT_COUNTDOWN.forEach((e, i) => items.push({ id: 'def-' + i, real: false, ...e }));
    } else {
      snap.forEach(d => items.push({ id: d.id, real: true, ...d.data() }));
    }

    // Hide events past their expiry date (same rule the website should use)
    const todayStr = new Date().toLocaleDateString('en-CA');
    const visible = items.filter(e => !e.expiry || e.expiry >= todayStr);
    countdownTimers = []; cdCache = {}; row.innerHTML = '';
    visible.forEach(e => {
      const id = e.id;
      if (e.real) cdCache[id] = e;
      const dt = e.date ? new Date(e.date + 'T06:00:00') : new Date(NaN);
      countdownTimers.push({ id, date: dt });
      const dateLabel = e.date ? dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      const card = document.createElement('div');
      card.className = 'cdc';
      card.innerHTML =
        `<div class="cdc-name">${e.nameEn || ''}</div>` +
        `<span class="cdc-kn">${e.nameKn || ''}${dateLabel ? ' · ' + dateLabel : ''}</span>` +
        `<div class="cdc-trow">` +
          `<div class="tb"><span class="tb-n" id="cd-d-${id}">--</span><span class="tb-l">D</span></div>` +
          `<div class="tb"><span class="tb-n" id="cd-h-${id}">--</span><span class="tb-l">H</span></div>` +
          `<div class="tb"><span class="tb-n" id="cd-m-${id}">--</span><span class="tb-l">M</span></div>` +
          `<div class="tb"><span class="tb-n" id="cd-s-${id}">--</span><span class="tb-l">S</span></div>` +
        `</div>` +
        ((isAdmin && e.real) ? `<div style="margin-top:.5rem;"><button onclick="editCountdownEvent('${id}')" style="width:100%;font-size:.55rem;padding:.3rem;border:none;border-radius:6px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;">✏️ Edit / Expiry · ತಿದ್ದಿ</button></div>` : '');
      row.appendChild(card);
    });
    if (isAdmin) {
      const add = document.createElement('div');
      add.className = 'cdc';
      add.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed rgba(255,255,255,.3);background:transparent;';
      add.innerHTML = '<div style="color:#fff;text-align:center;font-size:.7rem;">＋<br>Add Event</div>';
      add.onclick = window.addCountdownEvent;
      row.appendChild(add);
    }
    tick();
  });
}

// Event add/edit/delete via an in-app form (prompt()/confirm() are blocked in
// iOS standalone PWAs, which is why editing appeared to do nothing).
let _editingEventId = null;
let _evDeleteArmed = false;

function openEventEditor(id) {
  _editingEventId = id;
  _evDeleteArmed = false;
  const e = id ? (cdCache[id] || {}) : {};
  document.getElementById('event-modal-title').innerHTML = id
    ? '✏️ Edit Event <span class="k">· ತಿದ್ದಿ</span>'
    : '＋ Add Event <span class="k">· ಸೇರಿಸಿ</span>';
  document.getElementById('ev-en').value = e.nameEn || '';
  document.getElementById('ev-kn').value = e.nameKn || '';
  document.getElementById('ev-date').value = e.date || '';
  document.getElementById('ev-expiry').value = e.expiry || '';
  document.getElementById('ev-order').value = e.order || 99;
  const del = document.getElementById('ev-delete-btn');
  del.style.display = id ? 'block' : 'none';
  del.textContent = '🗑 Delete Event · ಅಳಿಸಿ';
  openModal('event-modal');
}

window.addCountdownEvent = function() { openEventEditor(null); };
window.editCountdownEvent = function(id) { openEventEditor(id); };

window.saveEventEditor = function() {
  if (!isAdmin) return;
  const nameEn = document.getElementById('ev-en').value.trim();
  const nameKn = document.getElementById('ev-kn').value.trim();
  const date = document.getElementById('ev-date').value;
  const expiry = document.getElementById('ev-expiry').value;
  const order = Number(document.getElementById('ev-order').value) || 99;
  if (!nameEn && !nameKn) { showToast('Enter a name · ಹೆಸರು ನಮೂದಿಸಿ'); return; }
  if (!date) { showToast('Choose a date · ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ'); return; }
  const data = { nameEn, nameKn, date, expiry: expiry || '', order };
  const done = () => { closeModal('event-modal'); showToast('Saved · ಉಳಿಸಲಾಗಿದೆ'); };
  const fail = er => showToast('Error: ' + er.message);
  if (_editingEventId) {
    updateDoc(doc(db, 'countdownEvents', _editingEventId), data).then(done).catch(fail);
  } else {
    addDoc(collection(db, 'countdownEvents'), { ...data, createdAt: serverTimestamp() }).then(done).catch(fail);
  }
};

// Two-tap delete (no confirm() dialog, which iOS PWAs suppress)
window.deleteEventFromEditor = function() {
  if (!isAdmin || !_editingEventId) return;
  const del = document.getElementById('ev-delete-btn');
  if (!_evDeleteArmed) { _evDeleteArmed = true; del.textContent = '⚠️ Tap again to delete · ಮತ್ತೆ ಒತ್ತಿ'; return; }
  deleteDoc(doc(db, 'countdownEvents', _editingEventId))
    .then(() => { closeModal('event-modal'); showToast('Deleted · ಅಳಿಸಲಾಗಿದೆ'); })
    .catch(er => showToast('Error: ' + er.message));
};

function listenCommittee() {
  if (unsubCommittee) unsubCommittee();
  unsubCommittee = onSnapshot(query(collection(db, 'committee'), orderBy('order', 'asc')), snap => {
    if (snap.empty && isAdmin && !_seededCM) {
      _seededCM = true;
      DEFAULT_COMMITTEE.forEach(c => addDoc(collection(db, 'committee'), { ...c, createdAt: serverTimestamp() }));
      return;
    }
    const grid = document.getElementById('committee-grid');
    if (!grid) return;
    cmCache = {}; grid.innerHTML = '';
    const items = []; snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.forEach((c, i) => {
      cmCache[c.id] = c;
      const last = (i === items.length - 1 && items.length % 2 === 1);
      const div = document.createElement('div');
      div.className = 'cmem';
      div.style.cssText = 'background:var(--card);border-radius:var(--rad);padding:.7rem .8rem;box-shadow:0 1px 6px rgba(0,0,0,.05);border-bottom:3px solid var(--or);' + (last ? 'grid-column:1/3;' : '');
      div.innerHTML =
        `<div style="font-size:.6rem;font-weight:800;color:var(--or);letter-spacing:.04em;">${c.roleKn || ''}</div>` +
        `<div style="font-size:.78rem;font-weight:700;color:var(--txt);margin-top:.15rem;">${c.name || ''}</div>` +
        (isAdmin ? `<div style="display:flex;gap:.4rem;margin-top:.45rem;"><button onclick="editCommittee('${c.id}')" style="flex:1;font-size:.55rem;padding:.2rem;border:none;border-radius:6px;background:rgba(0,0,0,.06);cursor:pointer;">✏️ Edit</button><button onclick="deleteCommittee('${c.id}')" style="flex:1;font-size:.55rem;padding:.2rem;border:none;border-radius:6px;background:rgba(220,40,40,.12);color:#b00;cursor:pointer;">🗑</button></div>` : '');
      grid.appendChild(div);
    });
    if (isAdmin) {
      const add = document.createElement('div');
      add.className = 'cmem';
      add.style.cssText = 'grid-column:1/3;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed var(--or);background:transparent;padding:.6rem;border-radius:var(--rad);';
      add.innerHTML = '<div style="color:var(--or);font-weight:700;font-size:.7rem;">＋ Add committee member</div>';
      add.onclick = window.addCommittee;
      grid.appendChild(add);
    }
  });
}

window.addCommittee = function() {
  const roleKn = prompt('Designation (Kannada), e.g. ಅಧ್ಯಕ್ಷರು:'); if (roleKn === null) return;
  const name = prompt('Name (Kannada), e.g. ಶ್ರೀ ... ನಾಯ್ಕ:'); if (!name) return;
  const order = Number(prompt('Display order (number):', '99')) || 99;
  addDoc(collection(db, 'committee'), { roleKn: roleKn.trim(), name: name.trim(), order, createdAt: serverTimestamp() })
    .catch(e => alert('Error: ' + e.message));
};
window.editCommittee = function(id) {
  const c = cmCache[id] || {};
  const roleKn = prompt('Designation (Kannada):', c.roleKn || ''); if (roleKn === null) return;
  const name = prompt('Name (Kannada):', c.name || ''); if (name === null) return;
  const order = Number(prompt('Display order:', c.order || 99)) || c.order || 99;
  updateDoc(doc(db, 'committee', id), { roleKn: roleKn.trim(), name: name.trim(), order })
    .catch(e => alert('Error: ' + e.message));
};
window.deleteCommittee = function(id) {
  if (!confirm('Remove this committee member?')) return;
  deleteDoc(doc(db, 'committee', id)).catch(e => alert('Error: ' + e.message));
};

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
      const id = d.id;
      const target = p.year === '2026' ? g2026 : g2025;
      if (p.year === '2026') c26++; else c25++;
      const card = document.createElement('div');
      card.className = 'gc';
      card.style.position = 'relative';
      card.onclick = () => openLB(p.url, (p.captionKn || '') + (p.captionEn ? ' · ' + p.captionEn : ''));
      card.innerHTML = `<img src="${p.url}" alt="" loading="lazy"><div class="gc-ov"><div><span class="gc-kn">${p.captionKn || ''}</span><span class="gc-en">${p.captionEn || ''}</span></div></div>`
        + (isAdmin ? `<button onclick="event.stopPropagation();deleteGallery('${id}')" title="Delete photo" style="position:absolute;top:6px;right:6px;width:28px;height:28px;border:none;border-radius:50%;background:rgba(220,40,40,.92);color:#fff;font-size:.8rem;line-height:1;cursor:pointer;z-index:2;box-shadow:0 1px 4px rgba(0,0,0,.3);">🗑</button>` : '');
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
    const today = new Date(); today.setHours(0,0,0,0);
    const allItems = [];
    snap.forEach(d => allItems.push({ id: d.id, ...d.data() }));

    // Filter: no validUntil = always show; validUntil = show only if today <= validUntil
    const activeItems = allItems.filter(a => {
      if (!a.validUntil) return true;
      const exp = new Date(a.validUntil); exp.setHours(23,59,59,999);
      return today <= exp;
    });

    if (allItems.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">📢</div><div class="et">No announcements yet</div><div class="ek">ಯಾವುದೇ ಘೋಷಣೆಗಳಿಲ್ಲ</div></div>';
    } else {
      list.innerHTML = allItems.map(a => {
        const expired = a.validUntil && new Date(a.validUntil) < today;
        return `<div class="ann-item" style="${expired ? 'opacity:.5;' : ''}">
          <div class="ann-tag">📢 Announcement${expired ? ' · <span style="color:var(--sub);font-size:.65rem;">Expired</span>' : (a.validUntil ? ` · <span style="font-size:.65rem;color:var(--green);">Valid until ${a.validUntil}</span>` : '')}</div>
          <div class="ann-t-kn">${a.titleKn || ''}</div>
          <div class="ann-t-en">${a.titleEn || ''}</div>
          <div class="ann-b">${a.body || ''}</div>
          ${a.image ? `<img src="${a.image}" style="width:100%;border-radius:10px;margin-top:.5rem;" alt="">` : ''}
          <div class="ann-time">🕐 ${fmtDateTime(a.createdAt)}</div>
        </div>`;
      }).join('');
    }

    // Notification dot and popup only for active (non-expired) announcements
    if (activeItems.length > 0) {
      document.getElementById('ndot').classList.add('show');
      if (annFirstLoad) {
        const recent = activeItems.slice(0, 2);
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
    } else {
      document.getElementById('ndot').classList.remove('show');
    }
    annFirstLoad = false;
  });
}
window.closeP = function() { document.getElementById('ipop').classList.remove('open'); };

// ---- Announcement image/gif attachment ----
let annImageData = null;
window.pickAnnImage = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  // iOS/Safari requires the input to be in the DOM for the picker + change event to fire
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  const cleanup = () => { try { document.body.removeChild(input); } catch (e) {} };
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { cleanup(); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target.result;
      if (file.type === 'image/gif') {
        if (raw.length > 950000) { showToast('GIF too large (keep under ~700KB) · GIF ತುಂಬಾ ದೊಡ್ಡದು'); cleanup(); return; }
        annImageData = raw;
        showAnnPreview(raw);
      } else {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 900;
          const scale = Math.min(1, maxW / img.width);
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          annImageData = canvas.toDataURL('image/jpeg', 0.72);
          showAnnPreview(annImageData);
          cleanup();
        };
        img.onerror = () => { showToast('Could not read image'); cleanup(); };
        img.src = raw;
      }
      if (file.type === 'image/gif') cleanup();
    };
    reader.onerror = () => { showToast('Could not read file'); cleanup(); };
    reader.readAsDataURL(file);
  };
  input.click();
};
function showAnnPreview(src) {
  const p = document.getElementById('a-img-preview');
  if (p) { p.innerHTML = `<img src="${src}" style="max-width:100%;max-height:170px;border-radius:8px;display:block;">`; p.style.display = 'block'; }
  const rm = document.getElementById('a-img-remove');
  if (rm) rm.style.display = 'inline-block';
}
window.removeAnnImage = function() {
  annImageData = null;
  const p = document.getElementById('a-img-preview');
  if (p) { p.innerHTML = ''; p.style.display = 'none'; }
  const rm = document.getElementById('a-img-remove');
  if (rm) rm.style.display = 'none';
};

// ============ ANNOUNCEMENT TEMPLATES ============
let annTemplatesCache = [];
let unsubAnnTemplates = null;

function listenAnnTemplates() {
  if (unsubAnnTemplates) unsubAnnTemplates();
  unsubAnnTemplates = onSnapshot(query(collection(db, 'annTemplates'), orderBy('name')), snap => {
    annTemplatesCache = [];
    snap.forEach(d => annTemplatesCache.push({ id: d.id, ...d.data() }));
    const sel = document.getElementById('ann-template-select');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— None —</option>' +
      annTemplatesCache.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (current && annTemplatesCache.find(t => t.id === current)) sel.value = current;
  });
}

window.saveAnnTemplate = async function() {
  if (!isAdmin) return;
  const tkn = document.getElementById('a-tkn').value.trim();
  const ten = document.getElementById('a-ten').value.trim();
  const body = document.getElementById('a-body').value.trim();
  if (!ten && !tkn) { showToast('Fill in a title before saving as a template · ಮೊದಲು ಶೀರ್ಷಿಕೆ ನಮೂದಿಸಿ'); return; }
  const name = prompt('Name this template (e.g. "Meeting Notice", "Fee Reminder"):', ten || tkn);
  if (!name || !name.trim()) return;
  showLoader(true);
  try {
    await addDoc(collection(db, 'annTemplates'), {
      name: name.trim(), titleKn: tkn, titleEn: ten, body, createdAt: serverTimestamp()
    });
    showLoader(false);
    showToast('✅ Template saved · ಟೆಂಪ್ಲೇಟ್ ಉಳಿಸಲಾಗಿದೆ');
  } catch (e) {
    showLoader(false);
    showToast('Failed to save template');
  }
};

window.useAnnTemplate = function() {
  const sel = document.getElementById('ann-template-select');
  const t = annTemplatesCache.find(x => x.id === sel.value);
  if (!t) return;
  document.getElementById('a-tkn').value = t.titleKn || '';
  document.getElementById('a-ten').value = t.titleEn || '';
  document.getElementById('a-body').value = t.body || '';
  showToast('Template applied — adjust dates/image as needed · ಟೆಂಪ್ಲೇಟ್ ಅನ್ವಯಿಸಲಾಗಿದೆ');
};

window.deleteAnnTemplate = async function() {
  if (!isAdmin) return;
  const sel = document.getElementById('ann-template-select');
  if (!sel.value) { showToast('Select a template to delete'); return; }
  const t = annTemplatesCache.find(x => x.id === sel.value);
  if (!confirm(`Delete template "${t ? t.name : ''}"?`)) return;
  showLoader(true);
  try {
    await deleteDoc(doc(db, 'annTemplates', sel.value));
    sel.value = '';
    showLoader(false);
    showToast('Template deleted');
  } catch (e) {
    showLoader(false);
    showToast('Failed to delete template');
  }
};

window.postAnn = function() {
  const tkn = document.getElementById('a-tkn').value.trim();
  const ten = document.getElementById('a-ten').value.trim();
  const body = document.getElementById('a-body').value.trim();
  const validUntil = document.getElementById('a-valid-until').value;
  if (!tkn || !ten) { showToast('Please fill title fields · ಶೀರ್ಷಿಕೆ ನಮೂದಿಸಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'announcements'), {
    titleKn: tkn, titleEn: ten, body,
    image: annImageData || null,
    validUntil: validUntil || null,
    createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('a-tkn').value = '';
    document.getElementById('a-ten').value = '';
    document.getElementById('a-body').value = '';
    document.getElementById('a-valid-until').value = '';
    removeAnnImage();
    showToast('✅ Posted! · ಪ್ರಕಟಿಸಲಾಗಿದೆ');
    listenAdminAnn();
  }).catch(() => { showLoader(false); showToast('Failed to post'); });
};

let unsubAdminAnns = null;
function listenAdminAnn() {
  if (unsubAdminAnns) unsubAdminAnns();
  unsubAdminAnns = onSnapshot(query(collection(db, 'announcements'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('admin-ann-list');
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">📢</div><div class="et">No announcements</div></div>';
      return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    list.innerHTML = items.map(a => {
      const expired = a.validUntil && new Date(a.validUntil) < today;
      return `<div class="card" style="margin-bottom:.6rem;padding:.8rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
          <div style="flex:1;">
            <div style="font-size:.75rem;font-weight:800;color:var(--txt);">${a.titleEn || ''}</div>
            <div style="font-size:.7rem;color:var(--sub);font-style:italic;">${a.titleKn || ''}</div>
            ${a.body ? `<div style="font-size:.68rem;color:var(--sub);margin-top:.2rem;">${a.body}</div>` : ''}
            ${a.image ? `<img src="${a.image}" style="max-width:100%;max-height:120px;border-radius:8px;margin-top:.4rem;display:block;" alt="">` : ''}
            <div style="font-size:.62rem;color:var(--sub);margin-top:.3rem;">
              🕐 ${fmtDateTime(a.createdAt)}
              ${a.validUntil ? ` · ${expired ? '⛔ Expired' : '✅ Valid until'} ${a.validUntil}` : ' · No expiry'}
            </div>
          </div>
          <button onclick="deleteAnn('${a.id}')" style="background:#fdecea;color:var(--red);border:none;padding:.4rem .6rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;white-space:nowrap;">🗑️ Delete</button>
        </div>
      </div>`;
    }).join('');
  });
}

window.deleteAnn = function(id) {
  if (!confirm('Delete this announcement? · ಈ ಘೋಷಣೆ ಅಳಿಸಲೇ?')) return;
  showLoader(true);
  deleteDoc(doc(db, 'announcements', id))
    .then(() => { showLoader(false); showToast('✅ Deleted · ಅಳಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Failed to delete'); });
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
  if (Number(amt) > UPI_MAX_AMOUNT) { showToast(`Max ₹${UPI_MAX_AMOUNT} per transaction · ಗರಿಷ್ಠ ₹${UPI_MAX_AMOUNT}`); return; }
  const donorName = (currentProfile && currentProfile.name) ? currentProfile.name : 'Donation';
  const note = `${donorName}-Donation`;
  const params = buildMerchantUpiParams(amt);
  launchUpiPayment(params);
  setTimeout(() => showToast('Choose your UPI app · UPI ಆಪ್ ಆಯ್ಕೆಮಾಡಿ'), 300);
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
  if (Number(amt) > UPI_MAX_AMOUNT) { showToast(`Max ₹${UPI_MAX_AMOUNT} per transaction · ಗರಿಷ್ಠ ₹${UPI_MAX_AMOUNT}`); return; }

  const docRef = await addDoc(collection(db, 'transactions'), {
    memberId: currentUser.uid,
    memberName: currentProfile.name,
    type: currentPType,
    amount: Number(amt),
    status: 'initiated',
    createdAt: serverTimestamp()
  }).catch(() => null);

  if (!docRef) { showToast('Failed to record payment'); return; }

  const refId = docRef.id.slice(-6).toUpperCase();
  const note = `${currentProfile.name}-${refId}`;
  const params = buildMerchantUpiParams(amt);
  launchUpiPayment(params);
  setTimeout(() => showToast('Choose your UPI app · UPI ಆಪ್ ಆಯ್ಕೆಮಾಡಿ'), 300);
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

    // Membership fee and loan repaid: always derive from monthlyHistory (source of truth)
    let feeFromHistory = 0;
    let loanFromHistory = 0;
    const history = currentProfile.monthlyHistory || {};
    Object.values(history).forEach(h => {
      feeFromHistory += Number(h.fee || 0);
      loanFromHistory += Number(h.loanReturned || 0);
    });
    document.getElementById('m-fee').textContent = fmtMoney(feeFromHistory);
    document.getElementById('m-loan').textContent = fmtMoney(loanFromHistory);

    // Total Savings = sum of member fee from monthlyHistory + approved past savings
    // (feeFromHistory and history are already computed just above — reuse them)
    const pastSavings = (currentProfile.pastSavings && currentProfile.pastSavings.status === 'approved')
      ? Number(currentProfile.pastSavings.amount || 0) : 0;
    const total = feeFromHistory + pastSavings;
    document.getElementById('m-total').textContent = fmtMoney(total);
  });
}

// ============ MEMBER PAY TAB ============
let mpayMembersCache = [];
let mpaySelectedMemberId = null;
let unsubMpayMembers = null, unsubMpayRequests = null;

function initMpayTab() {
  const treasurerBar = document.getElementById('mpay-treasurer-bar');
  const approvalsSection = document.getElementById('mpay-approvals-section');
  const requestSection = document.getElementById('mpay-request-section');

  if (isLoanManager) {
    treasurerBar.style.display = 'block';
    approvalsSection.style.display = isAdmin ? 'block' : 'none'; // approving fee+loan self-reports is admin-only
    requestSection.style.display = 'block';
    loadMpayMemberList();
    if (isAdmin) listenMpayApprovals();
    // Loan managers (treasurer/secretary, non-admin) get loan-only controls; fee/bulk/reset stay admin-only
    const feeOnlyEls = document.querySelectorAll('.admin-only-mpay');
    feeOnlyEls.forEach(el => el.style.display = isAdmin ? '' : 'none');
    const loanOnlyBtn = document.getElementById('mpay-set-loan-btn');
    if (loanOnlyBtn) loanOnlyBtn.style.display = 'inline-block';
  } else {
    treasurerBar.style.display = 'none';
    approvalsSection.style.display = 'none';
    requestSection.style.display = 'block';
    mpaySelectedMemberId = currentUser.uid;
    renderMpayTable(currentProfile);
    // keep table live-updated for own profile
    if (unsubMpayMembers) unsubMpayMembers();
    unsubMpayMembers = onSnapshot(doc(db, 'members', currentUser.uid), d => {
      if (d.exists()) {
        currentProfile = { id: currentUser.uid, ...d.data() };
        renderMpayTable(currentProfile);
      }
    });
  }

  // default date = today
  const dateInput = document.getElementById('mpay-req-date');
  if (dateInput && !dateInput.value) {
    const now = new Date();
    dateInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  { const _b = document.getElementById('mpay-edit-total-fee-btn'); if (_b) _b.style.display = isAdmin ? 'inline-block' : 'none'; }
  loadTotalFeeCollected();
}

// ---- Org-wide total member fee collected ----
function loadTotalFeeCollected() {
  const out = document.getElementById('mpay-total-fee-collected');
  if (!out) return; // element not present in this layout
  getDoc(doc(db, 'settings', 'totals')).then(snap => {
    const data = snap.exists() ? snap.data() : {};
    if (data.totalFeeOverride !== undefined && data.totalFeeOverride !== null) {
      out.textContent = fmtMoney(data.totalFeeOverride);
    } else {
      computeTotalFeeFromMembers();
    }
  }).catch(() => computeTotalFeeFromMembers());
}

function computeTotalFeeFromMembers() {
  const out = document.getElementById('mpay-total-fee-collected');
  if (!out) return;
  getDocs(collection(db, 'members')).then(snap => {
    let total = 0;
    snap.forEach(d => {
      const m = d.data();
      const history = m.monthlyHistory || {};
      Object.values(history).forEach(h => { total += Number(h.fee || 0); });
    });
    out.textContent = fmtMoney(total);
  });
}

// ---- Past Savings (per-member, one-time admin set + approval) ----
function renderPastSavings(profile) {
  const ps = profile.pastSavings || {};
  const amount = Number(ps.amount || 0);
  const status = ps.status || 'none'; // none | pending | approved

  const amtEl = document.getElementById('mpay-past-savings');
  if (!amtEl) return; // past-savings UI not present in this layout — skip safely
  amtEl.textContent = fmtMoney(amount);

  const statusEl = document.getElementById('mpay-past-savings-status');
  if (statusEl) {
    if (status === 'pending') {
      statusEl.textContent = 'pending approval';
      statusEl.className = 'req-status pending';
      statusEl.style.display = 'inline-block';
    } else if (status === 'approved') {
      statusEl.textContent = 'approved';
      statusEl.className = 'req-status approved';
      statusEl.style.display = 'inline-block';
    } else {
      statusEl.style.display = 'none';
    }
  }

  const editBtn = document.getElementById('mpay-edit-past-savings-btn');
  const approveBtn = document.getElementById('mpay-approve-past-savings-btn');
  if (editBtn) editBtn.style.display = (isAdmin && status !== 'approved') ? 'inline-block' : 'none';
  if (approveBtn) approveBtn.style.display = (isAdmin && status === 'pending') ? 'inline-block' : 'none';
}

window.editPastSavings = function() {
  if (!isAdmin) return;
  const m = mpayMembersCache.find(x => x.id === mpaySelectedMemberId);
  if (!m) return;
  const current = Number((m.pastSavings && m.pastSavings.amount) || 0);
  const val = prompt(`Set Past Savings for ${m.name} (₹). This is a one-time entry that requires approval:`, current);
  if (val === null) return;
  const num = Number(val);
  if (isNaN(num) || num < 0) { showToast('Invalid amount'); return; }
  showLoader(true);
  updateDoc(doc(db, 'members', mpaySelectedMemberId), {
    pastSavings: { amount: num, status: 'pending' }
  }).then(() => {
    showLoader(false);
    showToast('✅ Past savings set. Awaiting approval · ಅನುಮೋದನೆಗೆ ಬಾಕಿ');
    m.pastSavings = { amount: num, status: 'pending' };
    renderPastSavings(m);
  }).catch(() => { showLoader(false); showToast('Failed'); });
};

window.approvePastSavings = function() {
  if (!isAdmin) return;
  const m = mpayMembersCache.find(x => x.id === mpaySelectedMemberId);
  if (!m) return;
  const amount = Number((m.pastSavings && m.pastSavings.amount) || 0);
  showLoader(true);
  updateDoc(doc(db, 'members', mpaySelectedMemberId), {
    pastSavings: { amount, status: 'approved' }
  }).then(() => {
    showLoader(false);
    showToast('✅ Past savings approved · ಅನುಮೋದಿಸಲಾಗಿದೆ');
    m.pastSavings = { amount, status: 'approved' };
    renderPastSavings(m);
  }).catch(() => { showLoader(false); showToast('Failed'); });
};

window.editTotalFeeCollected = function() {
  if (!isAdmin) return;
  const current = document.getElementById('mpay-total-fee-collected').textContent.replace(/[^\d.]/g, '');
  const val = prompt('Set Total Member Fee Collected (₹). Leave blank to auto-calculate from member records:', current);
  if (val === null) return;
  showLoader(true);
  const update = (val.trim() === '')
    ? { totalFeeOverride: null }
    : { totalFeeOverride: Number(val) };
  if (val.trim() !== '' && (isNaN(update.totalFeeOverride) || update.totalFeeOverride < 0)) {
    showLoader(false); showToast('Invalid amount'); return;
  }
  setDoc(doc(db, 'settings', 'totals'), update, { merge: true })
    .then(() => { showLoader(false); showToast('✅ Updated · ನವೀಕರಿಸಲಾಗಿದೆ'); loadTotalFeeCollected(); })
    .catch(() => { showLoader(false); showToast('Failed'); });
}

function loadMpayMemberList() {
  getDocs(collection(db, 'members')).then(snap => {
    mpayMembersCache = [];
    snap.forEach(d => {
      const m = d.data();
      if (m.status === 'approved') mpayMembersCache.push({ id: d.id, ...m });
    });
    mpayMembersCache.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const sel = document.getElementById('mpay-member-select');
    sel.innerHTML = mpayMembersCache.map(m => {
      const rs = rolesOf(m).filter(r => r !== 'member');
      const tag = rs.length ? ` (${rs.map(r => ROLES[r] ? ROLES[r].en : r).join(', ')})` : '';
      return `<option value="${m.id}">${m.name}${tag}</option>`;
    }).join('');

    if (!mpaySelectedMemberId || !mpayMembersCache.find(m => m.id === mpaySelectedMemberId)) {
      mpaySelectedMemberId = currentUser.uid;
    }
    sel.value = mpaySelectedMemberId;
    onMpayMemberChange();
  });
}

window.onMpayMemberChange = function() {
  const sel = document.getElementById('mpay-member-select');
  mpaySelectedMemberId = sel.value;
  const m = mpayMembersCache.find(x => x.id === mpaySelectedMemberId);
  if (m) renderMpayTable(m);
};

const LOAN_INTEREST_RATE = 0.05; // 5% per year
const LOAN_INTEREST_YEARS = 2;

function renderMpayTable(profile) {
  renderPastSavings(profile);
  const currentLoan = Number(profile.currentLoan || 0);
  const history = profile.monthlyHistory || {};
  const months = Object.keys(history).sort();

  let totalReturned = 0;
  // Sum all loanReturned across all months (not just keys in sorted list)
  Object.values(history).forEach(h => { totalReturned += Number(h.loanReturned || 0); });

  const totalInterest = currentLoan > 0 ? currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS : 0;
  const totalRepayable = currentLoan + totalInterest;
  const balanceLoan = currentLoan > 0 ? Math.max(0, totalRepayable - totalReturned) : 0;

  document.getElementById('mpay-current-loan').textContent = fmtMoney(currentLoan);
  document.getElementById('mpay-total-repayable').textContent = currentLoan > 0 ? fmtMoney(totalRepayable) : '—';
  document.getElementById('mpay-loan-returned').textContent = fmtMoney(totalReturned);
  document.getElementById('mpay-balance-loan').textContent = currentLoan > 0 ? fmtMoney(balanceLoan) : fmtMoney(0);

  const tbody = document.getElementById('mpay-table-body');
  const canEdit = isLoanManager && profile.id;
  if (months.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:.8rem;text-align:center;color:var(--sub);">No records yet · ಯಾವುದೇ ದಾಖಲೆಗಳಿಲ್ಲ</td></tr>';
    return;
  }
  tbody.innerHTML = months.map((mo, i) => {
    const h = history[mo];
    const monthLabel = new Date(mo + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    const bg = i % 2 === 0 ? 'var(--card)' : 'var(--bg)';
    const editAttr = canEdit ? ` onclick="editMonthEntry('${profile.id}','${mo}')" style="background:${bg};border-bottom:1px solid var(--border);cursor:pointer;"` : ` style="background:${bg};border-bottom:1px solid var(--border);"`;
    return `<tr${editAttr}>
      <td style="padding:.5rem;">${monthLabel}${canEdit ? ' <span style="opacity:.45;font-size:.8em;">✏️</span>' : ''}</td>
      <td style="padding:.5rem;text-align:right;">${fmtMoney(h.fee || 0)}</td>
      <td style="padding:.5rem;text-align:right;">${fmtMoney(h.loanReturned || 0)}</td>
    </tr>`;
  }).join('');
}

// ---- Admin: correct month + fee; Treasurer/Secretary: correct loan repaid only ----
window.editMonthEntry = function(memberId, month) {
  if (!isLoanManager) return;
  const m = mpayMembersCache.find(x => x.id === memberId);
  if (!m) { showToast('Member not found'); return; }
  const entry = (m.monthlyHistory && m.monthlyHistory[month]) || {};
  const label = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  let newMonth = month;
  let feeVal = entry.fee || 0;

  if (isAdmin) {
    const monthVal = prompt(`Correct MONTH for ${m.name} (currently ${label}).\nEnter as YYYY-MM:`, month);
    if (monthVal === null) return;
    newMonth = monthVal.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(newMonth)) { showToast('Invalid month format · YYYY-MM ಸ್ವರೂಪ ಬಳಸಿ'); return; }

    feeVal = prompt(`Correct FEE for ${m.name} — ${label} (₹):`, Number(entry.fee || 0));
    if (feeVal === null) return;
    if (isNaN(feeVal) || Number(feeVal) < 0) { showToast('Invalid fee amount'); return; }
  }

  const loanVal = prompt(`${isAdmin ? 'Correct' : 'Record'} LOAN REPAID for ${m.name} — ${label} (₹):`, Number(entry.loanReturned || 0));
  if (loanVal === null) return;
  if (isNaN(loanVal) || Number(loanVal) < 0) { showToast('Invalid loan amount'); return; }

  const monthChanged = newMonth !== month;
  const newMonthLabel = new Date(newMonth + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const targetHasData = monthChanged && m.monthlyHistory && m.monthlyHistory[newMonth] &&
    (Number(m.monthlyHistory[newMonth].fee || 0) > 0 || Number(m.monthlyHistory[newMonth].loanReturned || 0) > 0);

  let confirmMsg = isAdmin
    ? `Update entry for ${m.name}?\nFee: ₹${Number(feeVal)}\nLoan repaid: ₹${Number(loanVal)}`
    : `Record loan repaid for ${m.name} — ${label}?\nLoan repaid: ₹${Number(loanVal)}`;
  if (isAdmin) confirmMsg += monthChanged ? `\nMonth: ${label} → ${newMonthLabel}` : `\nMonth: ${label}`;
  if (targetHasData) confirmMsg += `\n\n⚠️ ${newMonthLabel} already has an entry — it will be OVERWRITTEN.`;
  if (!confirm(confirmMsg)) return;

  const newEntry = { fee: Number(feeVal), loanReturned: Number(loanVal) };
  const updatePayload = {};
  if (monthChanged) {
    updatePayload['monthlyHistory.' + month] = deleteField();
    updatePayload['monthlyHistory.' + newMonth] = newEntry;
  } else {
    updatePayload['monthlyHistory.' + month + '.fee'] = newEntry.fee;
    updatePayload['monthlyHistory.' + month + '.loanReturned'] = newEntry.loanReturned;
  }

  showLoader(true);
  updateDoc(doc(db, 'members', memberId), updatePayload).then(() => {
    if (!m.monthlyHistory) m.monthlyHistory = {};
    if (monthChanged) {
      delete m.monthlyHistory[month];
      m.monthlyHistory[newMonth] = newEntry;
    } else {
      m.monthlyHistory[month] = { ...(m.monthlyHistory[month] || {}), ...newEntry };
    }
    const dir = (typeof membersDirCache !== 'undefined') ? membersDirCache.find(x => x.id === memberId) : null;
    if (dir) {
      if (!dir.monthlyHistory) dir.monthlyHistory = {};
      if (monthChanged) {
        delete dir.monthlyHistory[month];
        dir.monthlyHistory[newMonth] = { ...newEntry };
      } else {
        dir.monthlyHistory[month] = { ...(dir.monthlyHistory[month] || {}), ...newEntry };
      }
    }
    showLoader(false);
    showToast('✅ Corrected · ಸರಿಪಡಿಸಲಾಗಿದೆ');
    renderMpayTable(m);
  }).catch(() => { showLoader(false); showToast('Failed to update'); });
};

// ---- Member: raise payment-done request ----
window.submitMpayRequest = function() {
  const dateVal = document.getElementById('mpay-req-date').value;
  const fee = document.getElementById('mpay-req-fee').value;
  const loan = document.getElementById('mpay-req-loan').value;

  if (!dateVal) { showToast('Select payment date · ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ'); return; }
  const feeNum = Number(fee) || 0;
  const loanNum = Number(loan) || 0;
  if (feeNum <= 0 && loanNum <= 0) { showToast('Enter at least one amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }
  if (feeNum < 0 || loanNum < 0) { showToast('Invalid amount · ತಪ್ಪಾದ ಮೊತ್ತ'); return; }

  const month = dateVal.slice(0, 7); // YYYY-MM
  const monthLabel = new Date(dateVal).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  showLoader(true);
  addDoc(collection(db, 'requests'), {
    memberId: currentUser.uid,
    memberName: currentProfile.name,
    title: `Payment Done - ${monthLabel}`,
    body: `Fee: ${fmtMoney(feeNum)} · Loan Repayment: ${fmtMoney(loanNum)} (Date: ${dateVal})`,
    paymentDate: dateVal,
    month,
    feeAmount: feeNum,
    loanAmount: loanNum,
    isPaymentRequest: true,
    status: 'pending',
    createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('mpay-req-fee').value = '';
    document.getElementById('mpay-req-loan').value = '';
    showToast('✅ Request submitted · ಮನವಿ ಸಲ್ಲಿಸಲಾಗಿದೆ');
  }).catch(() => { showLoader(false); showToast('Failed to submit'); });
};

// ---- Treasurer/Admin: pending payment-request approvals ----
function listenMpayApprovals() {
  if (unsubMpayRequests) unsubMpayRequests();
  unsubMpayRequests = onSnapshot(query(collection(db, 'requests'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('mpay-approvals-list');
    const items = [];
    snap.forEach(d => {
      const r = d.data();
      if (r.isPaymentRequest && r.status === 'pending') items.push({ id: d.id, ...r });
    });
    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">✅</div><div class="et">No pending requests</div><div class="ek">ಯಾವುದೇ ಬಾಕಿ ಮನವಿಗಳಿಲ್ಲ</div></div>';
      return;
    }
    list.innerHTML = items.map(r => `
      <div class="req-card">
        <span class="req-status pending">pending</span>
        <div class="req-title">${r.memberName} · ${fmtDate(r.paymentDate)}</div>
        <div class="req-body">Fee: ${fmtMoney(r.feeAmount || 0)} · Loan Repayment: ${fmtMoney(r.loanAmount || 0)}</div>
        <div class="req-time">🕐 ${fmtDateTime(r.createdAt)}</div>
        <div style="display:flex;gap:.5rem;margin-top:.6rem;">
          <button onclick="approveMpayRequest('${r.id}')" style="flex:1;background:var(--green);color:white;border:none;padding:.5rem;border-radius:6px;font-size:.7rem;font-weight:700;cursor:pointer;">✓ Approve</button>
          <button onclick="updateReq('${r.id}','rejected')" style="flex:1;background:var(--red);color:white;border:none;padding:.5rem;border-radius:6px;font-size:.7rem;font-weight:700;cursor:pointer;">✕ Reject</button>
        </div>
      </div>`).join('');
  });
}

window.approveMpayRequest = async function(reqId) {
  if (!isAdmin) return;
  showLoader(true);
  try {
    const reqSnap = await getDoc(doc(db, 'requests', reqId));
    if (!reqSnap.exists()) { showLoader(false); return; }
    const r = reqSnap.data();

    const memberRef = doc(db, 'members', r.memberId);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) { showLoader(false); showToast('Member not found'); return; }
    const member = memberSnap.data();

    const history = { ...(member.monthlyHistory || {}) };
    const entry = { ...(history[r.month] || { fee: 0, loanReturned: 0 }) };
    entry.fee = Number(entry.fee || 0) + Number(r.feeAmount || 0);
    entry.loanReturned = Number(entry.loanReturned || 0) + Number(r.loanAmount || 0);
    history[r.month] = entry;

    // Check if loan is now fully repaid (incl. interest) -> reset currentLoan to 0
    const currentLoan = Number(member.currentLoan || 0);
    const totalRepayable = currentLoan + (currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS);
    let totalReturned = 0;
    Object.values(history).forEach(h => { totalReturned += Number(h.loanReturned || 0); });

    const updatePayload = { monthlyHistory: history };
    if (currentLoan > 0 && totalReturned >= totalRepayable) {
      updatePayload.currentLoan = 0;
    }

    await updateDoc(memberRef, updatePayload);
    await updateDoc(doc(db, 'requests', reqId), { status: 'approved' });

    showLoader(false);
    showToast('✅ Approved & recorded · ಅನುಮೋದಿಸಲಾಗಿದೆ');

    if (mpaySelectedMemberId === r.memberId) {
      const updatedMember = { id: r.memberId, ...member, monthlyHistory: history, currentLoan: (updatePayload.currentLoan !== undefined ? 0 : currentLoan) };
      renderMpayTable(updatedMember);
      const idx = mpayMembersCache.findIndex(m => m.id === r.memberId);
      if (idx >= 0) mpayMembersCache[idx] = updatedMember;
    }
    loadTotalFeeCollected();
  } catch (err) {
    showLoader(false);
    showToast('Failed to approve');
  }
};

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
    const rank = s => s === 'onboarding' ? 0 : (s === 'pending' ? 1 : 2);
    items.sort((a, b) => rank(a.status) - rank(b.status));


    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">👥</div><div class="et">No members yet</div></div>';
      return;
    }

    list.innerHTML = items.map(m => `
      <div class="member-row">
        <div class="mr-av">${hasRole(m, 'admin') ? '⚙️' : (isTreasurerOrSecretary(m) ? '💰' : (m.status === 'onboarding' ? '🕐' : '👤'))}</div>
        <div class="mr-mid">
          <strong>${m.name} ${roleBadgesHtml(m)} ${m.status === 'onboarding' ? '<span class="admin-badge" style="background:#e67e22;">ONBOARDING</span>' : ''}</strong>
          <span>${m.status === 'onboarding' ? 'No login yet — mobile & password needed' : (m.email || '')} ${m.mobile ? '· ' + m.mobile : ''} ${m.dob ? '· DOB: ' + m.dob : ''}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end;">
          ${m.status === 'onboarding' ?
            `<button onclick="completeOnboarding('${m.id}','${m.name.replace(/'/g,"\\'")}','${m.dob || ''}')" style="background:#e67e22;color:white;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;">🚀 Complete Onboarding</button>`
          : m.status === 'pending' ?
            `<button onclick="approveMember('${m.id}')" style="background:var(--green);color:white;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;">Approve</button>`
            : `<button onclick="setMemberLoan('${m.id}','${m.name}',${Number(m.currentLoan || 0)})" style="background:var(--nv);color:white;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;">🏦 Loan: ${fmtMoney(m.currentLoan || 0)}</button>`
          }
          ${m.status === 'approved' ? `<button onclick="openRecordPayment('${m.id}','${m.name.replace(/'/g,'\\\'')}')" style="background:var(--or);color:white;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;">📝 Record Pay</button>` : ''}
          ${m.status === 'approved' ? `<button onclick="setMemberRole('${m.id}','${m.name.replace(/'/g,'\\\'').replace(/"/g,'&quot;')}','${m.role || 'member'}')" style="background:#6c757d;color:white;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.65rem;font-weight:700;cursor:pointer;">🔑 Role</button>` : ''}
        </div>
      </div>`).join('');
  });
}

window.approveMember = function(uid) {
  if (!isAdmin) return;
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { status: 'approved' })
    .then(() => { showLoader(false); showToast('✅ Member approved · ಸದಸ್ಯ ಅನುಮೋದಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Failed'); });
};

window.setMemberLoan = function(uid, name, current) {
  if (!isLoanManager) return;
  const val = prompt(`Set current loan amount for ${name} (₹):`, current);
  if (val === null) return;
  if (isNaN(val) || Number(val) < 0) { showToast('Invalid amount'); return; }
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { currentLoan: Number(val) })
    .then(() => { showLoader(false); showToast('✅ Loan amount updated · ಸಾಲ ಮೊತ್ತ ನವೀಕರಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Failed'); });
};

// Loan managers (treasurer/secretary) reach setMemberLoan from the Member Pay tab's member selector,
// since the Admin Panel member list itself is admin-only.
window.setLoanForSelectedMpayMember = function() {
  if (!isLoanManager) return;
  const m = mpayMembersCache.find(x => x.id === mpaySelectedMemberId);
  if (!m) { showToast('Select a member first'); return; }
  setMemberLoan(m.id, m.name, Number(m.currentLoan || 0));
};

let mrModalUid = null;
window.setMemberRole = function(uid, name, currentRole) {
  if (!isAdmin) return;
  const m = mpayMembersCache.find(x => x.id === uid) || (typeof membersDirCache !== 'undefined' ? membersDirCache.find(x => x.id === uid) : null);
  const current = m ? rolesOf(m) : (currentRole ? [currentRole] : ['member']);
  mrModalUid = uid;
  document.getElementById('mr-modal-name').textContent = name;
  const order = ['admin', 'president', 'treasurer', 'secretary', 'executive_committee', 'election_officer', 'member'];
  document.getElementById('mr-modal-checks').innerHTML = order.map(r => `
    <label style="display:flex;align-items:center;gap:.6rem;font-size:.78rem;">
      <input type="checkbox" class="mr-check" value="${r}" ${current.includes(r) ? 'checked' : ''} style="width:18px;height:18px;">
      ${ROLES[r].en} <span class="k" style="color:var(--sub);font-size:.7rem;">${ROLES[r].kn}</span>
    </label>`).join('');
  openModal('member-roles-modal');
};

window.saveMemberRoles = async function() {
  if (!isAdmin || !mrModalUid) return;
  const checked = Array.from(document.querySelectorAll('.mr-check:checked')).map(c => c.value);
  const newRoles = checked.length ? checked : ['member'];
  showLoader(true);
  try {
    await updateDoc(doc(db, 'members', mrModalUid), { roles: newRoles, role: newRoles[0] });
    showLoader(false);
    closeModal('member-roles-modal');
    showToast('✅ Roles updated · ಪಾತ್ರಗಳು ನವೀಕರಿಸಲಾಗಿದೆ');
  } catch (e) {
    showLoader(false);
    showToast('Failed to update roles');
  }
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
  ['members', 'approvals', 'requests', 'resolutions', 'ann', 'gallery', 'donations', 'burst'].forEach(t => {
    document.getElementById('admin-' + t).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'ann' && isAdmin) listenAdminAnn();
  if (tab === 'burst' && isAdmin) loadBurstAdmin();
  if (tab === 'approvals' && isAdmin) listenAdminApprovals();
  if (tab === 'resolutions' && isAdmin) listenAdminResolutions();
};

// ---- Celebration burst photo admin ----
let burstImageData = null;
window.pickBurstImage = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.position = 'fixed'; input.style.left = '-9999px'; input.style.opacity = '0';
  document.body.appendChild(input);
  const cleanup = () => { try { document.body.removeChild(input); } catch (e) {} };
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) { cleanup(); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        // Square-crop to centre, then shrink to 256px — small enough for Firestore
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        const out = 256;
        const canvas = document.createElement('canvas');
        canvas.width = out; canvas.height = out;
        canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, out, out);
        burstImageData = canvas.toDataURL('image/jpeg', 0.8);
        const prev = document.getElementById('burst-preview');
        prev.style.display = 'block';
        prev.innerHTML = `<img src="${burstImageData}" style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:3px solid var(--or);">`;
        cleanup();
      };
      img.onerror = () => { showToast('Could not read image'); cleanup(); };
      img.src = ev.target.result;
    };
    reader.onerror = () => { showToast('Could not read file'); cleanup(); };
    reader.readAsDataURL(file);
  };
  input.click();
};

function loadBurstAdmin() {
  getDoc(doc(db, 'settings', 'burst')).then(snap => {
    const c = snap.exists() ? snap.data() : {};
    cacheBurstCfg(c);
    document.getElementById('burst-from').value = c.from || '';
    document.getElementById('burst-until').value = c.until || '';
    document.getElementById('burst-label').value = c.label || '';
    const prev = document.getElementById('burst-preview');
    if (c.photo) {
      burstImageData = c.photo;
      prev.style.display = 'block';
      prev.innerHTML = `<img src="${c.photo}" style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:3px solid var(--or);">`;
    } else {
      burstImageData = null;
      prev.style.display = 'none'; prev.innerHTML = '';
    }
    const st = document.getElementById('burst-status');
    if (burstIsValid(c)) st.textContent = `✅ Active now${c.label ? ' · ' + c.label : ''}`;
    else if (c.photo) st.textContent = '⏳ Photo set, but outside its valid dates (logo showing)';
    else st.textContent = 'Showing association logo · ಲಾಂಛನ';
  }).catch(() => {});
}

window.saveBurst = function() {
  if (!isAdmin) return;
  if (!burstImageData) { showToast('Add a photo first · ಮೊದಲು ಫೋಟೋ ಸೇರಿಸಿ'); return; }
  const cfg = {
    photo: burstImageData,
    from: document.getElementById('burst-from').value || '',
    until: document.getElementById('burst-until').value || '',
    label: document.getElementById('burst-label').value.trim() || '',
    updatedAt: Date.now()
  };
  setDoc(doc(db, 'settings', 'burst'), cfg).then(() => {
    cacheBurstCfg(cfg);
    showToast('Saved · ಉಳಿಸಲಾಗಿದೆ 🎆');
    loadBurstAdmin();
  }).catch(() => showToast('Save failed · ಉಳಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ'));
};

window.clearBurst = function() {
  if (!isAdmin) return;
  setDoc(doc(db, 'settings', 'burst'), { photo: '', from: '', until: '', label: '', updatedAt: Date.now() }).then(() => {
    burstImageData = null;
    cacheBurstCfg({});
    showToast('Reverted to logo · ಲಾಂಛನಕ್ಕೆ ಮರಳಿದೆ');
    loadBurstAdmin();
  }).catch(() => showToast('Failed'));
};

// ============ ADMIN: GALLERY UPLOAD ============
let uploadYear = '2025';

window.deleteGallery = function(id) {
  if (!isAdmin) return;
  if (!confirm('Delete this photo? · ಈ ಚಿತ್ರ ಅಳಿಸಲೇ?')) return;
  showLoader(true);
  deleteDoc(doc(db, 'gallery', id))
    .then(() => { showLoader(false); showToast('🗑 Photo deleted · ಚಿತ್ರ ಅಳಿಸಲಾಗಿದೆ'); })
    .catch(e => { showLoader(false); showToast('Delete failed: ' + e.message); });
};

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

// ============ ADMIN: ASSOCIATION COLLECTION ============
// Stored in settings/association doc with fields: fd, interest, extLoanGiven, extLoanReceived
// totalSavings = total member fee collected (from settings/totals, same as Member Pay tab) - fd
// loanGiven (members) = sum of all members' currentLoan

function loadAssocData() {
  document.getElementById('assoc-admin-controls').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('assoc-ext-admin-controls').style.display = isAdmin ? 'flex' : 'none';
  listenAssocResolutions();
  listenAssocElections();

  Promise.all([
    getDoc(doc(db, 'settings', 'association')),
    getDocs(collection(db, 'members'))
  ]).then(([assocSnap, membersSnap]) => {
    // Total savings = sum of all members' monthlyHistory.fee + approved pastSavings
    // Same source as "Total Savings" shown on each member's membership screen
    let totalFee = 0;
    let loanGiven = 0;
    let pastSavingsTotal = 0;
    membersSnap.forEach(d => {
      const m = d.data();
      if (m.status !== 'approved') return; // only active members
      const history = m.monthlyHistory || {};
      Object.values(history).forEach(h => { totalFee += Number(h.fee || 0); });
      loanGiven += Number(m.currentLoan || 0);
      if (m.pastSavings && m.pastSavings.status === 'approved') {
        pastSavingsTotal += Number(m.pastSavings.amount || 0);
      }
    });

    const totalSavings = totalFee + pastSavingsTotal; // total money collected via member fees
    const a = assocSnap.exists() ? assocSnap.data() : {};
    const fd = Number(a.fd || 0);
    const interest = Number(a.interest || 0);
    const extLoanGiven = Number(a.extLoanGiven || 0);
    const extLoanReceived = Number(a.extLoanReceived || 0);
    const extLoanBalance = Math.max(0, extLoanGiven - extLoanReceived);

    document.getElementById('assoc-total-savings').textContent = fmtMoney(totalSavings);
    document.getElementById('assoc-fd').textContent = fmtMoney(fd);
    document.getElementById('assoc-loan-given').textContent = fmtMoney(loanGiven);
    document.getElementById('assoc-interest').textContent = fmtMoney(interest);
    document.getElementById('assoc-ext-loan-given').textContent = fmtMoney(extLoanGiven);
    document.getElementById('assoc-ext-loan-received').textContent = fmtMoney(extLoanReceived);
    document.getElementById('assoc-ext-loan-balance').textContent = fmtMoney(extLoanBalance);
  }).catch(() => showToast('Failed to load association data'));
}

window.editAssocField = function(field, label) {
  if (!isAdmin) return;
  getDoc(doc(db, 'settings', 'association')).then(snap => {
    const d = snap.exists() ? snap.data() : {};
    const current = Number(d[field] || 0);
    const val = prompt(`Set ${label} (₹):`, current);
    if (val === null) return;
    const num = Number(val);
    if (isNaN(num) || num < 0) { showToast('Invalid amount'); return; }

    showLoader(true);
    const update = {};
    update[field] = num;

    setDoc(doc(db, 'settings', 'association'), update, { merge: true })
      .then(() => { showLoader(false); showToast('✅ Updated · ನವೀಕರಿಸಲಾಗಿದೆ'); loadAssocData(); })
      .catch(() => { showLoader(false); showToast('Failed'); });
  }).catch(() => showToast('Failed to load current value'));
};

// ============ ADMIN: ADD MEMBER ============
window.adminAddMember = function() {
  const name = document.getElementById('adm-name').value.trim();
  const nameKn = document.getElementById('adm-name-kn').value.trim();
  const mobile = document.getElementById('adm-mobile').value.trim();
  const dob = document.getElementById('adm-dob').value;
  const pass = document.getElementById('adm-pass').value.trim();
  const errEl = document.getElementById('adm-err');
  errEl.textContent = ''; errEl.classList.remove('show');

  if (!name || !mobile || !pass) {
    errEl.textContent = 'Name, mobile and password are required';
    errEl.classList.add('show'); return;
  }
  if (!/^\d{10}$/.test(mobile)) {
    errEl.textContent = 'Enter a valid 10-digit mobile number';
    errEl.classList.add('show'); return;
  }
  if (pass.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters';
    errEl.classList.add('show'); return;
  }

  const email = `${mobile}@msskadle.app`;
  showLoader(true);

  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").then(({ createUserWithEmailAndPassword }) => {
    createUserWithEmailAndPassword(auth, email, pass)
      .then(async cred => {
        const uid = cred.user.uid;
        await setDoc(doc(db, 'members', uid), {
          name, nameKn: nameKn || name, dob: dob || '', mobile, email,
          role: 'member', roles: ['member'], status: 'approved', // admin-added = auto approved
          totalSavings: 0, membershipFeePaid: 0, loanRepaid: 0, currentLoan: 0,
          monthlyHistory: {},
          memberSince: serverTimestamp(), createdAt: serverTimestamp(),
          addedByAdmin: true
        });
        showLoader(false);
        document.getElementById('adm-name').value = '';
        document.getElementById('adm-name-kn').value = '';
        document.getElementById('adm-mobile').value = '';
        document.getElementById('adm-dob').value = '';
        document.getElementById('adm-pass').value = '';
        showToast(`✅ Member "${name}" added & approved · ಸದಸ್ಯ ಸೇರಿಸಲಾಗಿದೆ`);
      })
      .catch(err => {
        showLoader(false);
        let msg = 'Failed to add member';
        if (err.code === 'auth/email-already-in-use') msg = 'Mobile number already registered · ಈ ಮೊಬೈಲ್ ಈಗಾಗಲೇ ನೋಂದಣಿ ಆಗಿದೆ';
        errEl.textContent = msg; errEl.classList.add('show');
      });
  });
};

// ============ ADMIN: BULK ADD MEMBERS ============
// Uses a secondary Firebase app instance for account creation. createUserWithEmailAndPassword
// signs in as the newly created user on whichever auth instance it runs on — doing this on the
// primary `auth` would repeatedly kick the admin out of their own session mid-batch.
// ---- Admin: read an uploaded .txt/.csv member list into the paste box ----
window.loadBulkMemberFile = function() {
  const input = document.getElementById('adm-bulk-file');
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let text = ev.target.result || '';
    // If it looks like a CSV with a header row (e.g. "Name,Mobile"), drop the header line
    const lines = text.split('\n');
    if (lines[0] && /name/i.test(lines[0]) && /mobile|phone/i.test(lines[0])) lines.shift();
    const textarea = document.getElementById('adm-bulk-text');
    const existing = textarea.value.trim();
    textarea.value = (existing ? existing + '\n' : '') + lines.join('\n').trim();
    showToast('📄 Loaded — review the list below, then tap Add All Members');
  };
  reader.readAsText(file);
};

window.adminBulkAddMembers = async function() {
  if (!isAdmin) { showToast('Admin only'); return; }
  const raw = document.getElementById('adm-bulk-text').value;
  const errEl = document.getElementById('adm-bulk-err');
  const progEl = document.getElementById('adm-bulk-progress');
  errEl.textContent = ''; errEl.classList.remove('show');

  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length);
  if (!lines.length) { errEl.textContent = 'Paste at least one member line'; errEl.classList.add('show'); return; }

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    let name = parts[0] || '';
    let nameKn = '';
    let mobile = '';
    let dob = '';
    let pass = '';

    if (parts[1] && /^\d{10}$/.test(parts[1])) {
      // Standard row: Name, Mobile[, DOB][, Password]
      mobile = parts[1];
      dob = parts[2] || '';
      pass = parts[3] || '';
    } else if (parts[1]) {
      // Kannada,English name pair (no mobile yet) — first field is Kannada, second is English
      nameKn = parts[0];
      name = parts[1];
    }

    if (!name) { errEl.textContent = `Line ${i + 1}: name is required`; errEl.classList.add('show'); return; }
    const finalPass = mobile ? ((pass && pass.length >= 6) ? pass : mobile) : '';
    rows.push({ line: lines[i], name, nameKn, mobile, dob, pass: finalPass });
  }

  const seen = new Set();
  for (const r of rows) {
    if (!r.mobile) continue;
    if (seen.has(r.mobile)) { errEl.textContent = `Duplicate mobile number in list: ${r.mobile}`; errEl.classList.add('show'); return; }
    seen.add(r.mobile);
  }

  const fullCount = rows.filter(r => r.mobile).length;
  const pendingCount = rows.length - fullCount;
  if (!confirm(`Add ${rows.length} member(s)?\n${fullCount} with a mobile number → account created & auto-approved now.\n${pendingCount} name-only → added as "Onboarding" — complete their details later.`)) return;

  showLoader(true);
  progEl.style.display = 'block';

  const secondaryApp = fullCount ? initializeApp(firebaseConfig, 'bulkAdd_' + Date.now()) : null;
  const secondaryAuth = secondaryApp ? getAuth(secondaryApp) : null;

  let successCount = 0;
  const failedRows = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    progEl.textContent = `Adding ${i + 1} / ${rows.length}: ${r.name}...`;
    try {
      if (r.mobile) {
        const email = `${r.mobile}@msskadle.app`;
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, r.pass);
        const uid = cred.user.uid;
        await setDoc(doc(db, 'members', uid), {
          name: r.name, nameKn: r.nameKn || r.name, dob: r.dob || '', mobile: r.mobile, email,
          role: 'member', roles: ['member'], status: 'approved',
          totalSavings: 0, membershipFeePaid: 0, loanRepaid: 0, currentLoan: 0,
          monthlyHistory: {},
          memberSince: serverTimestamp(), createdAt: serverTimestamp(),
          addedByAdmin: true
        });
        await signOut(secondaryAuth).catch(() => {});
      } else {
        // Name-only: no login account yet. Admin fills in mobile/DOB/password later via "Complete Onboarding".
        await addDoc(collection(db, 'members'), {
          name: r.name, nameKn: r.nameKn || r.name, dob: r.dob || '',
          role: 'member', roles: ['member'], status: 'onboarding',
          createdAt: serverTimestamp(), addedByAdmin: true
        });
      }
      successCount++;
    } catch (err) {
      const reason = err.code === 'auth/email-already-in-use' ? 'mobile already registered' : (err.code || 'failed');
      failedRows.push(`${r.line}  ← ${reason}`);
    }
  }

  if (secondaryApp) { try { await deleteApp(secondaryApp); } catch (e) {} }

  showLoader(false);
  progEl.style.display = 'none';
  document.getElementById('adm-bulk-text').value = failedRows.length ? failedRows.map(f => f.split('  ← ')[0]).join('\n') : '';

  if (failedRows.length) {
    errEl.innerHTML = `⚠️ ${failedRows.length} failed (left in the box above to retry):<br>${failedRows.map(f => f.replace(/</g, '&lt;')).join('<br>')}`;
    errEl.classList.add('show');
  }
  showToast(failedRows.length ? `✅ ${successCount} added, ⚠️ ${failedRows.length} failed` : `✅ Added ${successCount} member(s) · ಸೇರಿಸಲಾಗಿದೆ`);
};

// ---- Admin: complete onboarding for a name-only member (adds mobile, DOB, password → creates their login) ----
window.completeOnboarding = async function(placeholderId, currentName, existingDob) {
  if (!isAdmin) return;

  const dobVal = prompt(`Date of birth for ${currentName} (YYYY-MM-DD, optional):`, existingDob || '');
  if (dobVal === null) return;
  const dob = dobVal.trim();
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) { showToast('Invalid DOB format · YYYY-MM-DD ಬಳಸಿ'); return; }

  const mobileVal = prompt(`Mobile number for ${currentName} (10 digits, required):`, '');
  if (mobileVal === null) return;
  const mobile = mobileVal.trim();
  if (!/^\d{10}$/.test(mobile)) { showToast('Enter a valid 10-digit mobile number · ಸರಿಯಾದ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ'); return; }

  const passVal = prompt(`Temporary password for ${currentName} (leave blank to use the mobile number):`, '');
  if (passVal === null) return;
  const pass = (passVal.trim() && passVal.trim().length >= 6) ? passVal.trim() : mobile;

  if (!confirm(`Create login for ${currentName}?\nMobile: ${mobile}\nTemp password: ${pass}`)) return;

  showLoader(true);
  const secondaryApp = initializeApp(firebaseConfig, 'onboard_' + Date.now());
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const email = `${mobile}@msskadle.app`;
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    const uid = cred.user.uid;
    await setDoc(doc(db, 'members', uid), {
      name: currentName, nameKn: currentName, dob: dob || '', mobile, email,
      role: 'member', roles: ['member'], status: 'approved',
      totalSavings: 0, membershipFeePaid: 0, loanRepaid: 0, currentLoan: 0,
      monthlyHistory: {},
      memberSince: serverTimestamp(), createdAt: serverTimestamp(),
      addedByAdmin: true
    });
    await signOut(secondaryAuth).catch(() => {});
    await deleteDoc(doc(db, 'members', placeholderId));
    showLoader(false);
    showToast(`✅ ${currentName} onboarded · ಸೇರಿಸಲಾಗಿದೆ`);
  } catch (err) {
    showLoader(false);
    const reason = err.code === 'auth/email-already-in-use' ? 'This mobile number is already registered to another member' : 'Failed to complete onboarding';
    showToast(reason);
  } finally {
    try { await deleteApp(secondaryApp); } catch (e) {}
  }
};

let recPayMemberId = null;

window.openRecordPayment = function(uid, name) {
  if (!isAdmin) return;
  recPayMemberId = uid;
  document.getElementById('rec-pay-member-name').textContent = `Recording payment for: ${name}`;
  const now = new Date();
  document.getElementById('rec-pay-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('rec-pay-fee').value = '';
  document.getElementById('rec-pay-loan').value = '';
  openModal('rec-pay-modal');
};

window.submitRecordPayment = async function() {
  if (!isAdmin) return;
  if (!recPayMemberId) return;
  const month = document.getElementById('rec-pay-month').value;
  const feeNum = Number(document.getElementById('rec-pay-fee').value) || 0;
  const loanNum = Number(document.getElementById('rec-pay-loan').value) || 0;

  if (!month) { showToast('Select a month · ತಿಂಗಳು ಆಯ್ಕೆಮಾಡಿ'); return; }
  if (feeNum <= 0 && loanNum <= 0) { showToast('Enter at least one amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }

  showLoader(true);
  try {
    const memberRef = doc(db, 'members', recPayMemberId);
    const snap = await getDoc(memberRef);
    if (!snap.exists()) { showLoader(false); showToast('Member not found'); return; }
    const member = snap.data();
    const history = { ...(member.monthlyHistory || {}) };
    const existing = history[month] || { fee: 0, loanReturned: 0 };
    history[month] = {
      fee: Number(existing.fee || 0) + feeNum,
      loanReturned: Number(existing.loanReturned || 0) + loanNum
    };

    // Check if loan fully repaid
    const currentLoan = Number(member.currentLoan || 0);
    const totalRepayable = currentLoan + (currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS);
    let totalReturned = 0;
    Object.values(history).forEach(h => { totalReturned += Number(h.loanReturned || 0); });

    const updatePayload = { monthlyHistory: history };
    if (currentLoan > 0 && totalReturned >= totalRepayable) {
      updatePayload.currentLoan = 0;
    }

    await updateDoc(memberRef, updatePayload);
    showLoader(false);
    closeModal('rec-pay-modal');
    showToast(`✅ Payment recorded for ${month} · ಪಾವತಿ ದಾಖಲಾಯಿತು`);

    // If this member is currently viewed in mpay tab, refresh
    if (mpaySelectedMemberId === recPayMemberId) {
      const updatedMember = { id: recPayMemberId, ...member, ...updatePayload };
      renderMpayTable(updatedMember);
      const idx = mpayMembersCache.findIndex(m => m.id === recPayMemberId);
      if (idx >= 0) mpayMembersCache[idx] = updatedMember;
    }
  } catch(e) {
    showLoader(false);
    showToast('Failed to record payment');
  }
};

// ============ ADMIN: BULK RECORD PAYMENT FOR MULTIPLE MEMBERS ============
let bulkPaySelectedIds = new Set();

window.openBulkRecordPayment = async function() {
  if (!isAdmin) return;
  showLoader(true);
  let approvedMembers = [];
  try {
    const snap = await getDocs(collection(db, 'members'));
    snap.forEach(d => {
      const m = d.data();
      if (m.status === 'approved') approvedMembers.push({ id: d.id, ...m });
    });
    approvedMembers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch (e) {
    showLoader(false);
    showToast('Failed to load members');
    return;
  }
  showLoader(false);

  if (!approvedMembers.length) { showToast('No approved members found'); return; }

  bulkPaySelectedIds = new Set(approvedMembers.map(m => m.id)); // default: all selected

  const now = new Date();
  document.getElementById('bulk-pay-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('bulk-pay-fee').value = '';
  document.getElementById('bulk-pay-loan').value = '';

  const listEl = document.getElementById('bulk-pay-member-list');
  listEl.innerHTML = approvedMembers.map(m => `
    <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer;">
      <input type="checkbox" class="bulk-pay-chk" data-id="${m.id}" checked onchange="bulkPayToggle('${m.id}', this.checked)">
      <span style="font-size:.75rem;">${m.name}</span>
    </label>`).join('');

  updateBulkPayCount();
  openModal('bulk-rec-pay-modal');
};

window.bulkPayToggle = function(memberId, checked) {
  if (checked) bulkPaySelectedIds.add(memberId);
  else bulkPaySelectedIds.delete(memberId);
  updateBulkPayCount();
};

window.bulkPaySelectAll = function(select) {
  document.querySelectorAll('.bulk-pay-chk').forEach(chk => {
    chk.checked = select;
    if (select) bulkPaySelectedIds.add(chk.dataset.id);
    else bulkPaySelectedIds.delete(chk.dataset.id);
  });
  updateBulkPayCount();
};

function updateBulkPayCount() {
  const el = document.getElementById('bulk-pay-count');
  if (el) el.textContent = bulkPaySelectedIds.size;
}

window.submitBulkRecordPayment = async function() {
  if (!isAdmin) return;
  const month = document.getElementById('bulk-pay-month').value;
  const feeNum = Number(document.getElementById('bulk-pay-fee').value) || 0;
  const loanNum = Number(document.getElementById('bulk-pay-loan').value) || 0;

  if (!month) { showToast('Select a month · ತಿಂಗಳು ಆಯ್ಕೆಮಾಡಿ'); return; }
  if (feeNum <= 0 && loanNum <= 0) { showToast('Enter at least one amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }
  const ids = Array.from(bulkPaySelectedIds);
  if (!ids.length) { showToast('Select at least one member · ಒಬ್ಬ ಸದಸ್ಯರನ್ನಾದರೂ ಆಯ್ಕೆಮಾಡಿ'); return; }

  const monthLabel = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const confirmMsg = isAdmin
    ? `Record for ${ids.length} member(s) — ${monthLabel}?\nFee: ₹${feeNum}\nLoan repaid: ₹${loanNum}`
    : `Submit for admin approval — ${ids.length} member(s), ${monthLabel}?\nFee: ₹${feeNum}\nLoan repaid: ₹${loanNum}\n\nThis won't apply until an admin approves it.`;
  if (!confirm(confirmMsg)) return;

  // Admin actions apply immediately. Treasurer (non-admin) actions go to admin for approval.
  if (!isAdmin) {
    showLoader(true);
    try {
      const names = ids.map(id => {
        const m = mpayMembersCache.find(x => x.id === id);
        return m ? m.name : id;
      });
      await addDoc(collection(db, 'adminApprovals'), {
        type: 'bulkRecordPay',
        status: 'pending',
        requestedByUid: currentUser.uid,
        requestedByName: currentProfile.name,
        createdAt: serverTimestamp(),
        payload: { month, fee: feeNum, loan: loanNum, memberIds: ids, memberNames: names }
      });
      showLoader(false);
      closeModal('bulk-rec-pay-modal');
      showToast('📤 Submitted for admin approval · ಅನುಮೋದನೆಗೆ ಕಳುಹಿಸಲಾಗಿದೆ');
    } catch (e) {
      showLoader(false);
      showToast('Failed to submit for approval');
    }
    return;
  }

  showLoader(true);
  const result = await runBulkRecordPayment(month, feeNum, loanNum, ids);
  showLoader(false);
  closeModal('bulk-rec-pay-modal');
  showToast(result.failCount ? `✅ ${result.successCount} recorded, ⚠️ ${result.failCount} failed` : `✅ Recorded for ${result.successCount} member(s) · ದಾಖಲಾಯಿತು`);
  loadTotalFeeCollected();
};

// Shared execution logic for bulk record pay — used for direct admin action and for approved treasurer requests
async function runBulkRecordPayment(month, feeNum, loanNum, ids) {
  let successCount = 0, failCount = 0;
  for (const memberId of ids) {
    try {
      const memberRef = doc(db, 'members', memberId);
      const snap = await getDoc(memberRef);
      if (!snap.exists()) { failCount++; continue; }
      const member = snap.data();
      const history = { ...(member.monthlyHistory || {}) };
      const existing = history[month] || { fee: 0, loanReturned: 0 };
      history[month] = {
        fee: Number(existing.fee || 0) + feeNum,
        loanReturned: Number(existing.loanReturned || 0) + loanNum
      };

      const currentLoan = Number(member.currentLoan || 0);
      const totalRepayable = currentLoan + (currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS);
      let totalReturned = 0;
      Object.values(history).forEach(h => { totalReturned += Number(h.loanReturned || 0); });

      const updatePayload = { monthlyHistory: history };
      if (currentLoan > 0 && totalReturned >= totalRepayable) {
        updatePayload.currentLoan = 0;
      }

      await updateDoc(memberRef, updatePayload);

      // Keep local caches in sync so Member Pay tab reflects instantly
      const idxM = mpayMembersCache.findIndex(x => x.id === memberId);
      if (idxM >= 0) mpayMembersCache[idxM] = { ...mpayMembersCache[idxM], ...updatePayload };
      const dir = (typeof membersDirCache !== 'undefined') ? membersDirCache.find(x => x.id === memberId) : null;
      if (dir) { dir.monthlyHistory = history; if (updatePayload.currentLoan !== undefined) dir.currentLoan = 0; }
      if (mpaySelectedMemberId === memberId) {
        const updatedMember = { id: memberId, ...member, ...updatePayload };
        renderMpayTable(updatedMember);
      }

      successCount++;
    } catch (e) {
      failCount++;
    }
  }
  return { successCount, failCount };
}

// ============ ADMIN: RESET ALL PAYMENT HISTORY (DESTRUCTIVE — clears monthlyHistory, pastSavings, currentLoan for every member) ============
window.resetAllMemberPayments = async function() {
  if (!isAdmin) { showToast("Admin only"); return; }

  showLoader(true);
  let members = [];
  try {
    const snap = await getDocs(collection(db, 'members'));
    snap.forEach(d => members.push({ id: d.id, ...d.data() }));
  } catch (e) {
    showLoader(false);
    showToast('Failed to load members');
    return;
  }
  showLoader(false);

  if (!members.length) { showToast('No members found'); return; }

  if (isAdmin) {
    if (!confirm(`⚠️ This will permanently erase for ALL ${members.length} members:\n\n• Monthly fee & loan repayment history\n• Past Savings entries\n• Current loan amounts (reset to ₹0)\n\nThis cannot be undone. Continue?`)) return;
  } else {
    if (!confirm(`Submit a request to erase payment history for ALL ${members.length} members?\n\nThis needs admin approval before it takes effect.`)) return;
  }

  const typed = prompt(`Type RESET to confirm ${isAdmin ? 'wiping' : 'submitting a request to wipe'} payment data for all ${members.length} members:`);
  if (typed !== 'RESET') { showToast('Cancelled — text did not match'); return; }

  // Admin actions apply immediately. Treasurer (non-admin) actions go to admin for approval.
  if (!isAdmin) {
    showLoader(true);
    try {
      await addDoc(collection(db, 'adminApprovals'), {
        type: 'resetAllPayments',
        status: 'pending',
        requestedByUid: currentUser.uid,
        requestedByName: currentProfile.name,
        createdAt: serverTimestamp(),
        payload: { memberCountAtRequest: members.length }
      });
      showLoader(false);
      showToast('📤 Submitted for admin approval · ಅನುಮೋದನೆಗೆ ಕಳುಹಿಸಲಾಗಿದೆ');
    } catch (e) {
      showLoader(false);
      showToast('Failed to submit for approval');
    }
    return;
  }

  showLoader(true);
  const result = await runResetAllPayments(members);
  showLoader(false);
  showToast(result.failCount ? `✅ ${result.successCount} reset, ⚠️ ${result.failCount} failed` : `✅ Reset complete for ${result.successCount} member(s) · ಅಳಿಸಲಾಗಿದೆ`);
  loadTotalFeeCollected();
};

// Shared execution logic for reset-all — used for direct admin action and for approved treasurer requests
async function runResetAllPayments(members) {
  let successCount = 0, failCount = 0;
  for (const m of members) {
    try {
      await updateDoc(doc(db, 'members', m.id), {
        monthlyHistory: {},
        pastSavings: { amount: 0, status: 'none' },
        currentLoan: 0
      });
      successCount++;
    } catch (e) {
      failCount++;
    }
  }

  mpayMembersCache = mpayMembersCache.map(x => ({ ...x, monthlyHistory: {}, pastSavings: { amount: 0, status: 'none' }, currentLoan: 0 }));
  if (typeof membersDirCache !== 'undefined') {
    membersDirCache = membersDirCache.map(x => ({ ...x, monthlyHistory: {}, pastSavings: { amount: 0, status: 'none' }, currentLoan: 0 }));
  }
  if (mpaySelectedMemberId) {
    const cur = mpayMembersCache.find(x => x.id === mpaySelectedMemberId);
    if (cur) renderMpayTable(cur);
  }
  return { successCount, failCount };
}

// ============ ADMIN: APPROVALS QUEUE (treasurer-submitted bulk pay / reset requests) ============
let unsubAdminApprovals = null;
function listenAdminApprovals() {
  if (!isAdmin) return;
  if (unsubAdminApprovals) unsubAdminApprovals();
  unsubAdminApprovals = onSnapshot(query(collection(db, 'adminApprovals'), orderBy('createdAt', 'desc')), snap => {
    const list = document.getElementById('admin-approvals-list');
    if (!list) return;
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    const badge = document.getElementById('admin-approvals-badge');
    const pendingCount = items.filter(x => x.status === 'pending').length;
    if (badge) badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    if (badge) badge.textContent = pendingCount;

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">✅</div><div class="et">No approval requests</div></div>';
      return;
    }

    list.innerHTML = items.map(a => {
      const label = a.type === 'bulkRecordPay' ? '🧾 Bulk Record Pay' : (a.type === 'resetAllPayments' ? '🗑️ Reset All Payment History' : a.type);
      let details = '';
      if (a.type === 'bulkRecordPay' && a.payload) {
        const monthLabel = a.payload.month ? new Date(a.payload.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '';
        details = `Month: ${monthLabel} · Fee: ₹${a.payload.fee || 0} · Loan: ₹${a.payload.loan || 0}<br>Members (${(a.payload.memberIds || []).length}): ${(a.payload.memberNames || []).join(', ')}`;
      } else if (a.type === 'resetAllPayments') {
        details = `⚠️ Will wipe payment history, past savings & loans for ALL members (~${(a.payload && a.payload.memberCountAtRequest) || '?'} at time of request)`;
      }
      return `<div class="req-card">
        <span class="req-status ${a.status}">${a.status}</span>
        <div class="req-title">${label}</div>
        <div class="req-body">Requested by ${a.requestedByName || 'Treasurer'}<br>${details}</div>
        <div class="req-time">🕐 ${fmtDateTime(a.createdAt)}</div>
        ${a.status === 'pending' ? `<div style="display:flex;gap:.5rem;margin-top:.5rem;">
          <button onclick="approveAdminAction('${a.id}')" style="flex:1;background:var(--green);color:#fff;border:none;padding:.5rem;border-radius:8px;font-size:.7rem;font-weight:700;cursor:pointer;">✅ Approve</button>
          <button onclick="rejectAdminAction('${a.id}')" style="flex:1;background:#c0392b;color:#fff;border:none;padding:.5rem;border-radius:8px;font-size:.7rem;font-weight:700;cursor:pointer;">❌ Reject</button>
        </div>` : ''}
      </div>`;
    }).join('');
  });
}

window.approveAdminAction = async function(approvalId) {
  if (!isAdmin) return;
  showLoader(true);
  try {
    const snap = await getDoc(doc(db, 'adminApprovals', approvalId));
    if (!snap.exists()) { showLoader(false); showToast('Request not found'); return; }
    const a = snap.data();
    if (a.status !== 'pending') { showLoader(false); showToast('Already actioned'); return; }

    let result = { successCount: 0, failCount: 0 };
    if (a.type === 'bulkRecordPay') {
      const p = a.payload || {};
      result = await runBulkRecordPayment(p.month, Number(p.fee || 0), Number(p.loan || 0), p.memberIds || []);
    } else if (a.type === 'resetAllPayments') {
      const membersSnap = await getDocs(collection(db, 'members'));
      const members = [];
      membersSnap.forEach(d => members.push({ id: d.id, ...d.data() }));
      result = await runResetAllPayments(members);
    }

    await updateDoc(doc(db, 'adminApprovals', approvalId), {
      status: 'approved', approvedByUid: currentUser.uid, approvedByName: currentProfile.name, approvedAt: serverTimestamp()
    });

    showLoader(false);
    showToast(`✅ Approved & applied (${result.successCount} updated${result.failCount ? `, ${result.failCount} failed` : ''})`);
    loadTotalFeeCollected();
  } catch (e) {
    showLoader(false);
    showToast('Failed to approve');
  }
};

window.rejectAdminAction = async function(approvalId) {
  if (!isAdmin) return;
  if (!confirm('Reject this request? It will not be applied.')) return;
  showLoader(true);
  try {
    await updateDoc(doc(db, 'adminApprovals', approvalId), {
      status: 'rejected', approvedByUid: currentUser.uid, approvedByName: currentProfile.name, approvedAt: serverTimestamp()
    });
    showLoader(false);
    showToast('Rejected');
  } catch (e) {
    showLoader(false);
    showToast('Failed to reject');
  }
};


const DON_REASONS = {
  'Ganesh Chaturthi': '🐘 Ganesh Chaturthi',
  'Rajyotsava': '🏳️ Rajyotsava',
  'General Donation': '🙏 General Donation',
  'Infrastructure': '🏗️ Infrastructure',
  'Other': '📝 Other'
};

let donationsCache = [];

// Pre-fill the donation form from a past record — for repeat donors / the next drive of the same kind.
// Date and amount are left for the admin to enter fresh; everything else carries over.
window.copyDonationDetails = function(donationId) {
  if (!isAdmin) return;
  const d = donationsCache.find(x => x.id === donationId);
  if (!d) return;
  document.getElementById('don-name').value = d.donorName || '';
  document.getElementById('don-name-kn').value = d.donorNameKn || '';
  document.getElementById('don-reason').value = d.reason || '';
  document.getElementById('don-date').value = '';
  document.getElementById('don-amount').value = '';
  document.getElementById('don-amount').focus();
  showToast('📋 Details copied — set date & amount for the next donation · ದಿನಾಂಕ ಮತ್ತು ಮೊತ್ತ ನಮೂದಿಸಿ');
};


window.showDonTab = function(tab, btn) {
  document.querySelectorAll('#s-donations .ytab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('don-list-received').style.display = tab === 'received' ? 'block' : 'none';
  document.getElementById('don-list-expenses').style.display = tab === 'expenses' ? 'block' : 'none';
};

function loadDonationsTab() {
  // Load both donations and expenses in parallel
  Promise.all([
    getDocs(query(collection(db, 'donations'), orderBy('date', 'desc'))),
    getDocs(query(collection(db, 'donationExpenses'), orderBy('date', 'desc')))
  ]).then(([donSnap, expSnap]) => {
    const donations = [];
    donSnap.forEach(d => donations.push({ id: d.id, ...d.data() }));
    donationsCache = donations;
    const expenses = [];
    expSnap.forEach(d => expenses.push({ id: d.id, ...d.data() }));

    const totalReceived = donations.reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalUtilised = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const balance = totalReceived - totalUtilised;

    document.getElementById('don-total-received').textContent = fmtMoney(totalReceived);
    document.getElementById('don-total-utilised').textContent = fmtMoney(totalUtilised);
    document.getElementById('don-balance').textContent = fmtMoney(balance);

    // Donations list
    const recList = document.getElementById('don-list-received');
    if (donations.length === 0) {
      recList.innerHTML = '<div class="empty-state"><div class="ei">🎁</div><div class="et">No donations recorded yet</div></div>';
    } else {
      recList.innerHTML = donations.map(d => `
        <div class="card" style="margin-bottom:.6rem;padding:.8rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:.8rem;font-weight:800;color:var(--txt);">${d.donorName || 'Anonymous'}</div>
              ${d.donorNameKn ? `<div style="font-size:.72rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${d.donorNameKn}</div>` : ''}
              <div style="font-size:.68rem;color:var(--sub);margin-top:.1rem;">📅 ${d.date || ''} · ${DON_REASONS[d.reason] || d.reason || ''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1rem;font-weight:800;color:var(--green);">+${fmtMoney(d.amount)}</div>
              ${isAdmin ? `<button onclick="copyDonationDetails('${d.id}')" style="margin-top:.3rem;background:var(--nv);color:#fff;border:none;padding:.25rem .55rem;border-radius:6px;font-size:.62rem;font-weight:700;cursor:pointer;">📋 Copy → Next</button>` : ''}
            </div>
          </div>
        </div>`).join('');
    }

    // Expenses list
    const expList = document.getElementById('don-list-expenses');
    if (expenses.length === 0) {
      expList.innerHTML = '<div class="empty-state"><div class="ei">💸</div><div class="et">No expenses recorded yet</div></div>';
    } else {
      expList.innerHTML = expenses.map(e => `
        <div class="card" style="margin-bottom:.6rem;padding:.8rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:.8rem;font-weight:800;color:var(--txt);">${e.description || ''}</div>
              <div style="font-size:.68rem;color:var(--sub);margin-top:.1rem;">📅 ${e.date || ''} · ${DON_REASONS[e.reason] || e.reason || ''}</div>
            </div>
            <div style="font-size:1rem;font-weight:800;color:var(--or);">−${fmtMoney(e.amount)}</div>
          </div>
        </div>`).join('');
    }
  }).catch(() => showToast('Failed to load donations'));
}

window.recordDonation = function() {
  if (!isAdmin) return;
  const donorName = document.getElementById('don-name').value.trim();
  const donorNameKn = document.getElementById('don-name-kn').value.trim();
  const date = document.getElementById('don-date').value;
  const amount = Number(document.getElementById('don-amount').value);
  const reason = document.getElementById('don-reason').value;
  if (!donorName) { showToast('Enter donor name · ದಾನಿ ಹೆಸರು ನಮೂದಿಸಿ'); return; }
  if (!date) { showToast('Select date · ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ'); return; }
  if (!amount || amount <= 0) { showToast('Enter valid amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }
  if (!reason) { showToast('Select a reason · ಕಾರಣ ಆಯ್ಕೆಮಾಡಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'donations'), {
    donorName, donorNameKn: donorNameKn || '', date, amount, reason,
    recordedBy: currentUser.uid, createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('don-name').value = '';
    document.getElementById('don-name-kn').value = '';
    document.getElementById('don-date').value = '';
    document.getElementById('don-amount').value = '';
    document.getElementById('don-reason').value = '';
    showToast('✅ Donation recorded · ದೇಣಿಗೆ ದಾಖಲಾಯಿತು');
  }).catch(() => { showLoader(false); showToast('Failed to record donation'); });
};

// Admin: record an expense/utilisation
window.recordExpense = function() {
  if (!isAdmin) return;
  const description = document.getElementById('exp-desc').value.trim();
  const date = document.getElementById('exp-date').value;
  const amount = Number(document.getElementById('exp-amount').value);
  const reason = document.getElementById('exp-reason').value;
  if (!description) { showToast('Enter description · ವಿವರಣೆ ನಮೂದಿಸಿ'); return; }
  if (!date) { showToast('Select date · ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ'); return; }
  if (!amount || amount <= 0) { showToast('Enter valid amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }
  if (!reason) { showToast('Select a reason · ಕಾರಣ ಆಯ್ಕೆಮಾಡಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'donationExpenses'), {
    description, date, amount, reason, recordedBy: currentUser.uid, createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-date').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-reason').value = '';
    showToast('✅ Expense recorded · ಖರ್ಚು ದಾಖಲಾಯಿತು');
  }).catch(() => { showLoader(false); showToast('Failed to record expense'); });
};

// ============ MEMBERS DIRECTORY TAB ============
let membersDirCache = [];

function loadMembersTab() {
  getDocs(collection(db, 'members')).then(snap => {
    membersDirCache = [];
    snap.forEach(d => {
      const m = d.data();
      if (m.status === 'approved') membersDirCache.push({ id: d.id, ...m });
    });
    membersDirCache.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const sel = document.getElementById('members-dir-select');
    sel.innerHTML = `<option value="all">👥 All Members · ಎಲ್ಲಾ ಸದಸ್ಯರು</option>` +
      membersDirCache.map(m => `<option value="${m.id}">${m.name}${m.nameKn ? ' · ' + m.nameKn : ''}</option>`).join('');
    sel.value = 'all';
    renderMembersList(membersDirCache);
  }).catch(() => showToast('Failed to load members'));
}

window.onMemberDirChange = function() {
  const val = document.getElementById('members-dir-select').value;
  const detailDiv = document.getElementById('members-dir-detail');
  const listDiv = document.getElementById('members-dir-list');
  if (val === 'all') {
    detailDiv.style.display = 'none';
    listDiv.style.display = 'block';
    renderMembersList(membersDirCache);
  } else {
    const m = membersDirCache.find(x => x.id === val);
    if (m) {
      listDiv.style.display = 'none';
      detailDiv.style.display = 'block';
      renderMemberDetail(m);
    }
  }
};

function renderMemberDetail(m) {
  const history = m.monthlyHistory || {};
  let feeCollected = 0;
  Object.values(history).forEach(h => { feeCollected += Number(h.fee || 0); });

  const currentLoan = Number(m.currentLoan || 0);
  const totalInterest = currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS;
  const totalRepayable = currentLoan + totalInterest;
  let totalReturned = 0;
  Object.values(history).forEach(h => { totalReturned += Number(h.loanReturned || 0); });
  const loanBalance = Math.max(0, totalRepayable - totalReturned);

  const avatar = hasRole(m, 'admin') ? '⚙️' : (isTreasurerOrSecretary(m) ? '💰' : '👤');
  const roleBadge = roleBadgesHtml(m);

  document.getElementById('members-dir-summary').innerHTML = `
    <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.7rem;">
      <div style="font-size:1.6rem;">${avatar}</div>
      <div style="flex:1;">
        <div style="font-size:.85rem;font-weight:800;color:var(--txt);">${m.name} ${roleBadge}</div>
        ${m.nameKn ? `<div style="font-size:.75rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${m.nameKn}</div>` : ''}
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.2rem;">
          ${isTreasurer ? `<div style="font-size:.65rem;color:var(--sub);">📅 DOB: <strong>${m.dob || '—'}</strong></div>` : ''}
          ${isAdmin ? `<button onclick="editMemberDob('${m.id}','${m.dob || ''}')" style="background:var(--nv);color:#fff;border:none;padding:.2rem .5rem;border-radius:6px;font-size:.6rem;font-weight:700;cursor:pointer;">✏️ Edit</button>` : ''}
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem;">
      <div style="background:#e8f5e9;border-radius:8px;padding:.5rem;text-align:center;">
        <div style="font-size:.6rem;color:var(--sub);">Fee Collected · ಶುಲ್ಕ</div>
        <div style="font-size:.85rem;font-weight:800;color:var(--green);">${fmtMoney(feeCollected)}</div>
      </div>
      <div style="background:${loanBalance > 0 ? '#fdecea' : '#e8f5e9'};border-radius:8px;padding:.5rem;text-align:center;">
        <div style="font-size:.6rem;color:var(--sub);">Loan Balance · ಸಾಲ ಬಾಕಿ</div>
        <div style="font-size:.85rem;font-weight:800;color:${loanBalance > 0 ? 'var(--red)' : 'var(--green)'};">${loanBalance > 0 ? fmtMoney(loanBalance) : 'Nil'}</div>
      </div>
    </div>`;

  const months = Object.keys(history).sort();
  const tbody = document.getElementById('members-dir-month-body');
  if (months.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:.8rem;text-align:center;color:var(--sub);">No payment records · ಯಾವುದೇ ದಾಖಲೆಗಳಿಲ್ಲ</td></tr>';
  } else {
    tbody.innerHTML = months.map((mo, i) => {
      const h = history[mo];
      const label = new Date(mo + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      const bg = i % 2 === 0 ? 'var(--card)' : 'var(--bg)';
      return `<tr style="background:${bg};border-bottom:1px solid var(--border);">
        <td style="padding:.5rem;">${label}</td>
        <td style="padding:.5rem;text-align:right;">${fmtMoney(h.fee || 0)}</td>
        <td style="padding:.5rem;text-align:right;">${fmtMoney(h.loanReturned || 0)}</td>
      </tr>`;
    }).join('');
  }
}

window.editMemberDob = function(uid, currentDob) {
  if (!isAdmin) return;
  const val = prompt('Set Date of Birth (YYYY-MM-DD) · ಹುಟ್ಟಿದ ದಿನಾಂಕ ನಮೂದಿಸಿ:', currentDob || '');
  if (val === null) return;
  const trimmed = val.trim();
  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    showToast('Use format YYYY-MM-DD (e.g. 1990-06-15)'); return;
  }
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { dob: trimmed })
    .then(() => {
      showLoader(false);
      showToast('✅ DOB updated · ಹುಟ್ಟಿದ ದಿನ ನವೀಕರಿಸಲಾಗಿದೆ');
      // update cache and re-render
      const idx = membersDirCache.findIndex(m => m.id === uid);
      if (idx >= 0) {
        membersDirCache[idx].dob = trimmed;
        renderMemberDetail(membersDirCache[idx]);
      }
    })
    .catch(() => { showLoader(false); showToast('Failed to update DOB'); });
};

function renderMembersList(items) {
  const list = document.getElementById('members-dir-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="ei">👥</div><div class="et">No members found</div></div>';
    return;
  }
  list.innerHTML = items.map((m, i) => {
    const history = m.monthlyHistory || {};
    let feeCollected = 0;
    Object.values(history).forEach(h => { feeCollected += Number(h.fee || 0); });

    const currentLoan = Number(m.currentLoan || 0);
    const totalInterest = currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS;
    const totalRepayable = currentLoan + totalInterest;
    let totalReturned = 0;
    Object.values(history).forEach(h => { totalReturned += Number(h.loanReturned || 0); });
    const loanBalance = Math.max(0, totalRepayable - totalReturned);
    const monthCount = Object.keys(history).length;

    const avatar = hasRole(m, 'admin') ? '⚙️' : (isTreasurerOrSecretary(m) ? '💰' : '👤');
    const roleBadge = roleBadgesHtml(m);

    return `<div class="card" onclick="viewMember('${m.id}')" style="margin-bottom:.6rem;padding:.8rem;cursor:pointer;">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem;">
        <div style="font-size:1.4rem;">${m.profilePic ? `<img src="${m.profilePic}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;" alt="">` : avatar}</div>
        <div style="flex:1;">
          <div style="font-size:.8rem;font-weight:800;color:var(--txt);">${m.name} ${roleBadge}</div>
          ${m.nameKn ? `<div style="font-size:.7rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${m.nameKn}</div>` : ''}
        </div>
        <div style="font-size:.7rem;color:var(--sub);">#${String(i+1).padStart(3,'0')}</div>
      </div>
      <div style="display:grid;grid-template-columns:${isTreasurer ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr'};gap:.3rem;">
        ${isTreasurer ? `<div style="background:var(--bg);border-radius:6px;padding:.35rem;text-align:center;">
          <div style="font-size:.55rem;color:var(--sub);">DOB</div>
          <div style="font-size:.6rem;font-weight:700;">${m.dob || '—'}</div>
        </div>` : ''}
        <div style="background:#e8f5e9;border-radius:6px;padding:.35rem;text-align:center;">
          <div style="font-size:.55rem;color:var(--sub);">Fee · ಶುಲ್ಕ</div>
          <div style="font-size:.6rem;font-weight:700;color:var(--green);">${fmtMoney(feeCollected)}</div>
        </div>
        <div style="background:${loanBalance > 0 ? '#fdecea' : '#e8f5e9'};border-radius:6px;padding:.35rem;text-align:center;">
          <div style="font-size:.55rem;color:var(--sub);">Loan Bal</div>
          <div style="font-size:.6rem;font-weight:700;color:${loanBalance > 0 ? 'var(--red)' : 'var(--green)'};">${loanBalance > 0 ? fmtMoney(loanBalance) : 'Nil'}</div>
        </div>
        <div style="background:var(--bg);border-radius:6px;padding:.35rem;text-align:center;">
          <div style="font-size:.55rem;color:var(--sub);">Months · ತಿಂಗಳು</div>
          <div style="font-size:.6rem;font-weight:700;color:var(--nv);">${monthCount}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ============ MEMBER DETAIL VIEW (tap a member to see full details) ============
window.viewMember = function(id) {
  const m = (typeof membersDirCache !== 'undefined' ? membersDirCache : []).find(x => x.id === id);
  if (!m) return;
  const history = m.monthlyHistory || {};
  let feeCollected = 0, totalReturned = 0;
  Object.values(history).forEach(h => { feeCollected += Number(h.fee || 0); totalReturned += Number(h.loanReturned || 0); });
  const currentLoan = Number(m.currentLoan || 0);
  const totalInterest = currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS;
  const totalRepayable = currentLoan + totalInterest;
  const loanBalance = Math.max(0, totalRepayable - totalReturned);
  const monthCount = Object.keys(history).length;

  const photo = m.profilePic
    ? `<img src="${m.profilePic}" style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid var(--or);" alt="">`
    : `<div style="width:84px;height:84px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:2.2rem;border:3px solid var(--or);">${hasRole(m, 'admin') ? '⚙️' : (isTreasurerOrSecretary(m) ? '💰' : '👤')}</div>`;
  const roleBadge = roleBadgesHtml(m);

  function row(labelEn, labelKn, value, color) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.55rem .2rem;border-bottom:1px solid var(--border);">
      <div style="font-size:.72rem;color:var(--sub);">${labelEn}<span style="font-family:'Noto Sans Kannada',sans-serif;"> · ${labelKn}</span></div>
      <div style="font-size:.8rem;font-weight:800;color:${color || 'var(--txt)'};">${value}</div>
    </div>`;
  }

  const body = document.getElementById('member-detail-body');
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:.4rem;margin-bottom:.8rem;">
      ${photo}
      <div style="font-size:1rem;font-weight:800;color:var(--txt);text-align:center;">${m.name || ''} ${roleBadge}</div>
      ${m.nameKn ? `<div style="font-size:.8rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${m.nameKn}</div>` : ''}
    </div>
    ${isTreasurer ? row('Date of Birth', 'ಜನ್ಮ ದಿನಾಂಕ', m.dob || '—') : ''}
    ${isTreasurer ? row('Mobile', 'ಮೊಬೈಲ್', m.mobile || m.phone || '—') : ''}
    ${row('Total Fee Paid', 'ಒಟ್ಟು ಶುಲ್ಕ', fmtMoney(feeCollected), 'var(--green)')}
    ${row('Months Contributed', 'ತಿಂಗಳುಗಳು', String(monthCount))}
    <div style="margin-top:.7rem;font-size:.7rem;font-weight:800;color:var(--nv);font-family:'Noto Sans Kannada',sans-serif;">Loan Details · ಸಾಲದ ವಿವರ</div>
    ${row('Current Loan', 'ಪ್ರಸ್ತುತ ಸಾಲ', fmtMoney(currentLoan))}
    ${row('Interest', 'ಬಡ್ಡಿ', currentLoan > 0 ? fmtMoney(totalInterest) : '—')}
    ${row('Total Repayable', 'ಒಟ್ಟು ಮರುಪಾವತಿ', currentLoan > 0 ? fmtMoney(totalRepayable) : '—')}
    ${row('Repaid So Far', 'ಮರುಪಾವತಿಸಲಾಗಿದೆ', fmtMoney(totalReturned), 'var(--green)')}
    ${row('Loan Balance', 'ಬಾಕಿ ಸಾಲ', loanBalance > 0 ? fmtMoney(loanBalance) : 'Nil · ಇಲ್ಲ', loanBalance > 0 ? 'var(--red)' : 'var(--green)')}
  `;
  openModal('member-detail-modal');
};


// ============ ELECTIONS & ANONYMOUS VOTING ============
// Vote docs are keyed by electionId+voter so each member can only cast one vote per election,
// and candidates are referred to by index (c0, c1, ...) rather than by name, since Firestore
// treats dots in a field path as nested-field separators and names can contain periods (e.g. "C.").
// Results are tallied with count-only queries (getCountFromServer) so individual ballots are
// never fetched into the browser — the app never displays who voted which way.
let electionsCache = [];
let unsubAssocElections = null;

function listenAssocElections() {
  document.getElementById('assoc-create-election-btn').style.display = (isAdmin || isElectionOfficer) ? 'block' : 'none';
  if (unsubAssocElections) unsubAssocElections();
  unsubAssocElections = onSnapshot(query(collection(db, 'elections'), orderBy('createdAt', 'desc')), snap => {
    electionsCache = [];
    snap.forEach(d => electionsCache.push({ id: d.id, ...d.data() }));
    const list = document.getElementById('assoc-elections-list');
    if (!list) return;
    if (!electionsCache.length) {
      list.innerHTML = '<div class="empty-state"><div class="ei">🗳️</div><div class="et">No elections yet</div></div>';
      return;
    }
    list.innerHTML = electionsCache.map(e => `
      <div class="card" style="margin-bottom:.6rem;padding:.8rem;cursor:pointer;" onclick="openElectionVote('${e.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:.8rem;font-weight:800;color:var(--txt);">${(e.subjectEn || e.subjectKn || '').replace(/</g, '&lt;')}</div>
            ${e.subjectKn ? `<div style="font-size:.72rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${e.subjectKn.replace(/</g, '&lt;')}</div>` : ''}
          </div>
          <span class="admin-badge" style="background:${e.status === 'open' ? 'var(--green)' : '#6c757d'};">${e.status === 'open' ? 'OPEN' : 'CLOSED'}</span>
        </div>
      </div>`).join('');
  });
}

// ---- Create election (admin / election officer) ----
window.addCandidateField = function() {
  const wrap = document.getElementById('el-candidates-list');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:.4rem;';
  row.innerHTML = `<input class="li el-candidate-input" type="text" placeholder="Candidate name" style="margin:0;flex:1;">
    <button type="button" onclick="this.parentElement.remove()" style="background:#fdecea;color:var(--red);border:none;padding:0 .7rem;border-radius:8px;font-weight:700;cursor:pointer;">✕</button>`;
  wrap.appendChild(row);
};

window.openCreateElection = function() {
  if (!(isAdmin || isElectionOfficer)) return;
  document.getElementById('el-subject-en').value = '';
  document.getElementById('el-subject-kn').value = '';
  document.getElementById('el-details-en').value = '';
  document.getElementById('el-details-kn').value = '';
  document.getElementById('el-candidates-list').innerHTML = '';
  openModal('create-election-modal');
};

window.submitCreateElection = async function() {
  if (!(isAdmin || isElectionOfficer)) return;
  const subjectEn = document.getElementById('el-subject-en').value.trim();
  const subjectKn = document.getElementById('el-subject-kn').value.trim();
  const detailsEn = document.getElementById('el-details-en').value.trim();
  const detailsKn = document.getElementById('el-details-kn').value.trim();
  const candidates = Array.from(document.querySelectorAll('.el-candidate-input'))
    .map(i => i.value.trim()).filter(v => v.length);

  if (!subjectEn && !subjectKn) { showToast('Enter a subject (English or Kannada) · ವಿಷಯ ನಮೂದಿಸಿ'); return; }

  if (!confirm(`Create this ${candidates.length ? 'election (' + candidates.length + ' candidates)' : 'resolution vote'} and open it for voting now?`)) return;

  showLoader(true);
  try {
    await addDoc(collection(db, 'elections'), {
      subjectEn, subjectKn, detailsEn, detailsKn, candidates,
      status: 'open', createdAt: serverTimestamp(), createdByName: currentProfile.name
    });
    showLoader(false);
    closeModal('create-election-modal');
    showToast('✅ Election created & open for voting · ಚುನಾವಣೆ ಪ್ರಾರಂಭವಾಗಿದೆ');
  } catch (e) {
    showLoader(false);
    showToast('Failed to create election');
  }
};

// ---- Vote / Results ----
window.openElectionVote = async function(electionId) {
  const e = electionsCache.find(x => x.id === electionId);
  if (!e) return;
  document.getElementById('ev-subject').textContent = e.subjectEn || e.subjectKn || '';
  const detailsParts = [];
  if (e.detailsEn) detailsParts.push(e.detailsEn);
  if (e.detailsKn) detailsParts.push(e.detailsKn);
  document.getElementById('ev-details').textContent = detailsParts.join('\n\n');

  const body = document.getElementById('ev-body');
  const adminControls = document.getElementById('ev-admin-controls');
  body.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--sub);font-size:.75rem;">Loading...</div>';
  adminControls.style.display = 'none';
  openModal('election-vote-modal');

  const voteDocId = `${electionId}_${currentUser.uid}`;
  let myVoteSnap;
  try { myVoteSnap = await getDoc(doc(db, 'electionVotes', voteDocId)); } catch (err) { myVoteSnap = null; }
  const alreadyVoted = myVoteSnap && myVoteSnap.exists();

  const keys = (e.candidates && e.candidates.length) ? e.candidates.map((c, i) => ({ key: 'c' + i, label: c })) : [{ key: 'resolution', label: null }];

  if (e.status === 'closed' || alreadyVoted) {
    renderElectionResults(e, keys, alreadyVoted, body);
  } else {
    renderElectionBallot(e, keys, body);
  }

  if (isAdmin || isElectionOfficer) {
    adminControls.style.display = 'flex';
    adminControls.innerHTML = `
      ${e.status === 'open'
        ? `<button onclick="closeElectionVoting('${e.id}')" style="flex:1;background:#6c757d;color:#fff;border:none;padding:.6rem;border-radius:8px;font-size:.7rem;font-weight:700;cursor:pointer;">🔒 Close Voting</button>`
        : `<button onclick="reopenElectionVoting('${e.id}')" style="flex:1;background:var(--green);color:#fff;border:none;padding:.6rem;border-radius:8px;font-size:.7rem;font-weight:700;cursor:pointer;">🔓 Reopen Voting</button>`}
      <button onclick="deleteElection('${e.id}')" style="flex:1;background:#c0392b;color:#fff;border:none;padding:.6rem;border-radius:8px;font-size:.7rem;font-weight:700;cursor:pointer;">🗑️ Delete</button>`;
    // Admin/election officer can always see live results even while voting is still open, below the ballot
    if (e.status === 'open' && !alreadyVoted) {
      const resultsDiv = document.createElement('div');
      resultsDiv.style.cssText = 'margin-top:1rem;border-top:1px solid var(--border);padding-top:.8rem;';
      resultsDiv.innerHTML = '<div style="font-size:.7rem;font-weight:700;color:var(--sub);margin-bottom:.5rem;">📊 LIVE RESULTS (visible to admin/election officer only)</div>';
      body.appendChild(resultsDiv);
      renderElectionResults(e, keys, false, resultsDiv, true);
    }
  }
};

function renderElectionBallot(e, keys, container) {
  const choiceBtns = (key) => `
    <div class="ev-choice-group" data-key="${key}" style="display:flex;gap:.4rem;margin-top:.3rem;">
      <button type="button" onclick="selectVoteChoice(this,'yes')" style="flex:1;background:var(--bg);border:2px solid var(--border);padding:.5rem;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;">✅ Yes · ಹೌದು</button>
      <button type="button" onclick="selectVoteChoice(this,'no')" style="flex:1;background:var(--bg);border:2px solid var(--border);padding:.5rem;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;">❌ No · ಇಲ್ಲ</button>
      <button type="button" onclick="selectVoteChoice(this,'abstain')" style="flex:1;background:var(--bg);border:2px solid var(--border);padding:.5rem;border-radius:8px;font-size:.72rem;font-weight:700;cursor:pointer;">➖ Abstain · ಗೈರು</button>
    </div>`;

  container.innerHTML = `
    <p style="font-size:.68rem;color:var(--sub);margin-bottom:.6rem;">Your vote is anonymous — results only show totals, never who voted what. · ನಿಮ್ಮ ಮತ ಅನಾಮಧೇಯ</p>
    ${keys.map(k => `
      <div style="margin-bottom:.7rem;">
        ${k.label ? `<div style="font-size:.78rem;font-weight:700;color:var(--txt);">${k.label.replace(/</g, '&lt;')}</div>` : ''}
        ${choiceBtns(k.key)}
      </div>`).join('')}
    <button class="btn-post" style="background:var(--nv);margin-top:.4rem;" onclick="castVote('${e.id}')">🗳️ SUBMIT VOTE · ಮತ ಸಲ್ಲಿಸಿ</button>
  `;
}

window.selectVoteChoice = function(btn, choice) {
  const group = btn.closest('.ev-choice-group');
  group.dataset.selected = choice;
  Array.from(group.children).forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background = 'var(--bg)';
  });
  btn.style.borderColor = choice === 'yes' ? 'var(--green)' : (choice === 'no' ? '#c0392b' : '#e67e22');
  btn.style.background = choice === 'yes' ? '#eafaf1' : (choice === 'no' ? '#fdecea' : '#fef5e7');
};

window.castVote = async function(electionId) {
  const groups = document.querySelectorAll('.ev-choice-group');
  const choices = {};
  for (const g of groups) {
    if (!g.dataset.selected) { showToast('Please choose Yes/No/Abstain for every item · ಎಲ್ಲದಕ್ಕೂ ಆಯ್ಕೆ ಮಾಡಿ'); return; }
    choices[g.dataset.key] = g.dataset.selected;
  }
  if (!Object.keys(choices).length) { showToast('Nothing to vote on'); return; }
  if (!confirm('Submit your vote? This cannot be changed afterward.')) return;

  const voteDocId = `${electionId}_${currentUser.uid}`;
  showLoader(true);
  try {
    const existing = await getDoc(doc(db, 'electionVotes', voteDocId));
    if (existing.exists()) { showLoader(false); showToast('You have already voted in this election'); return; }
    await setDoc(doc(db, 'electionVotes', voteDocId), {
      electionId, choices, votedAt: serverTimestamp()
      // Note: voter uid lives only in the document ID for duplicate-vote prevention;
      // results are read back via count-only queries, never by fetching this document's contents.
    });
    showLoader(false);
    showToast('✅ Vote submitted — thank you · ಮತ ಸಲ್ಲಿಸಲಾಗಿದೆ');
    openElectionVote(electionId); // refresh to show "already voted" state
  } catch (err) {
    showLoader(false);
    showToast('Failed to submit vote');
  }
};

async function renderElectionResults(e, keys, alreadyVoted, container, liveOnly) {
  if (!liveOnly) {
    container.innerHTML = alreadyVoted
      ? '<p style="font-size:.75rem;color:var(--green);font-weight:700;margin-bottom:.7rem;">✅ You already voted in this election. Thank you.</p>'
      : '<p style="font-size:.75rem;color:var(--sub);margin-bottom:.7rem;">Voting is closed for this election.</p>';
  }
  const resultsWrap = document.createElement('div');
  resultsWrap.innerHTML = '<div style="text-align:center;padding:.5rem;color:var(--sub);font-size:.72rem;">Tallying votes...</div>';
  container.appendChild(resultsWrap);

  try {
    const rows = [];
    for (const k of keys) {
      const [yesSnap, noSnap, absSnap] = await Promise.all([
        getCountFromServer(query(collection(db, 'electionVotes'), where('electionId', '==', e.id), where('choices.' + k.key, '==', 'yes'))),
        getCountFromServer(query(collection(db, 'electionVotes'), where('electionId', '==', e.id), where('choices.' + k.key, '==', 'no'))),
        getCountFromServer(query(collection(db, 'electionVotes'), where('electionId', '==', e.id), where('choices.' + k.key, '==', 'abstain')))
      ]);
      const yes = yesSnap.data().count, no = noSnap.data().count, abstain = absSnap.data().count;
      const total = yes + no + abstain || 1;
      rows.push({ label: k.label, yes, no, abstain, total });
    }
    resultsWrap.innerHTML = rows.map(r => `
      <div style="margin-bottom:.7rem;">
        ${r.label ? `<div style="font-size:.75rem;font-weight:700;margin-bottom:.3rem;">${r.label.replace(/</g, '&lt;')}</div>` : ''}
        <div style="display:flex;height:18px;border-radius:5px;overflow:hidden;background:var(--bg);">
          <div style="width:${(r.yes / r.total) * 100}%;background:var(--green);"></div>
          <div style="width:${(r.no / r.total) * 100}%;background:#c0392b;"></div>
          <div style="width:${(r.abstain / r.total) * 100}%;background:#e67e22;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--sub);margin-top:.2rem;">
          <span>✅ Yes: ${r.yes}</span><span>❌ No: ${r.no}</span><span>➖ Abstain: ${r.abstain}</span>
        </div>
      </div>`).join('');
  } catch (err) {
    resultsWrap.innerHTML = '<div style="font-size:.7rem;color:var(--sub);">Could not load results.</div>';
  }
}

window.closeElectionVoting = async function(electionId) {
  if (!(isAdmin || isElectionOfficer)) return;
  if (!confirm('Close voting for this election? Results will become visible to all members.')) return;
  showLoader(true);
  try {
    await updateDoc(doc(db, 'elections', electionId), { status: 'closed' });
    showLoader(false);
    openElectionVote(electionId);
  } catch (e) { showLoader(false); showToast('Failed'); }
};

window.reopenElectionVoting = async function(electionId) {
  if (!(isAdmin || isElectionOfficer)) return;
  if (!confirm('Reopen voting for this election?')) return;
  showLoader(true);
  try {
    await updateDoc(doc(db, 'elections', electionId), { status: 'open' });
    showLoader(false);
    openElectionVote(electionId);
  } catch (e) { showLoader(false); showToast('Failed'); }
};

window.deleteElection = async function(electionId) {
  if (!(isAdmin || isElectionOfficer)) return;
  if (!confirm('Delete this election permanently? Vote records will remain but the election listing will be removed.')) return;
  showLoader(true);
  try {
    await deleteDoc(doc(db, 'elections', electionId));
    showLoader(false);
    closeModal('election-vote-modal');
    showToast('Deleted');
  } catch (e) { showLoader(false); showToast('Failed'); }
};

// ============ MEETING RESOLUTIONS ============
let resolutionsCache = [];
let resolutionImageData = null; // compressed base64 of the scanned photo, attached on upload

// ---- Admin: scan a photo of the resolution, OCR it, and auto-fill the form ----
window.scanResolutionImage = function() {
  if (!isAdmin) return;
  const input = document.getElementById('res-image-input');
  const file = input.files && input.files[0];
  if (!file) return;
  const progress = document.getElementById('res-scan-progress');
  const preview = document.getElementById('res-image-preview');

  progress.style.display = 'block';
  progress.textContent = 'Reading image...';

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      // Compress to keep the Firestore document well under the 1MB limit while staying legible
      const compress = (maxW, quality) => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        return canvas.toDataURL('image/jpeg', quality);
      };
      resolutionImageData = compress(1100, 0.75);
      if (resolutionImageData.length > 900000) resolutionImageData = compress(900, 0.6);
      if (resolutionImageData.length > 900000) resolutionImageData = compress(700, 0.5);

      preview.src = resolutionImageData;
      preview.style.display = 'block';

      if (typeof Tesseract === 'undefined') {
        progress.textContent = 'Photo attached. (OCR engine failed to load — please fill in the details manually.)';
        return;
      }

      progress.textContent = 'Scanning text... 0%';
      Tesseract.recognize(resolutionImageData, 'eng+kan', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            progress.textContent = 'Scanning text... ' + Math.round((m.progress || 0) * 100) + '%';
          } else if (m.status) {
            progress.textContent = m.status.charAt(0).toUpperCase() + m.status.slice(1) + '...';
          }
        }
      }).then(({ data: { text } }) => {
        applyResolutionOcrText(text);
        progress.textContent = '✅ Scan complete — please check the fields below before uploading.';
      }).catch(() => {
        progress.textContent = 'Photo attached. (Could not read text automatically — please fill in the details manually.)';
      });
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
};

// Heuristic parse of OCR output into date / title / body fields
function applyResolutionOcrText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length);
  if (!lines.length) return;

  // Look for a date in common written formats: 12/07/2026, 12-07-2026, 12 July 2026, July 12, 2026
  const datePatterns = [
    /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/,
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i
  ];
  const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  let foundDate = null;
  for (const line of lines) {
    let m = line.match(datePatterns[0]);
    if (m) {
      let [_, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      if (+d <= 31 && +mo <= 12) { foundDate = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; break; }
    }
    m = line.match(datePatterns[1]);
    if (m) { foundDate = `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; break; }
    m = line.match(datePatterns[2]);
    if (m) { foundDate = `${m[3]}-${String(months[m[1].toLowerCase()]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`; break; }
  }
  if (foundDate) document.getElementById('res-date').value = foundDate;

  // Guess a title: the first line that isn't just a date and isn't too short
  const titleLine = lines.find(l => !datePatterns.some(p => p.test(l)) && l.length > 4 && l.length < 100);
  if (titleLine && !document.getElementById('res-title').value.trim()) {
    document.getElementById('res-title').value = titleLine;
  }

  // Whole scanned text goes into the body for the admin to trim/clean up
  const bodyEl = document.getElementById('res-body');
  if (!bodyEl.value.trim()) bodyEl.value = lines.join('\n');

  // Look for "Proposed by:" / "Seconded by:" style lines
  const proposedLine = lines.find(l => /propos(ed|er)/i.test(l));
  const secondedLine = lines.find(l => /second(ed|er)/i.test(l));
  if (proposedLine && !document.getElementById('res-proposed').value.trim()) {
    document.getElementById('res-proposed').value = proposedLine.replace(/.*propos(ed|er)\s*(by)?\s*:?/i, '').trim();
  }
  if (secondedLine && !document.getElementById('res-seconded').value.trim()) {
    document.getElementById('res-seconded').value = secondedLine.replace(/.*second(ed|er)\s*(by)?\s*:?/i, '').trim();
  }
}

// ---- Admin: upload a resolution ----
window.uploadResolution = async function() {
  if (!isAdmin) { showToast('Admin only'); return; }
  const date = document.getElementById('res-date').value;
  const title = document.getElementById('res-title').value.trim();
  const body = document.getElementById('res-body').value.trim();
  const proposed = document.getElementById('res-proposed').value.trim();
  const seconded = document.getElementById('res-seconded').value.trim();

  if (!date) { showToast('Select a date · ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ'); return; }
  if (!title) { showToast('Enter a title · ವಿಷಯ ನಮೂದಿಸಿ'); return; }
  if (!body) { showToast('Enter the resolution text · ಪಠ್ಯ ನಮೂದಿಸಿ'); return; }

  showLoader(true);
  try {
    const payload = {
      date, title, body,
      proposedBy: proposed || '', secondedBy: seconded || '',
      createdAt: serverTimestamp(), createdByName: currentProfile.name
    };
    if (resolutionImageData) payload.imageData = resolutionImageData;
    await addDoc(collection(db, 'resolutions'), payload);
    document.getElementById('res-date').value = '';
    document.getElementById('res-title').value = '';
    document.getElementById('res-body').value = '';
    document.getElementById('res-proposed').value = '';
    document.getElementById('res-seconded').value = '';
    document.getElementById('res-image-input').value = '';
    document.getElementById('res-image-preview').style.display = 'none';
    document.getElementById('res-scan-progress').style.display = 'none';
    resolutionImageData = null;
    showLoader(false);
    showToast('✅ Resolution uploaded · ಅಪ್‌ಲೋಡ್ ಆಗಿದೆ');
  } catch (e) {
    showLoader(false);
    showToast('Failed to upload resolution');
  }
};

// ---- Admin: list + delete resolutions ----
let unsubAdminResolutions = null;
function listenAdminResolutions() {
  if (!isAdmin) return;
  if (unsubAdminResolutions) unsubAdminResolutions();
  unsubAdminResolutions = onSnapshot(query(collection(db, 'resolutions'), orderBy('date', 'desc')), snap => {
    const list = document.getElementById('admin-resolutions-list');
    if (!list) return;
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><div class="ei">📜</div><div class="et">No resolutions uploaded yet</div></div>';
      return;
    }
    list.innerHTML = items.map(r => {
      const label = new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const thumb = r.imageData ? `<img src="${r.imageData}" style="max-width:80px;max-height:80px;border-radius:6px;float:right;margin-left:.5rem;border:1px solid var(--border);">` : '';
      return `<div class="req-card">
        ${thumb}
        <div class="req-title">${label} — ${r.title}</div>
        <div class="req-body">${r.body.length > 140 ? r.body.slice(0, 140) + '…' : r.body}</div>
        <button onclick="deleteResolution('${r.id}')" style="margin-top:.5rem;background:#c0392b;color:#fff;border:none;padding:.4rem .7rem;border-radius:8px;font-size:.68rem;font-weight:700;cursor:pointer;">🗑️ Delete</button>
      </div>`;
    }).join('');
  });
}

window.deleteResolution = async function(id) {
  if (!isAdmin) return;
  if (!confirm('Delete this resolution? This cannot be undone.')) return;
  showLoader(true);
  try {
    await deleteDoc(doc(db, 'resolutions', id));
    showLoader(false);
    showToast('Deleted');
  } catch (e) {
    showLoader(false);
    showToast('Failed to delete');
  }
};

// ---- Everyone: dropdown + letter preview on Association tab ----
let unsubAssocResolutions = null;
function listenAssocResolutions() {
  if (unsubAssocResolutions) unsubAssocResolutions();
  unsubAssocResolutions = onSnapshot(query(collection(db, 'resolutions'), orderBy('date', 'desc')), snap => {
    resolutionsCache = [];
    snap.forEach(d => resolutionsCache.push({ id: d.id, ...d.data() }));
    const sel = document.getElementById('assoc-resolution-select');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">— Select a resolution by date —</option>' +
      resolutionsCache.map(r => {
        const label = new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        return `<option value="${r.id}">${label} — ${r.title}</option>`;
      }).join('');
    if (current && resolutionsCache.find(r => r.id === current)) sel.value = current;
  });
}

function resolutionLetterHtml(r) {
  const dateLabel = new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const bodyHtml = r.body.split('\n').map(p => `<p style="margin:0 0 .7rem;">${p.replace(/</g, '&lt;')}</p>`).join('');
  const imageHtml = r.imageData
    ? `<div style="text-align:center;margin-bottom:1rem;"><img src="${r.imageData}" style="max-width:100%;border:1px solid #ccc;border-radius:6px;"></div>`
    : '';
  return `
    <div style="text-align:center;border-bottom:2px solid var(--nv);padding-bottom:.6rem;margin-bottom:.9rem;">
      <img src="${window.LOGO_B64}" style="width:52px;height:52px;border-radius:50%;display:block;margin:0 auto .3rem;">
      <div style="font-weight:800;font-size:.95rem;color:var(--nv);">Shree Mahaganapati Seva Sangha (R.)</div>
      <div style="font-size:.68rem;color:var(--sub);">Holanagadde, Kumta, Uttara Kannada, Karnataka</div>
    </div>
    <div style="font-size:.72rem;color:var(--sub);margin-bottom:.6rem;">Date: ${dateLabel}</div>
    <div style="font-weight:800;margin-bottom:.7rem;">Subject: ${r.title.replace(/</g, '&lt;')}</div>
    ${imageHtml}
    ${bodyHtml}
    <div style="margin-top:1.6rem;display:flex;justify-content:space-between;font-size:.72rem;">
      <div>Proposed by:<br><strong>${(r.proposedBy || '—').replace(/</g, '&lt;')}</strong></div>
      <div>Seconded by:<br><strong>${(r.secondedBy || '—').replace(/</g, '&lt;')}</strong></div>
    </div>`;
}

window.onResolutionSelect = function() {
  const sel = document.getElementById('assoc-resolution-select');
  const preview = document.getElementById('assoc-resolution-preview');
  const letter = document.getElementById('assoc-resolution-letter');
  const r = resolutionsCache.find(x => x.id === sel.value);
  if (!r) { preview.style.display = 'none'; return; }
  letter.innerHTML = resolutionLetterHtml(r);
  preview.style.display = 'block';
};

// ---- Hard-copy print preview: opens a clean printable window ----
window.printResolution = function() {
  const sel = document.getElementById('assoc-resolution-select');
  const r = resolutionsCache.find(x => x.id === sel.value);
  if (!r) return;
  const w = window.open('', '_blank');
  if (!w) { showToast('Please allow pop-ups to print'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>${r.title.replace(/</g, '&lt;')}</title>
    <meta charset="utf-8">
    <style>
      body{font-family:Georgia,serif;color:#222;max-width:680px;margin:2rem auto;padding:0 1rem;}
      @media print { body{margin:0;} }
    </style></head><body>${resolutionLetterHtml(r)}</body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
};


// This rebinds every inline handler in JS via addEventListener, which is never
// blocked, so all buttons work regardless of host settings. No HTML changes needed.
(function bindInlineHandlers() {
  function bind() {
    try {
      var nodes = document.querySelectorAll('[onclick]');
      nodes.forEach(function (el) {
        if (el.dataset.boundClick) return;
        var attr = (el.getAttribute('onclick') || '').trim().replace(/;$/, '');
        // Match a zero-argument call like "doLogin()" or "showReg()"
        var m = attr.match(/^([A-Za-z_$][\w$]*)\(\s*\)$/);
        if (m && typeof window[m[1]] === 'function') {
          var fn = window[m[1]];
          el.dataset.boundClick = '1';
          el.removeAttribute('onclick'); // prevent any double-fire where inline still works
          el.addEventListener('click', function (e) {
            try { fn.call(el, e); } catch (err) { console.error('handler error:', err); }
          });
        }
      });
      // brief confirmation that this updated build is live
      var note = document.createElement('div');
      note.textContent = 'Build loaded \u2713';
      note.style.cssText = 'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);background:#070;color:#fff;font:11px sans-serif;padding:4px 10px;border-radius:12px;z-index:999999;opacity:.95;';
      document.body.appendChild(note);
      setTimeout(function () { note.remove(); }, 2500);
    } catch (err) { console.error('bindInlineHandlers failed', err); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

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
const UPI_MAX_AMOUNT = 2000;
let pendingUpiParams = null;

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
let isTreasurer = false;
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
        role: 'member',
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

    isAdmin = currentProfile.role === 'admin';
    isTreasurer = currentProfile.role === 'treasurer' || isAdmin;
    enterApp();
    showLoader(false);
  } else {
    currentUser = null;
    currentProfile = null;
    isAdmin = false;
    isTreasurer = false;
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
  // Profile pic: all members can tap avatar to change photo
  const avEl = document.getElementById('pav');
  avEl.style.cursor = 'pointer';
  avEl.title = 'Tap to change photo';
  avEl.onclick = window.changeProfilePic;
  updateProfilePicUI(currentProfile.profilePic || null);
  document.getElementById('pbadge').textContent = isAdmin ? 'Admin' : (isTreasurer ? 'Treasurer' : 'Active Member');
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
  document.getElementById('s-' + t).scrollTop = 0;
  if (t === 'mpay') initMpayTab();
  if (t === 'assoc') loadAssocData();
  if (t === 'donations') loadDonationsTab();
  if (t === 'members') loadMembersTab();
  if (t === 'admin') { if (isAdmin) listenAdminAnn(); }
};

window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };

// ============ BIRTHDAY CHECK ============
function checkBirthdays() {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const banner = document.getElementById('bday-banner');

  // Reads the lightweight 'birthdays' collection (day + month only, no birth year),
  // so members can see today's birthday without access to anyone's full DOB.
  getDocs(collection(db, 'birthdays')).then(snap => {
    const todays = [];
    snap.forEach(d => {
      const b = d.data();
      if (b.month === mm && b.day === dd) todays.push(b);
    });
    if (todays.length > 0) {
      const names = todays.map(b => (b.nameKn || b.name)).join(', ');
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
  });
}

window.editDividend = function() {
  if (!isAdmin) return;
  const val = prompt('Enter TOTAL dividend given by the association (₹).\nIt will be split equally among all approved members.\nಒಟ್ಟು ಲಾಭಾಂಶ ಮೊತ್ತ ನಮೂದಿಸಿ (ಎಲ್ಲಾ ಸದಸ್ಯರಿಗೆ ಸಮಾನವಾಗಿ ಹಂಚಲಾಗುವುದು):', '');
  if (val === null) return;
  const total = Number(val);
  if (isNaN(total) || total < 0) { alert('Please enter a valid amount.'); return; }
  showLoader(true);
  getDocs(collection(db, 'members')).then(snap => {
    let n = 0;
    snap.forEach(d => { const m = d.data(); if ((m.status || 'approved') === 'approved') n++; });
    if (n === 0) n = 1; // safety: avoid divide-by-zero
    const perMember = Math.round((total / n) * 100) / 100; // 2-decimal share
    return setDoc(doc(db, 'settings', 'association'),
      { dividend: total, dividendPerMember: perMember, dividendMemberCount: n }, { merge: true })
      .then(() => {
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

    countdownTimers = []; cdCache = {}; row.innerHTML = '';
    items.forEach(e => {
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
        ((isAdmin && e.real) ? `<div style="display:flex;gap:.4rem;margin-top:.5rem;"><button onclick="editCountdownEvent('${id}')" style="flex:1;font-size:.55rem;padding:.25rem;border:none;border-radius:6px;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;">✏️ Edit</button><button onclick="deleteCountdownEvent('${id}')" style="flex:1;font-size:.55rem;padding:.25rem;border:none;border-radius:6px;background:rgba(255,80,80,.3);color:#fff;cursor:pointer;">🗑</button></div>` : '');
      row.appendChild(card);
    });
    if (isAdmin && !usingDefaults) {
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

window.addCountdownEvent = function() {
  const nameEn = prompt('Event name (English), e.g. GANESH CHATURTHI:'); if (nameEn === null) return;
  const nameKn = prompt('Event name (Kannada):') || '';
  const date = prompt('Date (YYYY-MM-DD), e.g. 2026-09-14:'); if (!date) return;
  const order = Number(prompt('Display order (number):', '99')) || 99;
  addDoc(collection(db, 'countdownEvents'), { nameEn: nameEn.trim(), nameKn: nameKn.trim(), date: date.trim(), order, createdAt: serverTimestamp() })
    .catch(e => alert('Error: ' + e.message));
};
window.editCountdownEvent = function(id) {
  const e = cdCache[id] || {};
  const nameEn = prompt('Event name (English):', e.nameEn || ''); if (nameEn === null) return;
  const nameKn = prompt('Event name (Kannada):', e.nameKn || ''); if (nameKn === null) return;
  const date = prompt('Date (YYYY-MM-DD):', e.date || ''); if (date === null) return;
  const order = Number(prompt('Display order:', e.order || 99)) || e.order || 99;
  updateDoc(doc(db, 'countdownEvents', id), { nameEn: nameEn.trim(), nameKn: nameKn.trim(), date: date.trim(), order })
    .catch(er => alert('Error: ' + er.message));
};
window.deleteCountdownEvent = function(id) {
  if (!confirm('Delete this countdown event?')) return;
  deleteDoc(doc(db, 'countdownEvents', id)).catch(e => alert('Error: ' + e.message));
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
  const amtFmt = Number(amt).toFixed(2);
  const params = `pa=${UPI}&pn=${encodeURIComponent(PAYEE)}&am=${amtFmt}&cu=INR&tn=${encodeURIComponent(note)}`;
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
  const amtFmt = Number(amt).toFixed(2);
  const params = `pa=${UPI}&pn=${encodeURIComponent(PAYEE)}&am=${amtFmt}&cu=INR&tn=${encodeURIComponent(note)}`;
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

  if (isTreasurer) {
    treasurerBar.style.display = 'block';
    approvalsSection.style.display = 'block';
    requestSection.style.display = 'block';
    loadMpayMemberList();
    listenMpayApprovals();
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

  { const _b = document.getElementById('mpay-edit-total-fee-btn'); if (_b) _b.style.display = isTreasurer ? 'inline-block' : 'none'; }
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
  // Only treasurer/admin may read all members. Regular members can't, so show a dash
  // unless the treasurer has saved an org-wide total override.
  if (!isTreasurer) { out.textContent = '—'; return; }
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
  if (editBtn) editBtn.style.display = (isTreasurer && status !== 'approved') ? 'inline-block' : 'none';
  if (approveBtn) approveBtn.style.display = (isTreasurer && status === 'pending') ? 'inline-block' : 'none';
}

window.editPastSavings = function() {
  if (!isTreasurer) return;
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
  if (!isTreasurer) return;
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
  if (!isTreasurer) return;
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
    sel.innerHTML = mpayMembersCache.map(m => `<option value="${m.id}">${m.name}${m.role === 'admin' ? ' (Admin)' : ''}</option>`).join('');

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
  const canEdit = (isAdmin || isTreasurer) && profile.id;
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

// ---- Admin/Treasurer: one-time correction of a member's monthly fee/loan entry ----
window.editMonthEntry = function(memberId, month) {
  if (!(isAdmin || isTreasurer)) return;
  const m = mpayMembersCache.find(x => x.id === memberId);
  if (!m) { showToast('Member not found'); return; }
  const entry = (m.monthlyHistory && m.monthlyHistory[month]) || {};
  const label = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  const feeVal = prompt(`Correct FEE for ${m.name} — ${label} (₹):`, Number(entry.fee || 0));
  if (feeVal === null) return;
  if (isNaN(feeVal) || Number(feeVal) < 0) { showToast('Invalid fee amount'); return; }

  const loanVal = prompt(`Correct LOAN REPAID for ${m.name} — ${label} (₹):`, Number(entry.loanReturned || 0));
  if (loanVal === null) return;
  if (isNaN(loanVal) || Number(loanVal) < 0) { showToast('Invalid loan amount'); return; }

  if (!confirm(`Update ${label} for ${m.name}?\nFee: ₹${Number(feeVal)}\nLoan repaid: ₹${Number(loanVal)}`)) return;

  showLoader(true);
  updateDoc(doc(db, 'members', memberId), {
    ['monthlyHistory.' + month + '.fee']: Number(feeVal),
    ['monthlyHistory.' + month + '.loanReturned']: Number(loanVal)
  }).then(() => {
    if (!m.monthlyHistory) m.monthlyHistory = {};
    if (!m.monthlyHistory[month]) m.monthlyHistory[month] = {};
    m.monthlyHistory[month].fee = Number(feeVal);
    m.monthlyHistory[month].loanReturned = Number(loanVal);
    const dir = (typeof membersDirCache !== 'undefined') ? membersDirCache.find(x => x.id === memberId) : null;
    if (dir) {
      if (!dir.monthlyHistory) dir.monthlyHistory = {};
      dir.monthlyHistory[month] = { ...(dir.monthlyHistory[month] || {}), fee: Number(feeVal), loanReturned: Number(loanVal) };
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
  if (!isTreasurer) return;
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
    items.sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1));

    // Keep the lightweight 'birthdays' collection in sync (written by admin only),
    // so members can see today's birthday without reading anyone's full DOB.
    items.forEach(m => {
      if (m.status === 'approved' && m.dob) {
        const p = String(m.dob).split('-');
        if (p.length === 3) {
          setDoc(doc(db, 'birthdays', m.id),
            { month: p[1], day: p[2], name: m.name || '', nameKn: m.nameKn || '' },
            { merge: true }).catch(() => {});
        }
      }
    });

    if (items.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="ei">👥</div><div class="et">No members yet</div></div>';
      return;
    }

    list.innerHTML = items.map(m => `
      <div class="member-row">
        <div class="mr-av">${m.role === 'admin' ? '⚙️' : (m.role === 'treasurer' ? '💰' : '👤')}</div>
        <div class="mr-mid">
          <strong>${m.name} ${m.role === 'admin' ? '<span class="admin-badge">ADMIN</span>' : (m.role === 'treasurer' ? '<span class="admin-badge" style="background:var(--nv);">TREASURER</span>' : '')}</strong>
          <span>${m.email} · ${m.mobile || ''} ${m.dob ? '· DOB: ' + m.dob : ''}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-end;">
          ${m.status === 'pending' ?
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
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { status: 'approved' })
    .then(() => { showLoader(false); showToast('✅ Member approved · ಸದಸ್ಯ ಅನುಮೋದಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Failed'); });
};

window.setMemberLoan = function(uid, name, current) {
  const val = prompt(`Set current loan amount for ${name} (₹):`, current);
  if (val === null) return;
  if (isNaN(val) || Number(val) < 0) { showToast('Invalid amount'); return; }
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { currentLoan: Number(val) })
    .then(() => { showLoader(false); showToast('✅ Loan amount updated · ಸಾಲ ಮೊತ್ತ ನವೀಕರಿಸಲಾಗಿದೆ'); })
    .catch(() => { showLoader(false); showToast('Failed'); });
};

window.setMemberRole = function(uid, name, currentRole) {
  if (!isAdmin) return;
  const roles = ['member', 'treasurer', 'admin'];
  const labels = { member: 'Member', treasurer: 'Treasurer', admin: 'Admin' };
  const current = roles.indexOf(currentRole) >= 0 ? currentRole : 'member';
  const opts = roles.map(r => `${r === current ? '✓ ' : ''}${labels[r]}`).join(' / ');
  const val = prompt(`Change role for ${name}\nCurrent: ${labels[current]}\n\nEnter new role:\nmember | treasurer | admin`, current);
  if (!val) return;
  const newRole = val.trim().toLowerCase();
  if (!roles.includes(newRole)) { showToast('Invalid role. Use: member, treasurer, or admin'); return; }
  if (newRole === current) { showToast('Role unchanged'); return; }
  if (!confirm(`Change ${name}'s role from ${labels[current]} to ${labels[newRole]}?`)) return;
  showLoader(true);
  updateDoc(doc(db, 'members', uid), { role: newRole })
    .then(() => { showLoader(false); showToast(`✅ Role updated to ${labels[newRole]} · ಪಾತ್ರ ನವೀಕರಿಸಲಾಗಿದೆ`); })
    .catch(() => { showLoader(false); showToast('Failed to update role'); });
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
  ['members', 'payments', 'requests', 'ann', 'gallery', 'donations'].forEach(t => {
    document.getElementById('admin-' + t).style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'ann' && isAdmin) listenAdminAnn();
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
  document.getElementById('assoc-admin-controls').style.display = isTreasurer ? 'flex' : 'none';
  document.getElementById('assoc-ext-admin-controls').style.display = isTreasurer ? 'flex' : 'none';

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
  if (!isTreasurer) return;
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
          role: 'member', status: 'approved', // admin-added = auto approved
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

// ============ ADMIN: RECORD PAYMENT FOR ANY MEMBER ============
let recPayMemberId = null;

window.openRecordPayment = function(uid, name) {
  recPayMemberId = uid;
  document.getElementById('rec-pay-member-name').textContent = `Recording payment for: ${name}`;
  const now = new Date();
  document.getElementById('rec-pay-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('rec-pay-fee').value = '';
  document.getElementById('rec-pay-loan').value = '';
  openModal('rec-pay-modal');
};

window.submitRecordPayment = async function() {
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

// ============ DONATIONS ============
const DON_REASONS = {
  'Ganesh Chaturthi': '🐘 Ganesh Chaturthi',
  'Rajyotsava': '🏳️ Rajyotsava',
  'General Donation': '🙏 General Donation',
  'Infrastructure': '🏗️ Infrastructure',
  'Other': '📝 Other'
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
            <div style="font-size:1rem;font-weight:800;color:var(--green);">+${fmtMoney(d.amount)}</div>
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

    // Populate dropdown
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

  const avatar = m.role === 'admin' ? '⚙️' : (m.role === 'treasurer' ? '💰' : '👤');
  const roleBadge = m.role === 'admin' ? `<span class="admin-badge">ADMIN</span>` :
    (m.role === 'treasurer' ? `<span class="admin-badge" style="background:var(--nv);">TREASURER</span>` : '');

  document.getElementById('members-dir-summary').innerHTML = `
    <div style="display:flex;align-items:center;gap:.7rem;margin-bottom:.7rem;">
      <div style="font-size:1.6rem;">${avatar}</div>
      <div style="flex:1;">
        <div style="font-size:.85rem;font-weight:800;color:var(--txt);">${m.name} ${roleBadge}</div>
        ${m.nameKn ? `<div style="font-size:.75rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${m.nameKn}</div>` : ''}
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.2rem;">
          <div style="font-size:.65rem;color:var(--sub);">📅 DOB: <strong>${m.dob || '—'}</strong></div>
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

    const avatar = m.role === 'admin' ? '⚙️' : (m.role === 'treasurer' ? '💰' : '👤');
    const roleBadge = m.role === 'admin' ? `<span class="admin-badge">ADMIN</span>` :
      (m.role === 'treasurer' ? `<span class="admin-badge" style="background:var(--nv);">TREASURER</span>` : '');

    return `<div class="card" onclick="viewMember('${m.id}')" style="margin-bottom:.6rem;padding:.8rem;cursor:pointer;">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem;">
        <div style="font-size:1.4rem;">${m.profilePic ? `<img src="${m.profilePic}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;" alt="">` : avatar}</div>
        <div style="flex:1;">
          <div style="font-size:.8rem;font-weight:800;color:var(--txt);">${m.name} ${roleBadge}</div>
          ${m.nameKn ? `<div style="font-size:.7rem;color:var(--sub);font-family:'Noto Sans Kannada',sans-serif;">${m.nameKn}</div>` : ''}
        </div>
        <div style="font-size:.7rem;color:var(--sub);">#${String(i+1).padStart(3,'0')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:.3rem;">
        <div style="background:var(--bg);border-radius:6px;padding:.35rem;text-align:center;">
          <div style="font-size:.55rem;color:var(--sub);">DOB</div>
          <div style="font-size:.6rem;font-weight:700;">${m.dob || '—'}</div>
        </div>
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
    : `<div style="width:84px;height:84px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:2.2rem;border:3px solid var(--or);">${m.role === 'admin' ? '⚙️' : (m.role === 'treasurer' ? '💰' : '👤')}</div>`;
  const roleBadge = m.role === 'admin' ? `<span class="admin-badge">ADMIN</span>` :
    (m.role === 'treasurer' ? `<span class="admin-badge" style="background:var(--nv);">TREASURER</span>` : '');

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
    ${row('Date of Birth', 'ಜನ್ಮ ದಿನಾಂಕ', m.dob || '—')}
    ${row('Mobile', 'ಮೊಬೈಲ್', m.mobile || m.phone || '—')}
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


// Some hosts block inline onclick="" handlers (e.g. a Content-Security-Policy).
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

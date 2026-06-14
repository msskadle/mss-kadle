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
  document.getElementById('pav').textContent = isAdmin ? '⚙️' : (isTreasurer ? '💰' : '👤');
  document.getElementById('pbadge').textContent = isAdmin ? 'Admin' : (isTreasurer ? 'Treasurer' : 'Active Member');
  document.getElementById('m-admin').style.display = isAdmin ? 'flex' : 'none';

  {
    let feeFromHistory = 0;
    const history = currentProfile.monthlyHistory || {};
    Object.values(history).forEach(h => { feeFromHistory += Number(h.fee || 0); });
    const pastSavings = (currentProfile.pastSavings && currentProfile.pastSavings.status === 'approved')
      ? Number(currentProfile.pastSavings.amount || 0) : 0;
    document.getElementById('m-total').textContent = fmtMoney(feeFromHistory + pastSavings);
  }
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

window.postAnn = function() {
  const tkn = document.getElementById('a-tkn').value.trim();
  const ten = document.getElementById('a-ten').value.trim();
  const body = document.getElementById('a-body').value.trim();
  const validUntil = document.getElementById('a-valid-until').value;
  if (!tkn || !ten) { showToast('Please fill title fields · ಶೀರ್ಷಿಕೆ ನಮೂದಿಸಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'announcements'), {
    titleKn: tkn, titleEn: ten, body,
    validUntil: validUntil || null,
    createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('a-tkn').value = '';
    document.getElementById('a-ten').value = '';
    document.getElementById('a-body').value = '';
    document.getElementById('a-valid-until').value = '';
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

    document.getElementById('m-fee').textContent = fmtMoney(totalFee + (currentProfile.membershipFeePaid || 0));
    document.getElementById('m-loan').textContent = fmtMoney(totalLoan + (currentProfile.loanRepaid || 0));

    // Total Savings = sum of member fee from monthlyHistory + approved past savings
    let feeFromHistory = 0;
    const history = currentProfile.monthlyHistory || {};
    Object.values(history).forEach(h => { feeFromHistory += Number(h.fee || 0); });
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

  document.getElementById('mpay-edit-total-fee-btn').style.display = isTreasurer ? 'inline-block' : 'none';
  loadTotalFeeCollected();
}

// ---- Org-wide total member fee collected ----
function loadTotalFeeCollected() {
  getDoc(doc(db, 'settings', 'totals')).then(snap => {
    const data = snap.exists() ? snap.data() : {};
    if (data.totalFeeOverride !== undefined && data.totalFeeOverride !== null) {
      document.getElementById('mpay-total-fee-collected').textContent = fmtMoney(data.totalFeeOverride);
    } else {
      computeTotalFeeFromMembers();
    }
  }).catch(() => computeTotalFeeFromMembers());
}

function computeTotalFeeFromMembers() {
  getDocs(collection(db, 'members')).then(snap => {
    let total = 0;
    snap.forEach(d => {
      const m = d.data();
      const history = m.monthlyHistory || {};
      Object.values(history).forEach(h => { total += Number(h.fee || 0); });
    });
    document.getElementById('mpay-total-fee-collected').textContent = fmtMoney(total);
  });
}

// ---- Past Savings (per-member, one-time admin set + approval) ----
function renderPastSavings(profile) {
  const ps = profile.pastSavings || {};
  const amount = Number(ps.amount || 0);
  const status = ps.status || 'none'; // none | pending | approved

  document.getElementById('mpay-past-savings').textContent = fmtMoney(amount);

  const statusEl = document.getElementById('mpay-past-savings-status');
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

  const editBtn = document.getElementById('mpay-edit-past-savings-btn');
  const approveBtn = document.getElementById('mpay-approve-past-savings-btn');

  if (isTreasurer) {
    editBtn.style.display = (status === 'approved') ? 'none' : 'inline-block';
    approveBtn.style.display = (status === 'pending') ? 'inline-block' : 'none';
  } else {
    editBtn.style.display = 'none';
    approveBtn.style.display = 'none';
  }
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
  months.forEach(mo => { totalReturned += Number(history[mo].loanReturned || 0); });

  const totalInterest = currentLoan * LOAN_INTEREST_RATE * LOAN_INTEREST_YEARS;
  const totalRepayable = currentLoan + totalInterest;
  const balanceLoan = Math.max(0, totalRepayable - totalReturned);

  document.getElementById('mpay-current-loan').textContent = fmtMoney(currentLoan);
  document.getElementById('mpay-total-repayable').textContent = fmtMoney(totalRepayable);
  document.getElementById('mpay-loan-returned').textContent = fmtMoney(totalReturned);
  document.getElementById('mpay-balance-loan').textContent = fmtMoney(balanceLoan);

  const tbody = document.getElementById('mpay-table-body');
  if (months.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:.8rem;text-align:center;color:var(--sub);">No records yet · ಯಾವುದೇ ದಾಖಲೆಗಳಿಲ್ಲ</td></tr>';
    return;
  }
  tbody.innerHTML = months.map((mo, i) => {
    const h = history[mo];
    const monthLabel = new Date(mo + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    const bg = i % 2 === 0 ? 'var(--card)' : 'var(--bg)';
    return `<tr style="background:${bg};border-bottom:1px solid var(--border);">
      <td style="padding:.5rem;">${monthLabel}</td>
      <td style="padding:.5rem;text-align:right;">${fmtMoney(h.fee || 0)}</td>
      <td style="padding:.5rem;text-align:right;">${fmtMoney(h.loanReturned || 0)}</td>
    </tr>`;
  }).join('');
}

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
  ['members', 'requests', 'ann', 'gallery', 'donations'].forEach(t => {
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

// Admin: record a donation received
window.recordDonation = function() {
  if (!isAdmin) return;
  const donorName = document.getElementById('don-name').value.trim();
  const date = document.getElementById('don-date').value;
  const amount = Number(document.getElementById('don-amount').value);
  const reason = document.getElementById('don-reason').value;
  if (!donorName) { showToast('Enter donor name · ದಾನಿ ಹೆಸರು ನಮೂದಿಸಿ'); return; }
  if (!date) { showToast('Select date · ದಿನಾಂಕ ಆಯ್ಕೆಮಾಡಿ'); return; }
  if (!amount || amount <= 0) { showToast('Enter valid amount · ಮೊತ್ತ ನಮೂದಿಸಿ'); return; }
  if (!reason) { showToast('Select a reason · ಕಾರಣ ಆಯ್ಕೆಮಾಡಿ'); return; }
  showLoader(true);
  addDoc(collection(db, 'donations'), {
    donorName, date, amount, reason, recordedBy: currentUser.uid, createdAt: serverTimestamp()
  }).then(() => {
    showLoader(false);
    document.getElementById('don-name').value = '';
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

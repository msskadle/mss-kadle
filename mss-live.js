// ============================================================
//  mss-live.js  —  Pulls live Events (announcements) and Gallery
//  photos from the same Firebase the member app writes to, and
//  displays them on the public website. READ-ONLY. No login.
//
//  How to use: add ONE line to your index.html, just before </body>:
//      <script type="module" src="mss-live.js"></script>
//
//  It fills:
//   • Events  -> the ".events-grid" container inside <section id="events">
//   • Gallery -> the <section id="gallery"> (creates a grid inside it)
//  If a container isn't found, it does nothing for that part (safe).
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, query, orderBy }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Same project as the member app (these values are public by design)
const firebaseConfig = {
  apiKey: "AIzaSyB6OwS_FOwW0VGTuBBI20y4kkH3a26xu64",
  authDomain: "mss-kadle-e328f.firebaseapp.com",
  projectId: "mss-kadle-e328f",
  storageBucket: "mss-kadle-e328f.firebasestorage.app",
  messagingSenderId: "618234353316",
  appId: "1:618234353316:web:d5b7ca0340cca1a5993831"
};

const app = initializeApp(firebaseConfig, "mss-public");
const db = getFirestore(app);

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();      // Firestore Timestamp
  if (typeof v === "string") { const d = new Date(v); return isNaN(d) ? null : d; }
  if (typeof v === "number") return new Date(v);
  return null;
}

// ---------- EVENTS (from "announcements") ----------
async function loadEvents() {
  const grid = document.querySelector("#events .events-grid") || document.querySelector(".events-grid");
  if (!grid) return; // events section not on this page
  let snap;
  try {
    snap = await getDocs(query(collection(db, "announcements"), orderBy("createdAt", "desc")));
  } catch (e) { console.warn("events load failed", e); return; }

  const items = [];
  snap.forEach(d => items.push(d.data()));
  if (items.length === 0) return; // keep whatever static content is already there

  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  grid.innerHTML = items.map(a => {
    const d = toDate(a.validUntil) || toDate(a.createdAt) || new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const monthYr = `${months[d.getMonth()]} ${d.getFullYear()}`;
    const titleEn = esc(a.titleEn || a.titleKn || "Announcement");
    const titleKn = a.titleKn ? `<div class="event-title-kn">${esc(a.titleKn)}</div>` : "";
    const body = a.body ? `<div class="event-meta"><span>${esc(a.body)}</span></div>` : "";
    const img = a.image ? `<img src="${a.image}" alt="" style="width:100%;border-radius:10px;margin-top:.7rem;display:block;">` : "";
    return `
      <div class="event-card">
        <div class="event-header">
          <div class="event-date-num">${day}</div>
          <div class="event-date-meta">${monthYr}</div>
        </div>
        <div class="event-body">
          <div class="event-type">📢 Announcement · ಪ್ರಕಟಣೆ</div>
          <div class="event-title">${titleEn}</div>
          ${titleKn}
          ${body}
          ${img}
        </div>
      </div>`;
  }).join("");
}

// ---------- GALLERY (from "gallery") ----------
async function loadGallery() {
  const section = document.querySelector("#gallery");
  if (!section) return; // gallery section not on this page
  let snap;
  try {
    snap = await getDocs(query(collection(db, "gallery"), orderBy("createdAt", "desc")));
  } catch (e) { console.warn("gallery load failed", e); return; }

  const items = [];
  snap.forEach(d => items.push(d.data()));
  if (items.length === 0) return;

  // Use an existing grid container if present, else create one
  let grid = section.querySelector(".gallery-grid") || section.querySelector("#mss-live-gallery");
  if (!grid) {
    grid = document.createElement("div");
    grid.id = "mss-live-gallery";
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:1.5rem;";
    section.appendChild(grid);
  }

  grid.innerHTML = items.map(g => {
    const cap = esc(g.captionEn || g.captionKn || "");
    const capKn = g.captionKn && g.captionKn !== g.captionEn ? `<div style="font-size:.7rem;opacity:.75;">${esc(g.captionKn)}</div>` : "";
    return `
      <figure style="margin:0;cursor:pointer;" onclick="window.__mssLightbox && window.__mssLightbox('${g.url}')">
        <img src="${g.url}" alt="${cap}" loading="lazy"
             style="width:100%;height:160px;object-fit:cover;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.12);">
        ${cap ? `<figcaption style="font-size:.78rem;margin-top:.35rem;color:#444;text-align:center;">${cap}${capKn}</figcaption>` : ""}
      </figure>`;
  }).join("");
}

// Simple tap-to-enlarge lightbox for gallery photos
window.__mssLightbox = function (src) {
  const o = document.createElement("div");
  o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;";
  o.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;border-radius:8px;">`;
  o.onclick = () => o.remove();
  document.body.appendChild(o);
};

function start() { loadEvents(); loadGallery(); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();

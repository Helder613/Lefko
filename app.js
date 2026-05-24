const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    toast("Copied!");
  }catch{
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Copied!");
  }
}

function toast(msg){
  let t = $("#toast");
  if(!t){
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText = `
      position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
      background:rgba(0,0,0,.7);color:white;padding:10px 12px;border-radius:12px;
      border:1px solid rgba(255,255,255,.18);z-index:9999;font-size:13px;
      backdrop-filter: blur(10px);
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = "1";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> (t.style.opacity="0"), 1200);
}

/* ---------- PDF.js setup ---------- */
function setupPdfJs(){
  if(!window.pdfjsLib) return;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.js";
}

async function renderPdfThumb(url, canvas){
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const loadingTask = window.pdfjsLib.getDocument({ url });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  const targetHeight = 160;
  const unscaled = page.getViewport({ scale: 1 });
  const scale = targetHeight / unscaled.height;
  const viewport = page.getViewport({ scale });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  pdf.cleanup();
}

function setupPdfThumbLazyLoad(){
  const tiles = $$("[data-pdf-url]");
  if(!tiles.length || !window.pdfjsLib) return;

  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (e) => {
      if(!e.isIntersecting) return;
      io.unobserve(e.target);

      const url = e.target.getAttribute("data-pdf-url");
      const canvas = e.target.querySelector("canvas");
      const fallback = e.target.querySelector(".pdf-fallback");
      if(!url || !canvas) return;

      try{
        await renderPdfThumb(url, canvas);
        if(fallback) fallback.style.display = "none";
      }catch(err){
        // keep fallback visible
      }
    });
  }, { threshold: 0.15 });

  tiles.forEach(t => io.observe(t));
}

/* ---------- Load data from JSON (CMS-managed) ---------- */
let categories = [];
let allProjects = [];

async function loadCategories(){
  // Load from CMS-managed single JSON file
  try{
    const res = await fetch("/data/projects.json");
    if(res.ok){
      const data = await res.json();
      // data is an array of category objects (the "root" list from CMS)
      const cats = Array.isArray(data) ? data : (data.root || []);
      return cats.sort((a,b) => (a.sortOrder||99) - (b.sortOrder||99));
    }
  }catch(_){}

  // Fallback: legacy projects.js
  if(window.CATEGORIES) return window.CATEGORIES;

  return [];
}

/* ---------- State ---------- */
let activeCategoryId = "";
let filteredProjects = [];
let activeProjectIndex = 0;

/* ---------- Elements ---------- */
const categoryBarEl = $("#categoryBar");
const projectListEl = $("#projectList");
const thumbGridEl = $("#thumbGrid");
const activeTitleEl = $("#activeTitle");
const activeMetaEl = $("#activeMeta");
const activeCategoryLabelEl = $("#activeCategoryLabel");
const copyProjectLinkBtn = $("#copyProjectLink");

/* ---------- Category UI ---------- */
function renderCategories(){
  categoryBarEl.innerHTML = categories.map(c => `
    <button class="cat magnetic" type="button" data-cat="${escapeHtml(c.id)}" aria-selected="${c.id===activeCategoryId}">
      ${escapeHtml(c.label)}
    </button>
  `).join("");

  $$("#categoryBar .cat").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategoryId = btn.dataset.cat;
      $$("#categoryBar .cat").forEach(b => b.setAttribute("aria-selected","false"));
      btn.setAttribute("aria-selected","true");

      activeProjectIndex = 0;
      applyFilter();
      renderProjectList();
      renderActiveProject();
      updateHash();
      setupMagneticButtons();
    });
  });
}

/* ---------- Filtering ---------- */
function applyFilter(){
  filteredProjects = allProjects.filter(p => p.categoryId === activeCategoryId);
  const cat = categories.find(c => c.id === activeCategoryId);
  activeCategoryLabelEl.textContent = cat ? cat.label : "";
}

/* ---------- Project list ---------- */
function renderProjectList(){
  if(filteredProjects.length === 0){
    projectListEl.innerHTML = `<div class="muted small" style="padding:10px 6px;">No projects in this category yet.</div>`;
    return;
  }

  projectListEl.innerHTML = filteredProjects.map((p, i) => {
    const meta = `${escapeHtml(p.clientType)} • ${escapeHtml(p.date)} • ${p.tags.map(escapeHtml).join(", ")}`;
    return `
      <button class="magnetic"
        type="button"
        data-index="${i}"
        aria-selected="${i === activeProjectIndex ? "true" : "false"}">
        <div><b>${escapeHtml(p.title)}</b></div>
        <div class="project-meta">${meta}</div>
      </button>
    `;
  }).join("");

  $$("#projectList button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeProjectIndex = Number(btn.dataset.index);
      $$("#projectList button").forEach(b => b.setAttribute("aria-selected","false"));
      btn.setAttribute("aria-selected","true");
      renderActiveProject();
      updateHash();
      setupMagneticButtons();
    });
  });
}

/* ---------- Project items render ---------- */
function renderActiveProject(){
  const p = filteredProjects[activeProjectIndex];
  if(!p){
    activeTitleEl.textContent = "—";
    activeMetaEl.textContent = "—";
    thumbGridEl.innerHTML = "";
    return;
  }

  activeTitleEl.textContent = p.title;
  activeMetaEl.textContent = `${p.clientType} • ${p.date} • ${p.tags.join(" • ")}`;

  thumbGridEl.innerHTML = p.items.map((item, idx) => {
    if(item.type === "image"){
      return `
        <button class="thumb magnetic" type="button" data-idx="${idx}" data-type="image" aria-label="Open image ${idx+1}">
          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(p.title)} sample ${idx+1}" loading="lazy" />
        </button>
      `;
    }

    if(item.type === "pdf"){
      const name = item.name || "PDF document";
      return `
        <button class="pdf-tile magnetic"
          type="button"
          data-idx="${idx}"
          data-type="pdf"
          data-pdf-url="${escapeHtml(item.url)}"
          aria-label="Open PDF">
          <div class="pdf-preview">
            <canvas></canvas>
            <div class="pdf-fallback">
              <span class="pdf-badge">PDF</span>
              <span>Loading preview…</span>
            </div>
          </div>
          <div class="pdf-meta">
            <div class="pdf-name">${escapeHtml(name)}</div>
            <div class="pdf-sub">Click to open</div>
          </div>
        </button>
      `;
    }
    return "";
  }).join("");

  $$("#thumbGrid [data-type='image']").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      openImageLightbox(p, idx);
    });
  });

  $$("#thumbGrid [data-type='pdf']").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const item = p.items[idx];
      openPdfModal(p.title, item.url, item.name);
    });
  });

  setupMagneticButtons();
  setupPdfThumbLazyLoad();
}

/* ---------- Hash deep links ---------- */
function updateHash(){
  const p = filteredProjects[activeProjectIndex];
  if(!p) return;
  history.replaceState(null, "", `#projects?cat=${encodeURIComponent(activeCategoryId)}&project=${encodeURIComponent(p.id)}`);
}

function applyFromHash(){
  const hash = window.location.hash || "";
  const catMatch = hash.match(/cat=([^&]+)/);
  const projMatch = hash.match(/project=([^&]+)/);

  if(catMatch){
    const cid = decodeURIComponent(catMatch[1]);
    if(categories.some(c => c.id === cid)) activeCategoryId = cid;
  }
  applyFilter();

  if(projMatch){
    const pid = decodeURIComponent(projMatch[1]);
    const idx = filteredProjects.findIndex(p => p.id === pid);
    if(idx >= 0) activeProjectIndex = idx;
  }
}

/* ---------- Image lightbox ---------- */
const lbBackdrop = $("#lbBackdrop");
const lbImg = $("#lbImg");
const lbTitle = $("#lbTitle");
const lbClose = $("#lbClose");
const lbPrev = $("#lbPrev");
const lbNext = $("#lbNext");

let lbProject = null;
let lbIndex = 0;
let lbImageItemIndexes = [];

function openImageLightbox(project, itemIndex){
  lbProject = project;
  lbImageItemIndexes = project.items
    .map((it, i) => it.type === "image" ? i : -1)
    .filter(i => i >= 0);

  const mapped = lbImageItemIndexes.indexOf(itemIndex);
  lbIndex = mapped >= 0 ? mapped : 0;

  lbBackdrop.classList.add("is-open");
  document.body.style.overflow = "hidden";
  renderImageLightbox();
}

function closeImageLightbox(){
  lbBackdrop.classList.remove("is-open");
  document.body.style.overflow = "";
}

function renderImageLightbox(){
  if(!lbProject) return;
  const itemRealIndex = lbImageItemIndexes[lbIndex];
  const url = lbProject.items[itemRealIndex].url;

  lbTitle.textContent = `${lbProject.title} — ${lbIndex + 1}/${lbImageItemIndexes.length}`;
  lbImg.src = url;
  lbImg.alt = `${lbProject.title} image ${lbIndex + 1}`;
}

function prevImg(){ lbIndex = (lbIndex - 1 + lbImageItemIndexes.length) % lbImageItemIndexes.length; renderImageLightbox(); }
function nextImg(){ lbIndex = (lbIndex + 1) % lbImageItemIndexes.length; renderImageLightbox(); }

function setupImageLightboxEvents(){
  lbClose.addEventListener("click", closeImageLightbox);
  lbPrev.addEventListener("click", prevImg);
  lbNext.addEventListener("click", nextImg);
  lbBackdrop.addEventListener("click", (e) => { if(e.target === lbBackdrop) closeImageLightbox(); });
}

/* ---------- PDF modal ---------- */
const pdfBackdrop = $("#pdfBackdrop");
const pdfFrame = $("#pdfFrame");
const pdfTitle = $("#pdfTitle");
const pdfClose = $("#pdfClose");

function openPdfModal(projectTitle, url, name){
  const safeName = name ? ` — ${name}` : "";
  pdfTitle.textContent = `${projectTitle}${safeName}`;
  pdfFrame.src = url;

  pdfBackdrop.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closePdfModal(){
  pdfBackdrop.classList.remove("is-open");
  document.body.style.overflow = "";
  pdfFrame.src = "about:blank";
}

function setupPdfEvents(){
  pdfClose.addEventListener("click", closePdfModal);
  pdfBackdrop.addEventListener("click", (e) => { if(e.target === pdfBackdrop) closePdfModal(); });
}

/* ---------- Fade-in ---------- */
function setupFadeIn(){
  const items = $$(".fade-in");
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if(e.isIntersecting){
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach(el => io.observe(el));
}

/* ---------- Cursor glow + magnetic ---------- */
function setupCursorGlow(){
  const glow = document.querySelector(".cursor-glow");
  if(!glow) return;

  window.addEventListener("mousemove", (e) => {
    const x = (e.clientX / window.innerWidth) * 100;
    const y = (e.clientY / window.innerHeight) * 100;
    glow.style.setProperty("--x", x + "%");
    glow.style.setProperty("--y", y + "%");
  });
}

function setupMagneticButtons(){
  const magnets = $$(".magnetic");
  magnets.forEach(el => {
    el.onmousemove = (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * 0.06}px, ${dy * 0.06}px)`;
    };
    el.onmouseleave = () => { el.style.transform = ""; };
  });
}

/* ---------- Copy buttons ---------- */
function setupCopyButtons(){
  $$("[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => copyToClipboard(btn.getAttribute("data-copy") || ""));
  });

  if(copyProjectLinkBtn){
    copyProjectLinkBtn.addEventListener("click", () => {
      const p = filteredProjects[activeProjectIndex];
      if(!p) return;
      const url = `${location.origin}${location.pathname}#projects?cat=${encodeURIComponent(activeCategoryId)}&project=${encodeURIComponent(p.id)}`;
      copyToClipboard(url);
    });
  }
}

/* ---------- Keyboard ---------- */
function setupKeyboard(){
  window.addEventListener("keydown", (e) => {
    if(e.key !== "Escape") return;
    if(lbBackdrop.classList.contains("is-open")) closeImageLightbox();
    if(pdfBackdrop.classList.contains("is-open")) closePdfModal();
  });

  window.addEventListener("keydown", (e) => {
    if(!lbBackdrop.classList.contains("is-open")) return;
    if(e.key === "ArrowLeft") prevImg();
    if(e.key === "ArrowRight") nextImg();
  });
}

/* ---------- Netlify Identity redirect ---------- */
if(window.netlifyIdentity){
  window.netlifyIdentity.on("init", user => {
    if(!user){
      window.netlifyIdentity.on("login", () => {
        document.location.href = "/admin/";
      });
    }
  });
}

/* ---------- Init ---------- */
(async function init(){
  $("#year").textContent = new Date().getFullYear();

  setupPdfJs();

  // Load content from CMS-managed JSON files
  categories = await loadCategories();
  allProjects = categories.flatMap(cat =>
    cat.projects.map(p => ({...p, categoryId: cat.id, categoryLabel: cat.label}))
  );

  activeCategoryId = categories[0]?.id || "";

  applyFromHash();
  renderCategories();
  applyFilter();
  renderProjectList();
  renderActiveProject();

  setupFadeIn();
  setupCursorGlow();
  setupMagneticButtons();
  setupCopyButtons();
  setupImageLightboxEvents();
  setupPdfEvents();
  setupKeyboard();

  window.addEventListener("hashchange", () => {
    applyFromHash();
    renderCategories();
    renderProjectList();
    renderActiveProject();
    setupMagneticButtons();
  });
})();

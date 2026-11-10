/* Corrigeo — SPA branchée sur l'API Flask (/api/...).
   Flux : upload -> (auto | guidé) -> export -> résultat.
   Aucune donnée factice : tout vient du backend. */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- état ---------- */
const state = {
  docId: null,
  filename: null,
  proposals: [],          // [{id,title,category,original,suggestion,before,after,explanation,location,decision}]
  segments: [],           // [{index,label,page,text}] pour l'aperçu document
  decisions: {},          // id -> chosen|kept (pending = absent)
  statusFilter: "all",
  categoryFilter: "all",
  current: 0,             // index dans state.proposals
  exportInfo: null,       // réponse de /export
  loaded: false,          // proposals déjà récupérées pour ce doc
};

const SS_KEY = "corrigeo.doc";

/* ---------- utilitaires ---------- */
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Rend visibles les espaces : espace -> ␣, insécable -> ⍽, tab -> ⇥ (sur texte déjà échappé). */
function ws(escaped) {
  return escaped.replace(/[ \u0020\u00a0\t]/g, (ch) =>
    ch === "\u0020" ? '<span class="glyph">\u2423</span>'
    : ch === "\u00a0" ? '<span class="glyph">\u233d</span>'
    : '<span class="glyph">\u21e5</span>');
}

/* True si la proposition touche espaces/insécables/tabs : les glyphes ␣⍽⇥
   sont alors utiles. Sinon le texte s'affiche normalement (lisible). */
function needsGlyph(p) {
  const norm = (s) => (s || "").replace(/\s/g, "");
  if (norm(p.original) === norm(p.suggestion)) return true;   // diff = espaces seuls
  return /[\u00a0\u202f\t]/.test(p.original) || /[\u00a0\u202f\t]/.test(p.suggestion);
}

/* ws() ou esc() selon le besoin — jamais de glyphes partout dans le texte. */
const show = (p, s) => (needsGlyph(p) ? ws(esc(s)) : esc(s));

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, opts);
  let body = null;
  try { body = await res.json(); } catch (_) { /* réponses non-json */ }
  if (!res.ok) {
    const msg = body && body.error ? body.error.message : "Erreur " + res.status;
    const err = new Error(msg);
    err.code = body && body.error ? body.error.code : "http_" + res.status;
    err.status = res.status;
    throw err;
  }
  return body;
}
const getJSON = (p) => api(p);
const postJSON = (p, data) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });

function saveSession() {
  if (state.docId) sessionStorage.setItem(SS_KEY, JSON.stringify({ id: state.docId, filename: state.filename }));
  else sessionStorage.removeItem(SS_KEY);
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY)); } catch (_) { return null; }
}

/* ---------- navigation ---------- */
function go(page) {
  if ((page === "review" || page === "result") && !state.docId) {
    toast("Importez d'abord un document.");
    page = "upload";
  }
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
  $$(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  window.scrollTo({ top: 0 });
  if (page === "review") enterReview();
  if (page === "result") enterResult();
  if (page === "documents") renderDocuments();
}
$$("[data-page]").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));
$$("[data-go]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); go(el.dataset.go); }));

/* ---------- santé du moteur ---------- */
async function health() {
  try {
    const h = await getJSON("/health");
    $("#engineLabel").textContent = h.engine === "languagetool" ? "Moteur local" : "Moteur : " + h.engine;
    $("#engineDot").classList.remove("off");
  } catch (_) {
    $("#engineLabel").textContent = "Hors ligne";
    $("#engineDot").classList.add("off");
  }
}

/* ---------- page documents ---------- */
async function renderDocuments() {
  const stored = loadSession();
  const list = $("#docList"), empty = $("#docEmpty"), stats = $("#docStats");
  if (!stored) {
    list.innerHTML = ""; empty.hidden = false; stats.hidden = true;
    return;
  }
  let meta;
  try {
    meta = await getJSON("/documents/" + stored.id);
  } catch (e) {
    if (e.status === 404) { sessionStorage.removeItem(SS_KEY); state.docId = null; }
    list.innerHTML = ""; empty.hidden = false; stats.hidden = true;
    if (e.status !== 404) toast(e.message);
    return;
  }
  state.docId = meta.document_id; state.filename = meta.filename; state.loaded = false;
  const c = meta.counts, total = c.chosen + c.kept + c.pending, done = c.chosen + c.kept;
  stats.hidden = false;
  $("#pendingStat").textContent = c.pending;
  $("#chosenStat").textContent = c.chosen;
  $("#keptStat").textContent = c.kept;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const finished = meta.exported && c.pending === 0;
  list.innerHTML = `
   <div class="doc-row">
    <div class="doc-name"><div class="file-icon">DOCX</div><div><strong>${esc(meta.filename)}</strong><small>${meta.engine === "languagetool" ? "Moteur local" : esc(meta.engine)} · ${total} proposition${total > 1 ? "s" : ""}</small></div></div>
    <div class="doc-progress"><div class="progress"><span style="width:${pct}%;${finished ? "background:#3b936b" : ""}"></span></div><div class="progress-meta">${done} proposition${done > 1 ? "s" : ""} traitée${done > 1 ? "s" : ""} sur ${total}</div></div>
    <div class="doc-status"><span class="status ${finished ? "green" : "amber"}">${finished ? "Terminé" : "En cours"}</span></div>
    <div class="doc-action"><button class="btn btn-secondary" id="resumeBtn">${finished ? "Consulter" : "Reprendre →"}</button></div>
   </div>`;
  $("#resumeBtn").addEventListener("click", () => go(finished ? "result" : "review"));
}

/* ---------- page upload ---------- */
const fileInput = $("#fileInput"), drop = $("#dropzone"), selected = $("#fileSelected"), analyzeBtn = $("#analyzeBtn");
let chosenFile = null;

$("#browseBtn").addEventListener("click", () => fileInput.click());
function setFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".docx")) { toast("Veuillez sélectionner un fichier .docx."); return; }
  if (file.size > 25 * 1024 * 1024) { toast("Le fichier dépasse la limite de 25 Mo."); return; }
  chosenFile = file;
  selected.style.display = "block";
  selected.textContent = "✓ " + file.name + " (" + (file.size / 1024).toFixed(1) + " Ko) — prêt pour l'analyse";
  analyzeBtn.disabled = false;
}
fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

/* barre de progression honnête : avance tant qu'on attend le serveur */
function startProgress(stages) {
  const box = $("#analysis"), bar = $("#analysisProgress"), pct = $("#analysisPercent"), title = $("#analysisTitle"), hint = $("#analysisHint");
  box.classList.add("show");
  let step = 0, p = 0;
  const applyStage = () => { if (stages[step]) { title.textContent = stages[step][0]; hint.textContent = stages[step][1]; } };
  applyStage();
  const timer = setInterval(() => {
    const cap = step < stages.length - 1 ? 92 : 100;
    p = Math.min(cap, p + Math.max(1, (cap - p) * 0.04));
    bar.style.width = p + "%";
    pct.textContent = Math.round(p) + " %";
    if (stages[step + 1] && p >= stages[step + 1][2]) { step++; applyStage(); }
  }, 120);
  return {
    next() { if (stages[step + 1]) { step++; applyStage(); } },
    done() { clearInterval(timer); bar.style.width = "100%"; pct.textContent = "100 %"; },
    fail() { clearInterval(timer); box.classList.remove("show"); },
  };
}

analyzeBtn.addEventListener("click", async () => {
  if (!chosenFile) return;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const auto = mode === "auto";
  analyzeBtn.disabled = true;
  const prog = startProgress([
    ["Envoi du document…", "Transfert vers le service local.", 0],
    ["Analyse du document…", "Recherche des propositions — la première analyse peut prendre 1 à 2 minutes (démarrage du moteur).", 8],
    ["Document analysé", "Préparation de la relecture.", 90],
  ]);
  try {
    const fd = new FormData();
    fd.append("file", chosenFile, chosenFile.name);
    const up = await api("/documents", { method: "POST", body: fd });
    state.docId = up.document_id;
    state.filename = up.filename;
    state.decisions = {};
    state.exportInfo = null;
    state.loaded = false;
    saveSession();
    prog.next();
    await fetchProposals();

    if (auto && state.proposals.length) {
      prog.next(); // "Document analysé" -> on réutilise pour l'application
      $("#analysisTitle").textContent = "Application des corrections…";
      $("#analysisHint").textContent = "Correction automatique : toutes les suggestions du moteur sont acceptées.";
      const all = {};
      state.proposals.forEach((p) => { all[p.id] = "chosen"; });
      await postJSON(`/documents/${state.docId}/decisions`, { decisions: all });
      state.exportInfo = await api(`/documents/${state.docId}/export`, { method: "POST" });
      prog.done();
      toast(state.exportInfo.applied.length + " correction(s) appliquée(s).");
      analyzeBtn.disabled = false;
      go("result");
      return;
    }
    prog.done();
    analyzeBtn.disabled = false;
    if (!state.proposals.length) toast("Aucune proposition détectée — le document semble propre.");
    go("review");
  } catch (e) {
    prog.fail();
    analyzeBtn.disabled = false;
    toast(e.message);
  }
});

async function fetchProposals() {
  const data = await getJSON(`/documents/${state.docId}/proposals`);
  state.proposals = data.proposals;
  state.decisions = {};
  state.proposals.forEach((p) => { if (p.decision !== "pending") state.decisions[p.id] = p.decision; });
  state.loaded = true;
  return data;
}

async function fetchPreview() {
  try {
    const data = await getJSON(`/documents/${state.docId}/preview`);
    state.segments = data.segments;
  } catch (_) {
    state.segments = [];   // aperçu facultatif : la relecture reste utilisable
  }
}

/* ---------- page review ---------- */
const decisionOf = (p) => state.decisions[p.id] || "pending";
const visible = () => state.proposals.filter((p) =>
  (state.statusFilter === "all" || decisionOf(p) === state.statusFilter) &&
  (state.categoryFilter === "all" || p.category === state.categoryFilter));

function counts() {
  const c = { chosen: 0, kept: 0, pending: 0 };
  state.proposals.forEach((p) => c[decisionOf(p)]++);
  return c;
}

function updateCounts() {
  const c = counts(), total = state.proposals.length, done = c.chosen + c.kept;
  $("#acceptedCount").textContent = c.chosen;
  $("#keptCount").textContent = c.kept;
  $("#pendingCount").textContent = c.pending;
  $("#reviewProgressLabel").textContent = done + " / " + total;
  $("#filterAll").textContent = total;
  $("#filterPending").textContent = c.pending;
  $("#filterChosen").textContent = c.chosen;
  $("#filterKept").textContent = c.kept;
  if (total) {
    $("#acceptedBar").style.width = (c.chosen / total) * 100 + "%";
    $("#keptBar").style.width = (c.kept / total) * 100 + "%";
    $("#pendingBar").style.width = (c.pending / total) * 100 + "%";
  }
}

function buildCategoryFilters() {
  const cats = {};
  state.proposals.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
  const box = $("#categoryFilters");
  box.innerHTML = `<button class="filter-btn ${state.categoryFilter === "all" ? "active" : ""}" data-category="all">Toutes les catégories</button>` +
    Object.keys(cats).sort().map((cat) =>
      `<button class="filter-btn ${state.categoryFilter === cat ? "active" : ""}" data-category="${esc(cat)}">${esc(cat)} <small>${cats[cat]}</small></button>`).join("");
  $$("#categoryFilters .filter-btn").forEach((b) => b.addEventListener("click", () => {
    state.categoryFilter = b.dataset.category;
    $$("#categoryFilters .filter-btn").forEach((x) => x.classList.toggle("active", x === b));
    state.current = 0;
    renderProposal();
  }));
}

/* ---------- aperçu document (panneau gauche) ---------- */
function renderPreview() {
  const box = $("#docPreview");
  if (!state.segments.length) {
    box.innerHTML = `<div class="empty" style="padding:30px 14px"><p class="fineprint">Aperçu indisponible pour ce document.</p></div>`;
    return;
  }
  const bySeg = {};
  state.proposals.forEach((p) => {
    (bySeg[p.location.segment] = bySeg[p.location.segment] || []).push(p);
  });
  box.innerHTML = state.segments.map((seg) => {
    const props = (bySeg[seg.index] || []).sort((a, b) => a.location.offset - b.location.offset);
    let html = "", pos = 0;
    for (const p of props) {
      let start = p.location.offset, end = start + p.original.length;
      if (seg.text.slice(start, end) !== p.original) {          // ancre côté rendu
        start = seg.text.indexOf(p.original, start);
        if (start === -1) continue;
        end = start + p.original.length;
      }
      if (start < pos) continue;                                 // sécurité : pas de chevauchement
      html += esc(seg.text.slice(pos, start));
      html += `<mark class="prop ${decisionOf(p)}" data-pid="${esc(p.id)}">${show(p, seg.text.slice(start, end))}</mark>`;
      pos = end;
    }
    html += esc(seg.text.slice(pos));
    return `<div class="doc-para"><span class="doc-para-label">${esc(seg.label)}</span>${html}</div>`;
  }).join("");
  box.querySelectorAll("mark.prop").forEach((m) => m.addEventListener("click", () => {
    const idx = state.proposals.findIndex((p) => p.id === m.dataset.pid);
    if (idx !== -1) { state.current = idx; renderProposal(); }
  }));
}

function syncPreviewMark(pid) {
  const m = document.querySelector(`mark[data-pid="${CSS.escape(pid)}"]`);
  if (m) m.className = "prop " + (state.decisions[pid] || "pending");
}

function scrollPreviewTo(pid) {
  const box = $("#docPreview");
  const m = box.querySelector(`mark[data-pid="${CSS.escape(pid)}"]`);
  $$("#docPreview mark.prop.active").forEach((x) => x.classList.remove("active"));
  if (!m) return;
  m.classList.add("active");
  // position mesurée en viewport : robuste quel que soit le flux
  box.scrollTop = m.getBoundingClientRect().top - box.getBoundingClientRect().top
    + box.scrollTop - box.clientHeight / 3;
}

/* Garder ce mot dans tout le document : toutes les propositions portant le
   même extrait original (insensible à la casse) passent à 'kept'. */
async function ignoreWord(p) {
  const word = p.original.trim().toLowerCase();
  const targets = state.proposals.filter(
    (x) => x.original.trim().toLowerCase() === word && decisionOf(x) === "pending"
  );
  if (!targets.length) return;
  if (!confirm(`Conserver « ${p.original.trim()} » partout dans le document ?\n${targets.length} proposition(s) en attente seront marquées « conservées ».`)) return;
  const all = {};
  targets.forEach((x) => { all[x.id] = "kept"; });
  try {
    await postJSON(`/documents/${state.docId}/decisions`, { decisions: all });
    targets.forEach((x) => { state.decisions[x.id] = "kept"; x.decision = "kept"; syncPreviewMark(x.id); });
    state.exportInfo = null;
    toast(`${targets.length} occurrence(s) de « ${p.original.trim()} » conservée(s).`);
    buildGroups();
    renderProposal();
  } catch (e) { toast(e.message); }
}

/* ---------- groupes de corrections identiques ---------- */
function buildGroups() {
  const groups = {};
  state.proposals.forEach((p) => {
    const key = p.title;
    (groups[key] = groups[key] || []).push(p);
  });
  const top = Object.entries(groups).filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  const box = $("#groupFilters");
  if (!top.length) { box.innerHTML = `<span class="fineprint" style="padding:0 10px">Aucun groupe répétitif.</span>`; return; }
  box.innerHTML = "";
  top.forEach(([title, list]) => {
    const pending = list.filter((p) => decisionOf(p) === "pending").length;
    const btn = document.createElement("button");
    btn.className = "group-btn";
    btn.innerHTML = `<strong>${esc(title.length > 34 ? title.slice(0, 33) + "…" : title)}</strong><small>×${list.length}${pending ? "" : " ✓"}</small>`;
    btn.title = "Accepter les " + pending + " occurrences en attente de « " + title + " »";
    btn.addEventListener("click", async () => {
      const targets = list.filter((p) => decisionOf(p) === "pending");
      if (!targets.length) { toast("Toutes les occurrences de ce groupe sont déjà traitées."); return; }
      if (!confirm(`Accepter les ${targets.length} occurrences en attente de\n« ${title} » ?`)) return;
      const all = {};
      targets.forEach((p) => { all[p.id] = "chosen"; });
      try {
        await postJSON(`/documents/${state.docId}/decisions`, { decisions: all });
        targets.forEach((p) => { state.decisions[p.id] = "chosen"; p.decision = "chosen"; syncPreviewMark(p.id); });
        state.exportInfo = null;
        toast(targets.length + " occurrence(s) acceptée(s).");
        buildGroups();
        renderProposal();
      } catch (e) { toast(e.message); }
    });
    box.appendChild(btn);
  });
}

async function enterReview() {
  $("#reviewFilename").textContent = state.filename || "document.docx";
  if (!state.loaded) {
    try { await fetchProposals(); } catch (e) { toast(e.message); go("upload"); return; }
  }
  await fetchPreview();
  buildCategoryFilters();
  buildGroups();
  renderPreview();
  // reprendre là où en est la première proposition non traitée
  const firstPending = state.proposals.findIndex((p) => decisionOf(p) === "pending");
  if (state.current >= state.proposals.length || decisionOf(state.proposals[state.current]) !== "pending") {
    state.current = firstPending >= 0 ? firstPending : 0;
  }
  renderProposal();
}

const pageOf = (p) => (state.segments[p.location.segment] || {}).page ?? null;

function renderProposal() {
  const view = visible();
  const card = $("#proposalCard");
  updateCounts();
  if (!state.proposals.length) {
    card.innerHTML = `<div class="empty"><div class="empty-icon">✓</div><h3>Aucune proposition</h3><p>Le moteur n'a détecté aucune correction à proposer dans ce document.</p><button class="btn btn-primary" id="goExportEmpty">Exporter le document →</button></div>`;
    $("#navPosition").textContent = "";
    $("#prevBtn").disabled = $("#nextBtn").disabled = true;
    $("#nextPageBtn").hidden = true;
    $(".action-bar").hidden = true;
    $("#goExportEmpty").addEventListener("click", doExport);
    return;
  }
  if (!view.length) {
    card.innerHTML = `<div class="empty"><div class="empty-icon">⌕</div><h3>Aucune proposition dans cette vue</h3><p>Modifiez les filtres pour afficher d'autres propositions.</p><button class="btn btn-secondary" id="resetFiltersBtn">Réinitialiser les filtres</button></div>`;
    $("#navPosition").textContent = "Aucun résultat";
    $("#prevBtn").disabled = $("#nextBtn").disabled = true;
    $("#nextPageBtn").hidden = true;
    $(".action-bar").hidden = true;
    $("#resetFiltersBtn").addEventListener("click", resetFilters);
    return;
  }
  if (!view.includes(state.proposals[state.current])) {
    state.current = state.proposals.indexOf(view[0]);
  }
  const p = state.proposals[state.current];
  const d = decisionOf(p);
  const idx = view.indexOf(p);
  const page = pageOf(p);
  // même mot ailleurs en attente -> proposer "ignorer partout"
  const sameWord = state.proposals.filter(
    (x) => x !== p && x.original.trim().toLowerCase() === p.original.trim().toLowerCase() && decisionOf(x) === "pending"
  );
  card.innerHTML = `
   <div class="proposal-top"><span class="category">${esc(p.category).toUpperCase()}</span><span class="proposal-position">${esc(p.location.label)}</span></div>
   <div class="diff-inline"><del>${show(p, p.original)}</del><span class="arrow">→</span><ins>${show(p, p.suggestion)}</ins></div>
   <div class="ctx-line">${esc(p.before)}<b>${show(p, p.original)}</b>${esc(p.after)}</div>
   <div class="explanation"><strong>Pourquoi cette suggestion ?</strong>${esc(p.explanation)}</div>
   ${needsGlyph(p) ? '<div class="ctx-note">␣ = espace · ⍽ = espace insécable · ⇥ = tabulation</div>' : ""}
   <div class="proposal-footer">
    <span class="left">${d === "pending" ? "Aucune décision enregistrée." : d === "chosen" ? "Acceptée — sera appliquée à l'export." : "Conservée — texte inchangé."}</span>
   </div>`;
  // boutons fixes : on ne met à jour que leurs libellés/visibilités (position stable)
  $(".action-bar").hidden = false;
  $("#keepBtn").textContent = d === "kept" ? "Conservé ✓" : "Garder";
  $("#acceptBtn").textContent = d === "chosen" ? "Acceptée ✓" : "Accepter";
  const iw = $("#ignoreWordBtn");
  iw.hidden = sameWord.length === 0;
  if (sameWord.length) iw.textContent = `Ignorer partout (×${sameWord.length + (d === "pending" ? 1 : 0)})`;
  $("#navPosition").textContent = (idx + 1) + " / " + view.length;
  $("#prevBtn").disabled = idx <= 0;
  $("#nextBtn").disabled = idx >= view.length - 1;
  // navigation par page : prochaine page contenant une erreur en attente
  const nextPage = state.proposals.find(
    (x) => decisionOf(x) === "pending" && pageOf(x) !== null && page !== null && pageOf(x) > page
  );
  $("#nextPageBtn").hidden = !nextPage;
  if (nextPage) $("#nextPageBtn").textContent = `⇥ Page ~${pageOf(nextPage)} suivante`;
  scrollPreviewTo(p.id);
}

async function decide(p, value) {
  const prev = state.decisions[p.id];
  state.decisions[p.id] = value;
  p.decision = value;
  syncPreviewMark(p.id);
  updateCounts();
  renderProposal();
  try {
    await postJSON(`/documents/${state.docId}/decisions`, { decisions: { [p.id]: value } });
    state.exportInfo = null; // décisions changées -> export à refaire
    // avancer automatiquement vers la prochaine proposition en attente de cette vue
    const view = visible();
    const nextPending = view.find((x) => decisionOf(x) === "pending" && state.proposals.indexOf(x) > state.proposals.indexOf(p));
    if (nextPending) {
      state.current = state.proposals.indexOf(nextPending);
      renderProposal();
    } else {
      const c = counts();
      if (!c.pending) toast("Toutes les propositions sont traitées — vous pouvez exporter.");
      else renderProposal();
    }
  } catch (e) {
    if (prev === undefined) delete state.decisions[p.id]; else state.decisions[p.id] = prev;
    p.decision = prev || "pending";
    toast(e.message);
    renderProposal();
  }
}

function move(delta) {
  const view = visible();
  if (!view.length) return;
  const p = state.proposals[state.current];
  let i = view.indexOf(p) + delta;
  if (i < 0) i = 0;
  if (i >= view.length) i = view.length - 1;
  state.current = state.proposals.indexOf(view[i]);
  renderProposal();
}
$("#prevBtn").addEventListener("click", () => move(-1));
$("#nextBtn").addEventListener("click", () => move(1));
/* boutons fixes, liés une seule fois : agissent toujours sur la proposition courante */
$("#keepBtn").addEventListener("click", () => { const p = state.proposals[state.current]; if (p) decide(p, "kept"); });
$("#acceptBtn").addEventListener("click", () => { const p = state.proposals[state.current]; if (p) decide(p, "chosen"); });
$("#ignoreWordBtn").addEventListener("click", () => { const p = state.proposals[state.current]; if (p) ignoreWord(p); });
$("#nextPageBtn").addEventListener("click", () => {
  const cur = pageOf(state.proposals[state.current]);
  const next = state.proposals.find(
    (x) => decisionOf(x) === "pending" && pageOf(x) !== null && cur !== null && pageOf(x) > cur
  );
  if (next) { state.current = state.proposals.indexOf(next); renderProposal(); }
  else toast("Plus d'erreur en attente sur les pages suivantes.");
});

function resetFilters() {
  state.statusFilter = "all"; state.categoryFilter = "all";
  $$("#statusFilters .filter-btn").forEach((b) => b.classList.toggle("active", b.dataset.status === "all"));
  buildCategoryFilters();
  state.current = 0;
  renderProposal();
}
$$("#statusFilters .filter-btn").forEach((b) => b.addEventListener("click", () => {
  state.statusFilter = b.dataset.status;
  $$("#statusFilters .filter-btn").forEach((x) => x.classList.toggle("active", x === b));
  state.current = 0;
  renderProposal();
}));

$("#bulkBtn").addEventListener("click", async () => {
  const targets = visible().filter((p) => decisionOf(p) === "pending");
  if (!targets.length) { toast("Aucune proposition en attente dans cette vue."); return; }
  if (!confirm(`Accepter les ${targets.length} propositions actuellement affichées et en attente ?`)) return;
  const all = {};
  targets.forEach((p) => { all[p.id] = "chosen"; });
  try {
    await postJSON(`/documents/${state.docId}/decisions`, { decisions: all });
    targets.forEach((p) => { state.decisions[p.id] = "chosen"; p.decision = "chosen"; syncPreviewMark(p.id); });
    state.exportInfo = null;
    toast(targets.length + " proposition(s) acceptée(s).");
    buildGroups();
    renderProposal();
  } catch (e) { toast(e.message); }
});

$("#exportBtn").addEventListener("click", doExport);
async function doExport() {
  const c = counts();
  if (c.pending && !confirm(`Il reste ${c.pending} proposition(s) non vérifiée(s) : elles resteront inchangées. Exporter quand même ?`)) return;
  $("#exportBtn").disabled = true;
  try {
    state.exportInfo = await api(`/documents/${state.docId}/export`, { method: "POST" });
    go("result");
  } catch (e) { toast(e.message); }
  $("#exportBtn").disabled = false;
}

/* ---------- page result ---------- */
async function enterResult() {
  if (!state.exportInfo) {
    try { state.exportInfo = await api(`/documents/${state.docId}/export`, { method: "POST" }); }
    catch (e) { toast(e.message); go("documents"); return; }
  }
  const info = state.exportInfo;
  const applied = info.applied.length, rejected = info.rejected.length, skipped = info.skipped.length;
  $("#resultApplied").textContent = applied;
  $("#resultSkipped").textContent = skipped;
  $("#resultRejected").textContent = rejected;
  $("#downloadName").textContent = info.output_filename;
  const box = $("#rejectedInfo");
  if (rejected) {
    box.hidden = false;
    box.className = "info warn";
    box.innerHTML = `<strong>À vérifier :</strong> ${rejected} suggestion(s) n'ont pas pu être appliquées (contexte modifié ou contenu protégé). Le texte original correspondant est conservé tel quel.`;
  } else box.hidden = true;
  $("#resultTitle").textContent = "Export terminé";
  $("#resultSubtitle").textContent = applied
    ? `${applied} correction(s) appliquée(s) sur votre document. Les passages non retenus sont inchangés.`
    : "Aucune correction n'a été appliquée : le fichier exporté est identique à l'original.";
}

$("#downloadBtn").addEventListener("click", () => {
  if (!state.docId) return;
  window.location = `/api/documents/${state.docId}/download`;
});

$("#summaryBtn").addEventListener("click", async () => {
  try {
    const s = await getJSON(`/documents/${state.docId}/summary`);
    const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const rows = [["Proposition", "Catégorie", "Localisation", "Décision", "Extrait original", "Extrait proposé"].map(q).join(";")];
    const labels = { chosen: "acceptée", kept: "conservée", pending: "non vérifiée" };
    for (const dec of ["chosen", "kept", "pending"]) {
      for (const it of s[dec] || []) {
        rows.push([it.title, it.category, it.label, labels[dec], it.original_full, it.suggestion_full].map(q).join(";"));
      }
    }
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (state.filename || "document").replace(/\.docx$/i, "") + "_recapitulatif.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Récapitulatif téléchargé.");
  } catch (e) { toast(e.message); }
});

/* ---------- clavier ---------- */
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  if (!$("#page-review").classList.contains("active")) return;
  const p = state.proposals[state.current];
  const k = e.key.toLowerCase();
  if (k === "a" && p) { e.preventDefault(); decide(p, "chosen"); }
  else if (k === "g" && p) { e.preventDefault(); decide(p, "kept"); }
  else if (k === "z" && p) {
    e.preventDefault();
    const prev = state.decisions[p.id];
    delete state.decisions[p.id];
    p.decision = "pending";
    state.exportInfo = null;
    postJSON(`/documents/${state.docId}/decisions`, { decisions: { [p.id]: "pending" } })
      .catch((err) => { if (prev) state.decisions[p.id] = prev; toast(err.message); });
    renderProposal();
  }
  else if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
});

/* ---------- démarrage ---------- */
(function init() {
  if (!document.getElementById("page-documents")) return; // pas la SPA (anciennes pages)
  const stored = loadSession();
  if (stored) { state.docId = stored.id; state.filename = stored.filename; }
  health();
  renderDocuments();
})();

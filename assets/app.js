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

async function enterReview() {
  $("#reviewFilename").textContent = state.filename || "document.docx";
  if (!state.loaded) {
    try { await fetchProposals(); } catch (e) { toast(e.message); go("upload"); return; }
  }
  buildCategoryFilters();
  // reprendre là où en est la première proposition non traitée
  const firstPending = state.proposals.findIndex((p) => decisionOf(p) === "pending");
  if (state.current >= state.proposals.length || decisionOf(state.proposals[state.current]) !== "pending") {
    state.current = firstPending >= 0 ? firstPending : 0;
  }
  renderProposal();
}

function contextHTML(p, suggested) {
  const mid = suggested
    ? `<span class="good-word">${ws(esc(p.suggestion))}</span>`
    : `<span class="bad-word">${ws(esc(p.original))}</span>`;
  return ws(esc(p.before)) + mid + ws(esc(p.after));
}

function renderProposal() {
  const view = visible();
  const card = $("#proposalCard");
  updateCounts();
  if (!state.proposals.length) {
    card.innerHTML = `<div class="empty"><div class="empty-icon">✓</div><h3>Aucune proposition</h3><p>Le moteur n'a détecté aucune correction à proposer dans ce document.</p><button class="btn btn-primary" id="goExportEmpty">Exporter le document →</button></div>`;
    $("#navPosition").textContent = "";
    $("#prevBtn").disabled = $("#nextBtn").disabled = true;
    $("#goExportEmpty").addEventListener("click", doExport);
    return;
  }
  if (!view.length) {
    card.innerHTML = `<div class="empty"><div class="empty-icon">⌕</div><h3>Aucune proposition dans cette vue</h3><p>Modifiez les filtres pour afficher d'autres propositions.</p><button class="btn btn-secondary" id="resetFiltersBtn">Réinitialiser les filtres</button></div>`;
    $("#navPosition").textContent = "Aucun résultat";
    $("#prevBtn").disabled = $("#nextBtn").disabled = true;
    $("#resetFiltersBtn").addEventListener("click", resetFilters);
    return;
  }
  if (!view.includes(state.proposals[state.current])) {
    state.current = state.proposals.indexOf(view[0]);
  }
  const p = state.proposals[state.current];
  const d = decisionOf(p);
  const idx = view.indexOf(p);
  card.innerHTML = `
   <div class="proposal-top"><span class="category">${esc(p.category).toUpperCase()}</span><span class="proposal-position">${esc(p.location.label)}</span></div>
   <h3 class="proposal-title">${ws(esc(p.title))}</h3>
   <div class="diff-label">EXTRAIT ORIGINAL</div>
   <div class="proposal-context">${contextHTML(p, false)}</div>
   <div class="diff-label">SUGGESTION PROPOSÉE</div>
   <div class="proposal-context" style="border-left-color:#b9ddc7">${contextHTML(p, true)}</div>
   <div class="explanation"><strong>Pourquoi cette suggestion ?</strong>${esc(p.explanation)}</div>
   <div class="proposal-footer">
    <span class="left">${d === "pending" ? "Aucune décision enregistrée pour cette proposition." : d === "chosen" ? "Correction acceptée — sera appliquée à l'export." : "Texte original conservé — ne sera pas modifié."}</span>
    <div class="proposal-actions">
     <button class="btn btn-secondary" id="keepBtn">${d === "kept" ? "Texte conservé ✓" : "Garder mon texte"}</button>
     <button class="btn btn-green" id="acceptBtn">${d === "chosen" ? "Correction acceptée ✓" : "Accepter la correction"}</button>
    </div>
   </div>`;
  $("#keepBtn").addEventListener("click", () => decide(p, "kept"));
  $("#acceptBtn").addEventListener("click", () => decide(p, "chosen"));
  $("#navPosition").textContent = (idx + 1) + " sur " + view.length + " · proposition " + (state.proposals.indexOf(p) + 1) + "/" + state.proposals.length;
  $("#prevBtn").disabled = idx <= 0;
  $("#nextBtn").disabled = idx >= view.length - 1;
}

async function decide(p, value) {
  const prev = state.decisions[p.id];
  state.decisions[p.id] = value;
  p.decision = value;
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
    targets.forEach((p) => { state.decisions[p.id] = "chosen"; p.decision = "chosen"; });
    state.exportInfo = null;
    toast(targets.length + " proposition(s) acceptée(s).");
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

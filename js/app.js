import {
  initFirebaseServices,
  saveFirebaseConfig,
  clearFirebaseConfig,
  getSavedFirebaseConfig
} from "./firebase-config.js";
import { SUBJECTS, FlashcardRepository, generateId } from "./db.js";
import {
  HandwrittenEditor,
  PRESET_COLORS,
  renderStrokesToCanvas
} from "./canvas-editor.js";
import { StudySession } from "./study-mode.js";
import { computeAnalytics } from "./analytics.js";
import { soundFX } from "./sound-fx.js";

const SUBJECT_META = {
  Mathematics: { icon: "∑", subtitle: "Calculus, Algebra, Coordinate Geometry" },
  Chemistry: { icon: "⚗", subtitle: "Physical, Organic & Inorganic" },
  Physics: { icon: "⚛", subtitle: "Mechanics, Electrodynamics, Modern Physics" }
};

const state = {
  view: "dashboard", // dashboard | folder | analytics | setup
  activeFolderId: null,
  searchQuery: "",
  folders: [],
  cards: [],
  user: null,
  firebase: null,
  repo: new FlashcardRepository(),
  editor: null,
  editingCardId: null,
  study: null,
  dragCardId: null
};

const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("toastStack").appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function openModal(html, onBind) {
  $("modalContent").innerHTML = html;
  $("modalBackdrop").classList.remove("hidden");
  if (onBind) onBind($("modalContent"));
}

function closeModal() {
  $("modalBackdrop").classList.add("hidden");
  $("modalContent").innerHTML = "";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Theme Management
function updateSoundBtn() {
  const btn = $("soundToggleBtn");
  if (!btn) return;
  btn.innerHTML = soundFX.enabled
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
  btn.title = soundFX.enabled ? "Sound On (Creamy Keypress)" : "Sound Muted";
}

function initTheme() {
  let theme = "light";
  try {
    theme = localStorage.getItem("jee_recall_theme") || "light";
  } catch (_) {}
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("jee_recall_theme", theme);
  } catch (_) {}
  $("themeToggleBtn").innerHTML =
    theme === "dark"
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
}

function updateSyncBadge(status) {
  const pill = $("syncStatusPill");
  const txt = $("syncStatusText");
  pill.classList.remove("offline", "local", "syncing");
  if (!navigator.onLine) {
    pill.classList.add("offline");
    txt.textContent = "Offline (Cached)";
    return;
  }
  if (!state.repo.isCloudActive()) {
    pill.classList.add("local");
    txt.textContent = state.firebase?.ready ? "Sign in to Sync" : "Local Preview";
    return;
  }
  if (status === "syncing") {
    pill.classList.add("syncing");
    txt.textContent = "Syncing...";
  } else if (status === "offline") {
    pill.classList.add("offline");
    txt.textContent = "Sync Paused";
  } else {
    txt.textContent = "Cloud Synced";
  }
}

// Navigation
function setView(view, folderId = null) {
  state.view = view;
  if (folderId !== null) state.activeFolderId = folderId;

  document.querySelectorAll(".nav-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  $("dashboardView").classList.toggle("hidden", view !== "dashboard");
  $("folderView").classList.toggle("hidden", view !== "folder");
  $("analyticsView").classList.toggle("hidden", view !== "analytics");
  $("setupView").classList.toggle("hidden", view !== "setup");
  $("fabAddCard").classList.toggle("hidden", view !== "folder");

  if (view === "dashboard") renderDashboard();
  if (view === "folder") renderFolderView();
  if (view === "analytics") renderAnalytics();
  if (view === "setup") renderSetupView();
}

function getFolderCards(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  const raw = state.cards.filter((c) => c.folderId === folderId);
  if (!folder || !Array.isArray(folder.cardOrder) || folder.cardOrder.length === 0) {
    return raw.sort((a, b) => (a.position || 0) - (b.position || 0));
  }
  const orderMap = new Map(folder.cardOrder.map((id, i) => [id, i]));
  return raw.sort((a, b) => {
    const ia = orderMap.has(a.id) ? orderMap.get(a.id) : 999999;
    const ib = orderMap.has(b.id) ? orderMap.get(b.id) : 999999;
    return ia - ib || (a.position || 0) - (b.position || 0);
  });
}

// Dashboard Rendering
function renderDashboard() {
  const container = $("dashboardView");
  const q = state.searchQuery.trim().toLowerCase();

  container.innerHTML = SUBJECTS.map((subject) => {
    const meta = SUBJECT_META[subject];
    const folders = state.folders
      .filter((f) => f.subject === subject)
      .filter((f) => {
        if (!q) return true;
        return f.name.toLowerCase().includes(q) || subject.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.position || 0) - (b.position || 0));

    const foldersHtml = folders.length
      ? `<div class="folders-grid">
          ${folders
            .map((f, idx) => {
              const fCards = getFolderCards(f.id);
              const knewCount = fCards.filter((c) => c.difficulty === "knew").length;
              const pct = fCards.length ? Math.round((knewCount / fCards.length) * 100) : 0;
              return `
                <div class="folder-card" data-folder-id="${f.id}">
                  <div class="folder-click-area" data-action="open-folder" data-id="${f.id}">
                    <div class="folder-name">${escapeHtml(f.name)}</div>
                    <div class="folder-stats">
                      <span>${fCards.length} ${fCards.length === 1 ? "card" : "cards"}</span>
                      <span>&bull;</span>
                      <span>${pct}% mastered</span>
                    </div>
                  </div>
                  <div class="folder-actions">
                    <button type="button" class="icon-btn" data-action="move-folder-up" data-id="${f.id}" title="Move Up" ${idx === 0 ? "disabled" : ""} style="width:30px;height:30px;">&uarr;</button>
                    <button type="button" class="icon-btn" data-action="rename-folder" data-id="${f.id}" title="Rename Folder" style="width:30px;height:30px;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    </button>
                    <button type="button" class="icon-btn" data-action="delete-folder" data-id="${f.id}" title="Delete Folder" style="width:30px;height:30px;">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                    <button type="button" class="play-btn" data-action="play-folder" data-id="${f.id}" title="Study Folder" ${fCards.length === 0 ? "disabled" : ""}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>`
      : `<div class="folder-empty">No folders in ${subject} yet. Click <strong>+ Add Folder</strong> to organize your chapters.</div>`;

    return `
      <div class="subject-section" data-subject="${subject}">
        <div class="subject-header">
          <div class="subject-title-group">
            <div class="subject-badge">${meta.icon}</div>
            <div>
              <h2 class="subject-name">${subject}</h2>
              <div class="subject-meta">${meta.subtitle} &bull; ${folders.length} ${folders.length === 1 ? "folder" : "folders"}</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" data-action="add-folder" data-subject="${subject}">
            + Add Folder
          </button>
        </div>
        ${foldersHtml}
      </div>
    `;
  }).join("");
}

// Folder View Rendering
function renderFolderView() {
  const folder = state.folders.find((f) => f.id === state.activeFolderId);
  if (!folder) {
    setView("dashboard");
    return;
  }

  const cards = getFolderCards(folder.id);
  const knew = cards.filter((c) => c.difficulty === "knew").length;
  const difficult = cards.filter((c) => c.difficulty === "difficult").length;
  const forgotten = cards.filter((c) => c.difficulty === "forgotten").length;
  const pct = cards.length ? Math.round((knew / cards.length) * 100) : 0;

  const container = $("folderView");
  container.innerHTML = `
    <div class="folder-view-header">
      <div style="flex:1;min-width:240px;">
        <div class="breadcrumb">
          <button type="button" id="backToDashBtn">Dashboard</button>
          <span>/</span>
          <span>${escapeHtml(folder.subject)}</span>
        </div>
        <div class="folder-title-row">
          <h1 class="folder-view-title">${escapeHtml(folder.name)}</h1>
        </div>
        <div style="font-size:0.83rem;color:var(--text-secondary);margin-top:4px;">
          ${cards.length} ${cards.length === 1 ? "card" : "cards"} &bull; ${knew} Knew It &bull; ${difficult} Difficult &bull; ${forgotten} Didn't Know (${pct}% mastered)
        </div>
        <div class="progress-bar-track" style="max-width:420px;">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" id="folderRenameBtn" class="btn btn-secondary">Rename</button>
        <button type="button" id="folderStudyBtn" class="btn btn-primary" ${cards.length === 0 ? "disabled" : ""}>
          Study Folder
        </button>
      </div>
    </div>

    ${
      cards.length === 0
        ? `<div class="folder-empty" style="padding:48px 20px;">
            <p style="margin:0 0 12px;font-size:1rem;color:var(--text-primary);font-weight:600;">This folder is empty</p>
            <p style="margin:0 0 18px;">Tap the <strong>+</strong> button below to handwrite your first question &amp; answer flashcard.</p>
            <button type="button" id="emptyCreateCardBtn" class="btn btn-primary">+ Create Handwritten Card</button>
          </div>`
        : `<div class="cards-list" id="cardsListGrid">
            ${cards
              .map((c, idx) => {
                const diffLabel =
                  c.difficulty === "knew"
                    ? "Knew It"
                    : c.difficulty === "difficult"
                    ? "Difficult"
                    : c.difficulty === "forgotten"
                    ? "Didn't Know"
                    : "New";
                return `
                  <div class="flashcard-item" draggable="true" data-card-id="${c.id}">
                    <div class="card-preview-box" data-action="study-from-card" data-id="${c.id}" title="Click to study from card #${idx + 1}">
                      <canvas class="card-preview-canvas" id="preview_${c.id}"></canvas>
                      <span class="card-index-pill">#${idx + 1}</span>
                    </div>
                    <div class="card-item-footer">
                      <span class="diff-badge diff-${c.difficulty || "new"}">${diffLabel}</span>
                      <div class="card-item-actions">
                        <button type="button" class="icon-btn drag-handle" title="Drag to reorder" style="width:30px;height:30px;">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>
                        </button>
                        <button type="button" class="icon-btn" data-action="move-card-up" data-id="${c.id}" title="Move Up" ${idx === 0 ? "disabled" : ""} style="width:28px;height:28px;">&uarr;</button>
                        <button type="button" class="icon-btn" data-action="move-card-down" data-id="${c.id}" title="Move Down" ${idx === cards.length - 1 ? "disabled" : ""} style="width:28px;height:28px;">&darr;</button>
                        <button type="button" class="icon-btn" data-action="edit-card" data-id="${c.id}" title="Edit Card" style="width:30px;height:30px;">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        </button>
                        <button type="button" class="icon-btn" data-action="delete-card" data-id="${c.id}" title="Delete Card" style="width:30px;height:30px;">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>`
    }
  `;

  $("backToDashBtn").addEventListener("click", () => setView("dashboard"));
  $("folderRenameBtn").addEventListener("click", () => promptRenameFolder(folder.id));
  $("folderStudyBtn").addEventListener("click", () => startStudy(folder.id));
  if ($("emptyCreateCardBtn")) {
    $("emptyCreateCardBtn").addEventListener("click", () => openCardCreator(null));
  }

  requestAnimationFrame(() => {
    for (const c of cards) {
      const canvas = $(`preview_${c.id}`);
      if (canvas) renderStrokesToCanvas(canvas, c.questionStrokes || [], c.questionBg || "plain");
    }
  });
}

// Analytics View
function renderAnalytics() {
  const data = computeAnalytics(state.folders, state.cards);
  $("analyticsView").innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Total Folders</div><div class="kpi-value">${data.totalFolders}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Cards</div><div class="kpi-value">${data.totalCards}</div></div>
      <div class="kpi-card"><div class="kpi-label">Cards Studied</div><div class="kpi-value">${data.cardsStudied}</div></div>
      <div class="kpi-card"><div class="kpi-label">Knew It</div><div class="kpi-value" style="color:var(--status-knew);">${data.knewCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Difficult</div><div class="kpi-value" style="color:var(--status-difficult);">${data.difficultCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Didn't Know</div><div class="kpi-value" style="color:var(--status-forgotten);">${data.forgottenCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Study Sessions</div><div class="kpi-value">${data.totalSessions}</div></div>
    </div>

    <div class="analytics-panel">
      <h2 style="margin:0 0 14px;font-size:1.05rem;">Subject Progress</h2>
      <div style="display:flex;flex-direction:column;gap:14px;">
        ${data.bySubject
          .map(
            (s) => `
          <div>
            <div style="display:flex;justify-content:space-between;font-size:0.875rem;margin-bottom:4px;">
              <strong>${s.subject}</strong>
              <span style="color:var(--text-secondary);">${s.knew}/${s.cardsCount} mastered (${s.masteryPct}%) &bull; ${s.foldersCount} folders</span>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" style="width:${s.masteryPct}%"></div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    <div class="analytics-panel" style="overflow-x:auto;">
      <h2 style="margin:0 0 14px;font-size:1.05rem;">Folder Breakdown</h2>
      ${
        data.byFolder.length === 0
          ? `<p style="color:var(--text-muted);font-size:0.875rem;margin:0;">Create folders and study flashcards to see per-folder analytics.</p>`
          : `<table class="analytics-table">
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Subject</th>
                  <th>Cards</th>
                  <th>Knew It</th>
                  <th>Difficult</th>
                  <th>Didn't Know</th>
                  <th>Sessions</th>
                  <th>Mastery</th>
                </tr>
              </thead>
              <tbody>
                ${data.byFolder
                  .map(
                    (f) => `
                  <tr>
                    <td><strong>${escapeHtml(f.name)}</strong></td>
                    <td>${f.subject}</td>
                    <td>${f.cardsCount}</td>
                    <td style="color:var(--status-knew);font-weight:600;">${f.knew}</td>
                    <td style="color:var(--status-difficult);font-weight:600;">${f.difficult}</td>
                    <td style="color:var(--status-forgotten);font-weight:600;">${f.forgotten}</td>
                    <td>${f.sessions}</td>
                    <td>${f.masteryPct}%</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  `;
}

// Firebase Setup View
function renderSetupView() {
  const saved = getSavedFirebaseConfig();
  const sampleRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}`;

  $("setupView").innerHTML = `
    <div class="analytics-panel">
      <h2 style="margin:0 0 8px;font-size:1.2rem;">Firebase Configuration & Cloud Sync</h2>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin:0 0 16px;">
        Connect your own Firebase project (Authentication + Cloud Firestore) so all folders, handwritten strokes, ordering, and revision progress sync across your Android tablet and desktop. Never paste private service account credentials here—only your public Web App <code>firebaseConfig</code>.
      </p>

      <div class="form-field">
        <label class="form-label" for="fbConfigTextarea">Firebase Web App Config (JSON)</label>
        <textarea id="fbConfigTextarea" class="form-textarea" rows="8" placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}'>${
          saved ? JSON.stringify(saved, null, 2) : ""
        }</textarea>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px;">
        <button type="button" id="saveFbConfigBtn" class="btn btn-primary">Save & Connect Firebase</button>
        ${saved ? `<button type="button" id="clearFbConfigBtn" class="btn btn-danger">Disconnect Firebase</button>` : ""}
      </div>

      <h3 style="margin:0 0 8px;font-size:1rem;">Firestore Security Rules</h3>
      <p style="color:var(--text-secondary);font-size:0.84rem;margin:0 0 8px;">
        Paste these rules in Firebase Console &rarr; Firestore Database &rarr; Rules to isolate each user's data:
      </p>
      <pre style="background:var(--bg-app);border:1px solid var(--border-subtle);padding:14px;border-radius:10px;overflow-x:auto;font-size:0.8rem;font-family:'JetBrains Mono',monospace;">${escapeHtml(sampleRules)}</pre>
    </div>
  `;

  $("saveFbConfigBtn").addEventListener("click", async () => {
    try {
      const parsed = JSON.parse($("fbConfigTextarea").value.trim());
      if (!parsed.apiKey || !parsed.projectId) {
        showToast("Config must include apiKey and projectId.");
        return;
      }
      saveFirebaseConfig(parsed);
      showToast("Firebase config saved. Connecting...");
      await bootstrapFirebase();
      setView("setup");
    } catch (_) {
      showToast("Invalid JSON format. Please paste a valid firebaseConfig JSON object.");
    }
  });

  if ($("clearFbConfigBtn")) {
    $("clearFbConfigBtn").addEventListener("click", async () => {
      clearFirebaseConfig();
      state.repo.detachFirebase();
      state.user = null;
      state.firebase = null;
      updateSyncBadge("local");
      showToast("Disconnected from Firebase.");
      setView("setup");
    });
  }
}

// Folder CRUD
function promptCreateFolder(subject) {
  openModal(
    `
    <h3 class="modal-title">New ${subject} Folder</h3>
    <div class="form-field">
      <label class="form-label" for="folderNameInput">Chapter / Topic Name</label>
      <input type="text" id="folderNameInput" class="form-input" placeholder="e.g., Rotational Motion" autofocus />
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button type="button" class="btn btn-secondary" id="modalCancelBtn">Cancel</button>
      <button type="button" class="btn btn-primary" id="modalConfirmBtn">Create Folder</button>
    </div>
  `,
    (el) => {
      const input = el.querySelector("#folderNameInput");
      input.focus();
      const submit = async () => {
        const name = input.value.trim();
        if (!name) return showToast("Please enter a folder name.");
        const subjectFolders = state.folders.filter((f) => f.subject === subject);
        const folder = {
          id: generateId("fld"),
          subject,
          name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          position: subjectFolders.length,
          cardOrder: [],
          lastStudiedIndex: 0,
          studySessions: 0
        };
        state.folders.push(folder);
        closeModal();
        renderDashboard();
        try {
          await state.repo.saveFolder(folder);
          showToast(`Created "${name}"`);
        } catch (err) {
          showToast(`Saved locally; sync error: ${err.message}`);
        }
      };
      el.querySelector("#modalCancelBtn").addEventListener("click", closeModal);
      el.querySelector("#modalConfirmBtn").addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    }
  );
}

function promptRenameFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  openModal(
    `
    <h3 class="modal-title">Rename Folder</h3>
    <div class="form-field">
      <label class="form-label" for="renameFolderInput">Folder Name</label>
      <input type="text" id="renameFolderInput" class="form-input" value="${escapeHtml(folder.name)}" />
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button type="button" class="btn btn-secondary" id="modalCancelBtn">Cancel</button>
      <button type="button" class="btn btn-primary" id="modalConfirmBtn">Save</button>
    </div>
  `,
    (el) => {
      const input = el.querySelector("#renameFolderInput");
      input.focus();
      input.select();
      const submit = async () => {
        const name = input.value.trim();
        if (!name) return;
        folder.name = name;
        folder.updatedAt = Date.now();
        closeModal();
        if (state.view === "folder") renderFolderView();
        else renderDashboard();
        await state.repo.saveFolder(folder);
        showToast("Folder renamed");
      };
      el.querySelector("#modalCancelBtn").addEventListener("click", closeModal);
      el.querySelector("#modalConfirmBtn").addEventListener("click", submit);
    }
  );
}

function promptDeleteFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const fCards = state.cards.filter((c) => c.folderId === folderId);
  openModal(
    `
    <h3 class="modal-title">Delete "${escapeHtml(folder.name)}"?</h3>
    <p style="color:var(--text-secondary);font-size:0.9rem;margin:0 0 18px;">
      This will permanently delete this folder and all ${fCards.length} flashcards inside it.
    </p>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button type="button" class="btn btn-secondary" id="modalCancelBtn">Cancel</button>
      <button type="button" class="btn btn-danger" id="modalConfirmBtn">Delete Folder</button>
    </div>
  `,
    (el) => {
      el.querySelector("#modalCancelBtn").addEventListener("click", closeModal);
      el.querySelector("#modalConfirmBtn").addEventListener("click", async () => {
        state.folders = state.folders.filter((f) => f.id !== folderId);
        state.cards = state.cards.filter((c) => c.folderId !== folderId);
        closeModal();
        renderDashboard();
        await state.repo.deleteFolder(folder, fCards.map((c) => c.id));
        showToast("Folder deleted");
      });
    }
  );
}

async function moveFolderUp(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const list = state.folders
    .filter((f) => f.subject === folder.subject)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const idx = list.findIndex((f) => f.id === folderId);
  if (idx <= 0) return;
  [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
  list.forEach((f, i) => (f.position = i));
  renderDashboard();
  await Promise.all(list.map((f) => state.repo.saveFolder(f)));
}

// Card Creator & Draft Autosave
function getDraftKey() {
  return `jee_recall_draft_${state.activeFolderId}_${state.editingCardId || "new"}`;
}

function saveDraftToLocal() {
  if (!state.editor || !state.activeFolderId) return;
  try {
    const data = state.editor.exportData();
    localStorage.setItem(getDraftKey(), JSON.stringify(data));
    $("draftStatusLabel").textContent = "Draft autosaved";
  } catch (_) {}
}

function clearDraftLocal() {
  try {
    localStorage.removeItem(getDraftKey());
  } catch (_) {}
}

function openCardCreator(cardId = null) {
  state.editingCardId = cardId;
  const existing = cardId ? state.cards.find((c) => c.id === cardId) : null;

  let initialData = existing;
  if (!existing) {
    try {
      const rawDraft = localStorage.getItem(getDraftKey());
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed.questionStrokes?.length || parsed.answerStrokes?.length) {
          initialData = parsed;
          showToast("Restored unsaved draft");
        }
      }
    } catch (_) {}
  }

  $("creatorTitle").textContent = existing ? "Edit Flashcard" : "New Handwritten Flashcard";
  $("creatorOverlay").classList.remove("hidden");

  if (!state.editor) {
    state.editor = new HandwrittenEditor($("drawingCanvas"), () => {
      syncCreatorUI();
      saveDraftToLocal();
    });
  }
  state.editor.loadCard(initialData);
  syncCreatorUI();
}

function syncCreatorUI() {
  if (!state.editor) return;
  const isQ = state.editor.activeSide === "question";
  $("stepQuestionBtn").classList.toggle("active", isQ);
  $("stepAnswerBtn").classList.toggle("active", !isQ);
  $("creatorPrevBtn").disabled = isQ;
  $("creatorNextBtn").disabled = !isQ;
  $("paperBgSelect").value = state.editor.getSideState().bg;
  $("zoomResetBtn").textContent = `${Math.round(state.editor.zoom * 100)}%`;
  $("stylusOnlyBtn").classList.toggle("active", state.editor.stylusOnly);

  document.querySelectorAll(".tool-btn[data-tool]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === state.editor.tool);
  });
}

function requestCloseCreator() {
  if (state.editor && state.editor.dirty) {
    openModal(
      `
      <h3 class="modal-title">Discard Unsaved Changes?</h3>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin:0 0 18px;">
        You have unsaved handwritten strokes on this flashcard.
      </p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" id="modalCancelBtn">Keep Editing</button>
        <button type="button" class="btn btn-danger" id="modalConfirmBtn">Discard</button>
      </div>
    `,
      (el) => {
        el.querySelector("#modalCancelBtn").addEventListener("click", closeModal);
        el.querySelector("#modalConfirmBtn").addEventListener("click", () => {
          clearDraftLocal();
          closeModal();
          $("creatorOverlay").classList.add("hidden");
        });
      }
    );
  } else {
    $("creatorOverlay").classList.add("hidden");
  }
}

async function saveCreatorCard() {
  const folder = state.folders.find((f) => f.id === state.activeFolderId);
  if (!folder || !state.editor) return;

  const data = state.editor.exportData();
  if (data.questionStrokes.length === 0 && data.answerStrokes.length === 0) {
    showToast("Draw something on the Question or Answer canvas before saving.");
    return;
  }

  const now = Date.now();
  let card;
  if (state.editingCardId) {
    card = state.cards.find((c) => c.id === state.editingCardId);
    if (card) {
      card.questionStrokes = data.questionStrokes;
      card.answerStrokes = data.answerStrokes;
      card.questionBg = data.questionBg;
      card.answerBg = data.answerBg;
      card.updatedAt = now;
    }
  } else {
    const folderCards = getFolderCards(folder.id);
    card = {
      id: generateId("crd"),
      folderId: folder.id,
      subject: folder.subject,
      ...data,
      position: folderCards.length,
      difficulty: "new",
      lastReviewed: null,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now
    };
    state.cards.push(card);
    folder.cardOrder = [...(folder.cardOrder || []), card.id];
    folder.updatedAt = now;
  }

  clearDraftLocal();
  state.editor.dirty = false;
  $("creatorOverlay").classList.add("hidden");
  renderFolderView();

  try {
    await state.repo.saveCard(card);
    await state.repo.saveFolder(folder);
    soundFX.playSuccessChime();
    showToast("Flashcard saved");
  } catch (err) {
    showToast(`Saved locally; sync error: ${err.message}`);
  }
}

// Card Reordering & Deletion
async function reorderFolderCards(folderId, orderedIds) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  folder.cardOrder = orderedIds;
  folder.updatedAt = Date.now();
  orderedIds.forEach((id, idx) => {
    const c = state.cards.find((card) => card.id === id);
    if (c) c.position = idx;
  });
  renderFolderView();
  await state.repo.saveFolder(folder);
}

function promptDeleteCard(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  const folder = state.folders.find((f) => f.id === card?.folderId);
  if (!card || !folder) return;

  openModal(
    `
    <h3 class="modal-title">Delete Flashcard?</h3>
    <p style="color:var(--text-secondary);font-size:0.9rem;margin:0 0 18px;">
      This handwritten flashcard will be permanently removed from "${escapeHtml(folder.name)}".
    </p>
    <div style="display:flex;justify-content:flex-end;gap:8px;">
      <button type="button" class="btn btn-secondary" id="modalCancelBtn">Cancel</button>
      <button type="button" class="btn btn-danger" id="modalConfirmBtn">Delete</button>
    </div>
  `,
    (el) => {
      el.querySelector("#modalCancelBtn").addEventListener("click", closeModal);
      el.querySelector("#modalConfirmBtn").addEventListener("click", async () => {
        state.cards = state.cards.filter((c) => c.id !== cardId);
        folder.cardOrder = (folder.cardOrder || []).filter((id) => id !== cardId);
        closeModal();
        renderFolderView();
        await state.repo.deleteCard(card);
        await state.repo.saveFolder(folder);
        showToast("Flashcard deleted");
      });
    }
  );
}

// Study Mode
function startStudy(folderId, startCardId = null) {
  const folder = state.folders.find((f) => f.id === folderId);
  const cards = getFolderCards(folderId);
  if (!folder || cards.length === 0) {
    showToast("Add at least one flashcard to start studying.");
    return;
  }

  state.study = new StudySession({
    folder,
    cards,
    startCardId,
    onUpdateCard: (c) => state.repo.saveCard(c),
    onUpdateFolder: (f) => state.repo.saveFolder(f),
    onExit: () => {
      $("studyOverlay").classList.add("hidden");
      state.study = null;
      if (state.view === "folder") renderFolderView();
      else if (state.view === "dashboard") renderDashboard();
    }
  });

  $("studyFolderTitle").textContent = `${folder.subject} · ${folder.name}`;
  $("studyOverlay").classList.remove("hidden");
  renderStudyFrame();
}

function renderStudyFrame() {
  const s = state.study;
  if (!s) return;
  const total = s.deck.length;
  const currentNum = s.index + 1;
  $("studyCounter").textContent = `${currentNum} / ${total}`;
  $("studyProgressBar").style.width = `${Math.round((currentNum / total) * 100)}%`;
  $("studyRandomBtn").textContent = `Shuffle: ${s.randomized ? "On" : "Off"}`;
  $("studyRandomBtn").classList.toggle("btn-primary", s.randomized);
  $("studyRandomBtn").classList.toggle("btn-secondary", !s.randomized);

  $("studyPrevBtn").disabled = s.index === 0;
  $("studyNextBtn").disabled = s.index === total - 1;

  $("studyAnswerWrap").classList.toggle("hidden", !s.revealed);
  $("studyRevealWrap").classList.toggle("hidden", s.revealed);
  $("studyFeedbackWrap").classList.toggle("hidden", !s.revealed);

  requestAnimationFrame(() => {
    s.renderCanvases($("studyQuestionCanvas"), $("studyAnswerCanvas"));
  });
}

// Auth Modal
function formatAuthError(err) {
  const code = err?.code || "";
  if (code === "auth/operation-not-allowed") {
    return "This sign-in method isn't enabled yet. In Firebase Console → Authentication → Sign-in method, enable Email/Password (or Google).";
  }
  if (code === "auth/unauthorized-domain") {
    const host = window.location.hostname || "this preview domain";
    return `Domain "${host}" is not authorized for Google Sign-In. Use Email/Password below, or add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`;
  }
  if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment" || code === "auth/cancelled-popup-request") {
    return "Popup sign-in is blocked in this embedded preview. Use Email/Password sign-in above, or open the deployed Firebase Hosting URL.";
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Invalid email or password. If you haven't registered yet, click 'Create Account'.";
  }
  if (code === "auth/email-already-in-use") {
    return "An account with this email already exists. Click 'Sign In' instead.";
  }
  if (code === "auth/weak-password") {
    return "Password must be at least 6 characters long.";
  }
  if (code === "auth/invalid-email") {
    return "Please enter a valid email address.";
  }
  return err?.message || "Authentication failed. Please check your Firebase settings.";
}

function openAccountModal() {
  if (!state.firebase?.ready) {
    const errDetail = state.firebase?.error ? `<div style="margin-bottom:12px;padding:10px;border-radius:8px;background:var(--status-forgotten-bg);color:var(--status-forgotten);font-size:0.82rem;">${escapeHtml(state.firebase.error)}</div>` : "";
    openModal(
      `
      <h3 class="modal-title">Cloud Account</h3>
      ${errDetail}
      <p style="color:var(--text-secondary);font-size:0.9rem;margin:0 0 16px;">
        You are currently in <strong>Local Preview Mode</strong>. To sign in and sync flashcards to Cloud Firestore, check your Firebase project in the <strong>Firebase Setup</strong> tab.
      </p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" id="modalCloseBtn">Close</button>
        <button type="button" class="btn btn-primary" id="goSetupBtn">Open Firebase Setup</button>
      </div>
    `,
      (el) => {
        el.querySelector("#modalCloseBtn").addEventListener("click", closeModal);
        el.querySelector("#goSetupBtn").addEventListener("click", () => {
          closeModal();
          setView("setup");
        });
      }
    );
    return;
  }

  if (state.user) {
    openModal(
      `
      <h3 class="modal-title">Signed In</h3>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin:0 0 16px;">
        Account: <strong>${escapeHtml(state.user.email || state.user.uid)}</strong>
      </p>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" id="modalCloseBtn">Close</button>
        <button type="button" class="btn btn-danger" id="signOutBtn">Sign Out</button>
      </div>
    `,
      (el) => {
        el.querySelector("#modalCloseBtn").addEventListener("click", closeModal);
        el.querySelector("#signOutBtn").addEventListener("click", async () => {
          await state.firebase.authApi.signOut(state.firebase.auth);
          closeModal();
          showToast("Signed out");
        });
      }
    );
    return;
  }

  openModal(
    `
    <h3 class="modal-title">Sign In to JEE Recall</h3>
    <div id="authErrorBox" class="hidden" style="margin-bottom:12px;padding:10px 12px;border-radius:10px;background:var(--status-forgotten-bg);color:var(--status-forgotten);font-size:0.82rem;line-height:1.45;"></div>
    <div class="form-field">
      <label class="form-label" for="authEmail">Email</label>
      <input type="email" id="authEmail" class="form-input" placeholder="you@example.com" autocomplete="email" />
    </div>
    <div class="form-field">
      <label class="form-label" for="authPass">Password</label>
      <input type="password" id="authPass" class="form-input" placeholder="At least 6 characters" autocomplete="current-password" />
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button type="button" class="btn btn-primary" id="emailSignInBtn">Sign In</button>
      <button type="button" class="btn btn-secondary" id="emailSignUpBtn">Create Account</button>
      <button type="button" class="btn btn-secondary" id="googleSignInBtn">Continue with Google</button>
      <button type="button" class="btn btn-secondary" id="authCancelBtn" style="margin-top:4px;">Cancel</button>
    </div>
  `,
    (el) => {
      const { auth, authApi } = state.firebase;
      const errBox = el.querySelector("#authErrorBox");
      const emailInput = el.querySelector("#authEmail");
      const passInput = el.querySelector("#authPass");
      const buttons = [
        el.querySelector("#emailSignInBtn"),
        el.querySelector("#emailSignUpBtn"),
        el.querySelector("#googleSignInBtn")
      ];

      const setBusy = (busy) => buttons.forEach((b) => (b.disabled = busy));
      const showAuthErr = (err) => {
        errBox.textContent = typeof err === "string" ? err : formatAuthError(err);
        errBox.classList.remove("hidden");
      };

      const withTimeout = (promise, ms = 15000) =>
        Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Request timed out. Check your internet connection and verify Email/Password is enabled in Firebase Console.")), ms)
          )
        ]);

      el.querySelector("#emailSignInBtn").addEventListener("click", async () => {
        errBox.classList.add("hidden");
        const email = emailInput.value.trim();
        const pass = passInput.value;
        if (!email || !pass) return showAuthErr("Please enter both email and password.");
        setBusy(true);
        const btn = el.querySelector("#emailSignInBtn");
        btn.textContent = "Signing in...";
        try {
          await withTimeout(authApi.signInWithEmailAndPassword(auth, email, pass));
          closeModal();
          showToast("Signed in & syncing");
        } catch (err) {
          showAuthErr(err);
        } finally {
          btn.textContent = "Sign In";
          setBusy(false);
        }
      });

      el.querySelector("#emailSignUpBtn").addEventListener("click", async () => {
        errBox.classList.add("hidden");
        const email = emailInput.value.trim();
        const pass = passInput.value;
        if (!email || pass.length < 6) return showAuthErr("Enter a valid email and a password of at least 6 characters.");
        setBusy(true);
        const btn = el.querySelector("#emailSignUpBtn");
        btn.textContent = "Creating account...";
        try {
          await withTimeout(authApi.createUserWithEmailAndPassword(auth, email, pass));
          closeModal();
          showToast("Account created & syncing");
        } catch (err) {
          showAuthErr(err);
        } finally {
          btn.textContent = "Create Account";
          setBusy(false);
        }
      });

      el.querySelector("#authCancelBtn").addEventListener("click", closeModal);

      el.querySelector("#googleSignInBtn").addEventListener("click", async () => {
        errBox.classList.add("hidden");
        if (window.location.hostname === "appassets.androidplatform.net") {
          showAuthErr("Google Sign-In is blocked inside Android WebView. Use Email & Password above (click Create Account first) or open the hosted app in Chrome.");
          return;
        }
        setBusy(true);
        try {
          const provider = new authApi.GoogleAuthProvider();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject({ code: "auth/popup-blocked" }), 12000)
          );
          await Promise.race([authApi.signInWithPopup(auth, provider), timeoutPromise]);
          closeModal();
          showToast("Signed in with Google");
        } catch (err) {
          showAuthErr(err);
        } finally {
          setBusy(false);
        }
      });
    }
  );
}

// Backup Export / Import
function openBackupModal() {
  openModal(
    `
    <h3 class="modal-title">Backup &amp; Restore</h3>
    <p style="color:var(--text-secondary);font-size:0.88rem;margin:0 0 16px;">
      Export all subjects, folders, handwritten stroke data, and revision progress as a JSON file, or restore from a previous backup.
    </p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button type="button" class="btn btn-primary" id="exportJsonBtn">Export Full Backup (.json)</button>
      <button type="button" class="btn btn-secondary" id="importJsonBtn">Import Backup (.json)</button>
      <button type="button" class="btn btn-secondary" id="modalCloseBtn">Close</button>
    </div>
  `,
    (el) => {
      el.querySelector("#modalCloseBtn").addEventListener("click", closeModal);
      el.querySelector("#exportJsonBtn").addEventListener("click", () => {
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          folders: state.folders,
          cards: state.cards
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `jee-recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Backup exported");
      });
      el.querySelector("#importJsonBtn").addEventListener("click", () => {
        closeModal();
        $("importFileInput").click();
      });
    }
  );
}

async function bootstrapFirebase() {
  setView("dashboard");
  // Load local cache & update dashboard without blocking initial paint
  const localData = await state.repo.loadAllData();
  state.folders = localData.folders;
  state.cards = localData.cards;
  setView("dashboard");

  state.firebase = await initFirebaseServices();
  if (state.firebase.ready) {
    try {
      await state.firebase.authApi.getRedirectResult(state.firebase.auth);
    } catch (redirErr) {
      showToast(formatAuthError(redirErr));
    }
    state.firebase.authApi.onAuthStateChanged(state.firebase.auth, async (user) => {
      state.user = user;
      if (user) {
        $("accountBtn").textContent = user.email ? user.email.split("@")[0] : "Account";
        await state.repo.attachFirebase(state.firebase.db, user.uid);
        const data = await state.repo.loadAllData();
        state.folders = data.folders;
        state.cards = data.cards;
        updateSyncBadge(data.error ? "offline" : "synced");
        if (data.error) showToast("Firestore permissions/network issue: " + data.error);
      } else {
        $("accountBtn").textContent = "Sign In";
        state.repo.detachFirebase();
        updateSyncBadge("local");
      }
      setView(state.view, state.activeFolderId);
    });
  } else {
    updateSyncBadge("local");
  }
}

function bindGlobalEvents() {
  state.repo.onSyncChange = (status) => updateSyncBadge(status);
  window.addEventListener("online", () => updateSyncBadge("synced"));
  window.addEventListener("offline", () => updateSyncBadge("offline"));

  updateSoundBtn();
  $("soundToggleBtn").addEventListener("click", () => {
    soundFX.toggle();
    updateSoundBtn();
  });

  // Aesthetic creamy/thocky sound on key presses & button taps
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "Space" && state.study && !$("studyOverlay").classList.contains("hidden") && !state.study.revealed) {
      return; // handled by reveal chime
    }
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    soundFX.playCreamyTap();
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;
    if (btn.id === "soundToggleBtn" || btn.id === "studyRevealBtn" || btn.classList.contains("fb-btn")) return;
    soundFX.playSoftClick();
  });

  $("brandHomeBtn").addEventListener("click", () => setView("dashboard"));
  $("themeToggleBtn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
  $("syncStatusPill").addEventListener("click", () => setView("setup"));
  $("accountBtn").addEventListener("click", openAccountModal);
  $("backupBtn").addEventListener("click", openBackupModal);

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  $("globalSearchInput").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    $("searchClearBtn").classList.toggle("hidden", !state.searchQuery);
    if (state.view !== "dashboard") setView("dashboard");
    else renderDashboard();
  });

  $("searchClearBtn").addEventListener("click", () => {
    state.searchQuery = "";
    $("globalSearchInput").value = "";
    $("searchClearBtn").classList.add("hidden");
    renderDashboard();
  });

  // Dashboard delegation
  $("dashboardView").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id, subject } = btn.dataset;
    if (action === "add-folder") promptCreateFolder(subject);
    if (action === "open-folder") setView("folder", id);
    if (action === "play-folder") startStudy(id);
    if (action === "rename-folder") promptRenameFolder(id);
    if (action === "delete-folder") promptDeleteFolder(id);
    if (action === "move-folder-up") moveFolderUp(id);
  });

  // Folder view delegation & drag-and-drop
  $("folderView").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "study-from-card") startStudy(state.activeFolderId, id);
    if (action === "edit-card") openCardCreator(id);
    if (action === "delete-card") promptDeleteCard(id);
    if (action === "move-card-up" || action === "move-card-down") {
      const cards = getFolderCards(state.activeFolderId);
      const ids = cards.map((c) => c.id);
      const idx = ids.indexOf(id);
      const target = action === "move-card-up" ? idx - 1 : idx + 1;
      if (target >= 0 && target < ids.length) {
        [ids[idx], ids[target]] = [ids[target], ids[idx]];
        await reorderFolderCards(state.activeFolderId, ids);
      }
    }
  });

  $("folderView").addEventListener("dragstart", (e) => {
    const item = e.target.closest(".flashcard-item");
    if (!item) return;
    state.dragCardId = item.dataset.cardId;
    item.classList.add("dragging");
  });

  $("folderView").addEventListener("dragend", (e) => {
    const item = e.target.closest(".flashcard-item");
    if (item) item.classList.remove("dragging");
    document.querySelectorAll(".flashcard-item.drag-over").forEach((el) => el.classList.remove("drag-over"));
  });

  $("folderView").addEventListener("dragover", (e) => {
    const item = e.target.closest(".flashcard-item");
    if (!item || item.dataset.cardId === state.dragCardId) return;
    e.preventDefault();
    item.classList.add("drag-over");
  });

  $("folderView").addEventListener("dragleave", (e) => {
    const item = e.target.closest(".flashcard-item");
    if (item) item.classList.remove("drag-over");
  });

  $("folderView").addEventListener("drop", async (e) => {
    const targetItem = e.target.closest(".flashcard-item");
    if (!targetItem || !state.dragCardId) return;
    e.preventDefault();
    const targetId = targetItem.dataset.cardId;
    if (targetId === state.dragCardId) return;

    const cards = getFolderCards(state.activeFolderId);
    const ids = cards.map((c) => c.id);
    const fromIdx = ids.indexOf(state.dragCardId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    state.dragCardId = null;
    await reorderFolderCards(state.activeFolderId, ids);
  });

  $("fabAddCard").addEventListener("click", () => openCardCreator(null));

  // Creator Controls
  const palette = $("colorPaletteGroup");
  PRESET_COLORS.forEach((hex, i) => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = `color-swatch ${i === 0 ? "active" : ""}`;
    sw.style.backgroundColor = hex;
    sw.dataset.color = hex;
    sw.title = hex;
    sw.addEventListener("click", () => {
      if (!state.editor) return;
      state.editor.color = hex;
      if (state.editor.tool === "eraser") state.editor.tool = "pen";
      $("customColorInput").value = hex;
      palette.querySelectorAll(".color-swatch").forEach((s) => s.classList.toggle("active", s === sw));
      syncCreatorUI();
    });
    palette.insertBefore(sw, $("customColorInput"));
  });

  $("customColorInput").addEventListener("input", (e) => {
    if (!state.editor) return;
    state.editor.color = e.target.value;
    if (state.editor.tool === "eraser") state.editor.tool = "pen";
    palette.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
    syncCreatorUI();
  });

  document.querySelectorAll(".tool-btn[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.editor) return;
      state.editor.tool = btn.dataset.tool;
      syncCreatorUI();
    });
  });

  $("brushSizeInput").addEventListener("input", (e) => {
    if (!state.editor) return;
    state.editor.brushSize = Number(e.target.value);
    $("brushSizeVal").textContent = e.target.value;
  });

  $("undoBtn").addEventListener("click", () => state.editor?.undo());
  $("redoBtn").addEventListener("click", () => state.editor?.redo());
  $("clearCanvasBtn").addEventListener("click", () => state.editor?.clearCurrent());
  $("zoomOutBtn").addEventListener("click", () => state.editor?.setZoom(state.editor.zoom - 0.2));
  $("zoomInBtn").addEventListener("click", () => state.editor?.setZoom(state.editor.zoom + 0.2));
  $("zoomResetBtn").addEventListener("click", () => state.editor?.setZoom(1));
  $("paperBgSelect").addEventListener("change", (e) => state.editor?.setPaperBg(e.target.value));
  $("stylusOnlyBtn").addEventListener("click", () => {
    if (!state.editor) return;
    state.editor.stylusOnly = !state.editor.stylusOnly;
    syncCreatorUI();
    showToast(state.editor.stylusOnly ? "Palm rejection: Stylus Only" : "Touch, Stylus & Mouse enabled");
  });

  $("stepQuestionBtn").addEventListener("click", () => {
    state.editor?.setSide("question");
    syncCreatorUI();
  });
  $("stepAnswerBtn").addEventListener("click", () => {
    state.editor?.setSide("answer");
    syncCreatorUI();
  });
  $("creatorPrevBtn").addEventListener("click", () => {
    state.editor?.setSide("question");
    syncCreatorUI();
  });
  $("creatorNextBtn").addEventListener("click", () => {
    state.editor?.setSide("answer");
    syncCreatorUI();
  });
  $("creatorSaveBtn").addEventListener("click", saveCreatorCard);
  $("creatorCloseBtn").addEventListener("click", requestCloseCreator);

  // Study Mode Controls
  $("studyExitBtn").addEventListener("click", () => state.study?.onExit());
  $("studyRandomBtn").addEventListener("click", () => {
    state.study?.toggleRandomizer();
    renderStudyFrame();
  });
  $("studyRevealBtn").addEventListener("click", () => {
    soundFX.playRevealChime();
    state.study?.reveal();
    renderStudyFrame();
  });
  $("studyPrevBtn").addEventListener("click", () => {
    if (state.study?.prev()) renderStudyFrame();
  });
  $("studyNextBtn").addEventListener("click", () => {
    if (state.study?.next()) renderStudyFrame();
  });
  document.querySelectorAll(".fb-btn[data-rate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.study) return;
      if (btn.dataset.rate === "knew") soundFX.playSuccessChime();
      else soundFX.playSoftClick();
      await state.study.rateCard(btn.dataset.rate);
      renderStudyFrame();
    });
  });

  // Keyboard shortcuts for Study Mode
  document.addEventListener("keydown", (e) => {
    if (!state.study || $("studyOverlay").classList.contains("hidden")) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!state.study.revealed) {
        soundFX.playRevealChime();
        state.study.reveal();
        renderStudyFrame();
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (state.study.prev()) renderStudyFrame();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (state.study.next()) renderStudyFrame();
    } else if (e.key === "Escape") {
      e.preventDefault();
      state.study.onExit();
    }
  });

  // Import JSON backup
  $("importFileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.folders) || !Array.isArray(data.cards)) {
        throw new Error("Invalid backup structure");
      }
      state.folders = data.folders;
      state.cards = data.cards;
      await state.repo.replaceAllFromBackup(state.folders, state.cards);
      setView("dashboard");
      showToast(`Imported ${data.folders.length} folders and ${data.cards.length} cards`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  });

  window.addEventListener("resize", () => {
    if (!$("creatorOverlay").classList.contains("hidden")) state.editor?.resizeAndRender();
    if (!$("studyOverlay").classList.contains("hidden")) renderStudyFrame();
  });

  $("modalBackdrop").addEventListener("click", (e) => {
    if (e.target === $("modalBackdrop")) closeModal();
  });
}

initTheme();
bindGlobalEvents();
bootstrapFirebase();

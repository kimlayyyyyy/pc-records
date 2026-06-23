/* ============================================================
   CONFIG — PC folder → table label mapping
   PC01–PC15 are the Samba share / Docker volume names.
   id    = folder name under /videos/  (must match docker-compose volumes)
   name  = display name shown in the UI dropdown
   label = short table code shown as a badge
   ============================================================ */
const STATIONS = [
  { id: "PC01", name: "Baccarat 01", label: "BAC01", folder: "videos/PC01" },
  { id: "PC02", name: "Baccarat 02", label: "BAC02", folder: "videos/PC02" },
  { id: "PC03", name: "Baccarat 03", label: "BAC03", folder: "videos/PC03" },
  { id: "PC04", name: "Baccarat 05", label: "BAC05", folder: "videos/PC04" },
  { id: "PC05", name: "Baccarat 06", label: "BAC06", folder: "videos/PC05" },
  { id: "PC06", name: "Baccarat 07", label: "BAC07", folder: "videos/PC06" },
  { id: "PC07", name: "Baccarat 08", label: "BAC08", folder: "videos/PC07" },
  { id: "PC08", name: "Baccarat 09", label: "BAC09", folder: "videos/PC08" },
  { id: "PC09", name: "Dragon Tiger 01", label: "DT01",  folder: "videos/PC09" },
  { id: "PC10", name: "Mahjong 01",    label: "MJ01",  folder: "videos/PC10" },
  { id: "PC11", name: "NIU NIU 01",   label: "NN01",  folder: "videos/PC11" },
  { id: "PC12", name: "SD01",     label: "SD01",  folder: "videos/PC12" },
  { id: "PC13", name: "SB01",   label: "SB01",  folder: "videos/PC13" },
  { id: "PC14", name: "3K01",    label: "3K01",  folder: "videos/PC14" },
  { id: "PC15", name: "Roulette 01",   label: "RL01",  folder: "videos/PC15" },
];

const VIDEO_EXT = [".mp4", ".webm", ".mkv", ".mov", ".avi"];

const stationSelect   = document.getElementById("station-select");
const stationCount    = document.getElementById("station-count");
const pageSizeSelect  = document.getElementById("page-size-select");
const dateSelect      = document.getElementById("date-select");
const searchInput     = document.getElementById("search-input");
const tableBody       = document.getElementById("table-body");
const overlay         = document.getElementById("playerOverlay");
const playerVideo     = document.getElementById("playerVideo");
const playerTitle     = document.getElementById("playerTitle");
const closeBtn        = document.getElementById("closePlayer");
const prevPageBtn     = document.getElementById("prev-page");
const nextPageBtn     = document.getElementById("next-page");
const pagerInfo       = document.getElementById("pager-info");

let fileCache     = {};
let fileMtimes    = {};
let fileSizes     = {};   // folder -> { filename: bytes }
let fileDurations = {};   // folder -> { filename: seconds }
let currentStation = STATIONS[0];
let allFiles      = [];
let filteredFiles  = [];
let currentPage   = 1;
let pageSize      = 20;
let currentUserRole = 'viewer'; // updated after session check

/* ── Clock ── */
function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString();
}
tickClock();
setInterval(tickClock, 1000);

/* ── Date extraction ── */
function extractDate(filename) {
  const m = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* ── Format badge ── */
function fmtBadge(href) {
  const ext = VIDEO_EXT.find(e => href.toLowerCase().endsWith(e));
  if (!ext) return '';
  const name = ext.slice(1).toLowerCase();
  return `<span class="fmt-badge fmt-${name}">${name.toUpperCase()}</span>`;
}

/* ── Play icon SVG ── */
const playIcon = `<svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M5 3.5l8 4.5-8 4.5V3.5z"/></svg>`;

/* ── Fetch directory listing via API ── */
async function listFolder(folder) {
  if (fileCache[folder] !== undefined) return fileCache[folder];
  try {
    const station = folder.split("/").pop();
    const res = await fetch(`/api/list/${station}`);
    if (!res.ok) {
      console.error(`[listFolder] HTTP ${res.status} for ${station}`);
      fileCache[folder] = null;
      return null;
    }
    const data = await res.json();

    if (data.error) console.error(`[listFolder] Server error for ${station}:`, data.error);

    fileMtimes[folder]    = {};
    fileSizes[folder]     = {};
    fileDurations[folder] = {};
    const links = [];

    (data.files || []).forEach(entry => {
      links.push(entry.name);
      if (entry.mtime) {
        const t = new Date(entry.mtime).getTime();
        if (!isNaN(t)) fileMtimes[folder][entry.name] = t;
      }
      if (entry.size)     fileSizes[folder][entry.name]     = entry.size;
      if (entry.duration) fileDurations[folder][entry.name] = entry.duration;
    });

    console.log(`[listFolder] ${station}: ${links.length} video(s) found`);
    fileCache[folder] = links;
    return links;
  } catch (e) {
    console.error(`[listFolder] fetch failed for ${folder}:`, e.message);
    fileCache[folder] = null;
    return null;
  }
}

/* ── Station dropdown ── */
function populateStationSelect() {
  STATIONS.forEach((station, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `${station.label} — ${station.name}`;
    stationSelect.appendChild(opt);
  });
  stationSelect.addEventListener("change", () => {
    currentPage = 1;
    selectStation(parseInt(stationSelect.value, 10));
  });
}

pageSizeSelect.addEventListener("change", () => {
  pageSize = pageSizeSelect.value === "all" ? "all" : parseInt(pageSizeSelect.value, 10);
  currentPage = 1;
  renderTable();
});

dateSelect.addEventListener("change", () => { currentPage = 1; applyFilters(); });

let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { currentPage = 1; applyFilters(); }, 150);
});

/* ── Select station ── */
async function selectStation(idx) {
  currentStation = STATIONS[idx];
  document.title = `${currentStation.label} — PC Records`;
  document.getElementById('table-badge').textContent = currentStation.label;
  searchInput.value = "";
  const colspan = (window.__userRole === 'admin') ? 7 : 6;
  tableBody.innerHTML = `
    <tr class="empty-row">
      <td colspan="${colspan}">
        <div class="empty-state">
          <div class="empty-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
          </div>
          <span class="empty-title">Loading recordings…</span>
        </div>
      </td>
    </tr>`;
  stationCount.style.display = "none";

  const files = await listFolder(currentStation.folder);

  if (files === null) {
    allFiles = []; filteredFiles = [];
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="${colspan}">
          <div class="empty-state">
            <div class="empty-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            </div>
            <span class="empty-title">Directory listing unavailable</span>
            <span class="empty-sub">Check that the volume is mounted for ${currentStation.label} (${currentStation.folder}/)</span>
          </div>
        </td>
      </tr>`;
    updatePager(0);
    populateDateSelect([]);
    return;
  }

  allFiles = files.slice().sort().reverse();
  populateDateSelect(allFiles);
  applyFilters();
}

/* ── Date dropdown ── */
function populateDateSelect(files) {
  const dates = new Set();
  files.forEach(f => { const d = extractDate(decodeURIComponent(f)); if (d) dates.add(d); });
  const sorted = [...dates].sort().reverse();
  dateSelect.innerHTML = '<option value="">All dates</option>';
  sorted.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    dateSelect.appendChild(opt);
  });
}

/* ── Filters ── */
function applyFilters() {
  const dateFilter = dateSelect.value;
  const query = searchInput.value.trim().toLowerCase();
  filteredFiles = allFiles.filter(f => {
    const decoded = decodeURIComponent(f);
    if (dateFilter && extractDate(decoded) !== dateFilter) return false;
    if (query && !decoded.toLowerCase().includes(query)) return false;
    return true;
  });
  renderTable();
}

/* ── Render ── */
function renderTable() {
  currentUserRole = window.__userRole || 'viewer';
  const isAdmin = currentUserRole === 'admin';
  const colspan = isAdmin ? 7 : 6;

  if (filteredFiles.length === 0) {
    const reason = allFiles.length === 0 ? "No recordings yet" : "No recordings match your filters";
    tableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="${colspan}">
          <div class="empty-state">
            <div class="empty-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3l-4 4-4-4"/></svg>
            </div>
            <span class="empty-title">${reason}</span>
          </div>
        </td>
      </tr>`;
    stationCount.textContent = `0 files`;
    stationCount.style.display = "";
    updatePager(0);
    return;
  }

  const total = filteredFiles.length;
  const size = pageSize === "all" ? total : pageSize;
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = pageSize === "all" ? 0 : (currentPage - 1) * size;
  const pageFiles = filteredFiles.slice(start, start + size);

  // Compute station total used size
  const sizeMap     = fileSizes[currentStation.folder]     || {};
  const durMap      = fileDurations[currentStation.folder] || {};
  const stationTotalBytes = allFiles.reduce((sum, f) => sum + (sizeMap[f] || 0), 0);

  tableBody.innerHTML = "";
  pageFiles.forEach(f => {
    const decoded = decodeURIComponent(f);
    const isAdmin = currentUserRole === 'admin';
    const fileBytes = sizeMap[f] || 0;
    const fileDur   = durMap[f]  || 0;
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td class="col-name">${decoded}</td>
      <td class="col-size">${fmtBadge(f)}</td>
      <td class="col-filesize">${fileBytes ? `<span class="size-badge">${formatBytes(fileBytes)}</span>` : '—'}</td>
      <td class="col-duration" data-file="${f}" data-station="${currentStation.id}"><span class="duration-badge">${fileDur ? formatDuration(fileDur) : '<span class="dur-loading">…</span>'}</span></td>
      <td class="col-time">${extractDate(decoded) || "—"}</td>
      <td class="col-play"><div class="col-play-icon">${playIcon}</div></td>
      ${isAdmin ? `<td class="col-del"><button class="del-btn" title="Delete file" aria-label="Delete ${decoded}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="2 4 14 4"/><path d="M5 4V2h6v2"/><path d="M6 7v5M10 7v5"/><rect x="3" y="4" width="10" height="10" rx="1"/></svg>
      </button></td>` : ''}
    `;
    const open = () => openPlayer(`/${currentStation.folder}/${encodeURIComponent(f)}`, decoded, currentStation.folder, f);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", e => { if (e.key === "Enter") open(); });

    if (isAdmin) {
      tr.querySelector('.del-btn').addEventListener('click', e => {
        e.stopPropagation();
        openDeleteConfirm(currentStation.id, f, decoded);
      });
    }

    tableBody.appendChild(tr);
  });

  const label = total === allFiles.length
    ? `${total} file${total === 1 ? "" : "s"}`
    : `${total} of ${allFiles.length}`;
  const sizeLabel = stationTotalBytes ? ` · ${formatBytes(stationTotalBytes)}` : '';
  stationCount.textContent = label + sizeLabel;
  stationCount.style.display = "";
  updatePager(totalPages);

  // Lazily fetch durations for visible rows that don't have one yet
  fetchVisibleDurations();
}

/* ── Lazy duration loader ── */
async function fetchVisibleDurations() {
  const cells = tableBody.querySelectorAll('td.col-duration .dur-loading');
  if (!cells.length) return;
  const folder = currentStation.folder;
  if (!fileDurations[folder]) fileDurations[folder] = {};

  for (const loadingEl of cells) {
    const td = loadingEl.closest('td.col-duration');
    if (!td) continue;
    const file    = td.dataset.file;
    const station = td.dataset.station;
    try {
      const res = await fetch(`/api/duration/${station}/${encodeURIComponent(file.split('/').pop() || file)}`);
      if (!res.ok) { loadingEl.textContent = '—'; continue; }
      const { duration } = await res.json();
      fileDurations[folder][file] = duration;
      td.querySelector('.duration-badge').innerHTML = duration ? formatDuration(duration) : '—';
    } catch {
      loadingEl.textContent = '—';
    }
  }
}

/* ── Pager ── */
function updatePager(totalPages) {
  pagerInfo.textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

prevPageBtn.addEventListener("click", () => { if (currentPage > 1) { currentPage--; renderTable(); } });
nextPageBtn.addEventListener("click", () => { currentPage++; renderTable(); });

/* ── Player ── */
const RECENT_THRESHOLD_MS = 2 * 60 * 1000; // consider "still recording" if modified within 2 min

function openPlayer(src, title, folder, href) {
  const mtime = folder && href ? (fileMtimes[folder] || {})[href] : null;
  if (mtime && (Date.now() - mtime) < RECENT_THRESHOLD_MS) {
    const proceed = confirm(
      `⚠ "${title}" was modified very recently and may still be recording.\n\n` +
      `Playing it now may show an incomplete or corrupted video.\n\n` +
      `Open anyway?`
    );
    if (!proceed) return;
  }
  playerVideo.src = src;
  playerTitle.textContent = `${currentStation.label}: ${title}`;
  overlay.classList.add("active");
  playerVideo.play().catch(() => {});
}

function closePlayer() {
  overlay.classList.remove("active");
  playerVideo.pause();
  playerVideo.removeAttribute("src");
  playerVideo.load();
}

closeBtn.addEventListener("click", closePlayer);
overlay.addEventListener("click", e => { if (e.target === overlay) closePlayer(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && overlay.classList.contains("active")) closePlayer();
});

/* ── File delete (admin only) ── */
let pendingDelete = null;

function openDeleteConfirm(stationId, href, filename) {
  pendingDelete = { stationId, href, filename };
  document.getElementById('delFileName').textContent = filename;
  document.getElementById('deleteFileModal').classList.add('active');
}

document.getElementById('cancelDeleteFile').addEventListener('click', () => {
  document.getElementById('deleteFileModal').classList.remove('active');
  pendingDelete = null;
});

document.getElementById('cancelDeleteFile2').addEventListener('click', () => {
  document.getElementById('deleteFileModal').classList.remove('active');
  pendingDelete = null;
});

document.getElementById('deleteFileModal').addEventListener('click', e => {
  if (e.target === document.getElementById('deleteFileModal')) {
    document.getElementById('deleteFileModal').classList.remove('active');
    pendingDelete = null;
  }
});

document.getElementById('confirmDeleteFile').addEventListener('click', async () => {
  if (!pendingDelete) return;
  const btn = document.getElementById('confirmDeleteFile');
  btn.disabled = true; btn.textContent = 'Deleting…';

  const res = await fetch('/api/files', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ station: pendingDelete.stationId, filename: pendingDelete.filename })
  });

  btn.disabled = false; btn.textContent = 'Delete';
  document.getElementById('deleteFileModal').classList.remove('active');

  if (res.ok) {
    // Remove from cache and re-render
    delete fileCache[currentStation.folder];
    allFiles = allFiles.filter(f => f !== pendingDelete.href);
    showToast(`Deleted: ${pendingDelete.filename}`);
    populateDateSelect(allFiles);
    applyFilters();
  } else {
    const d = await res.json().catch(() => ({}));
    showToast(`Error: ${d.error || 'Delete failed'}`);
  }
  pendingDelete = null;
});

/* ── Init ── */
populateStationSelect();
selectStation(0);

/* ── Auto-refresh: poll current station every 15 s ── */
const REFRESH_INTERVAL = 15000;
let refreshTimer = null;
let countdownTimer = null;
let countdown = 15;

function updateRefreshIndicator(seconds, polling = false) {
  const label = document.getElementById('refreshLabel');
  const dot   = document.getElementById('refreshDot');
  if (!label || !dot) return;
  if (polling) {
    dot.classList.add('active');
    label.textContent = '…';
    setTimeout(() => dot.classList.remove('active'), 600);
  } else {
    label.textContent = seconds + 's';
  }
}

async function pollStation() {
  updateRefreshIndicator(0, true);
  // Bypass cache — always fetch fresh listing
  delete fileCache[currentStation.folder];
  delete fileMtimes[currentStation.folder];
  delete fileSizes[currentStation.folder];
  const files = await listFolder(currentStation.folder);
  if (files === null) return;

  const fresh = files.slice().sort().reverse();

  // Detect new files by comparing sorted filename lists
  const freshKey = fresh.join('|');
  const oldKey   = allFiles.join('|');
  if (freshKey === oldKey) return;  // nothing changed

  // Show toast notification
  const added = fresh.length - allFiles.length;
  showToast(added > 0 ? `+${added} new recording${added === 1 ? '' : 's'}` : 'Recordings updated');

  allFiles = fresh;
  populateDateSelect(allFiles);
  // Stay on current page / filters if possible
  applyFilters();
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdown = REFRESH_INTERVAL / 1000;
  updateRefreshIndicator(countdown);
  countdownTimer = setInterval(() => {
    countdown--;
    if (countdown <= 0) countdown = REFRESH_INTERVAL / 1000;
    updateRefreshIndicator(countdown);
  }, 1000);
}

function startAutoRefresh() {
  stopAutoRefresh();
  startCountdown();
  refreshTimer = setInterval(() => {
    pollStation();
    startCountdown();
  }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer)   { clearInterval(refreshTimer);   refreshTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

startAutoRefresh();

// Restart timer whenever user switches station
stationSelect.addEventListener('change', () => {
  startAutoRefresh();
});

// Pause when tab is hidden, resume when visible (saves bandwidth)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopAutoRefresh(); }
  else { pollStation(); startAutoRefresh(); }
});

/* ── Toast notification ── */
function showToast(msg) {
  let toast = document.getElementById('autoToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'autoToast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast toast-show';
  clearTimeout(toast._hide);
  toast._hide = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

/* ── Storage stats ── */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0) + '\u00a0' + units[i];
}

function formatDuration(secs) {
  if (!secs || secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

async function loadStorage() {
  try {
    const res = await fetch('/api/storage');
    if (!res.ok) return;
    const d = await res.json();
    if (!d.total) return;

    const pct = Math.round((d.used / d.total) * 100);
    const fill = document.getElementById('storageFill');
    fill.style.width = pct + '%';
    fill.className = 'storage-fill' + (pct >= 90 ? ' crit' : pct >= 75 ? ' warn' : '');

    document.getElementById('storageUsed').textContent  = formatBytes(d.used);
    document.getElementById('storageTotal').textContent = formatBytes(d.total);
    document.getElementById('storageAvail').textContent = '(' + formatBytes(d.available) + ' free)';
    document.getElementById('storagePct').textContent   = pct + '%';
    document.getElementById('storageBar').style.display = '';
  } catch (e) { /* endpoint not available in dev */ }
}

loadStorage();
setInterval(loadStorage, 60000);

/* ── Bulk delete (admin only) ── */
const deleteAllBtn    = document.getElementById('deleteAllBtn');
const deleteByDateBtn = document.getElementById('deleteByDateBtn');
const bulkModal       = document.getElementById('bulkDeleteModal');
const bulkMessage     = document.getElementById('bulkDeleteMessage');
const confirmBulkBtn  = document.getElementById('confirmBulkDelete');

let pendingBulkDelete = null; // { filenames: [...], label: "..." }

// Enable/disable "Delete by date" based on whether a date filter is selected
dateSelect.addEventListener('change', () => {
  deleteByDateBtn.disabled = !dateSelect.value;
});

function openBulkDeleteConfirm(filenames, label, hrefs) {
  if (!filenames.length) {
    showToast('No recordings to delete');
    return;
  }
  pendingBulkDelete = { filenames, hrefs: hrefs || filenames, label };
  bulkMessage.innerHTML = `Permanently delete <strong style="color:var(--text)">${filenames.length}</strong> recording${filenames.length === 1 ? '' : 's'} ${label}?`;
  bulkModal.classList.add('active');
}

function closeBulkDeleteModal() {
  bulkModal.classList.remove('active');
  pendingBulkDelete = null;
}

document.getElementById('cancelBulkDelete').addEventListener('click', closeBulkDeleteModal);
document.getElementById('cancelBulkDelete2').addEventListener('click', closeBulkDeleteModal);
bulkModal.addEventListener('click', e => { if (e.target === bulkModal) closeBulkDeleteModal(); });

deleteAllBtn.addEventListener('click', () => {
  openBulkDeleteConfirm(allFiles.map(decodeURIComponent), `from ${currentStation.label} (all dates)`, allFiles.slice());
});

deleteByDateBtn.addEventListener('click', () => {
  const dateFilter = dateSelect.value;
  if (!dateFilter) return;
  const matches = allFiles.filter(f => extractDate(decodeURIComponent(f)) === dateFilter);
  openBulkDeleteConfirm(matches.map(decodeURIComponent), `from ${currentStation.label} on ${dateFilter}`, matches);
});

confirmBulkBtn.addEventListener('click', async () => {
  if (!pendingBulkDelete) return;
  confirmBulkBtn.disabled = true;
  confirmBulkBtn.textContent = 'Deleting…';

  try {
    const res = await fetch('/api/files/bulk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: currentStation.id, filenames: pendingBulkDelete.filenames })
    });
    const d = await res.json().catch(() => ({}));

    if (res.ok) {
      showToast(`Deleted ${d.deleted} of ${d.total} recording${d.total === 1 ? '' : 's'}`);
      delete fileCache[currentStation.folder];
      const deletedSet = new Set(pendingBulkDelete.hrefs);
      allFiles = allFiles.filter(f => !deletedSet.has(f));
      populateDateSelect(allFiles);
      deleteByDateBtn.disabled = !dateSelect.value || !allFiles.some(f => extractDate(decodeURIComponent(f)) === dateSelect.value);
      currentPage = 1;
      applyFilters();
    } else {
      showToast(`Error: ${d.error || 'Bulk delete failed'}`);
    }
  } catch (e) {
    showToast('Error: request failed');
  }

  confirmBulkBtn.disabled = false;
  confirmBulkBtn.textContent = 'Delete';
  closeBulkDeleteModal();
});

// Re-evaluate "Delete by date" button state whenever station changes
stationSelect.addEventListener('change', () => {
  deleteByDateBtn.disabled = !dateSelect.value;
});

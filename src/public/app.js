import {
  calculateSelection,
  extensionColor,
  formatPercent,
  formatBytes,
  mosaicSquareLayout,
} from './ui-data.js';

const TABLE_PAGE_LIMIT = 500;
const TILE_LIMIT = 5_000;
let resizeFrame = 0;

const state = {
  token: null,
  scan: null,
  entries: [],
  entryTotal: 0,
  tileEntries: [],
  tileTotal: 0,
  entryMode: 'tree',
  selectedPaths: new Set(),
  selectedEntries: new Map(),
  expandedPaths: new Set(),
  treeChildren: new Map(),
  treeTotals: new Map(),
  treeLoadingPaths: new Set(),
  sortKey: 'size',
  sortDirection: 'desc',
  loadingEntries: false
};

const elements = {
  statusText: document.querySelector('#statusText'),
  rootInput: document.querySelector('#rootInput'),
  rootChips: document.querySelector('#rootChips'),
  scanButton: document.querySelector('#scanButton'),
  rescanButton: document.querySelector('#rescanButton'),
  scanProgress: document.querySelector('#scanProgress'),
  progressTitle: document.querySelector('#progressTitle'),
  progressStats: document.querySelector('#progressStats'),
  progressBar: document.querySelector('#progressBar'),
  progressPath: document.querySelector('#progressPath'),
  totalSize: document.querySelector('#totalSize'),
  entryCount: document.querySelector('#entryCount'),
  scanStatus: document.querySelector('#scanStatus'),
  selectedSummary: document.querySelector('#selectedSummary'),
  treemap: document.querySelector('#treemap'),
  fileMapSummary: document.querySelector('#fileMapSummary'),
  focusedPath: document.querySelector('#focusedPath'),
  entryHeading: document.querySelector('#entryHeading'),
  entrySubheading: document.querySelector('#entrySubheading'),
  entryRows: document.querySelector('#entryRows'),
  treeButton: document.querySelector('#treeButton'),
  filesOnlyButton: document.querySelector('#filesOnlyButton'),
  allEntriesButton: document.querySelector('#allEntriesButton'),
  loadMoreButton: document.querySelector('#loadMoreButton'),
  cleanupButton: document.querySelector('#cleanupButton'),
  errorPanel: document.querySelector('#errorPanel'),
  errorList: document.querySelector('#errorList'),
  confirmDialog: document.querySelector('#confirmDialog'),
  confirmSummary: document.querySelector('#confirmSummary'),
  confirmList: document.querySelector('#confirmList'),
  confirmCleanupButton: document.querySelector('#confirmCleanupButton')
};

function setStatus(message) {
  elements.statusText.textContent = message;
}

function logClientEvent(event, fields = {}) {
  console.info('[catscan]', event, {
    time: new Date().toISOString(),
    ...fields
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(state.token ? { 'x-disk-viewer-token': state.token } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error?.message || `Request failed with ${response.status}`);
  }

  return body;
}

function renderProgress(progress) {
  if (!progress) {
    elements.scanProgress.hidden = true;
    return;
  }

  elements.scanProgress.hidden = false;
  elements.progressTitle.textContent = progress.phase || 'Scanning';
  elements.progressStats.textContent = [
    `${progress.entriesScanned || 0} entries`,
    `${progress.filesScanned || 0} files`,
    formatBytes(progress.bytesScanned || 0),
    `${progress.errors || 0} errors`
  ].join(' / ');
  elements.progressPath.textContent = progress.currentPath || progress.rootPath || '';
  elements.progressPath.title = elements.progressPath.textContent;
  elements.progressBar.className = 'progress-bar';

  if (progress.status === 'failed') {
    elements.progressBar.classList.add('is-failed');
  } else if (progress.status === 'completed' || progress.status === 'partial') {
    elements.progressBar.classList.add('is-complete');
  } else {
    elements.progressBar.classList.add('is-running');
  }
}

async function pollScan(scanId) {
  while (true) {
    const job = await api(`/api/scan/${encodeURIComponent(scanId)}/progress`);
    renderProgress(job.progress);

    if (job.status === 'completed' || job.status === 'partial') {
      logClientEvent('scan.result.received', {
        scanId,
        status: job.status,
        entryCount: job.scan?.entryCount,
        totalSize: job.scan?.totalSize,
        errorCount: job.scan?.errorCount
      });
      return job.scan;
    }

    if (job.status === 'failed') {
      throw new Error(job.error?.message || 'Scan failed.');
    }

    await delay(400);
  }
}

function renderMetrics() {
  const scan = state.scan;
  const selection = calculateSelection([...state.selectedEntries.values()], state.selectedPaths);

  elements.totalSize.textContent = formatBytes(scan?.totalSize || 0);
  elements.entryCount.textContent = String(scan?.entryCount || 0);
  elements.scanStatus.textContent = scan ? scan.status : 'Not scanned';
  elements.selectedSummary.textContent = `${selection.itemCount} / ${formatBytes(selection.totalSize)}`;
  elements.cleanupButton.disabled = selection.itemCount === 0;
  elements.rescanButton.disabled = !scan;
}

function renderErrors() {
  const errors = state.scan?.errors || [];
  elements.errorPanel.hidden = errors.length === 0;
  elements.errorList.replaceChildren();

  for (const error of errors.slice(0, 50)) {
    const item = document.createElement('li');
    item.textContent = `${error.path}: ${error.message}`;
    elements.errorList.append(item);
  }

  if (state.scan?.errorsTruncated) {
    const item = document.createElement('li');
    item.textContent = 'More errors were omitted from this view.';
    elements.errorList.append(item);
  }
}

function renderTreemap() {
  elements.treemap.replaceChildren();

  const files = state.tileEntries;
  elements.fileMapSummary.textContent = files.length > 0
    ? `${files.length} of ${state.tileTotal} file${state.tileTotal === 1 ? '' : 's'}, largest first`
    : '';

  if (files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'treemap-empty';
    empty.textContent = state.scan ? 'No files found' : 'No scan data';
    elements.treemap.append(empty);
    return;
  }

  const bounds = elements.treemap.getBoundingClientRect();
  const styles = getComputedStyle(elements.treemap);
  const cellSize = Number.parseFloat(styles.getPropertyValue('--tile-cell-size')) || 8;
  const layout = mosaicSquareLayout(files, bounds.width, bounds.height, {
    height: bounds.height,
    cellSize
  });
  const spacer = document.createElement('div');
  spacer.className = 'treemap-spacer';
  spacer.style.height = `${layout.height}px`;
  elements.treemap.append(spacer);

  layout.rects.forEach((rect) => {
    const entry = rect.entry;
    const tile = document.createElement('button');
    tile.className = 'tile';
    tile.type = 'button';
    tile.style.setProperty('--tile-color', extensionColor(entry));
    tile.style.left = `${rect.x}px`;
    tile.style.top = `${rect.y}px`;
    tile.style.width = `${rect.width}px`;
    tile.style.height = `${rect.height}px`;
    tile.title = `${entry.path} - ${entry.extension || ''} - ${formatBytes(entry.size)}`;
    tile.setAttribute('aria-label', `${entry.name || entry.path}, ${formatBytes(entry.size)}`);
    tile.addEventListener('click', () => focusEntry(entry));
    elements.treemap.append(tile);
  });
}

function focusEntry(entry) {
  elements.focusedPath.textContent = entry.path;
  elements.focusedPath.title = entry.path;
}

function resetTreeState() {
  state.expandedPaths.clear();
  state.treeChildren.clear();
  state.treeTotals.clear();
  state.treeLoadingPaths.clear();

  if (state.scan?.root?.path) {
    state.expandedPaths.add(state.scan.root.path);
  }
}

function canExpandEntry(entry) {
  return entry?.type === 'directory' && Number(entry.childCount || 0) > 0;
}

function buildVisibleTreeRows() {
  if (!state.scan?.root) {
    return [];
  }

  const rows = [];

  const appendEntry = (entry, depth) => {
    const row = {
      ...entry,
      kind: 'entry',
      depth,
      isExpanded: state.expandedPaths.has(entry.path)
    };
    rows.push(row);

    if (!canExpandEntry(row) || !row.isExpanded) {
      return;
    }

    const children = state.treeChildren.get(row.path) || [];
    const isLoading = state.treeLoadingPaths.has(row.path);
    const total = state.treeTotals.get(row.path) ?? Number(row.childCount || 0);

    if (isLoading && children.length === 0) {
      rows.push({
        kind: 'status',
        id: `loading:${row.path}`,
        depth: depth + 1,
        message: 'Loading...'
      });
    }

    for (const child of children) {
      appendEntry(child, depth + 1);
    }

    if (children.length < total) {
      rows.push({
        kind: 'load-more',
        id: `load-more:${row.path}`,
        parentPath: row.path,
        depth: depth + 1,
        loaded: children.length,
        total
      });
    }
  };

  appendEntry({
    ...state.scan.root,
    percentOfParent: 100,
    percentOfTotal: 100
  }, 0);

  return rows;
}

async function fetchChildren(parentPath, { offset = 0, limit = TABLE_PAGE_LIMIT } = {}) {
  const params = new URLSearchParams({
    path: parentPath,
    sort: state.sortKey,
    direction: state.sortDirection,
    offset: String(offset),
    limit: String(limit)
  });
  return api(`/api/scan/${encodeURIComponent(state.scan.id)}/children?${params.toString()}`);
}

async function loadTreeChildren(parentPath, { append = false, render = true } = {}) {
  if (!state.scan || state.treeLoadingPaths.has(parentPath)) {
    return;
  }

  const existing = append ? (state.treeChildren.get(parentPath) || []) : [];
  state.treeLoadingPaths.add(parentPath);

  if (render) {
    renderRows();
  }

  try {
    const page = await fetchChildren(parentPath, {
      offset: existing.length,
      limit: TABLE_PAGE_LIMIT
    });
    state.treeChildren.set(parentPath, [...existing, ...page.entries]);
    state.treeTotals.set(parentPath, page.total);
  } finally {
    state.treeLoadingPaths.delete(parentPath);
    if (render) {
      renderRows();
    }
  }
}

async function toggleTreeEntry(entry) {
  if (!canExpandEntry(entry)) {
    focusEntry(entry);
    return;
  }

  focusEntry(entry);

  if (state.expandedPaths.has(entry.path)) {
    state.expandedPaths.delete(entry.path);
    renderRows();
    return;
  }

  state.expandedPaths.add(entry.path);
  if (!state.treeChildren.has(entry.path)) {
    await loadTreeChildren(entry.path);
    return;
  }

  renderRows();
}

function handleTreeToggle(entry) {
  toggleTreeEntry(entry).catch((error) => {
    setStatus(error.message);
  });
}

function createSvgIcon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) {
    svg.setAttribute('class', className);
  }

  const iconPaths = {
    archive: [
      '<path d="M6 3h12l2 4v13H4V7l2-4Z"/>',
      '<path d="M4 7h16"/>',
      '<path d="M10 3v4"/>',
      '<path d="M14 3v4"/>',
      '<path d="M11 11h2v2h-2z"/>',
      '<path d="M11 15h2v2h-2z"/>'
    ],
    audio: [
      '<path d="M9 18V6l10-2v12"/>',
      '<circle cx="6" cy="18" r="3"/>',
      '<circle cx="16" cy="16" r="3"/>'
    ],
    chevronDown: ['<path d="m7 10 5 5 5-5"/>'],
    chevronRight: ['<path d="m9 6 6 6-6 6"/>'],
    code: [
      '<path d="m9 18-6-6 6-6"/>',
      '<path d="m15 6 6 6-6 6"/>'
    ],
    database: [
      '<ellipse cx="12" cy="5" rx="7" ry="3"/>',
      '<path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>',
      '<path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'
    ],
    file: [
      '<path d="M14 3H6v18h12V7l-4-4Z"/>',
      '<path d="M14 3v5h5"/>'
    ],
    finder: [
      '<path d="M4 5h16v14H4z"/>',
      '<path d="M12 5v14"/>',
      '<path d="M8 10h.01"/>',
      '<path d="M16 10h.01"/>',
      '<path d="M8 15c1 1 2.3 1.5 4 1.5s3-.5 4-1.5"/>'
    ],
    folder: [
      '<path d="M3 6h7l2 2h9v11H3z"/>',
      '<path d="M3 8h18"/>'
    ],
    folderOpen: [
      '<path d="M3 7h7l2 2h9v3"/>',
      '<path d="M3 19 6 10h16l-3 9H3Z"/>'
    ],
    image: [
      '<path d="M4 5h16v14H4z"/>',
      '<circle cx="9" cy="10" r="1.5"/>',
      '<path d="m7 17 4-5 3 3 2-2 3 4"/>'
    ],
    pdf: [
      '<path d="M14 3H6v18h12V7l-4-4Z"/>',
      '<path d="M14 3v5h5"/>',
      '<path d="M8 16h8"/>'
    ],
    root: [
      '<path d="M5 7h14l2 6H3l2-6Z"/>',
      '<path d="M3 13v4h18v-4"/>',
      '<path d="M7 16h.01"/>'
    ],
    video: [
      '<path d="M4 6h12v12H4z"/>',
      '<path d="m16 10 5-3v10l-5-3z"/>'
    ]
  };

  svg.innerHTML = (iconPaths[name] || iconPaths.file).join('');
  return svg;
}

function iconNameForEntry(entry) {
  if (entry.path === state.scan?.rootPath) {
    return 'root';
  }

  if (entry.type === 'directory') {
    return entry.isExpanded ? 'folderOpen' : 'folder';
  }

  const extension = String(entry.extension || '').toLowerCase();

  if (['.zip', '.gz', '.rar', '.7z', '.dmg', '.iso'].includes(extension)) {
    return 'archive';
  }
  if (['.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.css', '.html', '.sql'].includes(extension)) {
    return 'code';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(extension)) {
    return 'image';
  }
  if (['.mp3', '.wav'].includes(extension)) {
    return 'audio';
  }
  if (['.mp4', '.mov', '.mkv'].includes(extension)) {
    return 'video';
  }
  if (extension === '.db') {
    return 'database';
  }
  if (extension === '.pdf') {
    return 'pdf';
  }

  return 'file';
}

async function openInFinder(entry, button) {
  if (!state.scan || !entry) {
    return;
  }

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = 'Opening';
  setStatus('Opening in Finder');

  try {
    await api('/api/reveal', {
      method: 'POST',
      body: JSON.stringify({
        scanId: state.scan.id,
        path: entry.path
      })
    });
    setStatus('Opened in Finder');
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function visibleEntries() {
  if (!state.scan) {
    return [];
  }

  if (state.entryMode === 'tree') {
    return buildVisibleTreeRows();
  }

  return state.entries;
}

function renderEntryModeControls() {
  const filesOnly = state.entryMode === 'files';
  const treeMode = state.entryMode === 'tree';
  const allEntries = state.entryMode === 'all';
  elements.treeButton.setAttribute('aria-pressed', String(treeMode));
  elements.filesOnlyButton.setAttribute('aria-pressed', String(filesOnly));
  elements.allEntriesButton.setAttribute('aria-pressed', String(allEntries));
  elements.entryHeading.textContent = treeMode ? 'Tree' : filesOnly ? 'Files' : 'All Entries';
}

function defaultSortDirection(sortKey) {
  return sortKey === 'name' || sortKey === 'type' ? 'asc' : 'desc';
}

function renderSortControls() {
  document.querySelectorAll('.sort-button').forEach((button) => {
    const isActive = button.dataset.sort === state.sortKey;
    const header = button.closest('th');
    button.classList.toggle('is-active', isActive);
    button.classList.toggle('is-asc', isActive && state.sortDirection === 'asc');
    button.classList.toggle('is-desc', isActive && state.sortDirection === 'desc');
    button.setAttribute('aria-pressed', String(isActive));
    button.setAttribute('aria-label', `${button.textContent.trim()}, sorted ${isActive ? state.sortDirection : 'none'}`);

    if (header) {
      header.setAttribute(
        'aria-sort',
        isActive ? state.sortDirection === 'asc' ? 'ascending' : 'descending' : 'none'
      );
    }
  });
}

function renderRows() {
  elements.entryRows.replaceChildren();
  renderEntryModeControls();
  renderSortControls();
  const rows = visibleEntries();
  const visibleEntryCount = state.entryMode === 'tree'
    ? rows.filter((row) => row.kind === 'entry').length
    : rows.length;
  const rowLabel = state.entryMode === 'tree'
    ? `entr${visibleEntryCount === 1 ? 'y' : 'ies'}`
    : state.entryMode === 'files'
    ? `file${visibleEntryCount === 1 ? '' : 's'}`
    : `entr${visibleEntryCount === 1 ? 'y' : 'ies'}`;
  elements.entrySubheading.textContent = state.scan
    ? `${visibleEntryCount} of ${state.entryTotal} ${rowLabel}`
    : '';
  elements.loadMoreButton.hidden = !state.scan || state.entryMode === 'tree' || rows.length >= state.entryTotal;
  elements.loadMoreButton.disabled = state.loadingEntries;

  for (const rowEntry of rows) {
    if (rowEntry.kind === 'status' || rowEntry.kind === 'load-more') {
      const row = document.createElement('tr');
      row.className = 'tree-meta-row';
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.style.paddingLeft = `${Math.min(Math.max(0, rowEntry.depth), 12) * 18 + 44}px`;

      if (rowEntry.kind === 'status') {
        cell.textContent = rowEntry.message;
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tree-load-more';
        button.textContent = `Load more (${rowEntry.loaded} of ${rowEntry.total})`;
        button.addEventListener('click', () => {
          loadTreeChildren(rowEntry.parentPath, { append: true }).catch((error) => {
            setStatus(error.message);
          });
        });
        cell.append(button);
      }

      row.append(cell);
      elements.entryRows.append(row);
      continue;
    }

    const entry = rowEntry;
    const row = document.createElement('tr');
    if (entry.type === 'directory') {
      row.classList.add('is-directory');
    }
    if (entry.isExpanded) {
      row.classList.add('is-expanded');
    }
    if (entry.path === state.scan?.rootPath) {
      row.classList.add('is-root-entry');
    }

    const checkCell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = state.selectedPaths.has(entry.path);
    input.disabled = entry.path === state.scan?.rootPath;
    input.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    input.addEventListener('change', () => {
      if (input.checked) {
        state.selectedPaths.add(entry.path);
        state.selectedEntries.set(entry.path, entry);
      } else {
        state.selectedPaths.delete(entry.path);
        state.selectedEntries.delete(entry.path);
      }
      renderMetrics();
    });
    checkCell.append(input);

    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell';
    if (state.entryMode === 'tree') {
      nameCell.classList.add('tree-name-cell');
    }
    const name = document.createElement('div');
    name.className = 'entry-name';
    if (state.entryMode === 'tree') {
      name.classList.add('is-tree-name');
      if (entry.depth > 0) {
        name.classList.add('has-parent');
      }
    }
    const treeIndent = state.entryMode === 'tree'
      ? Math.min(Math.max(0, entry.depth), 12) * 18
      : 0;
    name.style.paddingLeft = `${treeIndent}px`;
    name.style.setProperty('--tree-indent', `${treeIndent}px`);

    if (state.entryMode === 'tree') {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tree-toggle';
      toggle.disabled = !canExpandEntry(entry);
      if (canExpandEntry(entry)) {
        toggle.append(createSvgIcon(entry.isExpanded ? 'chevronDown' : 'chevronRight', 'tree-chevron'));
      }
      toggle.setAttribute('aria-label', `${entry.isExpanded ? 'Collapse' : 'Expand'} ${entry.name || entry.path}`);
      toggle.setAttribute('aria-expanded', String(Boolean(entry.isExpanded)));
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        handleTreeToggle(entry);
      });

      const itemIconName = iconNameForEntry(entry);
      const itemIcon = createSvgIcon(itemIconName, `tree-icon tree-icon-${itemIconName}`);
      itemIcon.style.setProperty('--tree-icon-color', extensionColor(entry));

      const nameText = document.createElement('span');
      nameText.className = 'entry-name-text';
      nameText.textContent = entry.name || entry.path;
      name.append(toggle, itemIcon, nameText);
    } else {
      name.textContent = entry.name || entry.path;
    }

    const entryPath = document.createElement('div');
    entryPath.className = 'entry-path';
    entryPath.textContent = entry.path;
    nameCell.append(name, entryPath);
    nameCell.addEventListener('click', () => {
      if (state.entryMode === 'tree' && canExpandEntry(entry)) {
        handleTreeToggle(entry);
        return;
      }
      focusEntry(entry);
    });

    const percentCell = document.createElement('td');
    percentCell.className = 'percent-cell';
    percentCell.title = state.entryMode === 'tree'
      ? 'Percent of the current folder'
      : 'Percent of parent';
    const percentBar = document.createElement('div');
    percentBar.className = 'percent-bar';
    const percentFill = document.createElement('span');
    percentFill.style.width = `${Math.min(100, Math.max(0, entry.percentOfParent || 0))}%`;
    const percentText = document.createElement('strong');
    percentText.textContent = formatPercent(entry.percentOfParent);
    percentBar.append(percentFill, percentText);
    percentCell.append(percentBar);

    const typeCell = document.createElement('td');
    const extensionLabel = entry.extension && !entry.extension.startsWith('[')
      ? ` ${entry.extension}`
      : '';
    typeCell.textContent = entry.partial ? `${entry.type}${extensionLabel} partial` : `${entry.type}${extensionLabel}`;
    if (entry.partial) {
      typeCell.className = 'partial';
    }

    const sizeCell = document.createElement('td');
    sizeCell.textContent = formatBytes(entry.size);

    const actionCell = document.createElement('td');
    const finderButton = document.createElement('button');
    finderButton.type = 'button';
    finderButton.className = 'finder-button';
    finderButton.textContent = 'Finder';
    finderButton.setAttribute('aria-label', `Open ${entry.name || entry.path} in Finder`);
    finderButton.addEventListener('click', () => openInFinder(entry, finderButton));
    actionCell.append(finderButton);

    row.append(checkCell, nameCell, percentCell, typeCell, sizeCell, actionCell);
    elements.entryRows.append(row);
  }
}

function renderAll() {
  const startedAt = performance.now();
  logClientEvent('render.start', {
    scanId: state.scan?.id,
    entryCount: state.scan?.entryCount,
    totalSize: state.scan?.totalSize,
    errorCount: state.scan?.errorCount,
    visibleEntries: state.entries.length,
    visibleTiles: state.tileEntries.length
  });
  renderMetrics();
  renderTreemap();
  renderRows();
  renderErrors();
  logClientEvent('render.complete', {
    scanId: state.scan?.id,
    entries: state.entries.length,
    durationMs: Math.round(performance.now() - startedAt)
  });
}

async function fetchEntries({ mode, sortKey, direction, offset, limit }) {
  const params = new URLSearchParams({
    mode,
    sort: sortKey,
    direction,
    offset: String(offset),
    limit: String(limit)
  });
  return api(`/api/scan/${encodeURIComponent(state.scan.id)}/entries?${params.toString()}`);
}

async function loadTiles() {
  if (!state.scan) {
    state.tileEntries = [];
    state.tileTotal = 0;
    return;
  }

  const page = await fetchEntries({
    mode: 'files',
    sortKey: 'size',
    direction: 'desc',
    offset: 0,
    limit: TILE_LIMIT
  });
  state.tileEntries = page.entries;
  state.tileTotal = page.total;
}

async function loadEntries({ append = false } = {}) {
  if (!state.scan) {
    state.entries = [];
    state.entryTotal = 0;
    return;
  }

  if (state.entryMode === 'tree') {
    state.loadingEntries = true;
    state.entryTotal = state.scan.entryCount || 0;
    renderRows();

    try {
      if (!state.expandedPaths.has(state.scan.root.path)) {
        state.expandedPaths.add(state.scan.root.path);
      }

      if (!append && !state.treeChildren.has(state.scan.root.path)) {
        await loadTreeChildren(state.scan.root.path, { render: false });
      }
    } finally {
      state.loadingEntries = false;
      renderRows();
      renderMetrics();
    }
    return;
  }

  state.loadingEntries = true;
  renderRows();

  try {
    const page = await fetchEntries({
      mode: state.entryMode,
      sortKey: state.sortKey,
      direction: state.sortDirection,
      offset: append ? state.entries.length : 0,
      limit: TABLE_PAGE_LIMIT
    });

    state.entries = append ? [...state.entries, ...page.entries] : page.entries;
    state.entryTotal = page.total;
  } finally {
    state.loadingEntries = false;
    renderRows();
    renderMetrics();
  }
}

async function loadScanViews() {
  await Promise.all([
    loadTiles(),
    loadEntries()
  ]);
  renderAll();
}

async function runScan() {
  const rootPath = elements.rootInput.value.trim();
  if (!rootPath) {
    setStatus('Enter a root path');
    return;
  }

  elements.scanButton.disabled = true;
  elements.rescanButton.disabled = true;
  setStatus('Scanning');
  renderProgress({
    status: 'running',
    phase: 'Starting scan',
    entriesScanned: 0,
    filesScanned: 0,
    bytesScanned: 0,
    errors: 0,
    currentPath: rootPath
  });

  try {
    const { scanId, progress } = await api('/api/scan/start', {
      method: 'POST',
      body: JSON.stringify({ rootPath })
    });
    logClientEvent('scan.started', { scanId, rootPath });
    renderProgress(progress);
    const scan = await pollScan(scanId);
    state.scan = scan;
    state.selectedPaths.clear();
    state.selectedEntries.clear();
    resetTreeState();
    focusEntry(scan.root);
    await loadScanViews();
    setStatus(scan.status === 'partial' ? 'Scan completed with partial results' : 'Scan completed');
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.scanButton.disabled = false;
    elements.rescanButton.disabled = !state.scan;
  }
}

function openCleanupDialog() {
  const selection = calculateSelection([...state.selectedEntries.values()], state.selectedPaths);
  if (selection.itemCount === 0) {
    return;
  }

  elements.confirmSummary.textContent = `${selection.itemCount} item(s), ${formatBytes(selection.totalSize)}`;
  elements.confirmList.replaceChildren();

  for (const entry of selection.entries.slice(0, 8)) {
    const item = document.createElement('li');
    item.textContent = entry.path;
    elements.confirmList.append(item);
  }

  if (selection.entries.length > 8) {
    const item = document.createElement('li');
    item.textContent = `${selection.entries.length - 8} more`;
    elements.confirmList.append(item);
  }

  elements.confirmDialog.showModal();
}

async function runCleanup() {
  if (!state.scan || state.selectedPaths.size === 0) {
    return;
  }

  elements.cleanupButton.disabled = true;
  setStatus('Moving to Trash');

  try {
    const { operation } = await api('/api/cleanup', {
      method: 'POST',
      body: JSON.stringify({
        scanId: state.scan.id,
        paths: [...state.selectedPaths]
      })
    });

    state.scan = operation.scan;
    state.selectedPaths.clear();
    state.selectedEntries.clear();
    resetTreeState();
    await loadScanViews();
    setStatus(operation.failed.length > 0 ? 'Cleanup completed with failures' : 'Cleanup completed');
  } catch (error) {
    setStatus(error.message);
  } finally {
    renderMetrics();
  }
}

async function initialize() {
  try {
    const session = await api('/api/session');
    state.token = session.token;
    elements.rootInput.value = session.suggestedRoots[0]?.path || '/';

    for (const root of session.suggestedRoots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = root.label;
      button.addEventListener('click', () => {
        elements.rootInput.value = root.path;
      });
      elements.rootChips.append(button);
    }

    setStatus('Ready');
  } catch (error) {
    setStatus(error.message);
  }

  renderAll();
}

elements.scanButton.addEventListener('click', runScan);
elements.rescanButton.addEventListener('click', runScan);
elements.cleanupButton.addEventListener('click', openCleanupDialog);
elements.confirmDialog.addEventListener('close', () => {
  if (elements.confirmDialog.returnValue === 'confirm') {
    runCleanup();
  }
});

document.querySelectorAll('.sort-button').forEach((button) => {
  button.addEventListener('click', async () => {
    const key = button.dataset.sort;
    if (state.sortKey === key) {
      state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortKey = key;
      state.sortDirection = defaultSortDirection(key);
    }
    if (state.entryMode === 'tree') {
      resetTreeState();
    }
    if (state.scan) {
      try {
        await loadEntries();
      } catch (error) {
        setStatus(error.message);
      }
    } else {
      renderRows();
    }
  });
});

elements.treeButton.addEventListener('click', async () => {
  state.entryMode = 'tree';
  state.sortKey = 'size';
  state.sortDirection = 'desc';
  resetTreeState();
  if (state.scan) {
    try {
      await loadEntries();
    } catch (error) {
      setStatus(error.message);
    }
  } else {
    renderRows();
  }
});

elements.filesOnlyButton.addEventListener('click', async () => {
  state.entryMode = 'files';
  state.sortKey = 'size';
  state.sortDirection = 'desc';
  if (state.scan) {
    try {
      await loadEntries();
    } catch (error) {
      setStatus(error.message);
    }
  } else {
    renderRows();
  }
});

elements.allEntriesButton.addEventListener('click', async () => {
  state.entryMode = 'all';
  state.sortKey = 'size';
  state.sortDirection = 'desc';
  if (state.scan) {
    try {
      await loadEntries();
    } catch (error) {
      setStatus(error.message);
    }
  } else {
    renderRows();
  }
});

elements.loadMoreButton.addEventListener('click', async () => {
  try {
    await loadEntries({ append: true });
  } catch (error) {
    setStatus(error.message);
  }
});

window.addEventListener('resize', () => {
  if (!state.scan || state.tileEntries.length === 0) {
    return;
  }

  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderTreemap);
});

initialize();

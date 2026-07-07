import {
  calculateSelection,
  createMosaicHitGrid,
  extensionColor,
  folderMosaicLayout,
  formatPercent,
  formatBytes,
  mosaicHitTest,
} from './ui-data.js';

const TABLE_PAGE_LIMIT = 500;
const TILE_LIMIT = 5_000;
let resizeFrame = 0;
let diskSpaceTimer = 0;
let diskSpaceRequestId = 0;

const state = {
  token: null,
  platform: 'unknown',
  scan: null,
  entryTotal: 0,
  tileEntries: [],
  tileTotal: 0,
  selectedPaths: new Set(),
  selectedEntries: new Map(),
  expandedPaths: new Set(),
  treeChildren: new Map(),
  treeTotals: new Map(),
  treeLoadingPaths: new Set(),
  sortKey: 'size',
  sortDirection: 'desc',
  loadingEntries: false,
  selectingContents: false
};

const elements = {
  statusText: document.querySelector('#statusText'),
  rootInput: document.querySelector('#rootInput'),
  rootChips: document.querySelector('#rootChips'),
  scanButton: document.querySelector('#scanButton'),
  scanProgress: document.querySelector('#scanProgress'),
  progressTitle: document.querySelector('#progressTitle'),
  progressStats: document.querySelector('#progressStats'),
  progressBar: document.querySelector('#progressBar'),
  progressPath: document.querySelector('#progressPath'),
  diskSpaceMount: document.querySelector('#diskSpaceMount'),
  diskTotalSpace: document.querySelector('#diskTotalSpace'),
  diskUsedSpace: document.querySelector('#diskUsedSpace'),
  diskFreeSpace: document.querySelector('#diskFreeSpace'),
  diskUsedBar: document.querySelector('#diskUsedBar'),
  totalSize: document.querySelector('#totalSize'),
  entryCount: document.querySelector('#entryCount'),
  selectedSummary: document.querySelector('#selectedSummary'),
  treemap: document.querySelector('#treemap'),
  fileMapSummary: document.querySelector('#fileMapSummary'),
  focusedPath: document.querySelector('#focusedPath'),
  entryHeading: document.querySelector('#entryHeading'),
  entrySubheading: document.querySelector('#entrySubheading'),
  entryRows: document.querySelector('#entryRows'),
  selectContentsButton: document.querySelector('#selectContentsButton'),
  cleanupButton: document.querySelector('#cleanupButton'),
  fullDiskAccessButton: document.querySelector('#fullDiskAccessButton'),
  fullAccessDialog: document.querySelector('#fullAccessDialog'),
  openFullAccessFromDialogButton: document.querySelector('#openFullAccessFromDialogButton'),
  scanAnywayButton: document.querySelector('#scanAnywayButton'),
  errorPanel: document.querySelector('#errorPanel'),
  errorList: document.querySelector('#errorList'),
  confirmDialog: document.querySelector('#confirmDialog'),
  confirmSummary: document.querySelector('#confirmSummary'),
  confirmList: document.querySelector('#confirmList'),
  confirmCleanupButton: document.querySelector('#confirmCleanupButton')
};

const ICON_CLASSES = {
  archive: 'fi-rr-file-zipper',
  audio: 'fi-rr-file-audio',
  chevronDown: 'fi-rr-angle-small-down',
  chevronRight: 'fi-rr-angle-small-right',
  code: 'fi-rr-file-code',
  database: 'fi-rr-database',
  file: 'fi-rr-file',
  finder: 'fi-rr-up-right-from-square',
  folder: 'fi-rr-folder',
  folderOpen: 'fi-rr-folder-open',
  image: 'fi-rr-file-image',
  pdf: 'fi-rr-file-pdf',
  refresh: 'fi-rr-refresh',
  root: 'fi-rr-hdd',
  scan: 'fi-rr-barcode-scan',
  scanning: 'fi-rr-rotate-right',
  selectAll: 'fi-rr-checkbox',
  status: 'fi-rr-check-circle',
  total: 'fi-rr-hdd',
  trash: 'fi-rr-trash',
  unselectAll: 'fi-rr-square',
  video: 'fi-rr-file-video'
};

function createUiIcon(name, className = '') {
  const icon = document.createElement('i');
  icon.className = ['fi', ICON_CLASSES[name] || ICON_CLASSES.file, className].filter(Boolean).join(' ');
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

function createFinderIcon(className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  svg.innerHTML = [
    '<rect x="3" y="3" width="18" height="18" rx="4" fill="#0a84ff"/>',
    '<path d="M12 3h5a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-5V3Z" fill="#f4f8ff"/>',
    '<path d="M12 3v18" stroke="#101010" stroke-width="1.15" stroke-linecap="round"/>',
    '<path d="M8.2 9.2h.01M15.8 9.2h.01" stroke="#101010" stroke-width="2.1" stroke-linecap="round"/>',
    '<path d="M12 7.2c-.9 1.8-.9 3.6 0 5.4" stroke="#101010" stroke-width="1.15" stroke-linecap="round"/>',
    '<path d="M7.2 15.2c1.3 1.25 2.9 1.85 4.8 1.85s3.5-.6 4.8-1.85" stroke="#101010" stroke-width="1.15" stroke-linecap="round"/>'
  ].join('');
  return svg;
}

function setButtonContent(button, iconName, label) {
  button.replaceChildren(createUiIcon(iconName, 'button-icon'), document.createTextNode(label));
}

function hashText(value) {
  let hash = 0;
  for (const character of String(value || '')) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function hexToRgb(hex) {
  const value = String(hex || '#ffffff').replace('#', '');
  const normalized = value.length === 3
    ? value.split('').map((character) => `${character}${character}`).join('')
    : value.padEnd(6, 'f').slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function mixColor(color, target, amount) {
  const sourceRgb = hexToRgb(color);
  const targetRgb = hexToRgb(target);
  return rgbToHex({
    r: sourceRgb.r + (targetRgb.r - sourceRgb.r) * amount,
    g: sourceRgb.g + (targetRgb.g - sourceRgb.g) * amount,
    b: sourceRgb.b + (targetRgb.b - sourceRgb.b) * amount
  });
}

function tileColor(entry) {
  const baseColor = extensionColor(entry);
  const variation = ((hashText(entry?.path || entry?.name) % 9) - 4) / 100;
  return variation >= 0
    ? mixColor(baseColor, '#ffffff', variation * 1.7)
    : mixColor(baseColor, '#000000', Math.abs(variation) * 1.9);
}

function trimCanvasText(context, text, maxWidth) {
  const value = String(text || '');
  if (context.measureText(value).width <= maxWidth) {
    return value;
  }

  let trimmed = value;
  while (trimmed.length > 1 && context.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function drawTreemapCanvas(canvas, layout) {
  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(layout.width * pixelRatio));
  canvas.height = Math.max(1, Math.round(layout.height * pixelRatio));
  canvas.style.width = `${layout.width}px`;
  canvas.style.height = `${layout.height}px`;

  const context = canvas.getContext('2d', { alpha: false });
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = '#050505';
  context.fillRect(0, 0, layout.width, layout.height);

  for (const groupRect of layout.groups || []) {
    const groupGradient = context.createLinearGradient(
      groupRect.x,
      groupRect.y,
      groupRect.x,
      groupRect.y + groupRect.height
    );
    groupGradient.addColorStop(0, '#151515');
    groupGradient.addColorStop(1, '#080808');
    context.fillStyle = groupGradient;
    context.fillRect(groupRect.x, groupRect.y, groupRect.width, groupRect.height);

    context.lineWidth = 2;
    context.strokeStyle = '#000000';
    context.strokeRect(
      groupRect.x + 1,
      groupRect.y + 1,
      Math.max(0, groupRect.width - 2),
      Math.max(0, groupRect.height - 2)
    );

    if (groupRect.showHeader) {
      context.fillStyle = 'rgba(0, 0, 0, 0.3)';
      context.fillRect(groupRect.x + 1, groupRect.y + 1, Math.max(0, groupRect.width - 2), 22);
      context.font = '700 12px "Avenir Next", "Inter", sans-serif';
      context.fillStyle = '#f4f4f4';
      context.textBaseline = 'top';
      const name = trimCanvasText(context, groupRect.group.name, Math.max(20, groupRect.width - 88));
      context.fillText(name, groupRect.x + 8, groupRect.y + 5);

      context.font = '600 10px "Avenir Next", "Inter", sans-serif';
      context.fillStyle = '#9f9f9f';
      const meta = trimCanvasText(
        context,
        `${formatBytes(groupRect.group.size)} / ${groupRect.fileCount}`,
        Math.max(20, groupRect.width - 16)
      );
      context.fillText(meta, groupRect.x + Math.max(8, groupRect.width - context.measureText(meta).width - 8), groupRect.y + 6);
    }
  }

  for (const rect of layout.rects) {
    const color = tileColor(rect.entry);
    const gradient = context.createLinearGradient(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    gradient.addColorStop(0, mixColor(color, '#ffffff', 0.18));
    gradient.addColorStop(0.55, color);
    gradient.addColorStop(1, mixColor(color, '#000000', 0.22));
    context.fillStyle = gradient;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (rect.width >= 9 && rect.height >= 9) {
      const highlightHeight = Math.max(1, Math.floor(rect.height * 0.22));
      context.fillStyle = 'rgba(255, 255, 255, 0.08)';
      context.fillRect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), highlightHeight);
      context.fillStyle = 'rgba(0, 0, 0, 0.1)';
      context.fillRect(rect.x + 1, rect.y + rect.height - highlightHeight - 1, Math.max(0, rect.width - 2), highlightHeight);
    }

    context.lineWidth = 0.65;
    context.strokeStyle = '#000000';
    context.strokeRect(rect.x + 0.25, rect.y + 0.25, Math.max(0, rect.width - 0.5), Math.max(0, rect.height - 0.5));
  }
}

function describeTreemapRect(rect) {
  return [
    rect.entry.path,
    rect.entry.extension || '',
    rect.group?.name,
    formatBytes(rect.entry.size)
  ].filter(Boolean).join(' - ');
}

function eventPointInCanvas(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Number.parseFloat(canvas.style.width) || bounds.width || 1;
  const cssHeight = Number.parseFloat(canvas.style.height) || bounds.height || 1;
  const scaleX = bounds.width > 0 ? cssWidth / bounds.width : 1;
  const scaleY = bounds.height > 0 ? cssHeight / bounds.height : 1;

  return {
    x: (event.clientX - bounds.left) * scaleX,
    y: (event.clientY - bounds.top) * scaleY
  };
}

function comparablePath(pathValue) {
  const value = String(pathValue || '').trim();
  if (!value || value === '/') {
    return value;
  }

  return value.replace(/\/+$/, '') || '/';
}

function isCurrentRootScanned() {
  return Boolean(
    state.scan?.rootPath &&
    comparablePath(elements.rootInput.value) === comparablePath(state.scan.rootPath)
  );
}

function shouldPromptForFullDiskAccess(rootPath) {
  return state.platform === 'darwin' && comparablePath(rootPath) === '/';
}

function updateScanButtonLabel() {
  const isRescan = isCurrentRootScanned();
  setButtonContent(elements.scanButton, isRescan ? 'refresh' : 'scan', isRescan ? 'Rescan' : 'Scan');
  elements.scanButton.classList.toggle('is-rescan', isRescan);
  elements.scanButton.setAttribute('aria-label', isRescan ? `Rescan ${state.scan.rootPath}` : 'Scan root path');
}

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

function renderDiskSpace(diskSpace, options = {}) {
  if (options.loading) {
    elements.diskSpaceMount.textContent = 'Loading';
    elements.diskTotalSpace.textContent = '--';
    elements.diskUsedSpace.textContent = '--';
    elements.diskFreeSpace.textContent = '--';
    elements.diskUsedBar.style.width = '0%';
    return;
  }

  if (!diskSpace) {
    elements.diskSpaceMount.textContent = 'Unavailable';
    elements.diskSpaceMount.title = options.error || '';
    elements.diskTotalSpace.textContent = '--';
    elements.diskUsedSpace.textContent = '--';
    elements.diskFreeSpace.textContent = '--';
    elements.diskUsedBar.style.width = '0%';
    return;
  }

  const usedPercent = Math.min(100, Math.max(0, Number(diskSpace.usedPercent || 0)));
  elements.diskSpaceMount.textContent = diskSpace.mountPath || diskSpace.path || 'Drive';
  elements.diskSpaceMount.title = diskSpace.mountPath || diskSpace.path || '';
  elements.diskTotalSpace.textContent = formatBytes(diskSpace.totalBytes || 0);
  elements.diskUsedSpace.textContent = formatBytes(diskSpace.usedBytes || 0);
  elements.diskFreeSpace.textContent = formatBytes(diskSpace.freeBytes || 0);
  elements.diskUsedBar.style.width = `${usedPercent}%`;
}

async function loadDiskSpace(rootPath) {
  if (!state.token) {
    return;
  }

  const requestId = ++diskSpaceRequestId;
  const pathValue = rootPath || '/';
  renderDiskSpace(null, { loading: true });

  try {
    const { diskSpace } = await api(`/api/disk-space?path=${encodeURIComponent(pathValue)}`);
    if (requestId === diskSpaceRequestId) {
      renderDiskSpace(diskSpace);
    }
  } catch (error) {
    if (requestId === diskSpaceRequestId) {
      renderDiskSpace(null, { error: error.message });
    }
  }
}

function scheduleDiskSpaceLoad(delay = 350) {
  clearTimeout(diskSpaceTimer);
  diskSpaceTimer = setTimeout(() => {
    loadDiskSpace(elements.rootInput.value.trim() || '/');
  }, delay);
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
  const allTopContentsSelected = areTopFolderContentsSelected();

  elements.totalSize.textContent = formatBytes(scan?.totalSize || 0);
  elements.entryCount.textContent = String(scan?.entryCount || 0);
  elements.selectedSummary.textContent = `${selection.itemCount} / ${formatBytes(selection.totalSize)}`;
  elements.cleanupButton.disabled = selection.itemCount === 0;
  elements.selectContentsButton.disabled = !scan || Number(scan.root?.childCount || 0) === 0 || state.selectingContents;
  const selectButtonLabel = state.selectingContents
    ? allTopContentsSelected ? 'Unselecting' : 'Selecting'
    : allTopContentsSelected ? 'Unselect All' : 'Select All';
  setButtonContent(
    elements.selectContentsButton,
    allTopContentsSelected ? 'unselectAll' : 'selectAll',
    selectButtonLabel
  );
  updateScanButtonLabel();
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
    ? `${files.length} of ${state.tileTotal} file${state.tileTotal === 1 ? '' : 's'}, grouped by folder`
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
  const cellSize = Number.parseFloat(styles.getPropertyValue('--tile-cell-size')) || 6;
  const layout = folderMosaicLayout(files, state.scan?.rootPath || '/', bounds.width, bounds.height, {
    cellSize,
    headerHeight: 22,
    maxGroups: 18,
    padding: 4
  });
  const hitGrid = createMosaicHitGrid(layout);
  const canvas = document.createElement('canvas');
  canvas.className = 'treemap-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${files.length} file squares grouped across ${layout.groups.length} folders`);
  canvas.tabIndex = 0;

  const hover = document.createElement('div');
  hover.className = 'treemap-hover';
  hover.hidden = true;

  const tooltip = document.createElement('div');
  tooltip.className = 'treemap-tooltip';
  tooltip.hidden = true;

  drawTreemapCanvas(canvas, layout);

  let hoveredRect = null;
  const setHoveredRect = (rect, point = null) => {
    if (hoveredRect === rect) {
      if (rect && point) {
        tooltip.style.left = `${Math.min(layout.width - 16, point.x + 12)}px`;
        tooltip.style.top = `${Math.min(layout.height - 16, point.y + 12)}px`;
      }
      return;
    }

    hoveredRect = rect;
    if (!rect) {
      hover.hidden = true;
      tooltip.hidden = true;
      canvas.removeAttribute('title');
      return;
    }

    hover.hidden = false;
    hover.style.left = `${rect.x}px`;
    hover.style.top = `${rect.y}px`;
    hover.style.width = `${rect.width}px`;
    hover.style.height = `${rect.height}px`;
    canvas.title = describeTreemapRect(rect);
    tooltip.hidden = false;
    tooltip.textContent = `${rect.entry.name || rect.entry.path} / ${formatBytes(rect.entry.size)} / ${rect.group?.name || ''}`;
    if (point) {
      tooltip.style.left = `${Math.min(layout.width - 16, point.x + 12)}px`;
      tooltip.style.top = `${Math.min(layout.height - 16, point.y + 12)}px`;
    }
  };

  canvas.addEventListener('pointermove', (event) => {
    const point = eventPointInCanvas(event, canvas);
    setHoveredRect(mosaicHitTest(layout, hitGrid, point.x, point.y), point);
  });
  canvas.addEventListener('pointerleave', () => setHoveredRect(null));
  canvas.addEventListener('click', (event) => {
    const point = eventPointInCanvas(event, canvas);
    const rect = mosaicHitTest(layout, hitGrid, point.x, point.y);
    if (rect) {
      focusEntry(rect.entry);
    }
  });
  canvas.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && hoveredRect) {
      event.preventDefault();
      focusEntry(hoveredRect.entry);
    }
  });

  elements.treemap.append(canvas, hover, tooltip);
}

function focusEntry(entry) {
  elements.focusedPath.textContent = entry.path;
  elements.focusedPath.title = entry.path;
}

function isDescendantPath(parentPath, candidatePath) {
  if (!parentPath || !candidatePath || parentPath === candidatePath) {
    return false;
  }

  const normalizedParent = parentPath.endsWith('/') ? parentPath : `${parentPath}/`;
  return candidatePath.startsWith(normalizedParent);
}

function selectedAncestorPath(entryPath) {
  for (const selectedPath of state.selectedPaths) {
    if (isDescendantPath(selectedPath, entryPath)) {
      return selectedPath;
    }
  }

  return null;
}

function removeSelectedDescendants(parentPath) {
  for (const selectedPath of [...state.selectedPaths]) {
    if (isDescendantPath(parentPath, selectedPath)) {
      state.selectedPaths.delete(selectedPath);
      state.selectedEntries.delete(selectedPath);
    }
  }
}

function removeSelectedBranch(entryPath) {
  for (const selectedPath of [...state.selectedPaths]) {
    if (selectedPath === entryPath || isDescendantPath(entryPath, selectedPath)) {
      state.selectedPaths.delete(selectedPath);
      state.selectedEntries.delete(selectedPath);
    }
  }
}

function selectEntryBranch(entry) {
  removeSelectedDescendants(entry.path);
  state.selectedPaths.add(entry.path);
  state.selectedEntries.set(entry.path, entry);
}

function selectionStateForEntry(entry) {
  const isDirect = state.selectedPaths.has(entry.path);
  const inheritedFrom = selectedAncestorPath(entry.path);

  return {
    isDirect,
    inheritedFrom,
    isSelected: isDirect || Boolean(inheritedFrom)
  };
}

function isDirectChildPath(parentPath, candidatePath) {
  if (!parentPath || !candidatePath || parentPath === candidatePath) {
    return false;
  }

  const normalizedParent = parentPath === '/' ? '/' : `${parentPath.replace(/\/+$/, '')}/`;
  if (!candidatePath.startsWith(normalizedParent)) {
    return false;
  }

  const remainder = candidatePath.slice(normalizedParent.length);
  return Boolean(remainder) && !remainder.includes('/');
}

function areTopFolderContentsSelected() {
  const rootPath = state.scan?.rootPath;
  const rootChildCount = Number(state.scan?.root?.childCount || 0);
  if (!rootPath || rootChildCount === 0) {
    return false;
  }

  let selectedTopChildCount = 0;
  for (const selectedPath of state.selectedPaths) {
    if (isDirectChildPath(rootPath, selectedPath)) {
      selectedTopChildCount += 1;
    }
  }

  return selectedTopChildCount >= rootChildCount;
}

function unselectTopFolderContents() {
  const rootPath = state.scan?.rootPath;
  if (!rootPath) {
    return 0;
  }

  let removed = 0;
  for (const selectedPath of [...state.selectedPaths]) {
    if (isDescendantPath(rootPath, selectedPath)) {
      state.selectedPaths.delete(selectedPath);
      state.selectedEntries.delete(selectedPath);
      removed += 1;
    }
  }

  return removed;
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

async function fetchAllChildren(parentPath) {
  const entries = [];
  let total = 0;

  do {
    const page = await fetchChildren(parentPath, {
      offset: entries.length,
      limit: TABLE_PAGE_LIMIT
    });
    total = page.total;
    entries.push(...page.entries);
  } while (entries.length < total);

  return entries;
}

async function selectTopFolderContents() {
  if (!state.scan?.root?.path || state.selectingContents) {
    return;
  }

  const shouldUnselect = areTopFolderContentsSelected();
  state.selectingContents = true;
  renderMetrics();
  setStatus(shouldUnselect ? 'Unselecting folder contents' : 'Selecting folder contents');

  try {
    if (shouldUnselect) {
      const removed = unselectTopFolderContents();
      renderRows();
      setStatus(`Unselected ${removed} item${removed === 1 ? '' : 's'}`);
      return;
    }

    const entries = await fetchAllChildren(state.scan.root.path);
    for (const entry of entries) {
      if (entry.path !== state.scan.rootPath) {
        selectEntryBranch(entry);
      }
    }

    renderRows();
    setStatus(`Selected ${entries.length} item${entries.length === 1 ? '' : 's'} from the top folder`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    state.selectingContents = false;
    renderMetrics();
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

  button.disabled = true;
  button.classList.add('is-opening');
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
    button.classList.remove('is-opening');
  }
}

async function openFullDiskAccessSettings() {
  if (elements.fullDiskAccessButton) {
    elements.fullDiskAccessButton.disabled = true;
  }
  if (elements.openFullAccessFromDialogButton) {
    elements.openFullAccessFromDialogButton.disabled = true;
  }
  setStatus('Opening Full Disk Access settings');

  try {
    await api('/api/full-disk-access-settings', {
      method: 'POST',
      body: JSON.stringify({})
    });
    setStatus('Full Disk Access settings opened');
  } catch (error) {
    setStatus(error.message);
  } finally {
    if (elements.fullDiskAccessButton) {
      elements.fullDiskAccessButton.disabled = false;
    }
    if (elements.openFullAccessFromDialogButton) {
      elements.openFullAccessFromDialogButton.disabled = false;
    }
  }
}

function visibleEntries() {
  if (!state.scan) {
    return [];
  }

  return buildVisibleTreeRows();
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
  elements.entryHeading.textContent = 'File Structure';
  renderSortControls();
  const rows = visibleEntries();
  const fragment = document.createDocumentFragment();
  const visibleEntryCount = rows.filter((row) => row.kind === 'entry').length;
  const rowLabel = `entr${visibleEntryCount === 1 ? 'y' : 'ies'}`;
  elements.entrySubheading.textContent = state.scan
    ? `${visibleEntryCount} of ${state.entryTotal} ${rowLabel}`
    : '';

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
      fragment.append(row);
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
    const entrySelection = selectionStateForEntry(entry);
    if (entrySelection.isSelected) {
      row.classList.add('is-selected');
    }
    if (entrySelection.inheritedFrom) {
      row.classList.add('is-inherited-selection');
    }

    const checkCell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = entrySelection.isSelected;
    input.disabled = entry.path === state.scan?.rootPath || Boolean(entrySelection.inheritedFrom);
    if (entrySelection.inheritedFrom) {
      input.title = 'Selected by parent folder';
    }
    input.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    input.addEventListener('change', () => {
      if (input.checked) {
        selectEntryBranch(entry);
      } else {
        removeSelectedBranch(entry.path);
      }
      renderRows();
      renderMetrics();
    });
    checkCell.append(input);

    const nameCell = document.createElement('td');
    nameCell.className = 'name-cell tree-name-cell';
    const name = document.createElement('div');
    name.className = 'entry-name is-tree-name';
    if (entry.depth > 0) {
      name.classList.add('has-parent');
    }
    const treeIndent = Math.min(Math.max(0, entry.depth), 12) * 18;
    name.style.paddingLeft = `${treeIndent}px`;
    name.style.setProperty('--tree-indent', `${treeIndent}px`);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tree-toggle';
    toggle.disabled = !canExpandEntry(entry);
    if (canExpandEntry(entry)) {
      toggle.append(createUiIcon(entry.isExpanded ? 'chevronDown' : 'chevronRight', 'tree-chevron'));
    }
    toggle.setAttribute('aria-label', `${entry.isExpanded ? 'Collapse' : 'Expand'} ${entry.name || entry.path}`);
    toggle.setAttribute('aria-expanded', String(Boolean(entry.isExpanded)));
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      handleTreeToggle(entry);
    });

    const itemIconName = iconNameForEntry(entry);
    const itemIcon = createUiIcon(itemIconName, `tree-icon tree-icon-${itemIconName}`);
    itemIcon.style.setProperty('--tree-icon-color', extensionColor(entry));

    const nameText = document.createElement('span');
    nameText.className = 'entry-name-text';
    nameText.textContent = entry.name || entry.path;
    name.append(toggle, itemIcon, nameText);

    const entryPath = document.createElement('div');
    entryPath.className = 'entry-path';
    entryPath.textContent = entry.path;
    nameCell.append(name, entryPath);
    nameCell.addEventListener('click', () => {
      if (canExpandEntry(entry)) {
        handleTreeToggle(entry);
        return;
      }
      focusEntry(entry);
    });

    const percentCell = document.createElement('td');
    percentCell.className = 'percent-cell';
    percentCell.title = 'Percent of the current folder';
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
    actionCell.className = 'action-cell';
    const finderButton = document.createElement('button');
    finderButton.type = 'button';
    finderButton.className = 'finder-button';
    finderButton.title = 'Open in Finder';
    finderButton.setAttribute('aria-label', `Open ${entry.name || entry.path} in Finder`);
    finderButton.append(createFinderIcon('finder-icon'));
    finderButton.addEventListener('click', () => openInFinder(entry, finderButton));
    actionCell.append(finderButton);

    row.append(checkCell, nameCell, percentCell, typeCell, sizeCell, actionCell);
    fragment.append(row);
  }

  elements.entryRows.replaceChildren(fragment);
}

function renderAll() {
  const startedAt = performance.now();
  logClientEvent('render.start', {
    scanId: state.scan?.id,
    entryCount: state.scan?.entryCount,
    totalSize: state.scan?.totalSize,
    errorCount: state.scan?.errorCount,
    visibleEntries: visibleEntries().filter((row) => row.kind === 'entry').length,
    visibleTiles: state.tileEntries.length
  });
  renderMetrics();
  renderTreemap();
  renderRows();
  renderErrors();
  logClientEvent('render.complete', {
    scanId: state.scan?.id,
    entries: visibleEntries().filter((row) => row.kind === 'entry').length,
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

async function loadEntries() {
  if (!state.scan) {
    state.entryTotal = 0;
    return;
  }

  state.loadingEntries = true;
  state.entryTotal = state.scan.entryCount || 0;

  try {
    if (!state.expandedPaths.has(state.scan.root.path)) {
      state.expandedPaths.add(state.scan.root.path);
    }

    if (!state.treeChildren.has(state.scan.root.path)) {
      await loadTreeChildren(state.scan.root.path, { render: false });
    }
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

async function runScan(options = {}) {
  const rootPath = elements.rootInput.value.trim();
  if (!rootPath) {
    setStatus('Enter a root path');
    return;
  }

  if (!options.skipFullDiskAccessPrompt && shouldPromptForFullDiskAccess(rootPath)) {
    elements.fullAccessDialog.showModal();
    return;
  }

  elements.scanButton.disabled = true;
  setButtonContent(elements.scanButton, 'scanning', 'Scanning');
  elements.scanButton.classList.remove('is-rescan');
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
    loadDiskSpace(scan.rootPath).catch(() => {});
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.scanButton.disabled = false;
    updateScanButtonLabel();
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
    loadDiskSpace(state.scan.rootPath).catch(() => {});
    setStatus(operation.failed.length > 0 ? 'Cleanup completed with failures' : 'Cleanup completed');
  } catch (error) {
    setStatus(error.message);
  } finally {
    renderMetrics();
  }
}

async function initialize() {
  setButtonContent(elements.cleanupButton, 'trash', 'Move to Trash');
  setButtonContent(elements.confirmCleanupButton, 'trash', 'Move to Trash');
  setButtonContent(elements.openFullAccessFromDialogButton, 'root', 'Open Settings');
  setButtonContent(elements.scanAnywayButton, 'scan', 'Scan Anyway');

  try {
    const session = await api('/api/session');
    state.token = session.token;
    state.platform = session.platform || 'unknown';
    elements.rootInput.value = session.suggestedRoots[0]?.path || '/';
    loadDiskSpace(elements.rootInput.value).catch(() => {});

    for (const root of session.suggestedRoots) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = root.label;
      button.addEventListener('click', () => {
        elements.rootInput.value = root.path;
        updateScanButtonLabel();
        scheduleDiskSpaceLoad(0);
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
elements.rootInput.addEventListener('input', () => {
  updateScanButtonLabel();
  scheduleDiskSpaceLoad();
});
elements.selectContentsButton.addEventListener('click', () => {
  selectTopFolderContents();
});
elements.cleanupButton.addEventListener('click', openCleanupDialog);
elements.fullDiskAccessButton.addEventListener('click', () => {
  openFullDiskAccessSettings();
});
elements.confirmDialog.addEventListener('close', () => {
  if (elements.confirmDialog.returnValue === 'confirm') {
    runCleanup();
  }
});
elements.fullAccessDialog.addEventListener('close', () => {
  if (elements.fullAccessDialog.returnValue === 'open-settings') {
    openFullDiskAccessSettings();
    return;
  }

  if (elements.fullAccessDialog.returnValue === 'scan-anyway') {
    runScan({ skipFullDiskAccessPrompt: true });
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
    resetTreeState();
    renderSortControls();
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

window.addEventListener('resize', () => {
  if (!state.scan || state.tileEntries.length === 0) {
    return;
  }

  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(renderTreemap);
});

initialize();

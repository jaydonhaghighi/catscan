import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { assertNotScanRoot, assertPathInside, isPathInside, normalizePath } from './security.js';

function entryId(scanId, entryPath) {
  return crypto
    .createHash('sha1')
    .update(`${scanId}:${entryPath}`)
    .digest('hex')
    .slice(0, 16);
}

function sizeFromStats(stats) {
  return Number(stats.size || 0);
}

function typeFromStats(stats) {
  if (stats.isSymbolicLink()) {
    return 'symlink';
  }
  if (stats.isDirectory()) {
    return 'directory';
  }
  if (stats.isFile()) {
    return 'file';
  }
  return 'other';
}

function createScanError(entryPath, error) {
  return {
    path: entryPath,
    code: error.code || 'SCAN_ERROR',
    message: error.code === 'EACCES' || error.code === 'EPERM'
      ? 'Permission denied'
      : error.message
  };
}

function sortChildren(children) {
  children.sort((a, b) => {
    if (b.size !== a.size) {
      return b.size - a.size;
    }
    return a.name.localeCompare(b.name);
  });
}

function indexEntries(entry, map = new Map()) {
  map.set(entry.path, entry);
  for (const child of entry.children || []) {
    indexEntries(child, map);
  }
  return map;
}

function collectErrors(entry, output = []) {
  output.push(...(entry.errors || []));
  for (const child of entry.children || []) {
    collectErrors(child, output);
  }
  return output;
}

function createProgress(scanId, rootPath) {
  const now = new Date().toISOString();
  return {
    scanId,
    rootPath,
    status: 'running',
    phase: 'Scanning',
    entriesScanned: 0,
    filesScanned: 0,
    directoriesScanned: 0,
    errors: 0,
    bytesScanned: 0,
    currentPath: rootPath,
    startedAt: now,
    updatedAt: now
  };
}

function updateProgressForEntry(progress, entryPath, type, size) {
  progress.entriesScanned += 1;
  progress.currentPath = entryPath;
  progress.updatedAt = new Date().toISOString();

  if (type === 'file') {
    progress.filesScanned += 1;
    progress.bytesScanned += size;
  } else if (type === 'directory') {
    progress.directoriesScanned += 1;
  } else {
    progress.bytesScanned += size;
  }
}

function updateProgressForError(progress, entryPath) {
  progress.errors += 1;
  progress.currentPath = entryPath;
  progress.updatedAt = new Date().toISOString();
}

async function scanEntry(entryPath, scanId, progress, reportProgress) {
  let stats;

  try {
    stats = await fs.lstat(entryPath);
  } catch (error) {
    updateProgressForError(progress, entryPath);
    reportProgress();
    return {
      entry: null,
      errors: [createScanError(entryPath, error)]
    };
  }

  const type = typeFromStats(stats);
  const ownSize = type === 'directory' ? 0 : sizeFromStats(stats);
  updateProgressForEntry(progress, entryPath, type, ownSize);
  reportProgress();

  const entry = {
    id: entryId(scanId, entryPath),
    path: entryPath,
    name: path.basename(entryPath) || entryPath,
    type,
    size: ownSize,
    ownSize,
    childCount: 0,
    children: [],
    partial: false,
    errors: []
  };

  if (type !== 'directory') {
    return { entry, errors: [] };
  }

  let dirents;
  try {
    dirents = await fs.readdir(entryPath, { withFileTypes: true });
  } catch (error) {
    const scanError = createScanError(entryPath, error);
    updateProgressForError(progress, entryPath);
    reportProgress();
    entry.partial = true;
    entry.errors.push(scanError);
    return { entry, errors: [scanError] };
  }

  const allErrors = [];

  for (const dirent of dirents) {
    const childPath = path.join(entryPath, dirent.name);
    const childResult = await scanEntry(childPath, scanId, progress, reportProgress);

    if (childResult.entry) {
      entry.children.push(childResult.entry);
      entry.size += childResult.entry.size;
    }

    if (childResult.errors.length > 0) {
      entry.partial = true;
      allErrors.push(...childResult.errors);
    }
  }

  entry.childCount = entry.children.length;
  sortChildren(entry.children);

  return { entry, errors: allErrors };
}

export async function scanDirectory(rootPath, options = {}) {
  const absoluteRoot = normalizePath(rootPath);
  const rootStats = await fs.lstat(absoluteRoot);

  if (!rootStats.isDirectory()) {
    const error = new Error('Scan root must be a directory.');
    error.statusCode = 400;
    throw error;
  }

  const scanId = options.scanId || crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const progress = createProgress(scanId, absoluteRoot);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  let lastReportedAt = 0;
  const reportProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReportedAt < 100) {
      return;
    }

    lastReportedAt = now;
    onProgress({ ...progress });
  };

  reportProgress(true);
  const result = await scanEntry(absoluteRoot, scanId, progress, reportProgress);
  const root = result.entry;
  progress.phase = 'Collecting scan errors';
  progress.updatedAt = new Date().toISOString();
  reportProgress(true);
  const errors = collectErrors(root);
  progress.phase = 'Indexing scan results';
  progress.updatedAt = new Date().toISOString();
  reportProgress(true);
  const entryCount = indexEntries(root).size;
  const completedAt = new Date().toISOString();
  progress.status = errors.length > 0 ? 'partial' : 'completed';
  progress.phase = errors.length > 0 ? 'Completed with partial results' : 'Completed';
  progress.updatedAt = completedAt;
  reportProgress(true);

  return {
    id: scanId,
    rootPath: absoluteRoot,
    status: errors.length > 0 ? 'partial' : 'completed',
    startedAt,
    completedAt,
    totalSize: root.size,
    entryCount,
    errorCount: errors.length,
    root,
    errors
  };
}

export function createEntryMap(scan) {
  return indexEntries(scan.root);
}

export function findEntryByPath(scan, entryPath) {
  const targetPath = normalizePath(entryPath);
  const stack = [scan.root];

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry.path === targetPath) {
      return entry;
    }

    for (let index = (entry.children || []).length - 1; index >= 0; index -= 1) {
      stack.push(entry.children[index]);
    }
  }

  return null;
}

function collapseDescendantPaths(paths) {
  const collapsed = [];

  for (const candidate of [...paths].sort((a, b) => a.length - b.length)) {
    const isCoveredByParent = collapsed.some(
      (parent) => parent !== candidate && isPathInside(parent, candidate)
    );

    if (!isCoveredByParent) {
      collapsed.push(candidate);
    }
  }

  return collapsed;
}

export function validateCleanupPaths(scan, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    const error = new Error('Select at least one item to clean up.');
    error.statusCode = 400;
    throw error;
  }

  const entryMap = createEntryMap(scan);
  const uniquePaths = [...new Set(paths.map((candidate) => normalizePath(candidate)))];

  for (const candidate of uniquePaths) {
    assertPathInside(scan.rootPath, candidate);
    assertNotScanRoot(scan.rootPath, candidate);

    if (!entryMap.has(candidate)) {
      const error = new Error(`Path was not found in the active scan: ${candidate}`);
      error.statusCode = 409;
      throw error;
    }
  }

  return collapseDescendantPaths(uniquePaths);
}

function recalculateEntry(entry) {
  if (entry.type !== 'directory') {
    return entry.size;
  }

  entry.childCount = entry.children.length;
  entry.size = entry.ownSize + entry.children.reduce((total, child) => total + recalculateEntry(child), 0);
  sortChildren(entry.children);
  return entry.size;
}

function pruneMovedEntries(entry, movedPathSet) {
  if (!entry.children || entry.children.length === 0) {
    return;
  }

  entry.children = entry.children.filter((child) => !movedPathSet.has(child.path));

  for (const child of entry.children) {
    pruneMovedEntries(child, movedPathSet);
  }
}

export function applyCleanupToScan(scan, movedPaths) {
  const movedPathSet = new Set(movedPaths.map((candidate) => normalizePath(candidate)));
  pruneMovedEntries(scan.root, movedPathSet);
  scan.totalSize = recalculateEntry(scan.root);
  scan.entryCount = createEntryMap(scan).size;
  scan.completedAt = new Date().toISOString();
  return scan;
}

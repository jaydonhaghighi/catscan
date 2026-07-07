import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { applyCleanupToScan, createEntryMap, findEntryByPath, scanDirectory, validateCleanupPaths } from './scanner.js';
import { assertLocalMutationRequest, assertPathInside, normalizePath } from './security.js';
import { movePathsToTrash } from './trash.js';
import { revealPathInFinder } from './finder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_DIR = path.resolve(__dirname, '../public');
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml']
]);
const DEFAULT_SCAN_LOG_INTERVAL_MS = 5_000;
const DEFAULT_SCAN_LOG_ENTRY_INTERVAL = 100_000;
const DEFAULT_ENTRY_PAGE_LIMIT = 500;
const MAX_ENTRY_PAGE_LIMIT = 5_000;
const execFileAsync = promisify(execFile);

function memorySummary() {
  const usage = process.memoryUsage();
  return {
    rssMb: Math.round(usage.rss / 1024 / 1024),
    heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024)
  };
}

function logEvent(logger, level, event, fields = {}) {
  if (!logger) {
    return;
  }

  const write = typeof logger[level] === 'function'
    ? logger[level].bind(logger)
    : typeof logger.log === 'function'
      ? logger.log.bind(logger)
      : null;

  if (!write) {
    return;
  }

  write(JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...fields
  }));
}

function extensionForEntry(entry) {
  if (!entry) {
    return '[none]';
  }

  if (entry.type === 'directory') {
    return '[folder]';
  }

  const extension = path.extname(entry.name || entry.path || '').toLowerCase();
  return extension || '[none]';
}

function entrySummary(entry, depth = 0, parentSize = 0, rootSize = 0) {
  if (!entry) {
    return null;
  }

  const size = Number(entry.size || 0);
  const parentTotal = Number(parentSize || 0);
  const rootTotal = Number(rootSize || 0);

  return {
    id: entry.id,
    path: entry.path,
    name: entry.name,
    type: entry.type,
    extension: extensionForEntry(entry),
    size,
    ownSize: entry.ownSize,
    childCount: entry.childCount,
    partial: entry.partial,
    percentOfParent: parentTotal > 0 ? (size / parentTotal) * 100 : 0,
    percentOfTotal: rootTotal > 0 ? (size / rootTotal) * 100 : 0,
    depth
  };
}

function scanSummary(scan, progress) {
  if (!scan) {
    return {};
  }

  return {
    id: scan.id,
    scanId: scan.id,
    rootPath: scan.rootPath,
    status: scan.status,
    totalSize: scan.totalSize,
    entryCount: scan.entryCount,
    errorCount: scan.errorCount,
    duplicatesSkipped: scan.duplicatesSkipped || progress?.duplicatesSkipped || 0,
    fileCount: progress?.filesScanned,
    directoryCount: progress?.directoriesScanned,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt,
    root: entrySummary(scan.root, 0, scan.root?.size, scan.root?.size),
    errors: (scan.errors || []).slice(0, 1_000),
    errorsTruncated: (scan.errors || []).length > 1_000
  };
}

function scanLogSummary(scan) {
  if (!scan) {
    return {};
  }

  return {
    scanId: scan.id || scan.scanId,
    rootPath: scan.rootPath,
    status: scan.status,
    totalSize: scan.totalSize,
    entryCount: scan.entryCount,
    errorCount: scan.errorCount,
    duplicatesSkipped: scan.duplicatesSkipped || 0,
    startedAt: scan.startedAt,
    completedAt: scan.completedAt
  };
}

function normalizeEntrySortKey(sortKey) {
  return ['name', 'type', 'size', 'percentOfParent'].includes(sortKey) ? sortKey : 'size';
}

function compareEntries(left, right, sortKey = 'size', direction = 'desc') {
  const normalizedSortKey = normalizeEntrySortKey(sortKey);
  const multiplier = direction === 'asc' ? 1 : -1;

  if (normalizedSortKey === 'name' || normalizedSortKey === 'type') {
    const compared = String(left[normalizedSortKey] || '').localeCompare(String(right[normalizedSortKey] || ''));
    if (compared !== 0) {
      return multiplier * compared;
    }
  } else {
    const compared = Number(left[normalizedSortKey] || 0) - Number(right[normalizedSortKey] || 0);
    if (compared !== 0) {
      return multiplier * compared;
    }
  }

  return left.path.localeCompare(right.path);
}

class WorstEntryHeap {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  replaceRoot(item) {
    this.items[0] = item;
    this.bubbleDown(0);
  }

  isWorse(left, right) {
    return this.compare(left, right) > 0;
  }

  bubbleUp(index) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (!this.isWorse(this.items[current], this.items[parent])) {
        break;
      }
      [this.items[current], this.items[parent]] = [this.items[parent], this.items[current]];
      current = parent;
    }
  }

  bubbleDown(index) {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = left + 1;
      let worst = current;

      if (left < this.items.length && this.isWorse(this.items[left], this.items[worst])) {
        worst = left;
      }
      if (right < this.items.length && this.isWorse(this.items[right], this.items[worst])) {
        worst = right;
      }
      if (worst === current) {
        break;
      }

      [this.items[current], this.items[worst]] = [this.items[worst], this.items[current]];
      current = worst;
    }
  }
}

function scanEntriesPage(scan, options = {}) {
  const mode = ['all', 'tree'].includes(options.mode) ? options.mode : 'files';
  const sortKey = normalizeEntrySortKey(options.sortKey);
  const direction = options.direction === 'asc' ? 'asc' : 'desc';
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(
    MAX_ENTRY_PAGE_LIMIT,
    Math.max(1, Number(options.limit) || DEFAULT_ENTRY_PAGE_LIMIT)
  );
  const requested = offset + limit;
  const compare = (left, right) => compareEntries(left, right, sortKey, direction);
  const rootSize = Number(scan.root?.size || scan.totalSize || 0);

  if (mode === 'tree') {
    const entries = [];
    const stack = [{ entry: scan.root, depth: 0, parentSize: rootSize }];
    let seen = 0;

    while (stack.length > 0 && entries.length < limit) {
      const { entry, depth, parentSize } = stack.pop();

      if (entry.path !== scan.rootPath) {
        if (seen >= offset) {
          entries.push(entrySummary(entry, depth, parentSize, rootSize));
        }
        seen += 1;
      }

      const childSortKey = sortKey === 'percentOfParent' ? 'size' : sortKey;
      const childCompare = (left, right) => compareEntries(left, right, childSortKey, direction);
      const children = childSortKey === 'size' && direction === 'desc'
        ? (entry.children || [])
        : [...(entry.children || [])].sort(childCompare);

      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({
          entry: children[index],
          depth: depth + 1,
          parentSize: Number(entry.size || 0)
        });
      }
    }

    return {
      mode,
      sortKey,
      direction,
      offset,
      limit,
      total: Math.max(0, Number(scan.entryCount || 0) - 1),
      entries
    };
  }

  const heap = new WorstEntryHeap(compare);
  const stack = [{ entry: scan.root, depth: 0, parentSize: rootSize }];
  let total = 0;

  while (stack.length > 0) {
    const { entry, depth, parentSize } = stack.pop();
    const includeEntry = mode === 'all'
      ? entry.path !== scan.rootPath
      : entry.type === 'file';

    if (includeEntry) {
      total += 1;
      const summary = entrySummary(entry, depth, parentSize, rootSize);

      if (heap.size < requested) {
        heap.push(summary);
      } else if (compare(summary, heap.peek()) < 0) {
        heap.replaceRoot(summary);
      }
    }

    for (let index = (entry.children || []).length - 1; index >= 0; index -= 1) {
      stack.push({
        entry: entry.children[index],
        depth: depth + 1,
        parentSize: Number(entry.size || 0)
      });
    }
  }

  return {
    mode,
    sortKey,
    direction,
    offset,
    limit,
    total,
    entries: heap.items.sort(compare).slice(offset, offset + limit)
  };
}

function scanChildrenPage(scan, options = {}) {
  const sortKey = normalizeEntrySortKey(options.sortKey);
  const direction = options.direction === 'asc' ? 'asc' : 'desc';
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.min(
    MAX_ENTRY_PAGE_LIMIT,
    Math.max(1, Number(options.limit) || DEFAULT_ENTRY_PAGE_LIMIT)
  );
  const parentPath = normalizePath(options.path || scan.rootPath);
  assertPathInside(scan.rootPath, parentPath);

  const parent = findEntryByPath(scan, parentPath);
  if (!parent) {
    const error = new Error('Folder was not found in the active scan.');
    error.statusCode = 404;
    throw error;
  }

  const childSortKey = sortKey === 'percentOfParent' ? 'size' : sortKey;
  const compare = (left, right) => compareEntries(left, right, childSortKey, direction);
  const rootSize = Number(scan.root?.size || scan.totalSize || 0);
  const children = parent.type === 'directory'
    ? childSortKey === 'size' && direction === 'desc'
      ? (parent.children || [])
      : [...(parent.children || [])].sort(compare)
    : [];

  return {
    parentPath: parent.path,
    parent: entrySummary(parent, 0, Number(parent.size || 0), rootSize),
    sortKey,
    direction,
    offset,
    limit,
    total: children.length,
    entries: children
      .slice(offset, offset + limit)
      .map((entry) => entrySummary(entry, 0, Number(parent.size || 0), rootSize))
  };
}

function sendJson(response, statusCode, payload, options = {}) {
  const { logger, routeName } = options;
  const scan = payload?.scan || payload?.operation?.scan || null;
  const shouldLogSerialization = Boolean(scan);
  const startedAt = Date.now();

  if (shouldLogSerialization) {
    logEvent(logger, 'info', 'response.serialize.start', {
      routeName,
      statusCode,
      ...scanLogSummary(scan),
      ...memorySummary()
    });
  }

  let body;
  try {
    body = JSON.stringify(payload);
  } catch (error) {
    logEvent(logger, 'error', 'response.serialize.failed', {
      routeName,
      statusCode,
      message: error.message,
      code: error.code || 'SERIALIZE_FAILED',
      ...memorySummary()
    });
    throw error;
  }

  if (shouldLogSerialization) {
    logEvent(logger, 'info', 'response.serialize.complete', {
      routeName,
      statusCode,
      durationMs: Date.now() - startedAt,
      bytes: Buffer.byteLength(body),
      ...scanLogSummary(scan),
      ...memorySummary()
    });
  }

  if (response.writableEnded) {
    return;
  }

  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(body);
}

function sendError(response, error) {
  if (response.writableEnded) {
    return;
  }

  if (response.headersSent) {
    response.destroy(error);
    return;
  }

  const statusCode = error.statusCode || 500;
  sendJson(response, statusCode, {
    error: {
      message: statusCode === 500 ? 'Unexpected server error.' : error.message,
      code: error.code || 'REQUEST_FAILED'
    }
  });
}

function assertSessionToken(request, expectedToken) {
  if (request.headers['x-disk-viewer-token'] !== expectedToken) {
    const error = new Error('Missing or invalid session token.');
    error.statusCode = 403;
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > 1_000_000) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function suggestedRoots(homePath) {
  return [
    { label: 'Macintosh HD', path: '/' },
    { label: 'Home', path: homePath },
    { label: 'Downloads', path: path.join(homePath, 'Downloads') },
    { label: 'Desktop', path: path.join(homePath, 'Desktop') },
    { label: 'Documents', path: path.join(homePath, 'Documents') }
  ];
}

function parseDiskSpaceOutput(output, targetPath) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    const error = new Error('Disk space information was not available.');
    error.statusCode = 502;
    throw error;
  }

  const columns = lines[lines.length - 1].trim().split(/\s+/);
  if (columns.length < 6) {
    const error = new Error('Disk space information was not readable.');
    error.statusCode = 502;
    throw error;
  }

  const totalBytes = Number.parseInt(columns[1], 10) * 1024;
  const freeBytes = Number.parseInt(columns[3], 10) * 1024;
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) {
    const error = new Error('Disk space information was not readable.');
    error.statusCode = 502;
    throw error;
  }

  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    path: targetPath,
    filesystem: columns[0],
    mountPath: columns.slice(5).join(' '),
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0
  };
}

async function readDiskSpace(rootPath) {
  const targetPath = normalizePath(rootPath || '/');

  try {
    const { stdout } = await execFileAsync('df', ['-Pk', targetPath], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    return parseDiskSpaceOutput(stdout, targetPath);
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const diskError = new Error('Disk space is unavailable for that path.');
    diskError.statusCode = error.code === 'ENOENT' ? 400 : 502;
    diskError.code = error.code || 'DISK_SPACE_UNAVAILABLE';
    throw diskError;
  }
}

async function openFullDiskAccessSettings() {
  if (process.platform !== 'darwin') {
    const error = new Error('Full Disk Access settings are only available on macOS.');
    error.statusCode = 400;
    throw error;
  }

  const settingsUrl = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles';
  await execFileAsync('open', [settingsUrl], {
    timeout: 5_000,
    maxBuffer: 1024 * 1024
  });

  return {
    opened: true,
    settingsUrl
  };
}

async function serveStatic(request, response, staticDir) {
  const requestUrl = new URL(request.url, 'http://127.0.0.1');
  const rawPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  const filePath = path.resolve(staticDir, relativePath);
  const relative = path.relative(staticDir, filePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const contentType = MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream';
    response.writeHead(200, {
      'content-type': contentType,
      'cache-control': 'no-store'
    });
    response.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    throw error;
  }
}

export function createApp(options = {}) {
  const staticDir = options.staticDir || DEFAULT_STATIC_DIR;
  const sessionToken = options.sessionToken || crypto.randomBytes(24).toString('hex');
  const scans = new Map();
  const scanJobs = new Map();
  const homePath = options.homePath || os.homedir();
  const trashDir = options.trashDir;
  const scanDirectoryImpl = options.scanDirectoryImpl || scanDirectory;
  const revealPathImpl = options.revealPathImpl || revealPathInFinder;
  const diskSpaceImpl = options.diskSpaceImpl || readDiskSpace;
  const fullDiskAccessSettingsImpl = options.fullDiskAccessSettingsImpl || openFullDiskAccessSettings;
  const logger = options.logger === undefined ? console : options.logger;
  const scanLogIntervalMs = Number(options.scanLogIntervalMs || process.env.SCAN_LOG_INTERVAL_MS || DEFAULT_SCAN_LOG_INTERVAL_MS);
  const scanLogEntryInterval = Number(options.scanLogEntryInterval || process.env.SCAN_LOG_ENTRY_INTERVAL || DEFAULT_SCAN_LOG_ENTRY_INTERVAL);

  function scanJobPayload(job) {
    return {
      scanId: job.scanId,
      status: job.status,
      progress: job.progress,
      ...(job.error ? { error: job.error } : {}),
      ...(job.scan ? { scan: scanSummary(job.scan, job.progress) } : {})
    };
  }

  function runningScanJob() {
    for (const job of scanJobs.values()) {
      if (job.status === 'running') {
        return job;
      }
    }

    return null;
  }

  function clearFinishedScanState() {
    scans.clear();

    for (const [scanId, job] of scanJobs) {
      if (job.status !== 'running') {
        scanJobs.delete(scanId);
      }
    }
  }

  function startScanJob(rootPath) {
    const activeJob = runningScanJob();
    if (activeJob) {
      const error = new Error('A scan is already running. Wait for it to finish before starting another scan.');
      error.statusCode = 409;
      error.code = 'SCAN_ALREADY_RUNNING';
      throw error;
    }

    clearFinishedScanState();

    const scanId = crypto.randomUUID();
    const now = new Date().toISOString();
    const job = {
      scanId,
      status: 'running',
      startedAtMs: Date.now(),
      lastProgressLogAt: 0,
      lastLoggedEntries: 0,
      progress: {
        scanId,
        rootPath,
        status: 'running',
        phase: 'Queued',
        entriesScanned: 0,
        filesScanned: 0,
        directoriesScanned: 0,
        errors: 0,
        duplicatesSkipped: 0,
        bytesScanned: 0,
        currentPath: rootPath,
        startedAt: now,
        updatedAt: now
      },
      scan: null,
      error: null
    };

    scanJobs.set(scanId, job);
    logEvent(logger, 'info', 'scan.start', {
      scanId,
      rootPath,
      ...memorySummary()
    });

    queueMicrotask(async () => {
      try {
        const scan = await scanDirectoryImpl(rootPath, {
          scanId,
          onProgress: (progress) => {
            job.progress = progress;
            job.status = progress.status === 'running' ? 'running' : progress.status;

            const nowMs = Date.now();
            const entriesSinceLastLog = progress.entriesScanned - job.lastLoggedEntries;
            const shouldLogProgress = nowMs - job.lastProgressLogAt >= scanLogIntervalMs
              || entriesSinceLastLog >= scanLogEntryInterval
              || progress.status !== 'running';

            if (shouldLogProgress) {
              job.lastProgressLogAt = nowMs;
              job.lastLoggedEntries = progress.entriesScanned;
              logEvent(logger, 'info', 'scan.progress', {
                scanId,
                rootPath: progress.rootPath,
                status: progress.status,
                phase: progress.phase,
                entriesScanned: progress.entriesScanned,
                filesScanned: progress.filesScanned,
                directoriesScanned: progress.directoriesScanned,
                bytesScanned: progress.bytesScanned,
                errors: progress.errors,
                duplicatesSkipped: progress.duplicatesSkipped || 0,
                currentPath: progress.currentPath,
                elapsedMs: nowMs - job.startedAtMs,
                ...memorySummary()
              });
            }
          }
        });
        logEvent(logger, 'info', 'scan.finalize.complete', {
          ...scanLogSummary(scan),
          elapsedMs: Date.now() - job.startedAtMs,
          ...memorySummary()
        });
        scans.set(scan.id, scan);
        job.scan = scan;
        job.status = scan.status;
        job.progress = {
          ...job.progress,
          status: scan.status,
          phase: scan.status === 'partial' ? 'Completed with partial results' : 'Completed',
          bytesScanned: scan.totalSize,
          entriesScanned: scan.entryCount,
          errors: scan.errorCount,
          duplicatesSkipped: scan.duplicatesSkipped || 0,
          updatedAt: scan.completedAt
        };
      } catch (error) {
        job.status = 'failed';
        job.error = {
          message: error.message,
          code: error.code || 'SCAN_FAILED'
        };
        job.progress = {
          ...job.progress,
          status: 'failed',
          phase: 'Failed',
          updatedAt: new Date().toISOString()
        };
        logEvent(logger, 'error', 'scan.failed', {
          scanId,
          rootPath,
          message: error.message,
          code: error.code || 'SCAN_FAILED',
          stack: error.stack,
          elapsedMs: Date.now() - job.startedAtMs,
          ...memorySummary()
        });
      }
    });

    return job;
  }

  function validateRevealPath(scan, candidatePath) {
    const targetPath = normalizePath(candidatePath);
    assertPathInside(scan.rootPath, targetPath);

    const entry = findEntryByPath(scan, targetPath);
    if (!entry) {
      const error = new Error('Path was not found in the active scan.');
      error.statusCode = 400;
      throw error;
    }

    return entry;
  }

  async function route(request, response) {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const progressMatch = requestUrl.pathname.match(/^\/api\/scan\/([^/]+)\/progress$/);
    const entriesMatch = requestUrl.pathname.match(/^\/api\/scan\/([^/]+)\/entries$/);
    const childrenMatch = requestUrl.pathname.match(/^\/api\/scan\/([^/]+)\/children$/);

    try {
      if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        sendJson(response, 200, { ok: true }, { logger, routeName: 'GET /api/health' });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/session') {
        sendJson(response, 200, {
          token: sessionToken,
          homePath,
          platform: process.platform,
          suggestedRoots: suggestedRoots(homePath)
        }, { logger, routeName: 'GET /api/session' });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/disk-space') {
        assertSessionToken(request, sessionToken);
        const diskSpace = await diskSpaceImpl(requestUrl.searchParams.get('path') || '/');
        sendJson(response, 200, { diskSpace }, { logger, routeName: 'GET /api/disk-space' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/full-disk-access-settings') {
        assertLocalMutationRequest(request, sessionToken);
        await readJsonBody(request);
        const fullDiskAccess = await fullDiskAccessSettingsImpl();
        sendJson(response, 200, { fullDiskAccess }, { logger, routeName: 'POST /api/full-disk-access-settings' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/scan/start') {
        assertLocalMutationRequest(request, sessionToken);
        const body = await readJsonBody(request);
        const job = startScanJob(body.rootPath);
        sendJson(response, 202, scanJobPayload(job), { logger, routeName: 'POST /api/scan/start' });
        return;
      }

      if (request.method === 'GET' && progressMatch) {
        assertSessionToken(request, sessionToken);
        const job = scanJobs.get(progressMatch[1]);

        if (!job) {
          const error = new Error('Scan job was not found.');
          error.statusCode = 404;
          throw error;
        }

        sendJson(response, 200, scanJobPayload(job), { logger, routeName: 'GET /api/scan/:scanId/progress' });
        return;
      }

      if (request.method === 'GET' && entriesMatch) {
        assertSessionToken(request, sessionToken);
        const scan = scans.get(entriesMatch[1]);

        if (!scan) {
          const error = new Error('Scan session was not found.');
          error.statusCode = 404;
          throw error;
        }

        const startedAt = Date.now();
        const pageOptions = {
          mode: requestUrl.searchParams.get('mode'),
          sortKey: requestUrl.searchParams.get('sort'),
          direction: requestUrl.searchParams.get('direction'),
          offset: requestUrl.searchParams.get('offset'),
          limit: requestUrl.searchParams.get('limit')
        };
        logEvent(logger, 'info', 'scan.entries.start', {
          scanId: scan.id,
          ...pageOptions,
          ...memorySummary()
        });
        const page = scanEntriesPage(scan, pageOptions);
        logEvent(logger, 'info', 'scan.entries.complete', {
          scanId: scan.id,
          mode: page.mode,
          sortKey: page.sortKey,
          direction: page.direction,
          offset: page.offset,
          limit: page.limit,
          total: page.total,
          returned: page.entries.length,
          durationMs: Date.now() - startedAt,
          ...memorySummary()
        });
        sendJson(response, 200, { scanId: scan.id, ...page }, { logger, routeName: 'GET /api/scan/:scanId/entries' });
        return;
      }

      if (request.method === 'GET' && childrenMatch) {
        assertSessionToken(request, sessionToken);
        const scan = scans.get(childrenMatch[1]);

        if (!scan) {
          const error = new Error('Scan session was not found.');
          error.statusCode = 404;
          throw error;
        }

        const startedAt = Date.now();
        const pageOptions = {
          path: requestUrl.searchParams.get('path') || scan.rootPath,
          sortKey: requestUrl.searchParams.get('sort'),
          direction: requestUrl.searchParams.get('direction'),
          offset: requestUrl.searchParams.get('offset'),
          limit: requestUrl.searchParams.get('limit')
        };
        logEvent(logger, 'info', 'scan.children.start', {
          scanId: scan.id,
          ...pageOptions,
          ...memorySummary()
        });
        const page = scanChildrenPage(scan, pageOptions);
        logEvent(logger, 'info', 'scan.children.complete', {
          scanId: scan.id,
          parentPath: page.parentPath,
          sortKey: page.sortKey,
          direction: page.direction,
          offset: page.offset,
          limit: page.limit,
          total: page.total,
          returned: page.entries.length,
          durationMs: Date.now() - startedAt,
          ...memorySummary()
        });
        sendJson(response, 200, { scanId: scan.id, ...page }, { logger, routeName: 'GET /api/scan/:scanId/children' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/scan') {
        assertLocalMutationRequest(request, sessionToken);
        const body = await readJsonBody(request);
        const scan = await scanDirectoryImpl(body.rootPath);
        scans.set(scan.id, scan);
        sendJson(response, 200, { scan: scanSummary(scan) }, { logger, routeName: 'POST /api/scan' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/cleanup') {
        assertLocalMutationRequest(request, sessionToken);
        const body = await readJsonBody(request);
        const scan = scans.get(body.scanId);

        if (!scan) {
          const error = new Error('Scan session was not found.');
          error.statusCode = 400;
          throw error;
        }

        const paths = validateCleanupPaths(scan, body.paths);
        const entryMap = createEntryMap(scan);
        const { moved, failed } = await movePathsToTrash(paths, { trashDir });
        const movedPaths = moved.map((item) => item.path);
        const movedSize = movedPaths.reduce((total, itemPath) => total + (entryMap.get(itemPath)?.size || 0), 0);
        applyCleanupToScan(scan, movedPaths);

        const operation = {
          id: crypto.randomUUID(),
          scanId: scan.id,
          requestedPaths: paths,
          moved,
          failed,
          totalMovedSize: movedSize,
          completedAt: new Date().toISOString(),
          scan: scanSummary(scan)
        };

        sendJson(response, 200, { operation }, { logger, routeName: 'POST /api/cleanup' });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/reveal') {
        assertLocalMutationRequest(request, sessionToken);
        const body = await readJsonBody(request);
        const scan = scans.get(body.scanId);

        if (!scan) {
          const error = new Error('Scan session was not found.');
          error.statusCode = 400;
          throw error;
        }

        const entry = validateRevealPath(scan, body.path);
        await revealPathImpl(entry.path);

        const reveal = {
          scanId: scan.id,
          path: entry.path,
          type: entry.type,
          revealedAt: new Date().toISOString()
        };

        logEvent(logger, 'info', 'finder.reveal', {
          scanId: scan.id,
          path: entry.path,
          type: entry.type
        });
        sendJson(response, 200, { reveal }, { logger, routeName: 'POST /api/reveal' });
        return;
      }

      if (request.method === 'GET') {
        await serveStatic(request, response, staticDir);
        return;
      }

      response.writeHead(405);
      response.end('Method not allowed');
    } catch (error) {
      logEvent(logger, error.statusCode && error.statusCode < 500 ? 'info' : 'error', 'request.error', {
        method: request.method,
        path: requestUrl.pathname,
        statusCode: error.statusCode || 500,
        message: error.message,
        code: error.code || 'REQUEST_FAILED',
        stack: error.statusCode && error.statusCode < 500 ? undefined : error.stack
      });
      sendError(response, error);
    }
  }

  return {
    server: http.createServer(route),
    token: sessionToken,
    scans,
    scanJobs,
    logger
  };
}

export function startServer(options = {}) {
  const host = options.host || process.env.HOST || '127.0.0.1';
  const port = Number(options.port || process.env.PORT || 5179);
  const app = createApp(options);

  app.server.listen(port, host, () => {
    const address = app.server.address();
    logEvent(app.logger || console, 'info', 'server.start', {
      url: `http://${address.address}:${address.port}`
    });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

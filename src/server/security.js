import path from 'node:path';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function normalizePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new Error('Path must be a non-empty string.');
  }

  return path.resolve(inputPath);
}

export function isPathInside(rootPath, candidatePath) {
  const root = normalizePath(rootPath);
  const candidate = normalizePath(candidatePath);
  const relative = path.relative(root, candidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertPathInside(rootPath, candidatePath) {
  if (!isPathInside(rootPath, candidatePath)) {
    const error = new Error('Path is outside the active scan root.');
    error.statusCode = 403;
    throw error;
  }
}

export function assertNotScanRoot(rootPath, candidatePath) {
  if (normalizePath(rootPath) === normalizePath(candidatePath)) {
    const error = new Error('Moving the scan root itself is not allowed.');
    error.statusCode = 400;
    throw error;
  }
}

export function isLocalOrigin(origin) {
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function assertLocalMutationRequest(request, expectedToken) {
  const origin = request.headers.origin;
  const token = request.headers['x-disk-viewer-token'];
  const contentType = request.headers['content-type'] ?? '';

  if (!isLocalOrigin(origin)) {
    const error = new Error('Request origin is not allowed.');
    error.statusCode = 403;
    throw error;
  }

  if (token !== expectedToken) {
    const error = new Error('Missing or invalid session token.');
    error.statusCode = 403;
    throw error;
  }

  if (!contentType.toLowerCase().startsWith('application/json')) {
    const error = new Error('Only JSON API requests are accepted.');
    error.statusCode = 415;
    throw error;
  }
}

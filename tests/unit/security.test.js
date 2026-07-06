import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

import {
  assertLocalMutationRequest,
  assertNotScanRoot,
  assertPathInside,
  isLocalOrigin,
  isPathInside
} from '../../src/server/security.js';

test('isPathInside accepts root and descendants', () => {
  const root = path.join(os.tmpdir(), 'disk-viewer-root');

  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, path.join(root, 'nested/file.txt')), true);
});

test('isPathInside rejects sibling and traversal paths', () => {
  const root = path.join(os.tmpdir(), 'disk-viewer-root');

  assert.equal(isPathInside(root, path.join(os.tmpdir(), 'other/file.txt')), false);
  assert.equal(isPathInside(root, path.join(root, '../other/file.txt')), false);
});

test('assertPathInside throws a 403 for outside paths', () => {
  assert.throws(
    () => assertPathInside('/tmp/root', '/tmp/outside/file.txt'),
    (error) => error.statusCode === 403
  );
});

test('assertNotScanRoot rejects moving the scan root itself', () => {
  assert.throws(
    () => assertNotScanRoot('/tmp/root', '/tmp/root'),
    (error) => error.statusCode === 400
  );
});

test('isLocalOrigin only accepts local browser origins', () => {
  assert.equal(isLocalOrigin('http://127.0.0.1:5179'), true);
  assert.equal(isLocalOrigin('http://localhost:5179'), true);
  assert.equal(isLocalOrigin(undefined), true);
  assert.equal(isLocalOrigin('https://example.com'), false);
});

test('assertLocalMutationRequest requires local origin, JSON, and token', () => {
  const request = {
    headers: {
      origin: 'http://127.0.0.1:5179',
      'content-type': 'application/json',
      'x-disk-viewer-token': 'token'
    }
  };

  assert.doesNotThrow(() => assertLocalMutationRequest(request, 'token'));

  assert.throws(
    () => assertLocalMutationRequest({ headers: { ...request.headers, origin: 'https://example.com' } }, 'token'),
    (error) => error.statusCode === 403
  );

  assert.throws(
    () => assertLocalMutationRequest({ headers: { ...request.headers, 'x-disk-viewer-token': 'bad' } }, 'token'),
    (error) => error.statusCode === 403
  );

  assert.throws(
    () => assertLocalMutationRequest({ headers: { ...request.headers, 'content-type': 'text/plain' } }, 'token'),
    (error) => error.statusCode === 415
  );
});

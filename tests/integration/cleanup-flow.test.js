import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { createApp } from '../../src/server/app.js';

async function startTestApp(trashDir) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-integration-static-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>test</title>');
  const app = createApp({ staticDir, sessionToken: 'integration-token', trashDir, logger: null });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return {
    ...app,
    baseUrl: `http://${address.address}:${address.port}`,
    close: () => new Promise((resolve) => app.server.close(resolve))
  };
}

function apiHeaders(baseUrl) {
  return {
    'content-type': 'application/json',
    'x-disk-viewer-token': 'integration-token',
    origin: baseUrl
  };
}

test('scan, select, cleanup only moves selected files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-flow-'));
  const trashDir = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-flow-trash-'));
  const selectedPath = path.join(root, 'remove-me.txt');
  const retainedPath = path.join(root, 'keep-me.txt');
  await fs.writeFile(selectedPath, 'remove');
  await fs.writeFile(retainedPath, 'keep');
  const app = await startTestApp(trashDir);

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: apiHeaders(app.baseUrl),
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const cleanupResponse = await fetch(`${app.baseUrl}/api/cleanup`, {
      method: 'POST',
      headers: apiHeaders(app.baseUrl),
      body: JSON.stringify({ scanId: scan.id, paths: [selectedPath] })
    });

    assert.equal(cleanupResponse.status, 200);
    const { operation } = await cleanupResponse.json();
    assert.equal(operation.moved.length, 1);
    assert.equal(operation.failed.length, 0);
    await assert.rejects(() => fs.lstat(selectedPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(retainedPath, 'utf8'), 'keep');
  } finally {
    await app.close();
  }
});

test('cleanup rejects outside paths even with a valid token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-flow-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-outside-'));
  const outsidePath = path.join(outside, 'outside.txt');
  const trashDir = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-flow-trash-'));
  await fs.writeFile(path.join(root, 'inside.txt'), 'inside');
  await fs.writeFile(outsidePath, 'outside');
  const app = await startTestApp(trashDir);

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: apiHeaders(app.baseUrl),
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const cleanupResponse = await fetch(`${app.baseUrl}/api/cleanup`, {
      method: 'POST',
      headers: apiHeaders(app.baseUrl),
      body: JSON.stringify({ scanId: scan.id, paths: [outsidePath] })
    });

    assert.equal(cleanupResponse.status, 403);
    assert.equal(await fs.readFile(outsidePath, 'utf8'), 'outside');
  } finally {
    await app.close();
  }
});

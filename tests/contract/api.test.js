import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { createApp } from '../../src/server/app.js';

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-api-'));
  await fs.writeFile(path.join(root, 'one.bin'), Buffer.alloc(12));
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested', 'two.bin'), Buffer.alloc(8));
  return root;
}

async function startTestApp(options = {}) {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-static-'));
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>test</title>');
  const app = createApp({ staticDir, sessionToken: 'test-token', logger: null, ...options });

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  return {
    ...app,
    baseUrl,
    close: () => new Promise((resolve) => app.server.close(resolve))
  };
}

test('GET /api/health and /api/session return local runtime metadata', async () => {
  const app = await startTestApp();

  try {
    const health = await fetch(`${app.baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const session = await fetch(`${app.baseUrl}/api/session`);
    assert.equal(session.status, 200);
    const body = await session.json();
    assert.equal(body.token, 'test-token');
    assert.deepEqual(body.suggestedRoots[0], { label: 'Macintosh HD', path: '/' });
    assert.ok(body.suggestedRoots.some((root) => root.label === 'Home'));
  } finally {
    await app.close();
  }
});

test('POST /api/scan returns aggregate scan results', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const response = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.scan.totalSize, 20);
    assert.equal(body.scan.root.childCount, 2);
    assert.equal(body.scan.root.children, undefined);
  } finally {
    await app.close();
  }
});

test('GET /api/scan/:scanId/entries returns paged scan entries', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const entriesResponse = await fetch(
      `${app.baseUrl}/api/scan/${scan.id}/entries?mode=files&sort=size&direction=desc&offset=0&limit=1`,
      {
        headers: {
          'x-disk-viewer-token': 'test-token'
        }
      }
    );

    assert.equal(entriesResponse.status, 200);
    const body = await entriesResponse.json();
    assert.equal(body.total, 2);
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].name, 'one.bin');
    assert.equal(body.entries[0].extension, '.bin');
    assert.equal(body.entries[0].size, 12);
    assert.equal(body.entries[0].percentOfParent, 60);
    assert.equal(body.entries[0].children, undefined);
  } finally {
    await app.close();
  }
});

test('GET /api/scan/:scanId/entries supports tree rows with percentages', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const entriesResponse = await fetch(
      `${app.baseUrl}/api/scan/${scan.id}/entries?mode=tree&sort=size&direction=desc&offset=0&limit=3`,
      {
        headers: {
          'x-disk-viewer-token': 'test-token'
        }
      }
    );

    assert.equal(entriesResponse.status, 200);
    const body = await entriesResponse.json();
    assert.equal(body.mode, 'tree');
    assert.equal(body.total, 3);
    assert.equal(body.entries[0].name, 'one.bin');
    assert.equal(body.entries[0].depth, 1);
    assert.equal(body.entries[0].percentOfParent, 60);
    assert.equal(body.entries[1].name, 'nested');
    assert.equal(body.entries[1].percentOfParent, 40);
    assert.equal(body.entries[2].name, 'two.bin');
    assert.equal(body.entries[2].depth, 2);
    assert.equal(body.entries[2].percentOfParent, 100);
  } finally {
    await app.close();
  }
});

test('GET /api/scan/:scanId/entries sorts files by percent of parent', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const entriesResponse = await fetch(
      `${app.baseUrl}/api/scan/${scan.id}/entries?mode=files&sort=percentOfParent&direction=desc&offset=0&limit=2`,
      {
        headers: {
          'x-disk-viewer-token': 'test-token'
        }
      }
    );

    assert.equal(entriesResponse.status, 200);
    const body = await entriesResponse.json();
    assert.equal(body.sortKey, 'percentOfParent');
    assert.equal(body.entries[0].name, 'two.bin');
    assert.equal(body.entries[0].percentOfParent, 100);
    assert.equal(body.entries[1].name, 'one.bin');
    assert.equal(body.entries[1].percentOfParent, 60);
  } finally {
    await app.close();
  }
});

test('GET /api/scan/:scanId/children returns direct hierarchy children with percentages', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const rootChildrenResponse = await fetch(
      `${app.baseUrl}/api/scan/${scan.id}/children?path=${encodeURIComponent(root)}&sort=size&direction=desc&offset=0&limit=10`,
      {
        headers: {
          'x-disk-viewer-token': 'test-token'
        }
      }
    );

    assert.equal(rootChildrenResponse.status, 200);
    const rootChildren = await rootChildrenResponse.json();
    assert.equal(rootChildren.parentPath, root);
    assert.equal(rootChildren.total, 2);
    assert.equal(rootChildren.entries[0].name, 'one.bin');
    assert.equal(rootChildren.entries[0].percentOfParent, 60);
    assert.equal(rootChildren.entries[1].name, 'nested');
    assert.equal(rootChildren.entries[1].percentOfParent, 40);

    const nestedPath = path.join(root, 'nested');
    const nestedChildrenResponse = await fetch(
      `${app.baseUrl}/api/scan/${scan.id}/children?path=${encodeURIComponent(nestedPath)}&sort=size&direction=desc`,
      {
        headers: {
          'x-disk-viewer-token': 'test-token'
        }
      }
    );

    assert.equal(nestedChildrenResponse.status, 200);
    const nestedChildren = await nestedChildrenResponse.json();
    assert.equal(nestedChildren.parentPath, nestedPath);
    assert.equal(nestedChildren.total, 1);
    assert.equal(nestedChildren.entries[0].name, 'two.bin');
    assert.equal(nestedChildren.entries[0].percentOfParent, 100);
  } finally {
    await app.close();
  }
});

test('POST /api/scan/start and GET progress return scan progress', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const startResponse = await fetch(`${app.baseUrl}/api/scan/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });

    assert.equal(startResponse.status, 202);
    const started = await startResponse.json();
    assert.equal(started.status, 'running');
    assert.equal(started.progress.entriesScanned, 0);

    let progressBody;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const progressResponse = await fetch(`${app.baseUrl}/api/scan/${started.scanId}/progress`, {
        headers: {
          'x-disk-viewer-token': 'test-token'
        }
      });

      assert.equal(progressResponse.status, 200);
      progressBody = await progressResponse.json();
      if (progressBody.status === 'completed' || progressBody.status === 'partial') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(progressBody.status, 'completed');
    assert.equal(progressBody.scan.totalSize, 20);
    assert.equal(progressBody.progress.entriesScanned, progressBody.scan.entryCount);
  } finally {
    await app.close();
  }
});

test('GET scan progress requires the session token', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const startResponse = await fetch(`${app.baseUrl}/api/scan/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const started = await startResponse.json();

    const progressResponse = await fetch(`${app.baseUrl}/api/scan/${started.scanId}/progress`);

    assert.equal(progressResponse.status, 403);
  } finally {
    await app.close();
  }
});

test('POST /api/scan rejects missing tokens', async () => {
  const root = await makeFixture();
  const app = await startTestApp();

  try {
    const response = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });

    assert.equal(response.status, 403);
  } finally {
    await app.close();
  }
});

test('POST /api/scan returns one error response when scan payload cannot serialize', async () => {
  const app = await startTestApp({
    scanDirectoryImpl: async () => ({
      id: 'bad-scan',
      totalSize: 1n
    })
  });

  try {
    const response = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: '/' })
    });

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.message, 'Unexpected server error.');
  } finally {
    await app.close();
  }
});

test('POST /api/cleanup moves selected scan entries to the configured Trash', async () => {
  const root = await makeFixture();
  const trashDir = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-api-trash-'));
  const app = await startTestApp({ trashDir });

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();
    const selectedPath = path.join(root, 'one.bin');

    const cleanupResponse = await fetch(`${app.baseUrl}/api/cleanup`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ scanId: scan.id, paths: [selectedPath] })
    });

    assert.equal(cleanupResponse.status, 200);
    const body = await cleanupResponse.json();
    assert.equal(body.operation.moved.length, 1);
    assert.equal(body.operation.totalMovedSize, 12);
    await assert.rejects(() => fs.lstat(selectedPath), { code: 'ENOENT' });
    assert.ok(body.operation.scan.totalSize < scan.totalSize);
  } finally {
    await app.close();
  }
});

test('POST /api/reveal opens a scanned entry in Finder', async () => {
  const root = await makeFixture();
  const revealedPaths = [];
  const app = await startTestApp({
    revealPathImpl: async (targetPath) => {
      revealedPaths.push(targetPath);
    }
  });

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();
    const targetPath = path.join(root, 'one.bin');

    const revealResponse = await fetch(`${app.baseUrl}/api/reveal`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ scanId: scan.id, path: targetPath })
    });

    assert.equal(revealResponse.status, 200);
    const body = await revealResponse.json();
    assert.equal(body.reveal.path, targetPath);
    assert.deepEqual(revealedPaths, [targetPath]);
  } finally {
    await app.close();
  }
});

test('POST /api/reveal rejects paths not present in the scan', async () => {
  const root = await makeFixture();
  const revealedPaths = [];
  const app = await startTestApp({
    revealPathImpl: async (targetPath) => {
      revealedPaths.push(targetPath);
    }
  });

  try {
    const scanResponse = await fetch(`${app.baseUrl}/api/scan`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ rootPath: root })
    });
    const { scan } = await scanResponse.json();

    const revealResponse = await fetch(`${app.baseUrl}/api/reveal`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-disk-viewer-token': 'test-token',
        origin: app.baseUrl
      },
      body: JSON.stringify({ scanId: scan.id, path: path.join(root, 'missing.bin') })
    });

    assert.equal(revealResponse.status, 400);
    assert.deepEqual(revealedPaths, []);
  } finally {
    await app.close();
  }
});

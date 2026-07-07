import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  applyCleanupToScan,
  createEntryMap,
  findEntryByPath,
  scanDirectory,
  validateCleanupPaths
} from '../../src/server/scanner.js';

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-scan-'));
  await fs.mkdir(path.join(root, 'large'));
  await fs.mkdir(path.join(root, 'small'));
  await fs.writeFile(path.join(root, 'large', 'a.bin'), Buffer.alloc(30));
  await fs.writeFile(path.join(root, 'large', 'b.bin'), Buffer.alloc(20));
  await fs.writeFile(path.join(root, 'small', 'c.bin'), Buffer.alloc(5));
  return root;
}

test('scanDirectory aggregates nested file sizes and sorts largest children first', async () => {
  const root = await makeFixture();

  const scan = await scanDirectory(root);

  assert.equal(scan.status, 'completed');
  assert.equal(scan.totalSize, 55);
  assert.equal(scan.errorCount, 0);
  assert.equal(scan.root.children[0].name, 'large');
  assert.equal(scan.root.children[0].size, 50);
  assert.equal(scan.root.children[1].name, 'small');
  assert.equal(scan.root.children[1].size, 5);
});

test('scanDirectory reports live progress while scanning', async () => {
  const root = await makeFixture();
  const updates = [];

  const scan = await scanDirectory(root, {
    onProgress: (progress) => updates.push(progress)
  });

  assert.ok(updates.length >= 2);
  assert.equal(updates[0].status, 'running');
  assert.equal(updates.at(-1).status, 'completed');
  assert.equal(updates.at(-1).entriesScanned, scan.entryCount);
  assert.equal(updates.at(-1).filesScanned, 3);
  assert.equal(updates.at(-1).bytesScanned, 55);
});

test('scanDirectory reports symlinks without following them', async (t) => {
  const root = await makeFixture();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-outside-'));
  await fs.writeFile(path.join(outside, 'outside.bin'), Buffer.alloc(100));
  const linkPath = path.join(root, 'outside-link');

  try {
    await fs.symlink(outside, linkPath);
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('symlink creation is not permitted in this environment');
      return;
    }
    throw error;
  }

  const scan = await scanDirectory(root);
  const entryMap = createEntryMap(scan);

  assert.equal(entryMap.get(linkPath).type, 'symlink');
  assert.equal(entryMap.has(path.join(linkPath, 'outside.bin')), false);
});

test('scanDirectory does not double-count hard-linked files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-hardlink-'));
  const originalPath = path.join(root, 'original.bin');
  const linkedPath = path.join(root, 'linked.bin');
  const updates = [];

  await fs.writeFile(originalPath, Buffer.alloc(42));

  try {
    await fs.link(originalPath, linkedPath);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EXDEV') {
      t.skip('hard link creation is not permitted in this environment');
      return;
    }
    throw error;
  }

  const scan = await scanDirectory(root, {
    onProgress: (progress) => updates.push(progress)
  });
  const entryMap = createEntryMap(scan);
  const indexedHardLinks = [originalPath, linkedPath].filter((candidate) => entryMap.has(candidate));

  assert.equal(scan.totalSize, 42);
  assert.equal(scan.duplicatesSkipped, 1);
  assert.equal(scan.root.childCount, 1);
  assert.equal(indexedHardLinks.length, 1);
  assert.equal(updates.at(-1).duplicatesSkipped, 1);
});

test('validateCleanupPaths rejects paths outside the active scan root', async () => {
  const root = await makeFixture();
  const scan = await scanDirectory(root);

  assert.throws(
    () => validateCleanupPaths(scan, [path.join(os.tmpdir(), 'outside.txt')]),
    (error) => error.statusCode === 403
  );
});

test('validateCleanupPaths rejects paths missing from the active scan results', async () => {
  const root = await makeFixture();
  const scan = await scanDirectory(root);

  assert.throws(
    () => validateCleanupPaths(scan, [path.join(root, 'not-scanned.txt')]),
    (error) => error.statusCode === 409
  );
});

test('validateCleanupPaths collapses descendants when a parent folder is selected', async () => {
  const root = await makeFixture();
  const scan = await scanDirectory(root);
  const parentPath = path.join(root, 'large');
  const childPath = path.join(root, 'large', 'a.bin');

  const paths = validateCleanupPaths(scan, [parentPath, childPath]);

  assert.deepEqual(paths, [parentPath]);
});

test('findEntryByPath returns a scanned entry without building a full map', async () => {
  const root = await makeFixture();
  const scan = await scanDirectory(root);
  const filePath = path.join(root, 'large', 'a.bin');

  const entry = findEntryByPath(scan, filePath);

  assert.equal(entry.path, filePath);
  assert.equal(entry.type, 'file');
  assert.equal(findEntryByPath(scan, path.join(root, 'missing.bin')), null);
});

test('applyCleanupToScan removes moved entries and recalculates totals', async () => {
  const root = await makeFixture();
  const scan = await scanDirectory(root);
  const removedPath = path.join(root, 'large', 'a.bin');

  applyCleanupToScan(scan, [removedPath]);

  assert.equal(scan.totalSize, 25);
  assert.equal(createEntryMap(scan).has(removedPath), false);
});

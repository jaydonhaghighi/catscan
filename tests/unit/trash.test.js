import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { movePathsToTrash } from '../../src/server/trash.js';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'disk-viewer-trash-'));
}

test('movePathsToTrash moves files into the configured Trash directory', async () => {
  const root = await makeTempDir();
  const trashDir = await makeTempDir();
  const filePath = path.join(root, 'large.log');
  await fs.writeFile(filePath, 'content');

  const result = await movePathsToTrash([filePath], { trashDir });

  assert.equal(result.failed.length, 0);
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].path, filePath);
  assert.equal(await fs.readFile(result.moved[0].trashPath, 'utf8'), 'content');
  await assert.rejects(() => fs.lstat(filePath), { code: 'ENOENT' });
});

test('movePathsToTrash keeps existing Trash entries by creating unique names', async () => {
  const root = await makeTempDir();
  const trashDir = await makeTempDir();
  const filePath = path.join(root, 'duplicate.txt');
  const existingTrashPath = path.join(trashDir, 'duplicate.txt');
  await fs.writeFile(filePath, 'new');
  await fs.writeFile(existingTrashPath, 'old');

  const result = await movePathsToTrash([filePath], { trashDir });

  assert.equal(result.failed.length, 0);
  assert.notEqual(result.moved[0].trashPath, existingTrashPath);
  assert.equal(await fs.readFile(existingTrashPath, 'utf8'), 'old');
  assert.equal(await fs.readFile(result.moved[0].trashPath, 'utf8'), 'new');
});

test('movePathsToTrash reports failed entries without stopping the batch', async () => {
  const root = await makeTempDir();
  const trashDir = await makeTempDir();
  const filePath = path.join(root, 'present.txt');
  const missingPath = path.join(root, 'missing.txt');
  await fs.writeFile(filePath, 'ok');

  const result = await movePathsToTrash([missingPath, filePath], { trashDir });

  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].path, missingPath);
  assert.equal(result.moved.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateSelection,
  extensionColor,
  extensionKey,
  fileEntries,
  flattenEntries,
  formatPercent,
  formatBytes,
  mosaicSquareLayout,
  packedTreemapLayout,
  squareTileSpan,
  sortEntries,
  tileScaleForEntries,
} from '../../src/public/ui-data.js';

const root = {
  path: '/tmp/root',
  name: 'root',
  type: 'directory',
  size: 1536,
  children: [
    {
      path: '/tmp/root/b.bin',
      name: 'b.bin',
      type: 'file',
      size: 512,
      children: []
    },
    {
      path: '/tmp/root/a',
      name: 'a',
      type: 'directory',
      size: 1024,
      children: [
        {
          path: '/tmp/root/a/c.bin',
          name: 'c.bin',
          type: 'file',
          size: 1024,
          children: []
        }
      ]
    }
  ]
};

test('flattenEntries preserves hierarchy depth', () => {
  const entries = flattenEntries(root);

  assert.equal(entries.length, 4);
  assert.equal(entries[0].depth, 0);
  assert.equal(entries[2].path, '/tmp/root/a');
  assert.equal(entries[3].depth, 2);
});

test('sortEntries sorts by size and name', () => {
  const entries = flattenEntries(root).slice(1);
  const bySize = sortEntries(entries, 'size', 'desc');
  const byName = sortEntries(entries, 'name', 'asc');

  assert.equal(bySize[0].path, '/tmp/root/a');
  assert.equal(byName[0].name, 'a');
});

test('calculateSelection returns selected count and size', () => {
  const entries = flattenEntries(root);
  const selection = calculateSelection(entries, new Set(['/tmp/root/b.bin', '/tmp/root/a/c.bin']));

  assert.equal(selection.itemCount, 2);
  assert.equal(selection.totalSize, 1536);
});

test('calculateSelection collapses descendants selected under a parent', () => {
  const entries = flattenEntries(root);
  const selection = calculateSelection(entries, new Set(['/tmp/root/a', '/tmp/root/a/c.bin']));

  assert.equal(selection.itemCount, 1);
  assert.equal(selection.totalSize, 1024);
  assert.equal(selection.entries[0].path, '/tmp/root/a');
});

test('fileEntries returns every file across the full tree', () => {
  const entries = fileEntries(root);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.path).sort(), [
    '/tmp/root/a/c.bin',
    '/tmp/root/b.bin'
  ]);
});

test('squareTileSpan scales file squares from largest to smallest', () => {
  const entries = [
    { size: 10_000 },
    { size: 2_500 },
    { size: 100 },
    { size: 1 }
  ];
  const scale = tileScaleForEntries(entries, { cellBudget: 100 });

  assert.ok(squareTileSpan(entries[0], scale) > squareTileSpan(entries[1], scale));
  assert.ok(squareTileSpan(entries[1], scale) > squareTileSpan(entries[2], scale));
  assert.equal(squareTileSpan(entries[3], scale), 1);
});

test('packedTreemapLayout fills available area and preserves size ordering', () => {
  const entries = [
    { path: '/large.zip', name: 'large.zip', size: 600 },
    { path: '/medium.py', name: 'medium.py', size: 300 },
    { path: '/small.json', name: 'small.json', size: 100 }
  ];
  const layout = packedTreemapLayout(entries, 1000, 500);

  assert.equal(layout.length, 3);
  const totalArea = layout.reduce((total, rect) => total + rect.width * rect.height, 0);
  assert.ok(Math.abs(totalArea - 500_000) < 0.001);

  const areas = new Map(layout.map((rect) => [rect.entry.path, rect.width * rect.height]));
  assert.ok(areas.get('/large.zip') > areas.get('/medium.py'));
  assert.ok(areas.get('/medium.py') > areas.get('/small.json'));

  for (const rect of layout) {
    assert.ok(rect.x >= 0);
    assert.ok(rect.y >= 0);
    assert.ok(rect.x + rect.width <= 1000 + 0.001);
    assert.ok(rect.y + rect.height <= 500 + 0.001);
  }
});

test('mosaicSquareLayout fills the panel and makes larger files larger squares', () => {
  const entries = [
    { path: '/huge.bin', name: 'huge.bin', size: 10_000 },
    { path: '/large.zip', name: 'large.zip', size: 4_000 },
    { path: '/medium.py', name: 'medium.py', size: 1_000 },
    ...Array.from({ length: 80 }, (_, index) => ({
      path: `/small-${index}.txt`,
      name: `small-${index}.txt`,
      size: 10
    }))
  ];
  const layout = mosaicSquareLayout(entries, 240, 160, { cellSize: 8 });

  const occupied = new Set();
  const primarySideByPath = new Map();
  for (const rect of layout.rects) {
    assert.equal(rect.width, rect.height);
    assert.equal(rect.x % 8, 0);
    assert.equal(rect.y % 8, 0);
    assert.equal(rect.width % 8, 0);

    for (let y = rect.y / 8; y < (rect.y + rect.height) / 8; y += 1) {
      for (let x = rect.x / 8; x < (rect.x + rect.width) / 8; x += 1) {
        const key = `${x}:${y}`;
        assert.equal(occupied.has(key), false);
        occupied.add(key);
      }
    }
    if (rect.role === 'primary') {
      primarySideByPath.set(rect.entry.path, rect.width);
    }
  }

  assert.equal(occupied.size, layout.columns * layout.rows);
  assert.ok(primarySideByPath.get('/huge.bin') > primarySideByPath.get('/large.zip'));
  assert.ok(primarySideByPath.get('/large.zip') > primarySideByPath.get('/medium.py'));
});

test('formatBytes formats byte values', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('extensionKey extracts extensions and handles folders', () => {
  assert.equal(extensionKey({ name: 'archive.zip', type: 'file' }), '.zip');
  assert.equal(extensionKey({ name: 'script.py', type: 'file' }), '.py');
  assert.equal(extensionKey({ name: 'Folder', type: 'directory' }), '[folder]');
  assert.equal(extensionKey('README'), '[none]');
});

test('extensionColor maps known extensions to stable colors', () => {
  assert.equal(extensionColor({ name: 'archive.zip', type: 'file' }), '#4f8cff');
  assert.equal(extensionColor({ name: 'script.py', type: 'file' }), '#f2c94c');
  assert.equal(extensionColor({ name: 'Folder', type: 'directory' }), '#64748b');
});

test('formatPercent formats small and large percentages', () => {
  assert.equal(formatPercent(14.567), '14.6%');
  assert.equal(formatPercent(2.345), '2.35%');
});

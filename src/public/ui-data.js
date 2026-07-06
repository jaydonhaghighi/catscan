export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

const EXTENSION_COLORS = new Map([
  ['[folder]', '#64748b'],
  ['[none]', '#526071'],
  ['.zip', '#4f8cff'],
  ['.gz', '#3d73d8'],
  ['.rar', '#6aa5ff'],
  ['.7z', '#8abaff'],
  ['.py', '#f2c94c'],
  ['.js', '#ffb86b'],
  ['.ts', '#57c7ff'],
  ['.tsx', '#64dfdf'],
  ['.jsx', '#ffd166'],
  ['.json', '#7bd88f'],
  ['.css', '#4dd4c6'],
  ['.html', '#ff7a90'],
  ['.md', '#9aa8bd'],
  ['.txt', '#c7d2e5'],
  ['.pdf', '#ff5f6d'],
  ['.doc', '#5b8def'],
  ['.docx', '#5b8def'],
  ['.xls', '#56c271'],
  ['.xlsx', '#56c271'],
  ['.png', '#f06ab4'],
  ['.jpg', '#ff9f68'],
  ['.jpeg', '#ff9f68'],
  ['.gif', '#ba8cff'],
  ['.svg', '#35d0ba'],
  ['.mp3', '#35c99a'],
  ['.wav', '#6ee7b7'],
  ['.mp4', '#a78bfa'],
  ['.mov', '#9275e6'],
  ['.mkv', '#c084fc'],
  ['.dmg', '#42b3f5'],
  ['.iso', '#38c9e8'],
  ['.app', '#38d9a9'],
  ['.sql', '#ff9a57'],
  ['.db', '#ffb15f'],
  ['.log', '#b6e36c']
]);

const FALLBACK_COLORS = [
  '#4dd4c6',
  '#6aa5ff',
  '#ba8cff',
  '#ff9f68',
  '#ff7a90',
  '#7bd88f',
  '#f2c94c',
  '#57c7ff',
  '#f06ab4',
  '#b6e36c',
  '#c084fc',
  '#ffd166'
];

export function extensionKey(entryOrPath) {
  if (!entryOrPath) {
    return '[none]';
  }

  if (typeof entryOrPath === 'object') {
    if (entryOrPath.extension) {
      return String(entryOrPath.extension).toLowerCase();
    }
    if (entryOrPath.type === 'directory') {
      return '[folder]';
    }
    return extensionKey(entryOrPath.name || entryOrPath.path);
  }

  const value = String(entryOrPath);
  const filename = value.split('/').pop() || value;
  const dotIndex = filename.lastIndexOf('.');

  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return '[none]';
  }

  return filename.slice(dotIndex).toLowerCase();
}

export function extensionColor(entryOrPath) {
  const key = extensionKey(entryOrPath);
  const configured = EXTENSION_COLORS.get(key);

  if (configured) {
    return configured;
  }

  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function formatPercent(percent) {
  const value = Number(percent || 0);
  if (!Number.isFinite(value)) {
    return '0.0%';
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
}

export function flattenEntries(root, depth = 0, output = []) {
  if (!root) {
    return output;
  }

  output.push({ ...root, depth });

  for (const child of root.children || []) {
    flattenEntries(child, depth + 1, output);
  }

  return output;
}

export function fileEntries(root) {
  return flattenEntries(root).filter((entry) => entry.type === 'file');
}

export function sortEntries(entries, sortKey, direction = 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    if (sortKey === 'name' || sortKey === 'type') {
      return multiplier * String(a[sortKey]).localeCompare(String(b[sortKey]));
    }

    const left = Number(a[sortKey] || 0);
    const right = Number(b[sortKey] || 0);
    if (left === right) {
      return a.name.localeCompare(b.name);
    }
    return multiplier * (left - right);
  });
}

export function calculateSelection(entries, selectedPaths) {
  const selected = new Set(selectedPaths);
  const selectedEntries = collapseDescendantEntries(entries.filter((entry) => selected.has(entry.path)));
  const totalSize = selectedEntries.reduce((total, entry) => total + entry.size, 0);

  return {
    itemCount: selectedEntries.length,
    totalSize,
    entries: selectedEntries
  };
}

function isDescendantPath(parentPath, candidatePath) {
  if (parentPath === candidatePath) {
    return false;
  }
  const normalizedParent = parentPath.endsWith('/') ? parentPath : `${parentPath}/`;
  return candidatePath.startsWith(normalizedParent);
}

function collapseDescendantEntries(entries) {
  const collapsed = [];

  for (const entry of [...entries].sort((a, b) => a.path.length - b.path.length)) {
    const isCoveredByParent = collapsed.some((parent) => isDescendantPath(parent.path, entry.path));
    if (!isCoveredByParent) {
      collapsed.push(entry);
    }
  }

  return collapsed;
}

export function tileScaleForEntries(entries, options = {}) {
  const totalSize = entries.reduce((total, entry) => total + Number(entry.size || 0), 0);
  const cellBudget = Math.max(
    entries.length || 1,
    Number(options.cellBudget || 0),
    Number(options.minCellBudget || 0),
    1
  );

  return {
    unitSize: totalSize > 0 ? totalSize / cellBudget : 1
  };
}

export function squareTileSpan(entry, scale) {
  const size = Number(entry?.size || 0);
  const unitSize = Number(scale?.unitSize || scale || 1);

  if (!entry || size <= 0 || unitSize <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(Math.sqrt(size / unitSize)));
}

function createRows(rowCount, columns) {
  return Array.from({ length: rowCount }, () => new Uint8Array(columns));
}

function ensureRows(rows, neededRows, columns) {
  while (rows.length < neededRows) {
    rows.push(new Uint8Array(columns));
  }
}

function canPlaceSquare(rows, x, y, span, columns) {
  if (x + span > columns) {
    return false;
  }

  for (let row = y; row < y + span; row += 1) {
    if (!rows[row]) {
      continue;
    }
    for (let column = x; column < x + span; column += 1) {
      if (rows[row][column]) {
        return false;
      }
    }
  }

  return true;
}

function occupySquare(rows, x, y, span, columns) {
  ensureRows(rows, y + span, columns);

  for (let row = y; row < y + span; row += 1) {
    for (let column = x; column < x + span; column += 1) {
      rows[row][column] = 1;
    }
  }
}

export function packedSquareLayout(entries, width, options = {}) {
  const cellSize = Math.max(4, Number(options.cellSize) || 8);
  const columns = Math.max(1, Math.floor((Number(width) || cellSize) / cellSize));
  const visibleRows = Math.max(1, Math.floor((Number(options.height) || cellSize * 80) / cellSize));
  const scale = tileScaleForEntries(entries, {
    cellBudget: Math.max(entries.length, Math.round(columns * visibleRows * 1.15))
  });
  const tiles = entries
    .filter((entry) => Number(entry.size || 0) > 0)
    .map((entry) => ({
      entry,
      span: Math.min(columns, squareTileSpan(entry, scale))
    }))
    .sort((left, right) => {
      if (right.span !== left.span) {
        return right.span - left.span;
      }
      return Number(right.entry.size || 0) - Number(left.entry.size || 0);
    });
  const rows = createRows(visibleRows, columns);
  const rects = [];
  let usedRows = 0;

  for (const tile of tiles) {
    let placed = false;

    for (let y = 0; !placed; y += 1) {
      ensureRows(rows, y + tile.span, columns);

      for (let x = 0; x <= columns - tile.span; x += 1) {
        if (!canPlaceSquare(rows, x, y, tile.span, columns)) {
          continue;
        }

        occupySquare(rows, x, y, tile.span, columns);
        usedRows = Math.max(usedRows, y + tile.span);
        rects.push({
          entry: tile.entry,
          x: x * cellSize,
          y: y * cellSize,
          width: tile.span * cellSize,
          height: tile.span * cellSize,
          span: tile.span
        });
        placed = true;
        break;
      }
    }
  }

  return {
    rects,
    width: columns * cellSize,
    height: Math.max(visibleRows, usedRows) * cellSize,
    cellSize,
    columns,
    rows: Math.max(visibleRows, usedRows)
  };
}

export function mosaicSquareLayout(entries, width, height, options = {}) {
  const cellSize = Math.max(4, Number(options.cellSize) || 8);
  const columns = Math.max(1, Math.floor((Number(width) || cellSize) / cellSize));
  const visibleRows = Math.max(1, Math.floor((Number(height) || cellSize * 80) / cellSize));
  const totalCells = Math.max(entries.length, columns * visibleRows);
  const visibleEntries = entries.filter((entry) => Number(entry.size || 0) > 0);
  const totalSize = visibleEntries.reduce((total, entry) => total + Number(entry.size || 0), 0);

  if (visibleEntries.length === 0 || totalSize <= 0) {
    return {
      rects: [],
      width: columns * cellSize,
      height: visibleRows * cellSize,
      cellSize,
      columns,
      rows: visibleRows
    };
  }

  const remainingCells = Math.max(0, totalCells - visibleEntries.length);
  const allocations = visibleEntries.map((entry) => {
    const exactExtra = (Number(entry.size || 0) / totalSize) * remainingCells;
    const extraCells = Math.floor(exactExtra);
    return {
      entry,
      cells: 1 + extraCells,
      remainder: exactExtra - extraCells
    };
  });
  let allocatedCells = allocations.reduce((total, item) => total + item.cells, 0);
  const byRemainder = [...allocations].sort((left, right) => right.remainder - left.remainder);

  for (let index = 0; allocatedCells < totalCells; index = (index + 1) % byRemainder.length) {
    byRemainder[index].cells += 1;
    allocatedCells += 1;
  }

  const rows = [];
  const rects = [];
  let singleCellCursor = 0;

  const ensureRows = (count) => {
    while (rows.length < count) {
      rows.push(new Uint8Array(columns));
    }
  };

  const canPlace = (column, row, sideCells) => {
    if (column + sideCells > columns) {
      return false;
    }
    ensureRows(row + sideCells);

    for (let y = row; y < row + sideCells; y += 1) {
      for (let x = column; x < column + sideCells; x += 1) {
        if (rows[y][x] === 1) {
          return false;
        }
      }
    }

    return true;
  };

  const occupy = (column, row, sideCells) => {
    ensureRows(row + sideCells);

    for (let y = row; y < row + sideCells; y += 1) {
      for (let x = column; x < column + sideCells; x += 1) {
        rows[y][x] = 1;
      }
    }
  };

  const findSquarePlacement = (sideCells) => {
    for (let row = 0; ; row += 1) {
      for (let column = 0; column <= columns - sideCells; column += 1) {
        if (canPlace(column, row, sideCells)) {
          return { column, row };
        }
      }
    }
  };

  const findSingleCellPlacement = () => {
    for (; ; singleCellCursor += 1) {
      const column = singleCellCursor % columns;
      const row = Math.floor(singleCellCursor / columns);
      ensureRows(row + 1);

      if (rows[row][column] === 0) {
        return { column, row };
      }
    }
  };

  const squareAllocations = allocations
    .map((allocation) => ({
      ...allocation,
      sideCells: Math.min(columns, Math.max(1, Math.ceil(Math.sqrt(allocation.cells))))
    }))
    .sort((left, right) => {
      if (right.sideCells !== left.sideCells) {
        return right.sideCells - left.sideCells;
      }
      return Number(right.entry.size || 0) - Number(left.entry.size || 0);
    });

  for (const allocation of squareAllocations) {
    const placement = allocation.sideCells === 1
      ? findSingleCellPlacement()
      : findSquarePlacement(allocation.sideCells);
    occupy(placement.column, placement.row, allocation.sideCells);
    rects.push({
      entry: allocation.entry,
      x: placement.column * cellSize,
      y: placement.row * cellSize,
      width: allocation.sideCells * cellSize,
      height: allocation.sideCells * cellSize,
      role: 'primary'
    });
  }

  const usedRows = Math.max(visibleRows, rows.length);
  ensureRows(usedRows);
  const fillerEntries = [...squareAllocations].sort((left, right) => {
    if (left.sideCells !== right.sideCells) {
      return left.sideCells - right.sideCells;
    }
    return Number(left.entry.size || 0) - Number(right.entry.size || 0);
  });
  let fillerIndex = 0;

  for (let row = 0; row < usedRows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (rows[row][column] === 1) {
        continue;
      }

      const filler = fillerEntries[fillerIndex % fillerEntries.length];
      fillerIndex += 1;
      rows[row][column] = 1;
      rects.push({
        entry: filler.entry,
        x: column * cellSize,
        y: row * cellSize,
        width: cellSize,
        height: cellSize,
        role: 'filler'
      });
    }
  }

  return {
    rects,
    width: columns * cellSize,
    height: usedRows * cellSize,
    cellSize,
    columns,
    rows: usedRows
  };
}

function worstAspectRatio(row, sideLength) {
  if (row.length === 0 || sideLength <= 0) {
    return Infinity;
  }

  const totalArea = row.reduce((total, item) => total + item.area, 0);
  const minArea = Math.min(...row.map((item) => item.area));
  const maxArea = Math.max(...row.map((item) => item.area));

  if (minArea <= 0 || totalArea <= 0) {
    return Infinity;
  }

  return Math.max(
    (sideLength ** 2 * maxArea) / (totalArea ** 2),
    (totalArea ** 2) / (sideLength ** 2 * minArea)
  );
}

function layoutTreemapRow(row, rect, output) {
  const totalArea = row.reduce((total, item) => total + item.area, 0);

  if (rect.width >= rect.height) {
    const rowHeight = rect.width > 0 ? totalArea / rect.width : 0;
    let x = rect.x;

    for (const item of row) {
      const width = rowHeight > 0 ? item.area / rowHeight : 0;
      output.push({
        entry: item.entry,
        x,
        y: rect.y,
        width,
        height: rowHeight
      });
      x += width;
    }

    rect.y += rowHeight;
    rect.height = Math.max(0, rect.height - rowHeight);
    return;
  }

  const columnWidth = rect.height > 0 ? totalArea / rect.height : 0;
  let y = rect.y;

  for (const item of row) {
    const height = columnWidth > 0 ? item.area / columnWidth : 0;
    output.push({
      entry: item.entry,
      x: rect.x,
      y,
      width: columnWidth,
      height
    });
    y += height;
  }

  rect.x += columnWidth;
  rect.width = Math.max(0, rect.width - columnWidth);
}

export function packedTreemapLayout(entries, width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const visibleEntries = entries.filter((entry) => Number(entry.size || 0) > 0);
  const totalSize = visibleEntries.reduce((total, entry) => total + Number(entry.size || 0), 0);

  if (visibleEntries.length === 0 || totalSize <= 0) {
    return [];
  }

  const totalArea = safeWidth * safeHeight;
  const items = visibleEntries.map((entry) => ({
    entry,
    area: (Number(entry.size || 0) / totalSize) * totalArea
  }));
  const rect = { x: 0, y: 0, width: safeWidth, height: safeHeight };
  const output = [];
  let row = [];

  while (items.length > 0) {
    const item = items[0];
    const sideLength = Math.min(rect.width, rect.height);
    const currentWorst = worstAspectRatio(row, sideLength);
    const nextWorst = worstAspectRatio([...row, item], sideLength);

    if (row.length === 0 || nextWorst <= currentWorst) {
      row.push(item);
      items.shift();
    } else {
      layoutTreemapRow(row, rect, output);
      row = [];
    }
  }

  if (row.length > 0) {
    layoutTreemapRow(row, rect, output);
  }

  return output;
}

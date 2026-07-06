import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function defaultTrashDir() {
  return process.env.DISK_VIEWER_TRASH_DIR || path.join(os.homedir(), '.Trash');
}

async function exists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function uniqueTrashPath(trashDir, sourcePath) {
  const parsed = path.parse(sourcePath);
  let candidate = path.join(trashDir, parsed.base);
  let index = 1;

  while (await exists(candidate)) {
    const suffix = `-${Date.now()}-${index}`;
    candidate = path.join(trashDir, `${parsed.name}${suffix}${parsed.ext}`);
    index += 1;
  }

  return candidate;
}

async function moveOneToTrash(sourcePath, trashDir) {
  const destination = await uniqueTrashPath(trashDir, sourcePath);

  try {
    await fs.rename(sourcePath, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') {
      throw error;
    }

    await fs.cp(sourcePath, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true
    });
    await fs.rm(sourcePath, { recursive: true, force: false });
  }

  return destination;
}

export async function movePathsToTrash(paths, options = {}) {
  const trashDir = options.trashDir || defaultTrashDir();
  await fs.mkdir(trashDir, { recursive: true });

  const moved = [];
  const failed = [];

  for (const sourcePath of paths) {
    try {
      const absolutePath = path.resolve(sourcePath);
      const trashPath = await moveOneToTrash(absolutePath, trashDir);
      moved.push({ path: absolutePath, trashPath });
    } catch (error) {
      failed.push({
        path: path.resolve(sourcePath),
        code: error.code || 'MOVE_FAILED',
        message: error.message
      });
    }
  }

  return { moved, failed };
}

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function revealPathInFinder(targetPath) {
  if (process.platform !== 'darwin') {
    const error = new Error('Opening files in Finder is only available on macOS.');
    error.statusCode = 501;
    throw error;
  }

  try {
    await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const notFound = new Error('Path no longer exists on disk.');
      notFound.statusCode = 404;
      throw notFound;
    }
    throw error;
  }

  await execFileAsync('open', ['-R', targetPath]);
}

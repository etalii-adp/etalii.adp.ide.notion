import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { platform } from 'node:process';
import { ordinal } from '../text/utf8';
import type { FblFiles } from './fblFiles';

/**
 * The file access of the library on Node's own modules, which is what the extension host runs on.
 * A link is anything `lstat` reports as a symbolic link, which on Windows includes a junction.
 */
export const nodeFiles: FblFiles = {
  read(path) {
    try {
      return new Uint8Array(readFileSync(path));
    } catch {
      return undefined;
    }
  },

  kind(path) {
    try {
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) return 'link';
      if (entry.isDirectory()) return 'folder';
      return entry.isFile() ? 'file' : undefined;
    } catch {
      return undefined;
    }
  },

  list(folder) {
    try {
      return readdirSync(folder).sort(ordinal);
    } catch {
      return [];
    }
  },

  // Windows and macOS do not tell names apart by case, by the platform's convention.
  ignoresCase: platform === 'win32' || platform === 'darwin',
};

// Paths as text. The library has no working directory and imports no path module: a path is the
// caller's, with either separator, and what is made from it keeps the separator it came with.

const isSeparator = (character: string): boolean => character === '/' || character === '\\';

/** The separator a path is written with: a backslash when it has one or starts with a drive, else a slash. */
export const separatorOf = (path: string): string => (path.includes('\\') || /^[A-Za-z]:/.test(path) ? '\\' : '/');

/** The root a path starts with (`/`, `C:\`, `\\server\share\`), or nothing for a relative path. */
function rootOf(path: string): string {
  const drive = /^[A-Za-z]:[\\/]?/.exec(path);
  if (drive) return drive[0];
  const share = /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?/.exec(path);
  if (share) return share[0];
  return path.length > 0 && isSeparator(path[0]) ? path[0] : '';
}

/** Whether a path says where it starts: at a root, or on a drive. */
export const isRooted = (path: string): boolean => rootOf(path).length > 0;

/** A path without `.` and `..` segments and with one separator between segments. */
export function normalize(path: string): string {
  const separator = separatorOf(path);
  const root = rootOf(path);
  const segments: string[] = [];
  for (const segment of path.slice(root.length).split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
    else if (segment !== '..' || root.length === 0) segments.push(segment);
  }
  const start = root.replace(/[\\/]/g, separator);
  return start + segments.join(separator);
}

/** A folder's path and a path relative to it, as one normalized path. */
export function join(folder: string, relative: string): string {
  if (folder.length === 0) return normalize(relative);
  const separator = separatorOf(folder);
  return normalize(folder + separator + relative);
}

/** The folder a path is in; empty for a name alone. */
export function folderOf(path: string): string {
  const root = rootOf(path);
  let end = path.length;
  while (end > root.length && isSeparator(path[end - 1])) end--;
  while (end > root.length && !isSeparator(path[end - 1])) end--;
  if (end <= root.length) return root;
  while (end > root.length && isSeparator(path[end - 1])) end--;
  return path.slice(0, end);
}

/** The last segment of a path. */
export function nameOf(path: string): string {
  let end = path.length;
  while (end > 0 && isSeparator(path[end - 1])) end--;
  let start = end;
  while (start > 0 && !isSeparator(path[start - 1])) start--;
  return path.slice(start, end);
}

/** A name's extension with its dot, as the baseline's platform has it: from the last dot, and empty when the name ends with it. */
export function extensionOf(path: string): string {
  const name = nameOf(path);
  const dot = name.lastIndexOf('.');
  return dot < 0 || dot === name.length - 1 ? '' : name.slice(dot);
}

/** A path's last segment without its extension. */
export function baseNameOf(path: string): string {
  const name = nameOf(path);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

/** Whether `path` is `root` or below it; both normalized. */
export function isWithin(root: string, path: string, ignoreCase: boolean): boolean {
  const fold = (text: string): string => (ignoreCase ? text.toUpperCase() : text);
  const separator = separatorOf(root);
  const prefix = isSeparator(root[root.length - 1] ?? '') ? root : root + separator;
  return fold(path) === fold(root) || fold(path).startsWith(fold(prefix));
}

/** A path relative to a folder as `/`-separated text, for a path that is within it. */
export const relativeTo = (folder: string, path: string): string => path.slice(folder.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');

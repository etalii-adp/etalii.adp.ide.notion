import type { FblBinding, FileRule } from '../documents/types';
import type { FblFiles } from '../files/fblFiles';
import { separatorOf } from '../files/paths';
import { ordinal } from '../text/utf8';
import { globMatches } from './glob';

// Folder subjects (FBL 10): whether a folder qualifies by `recognise`, and which of its files the
// file rules select, in ordinal order of relative path. A link is neither followed nor read.

/** A file of a folder subject (FBL 10.2): its `/`-separated path relative to the folder and the file rule that selected it. */
export interface FolderFile {
  readonly relativePath: string;
  readonly fullPath: string;
  readonly rule: FileRule;
}

/**
 * Whether `folder` qualifies (FBL 10.1): every `all` glob matches an entry, at least one `any` glob
 * does when there are any, and no `none` glob does.
 */
export function recogniseFolder(binding: FblBinding, folder: string, files: FblFiles, ignoreCase = files.ignoresCase): boolean {
  if (!binding.body.isFolder || files.kind(folder) !== 'folder') return false;
  const entries = entriesOf(folder, files, true).map((entry) => entry.relative);
  const any = (glob: string): boolean => entries.some((entry) => globMatches(glob, entry, ignoreCase));
  const body = binding.body;
  return body.recogniseAll.every(any) && (body.recogniseAny.length === 0 || body.recogniseAny.some(any)) && !body.recogniseNone.some(any);
}

/** The files the binding's file rules select (FBL 10.2), first matching rule each, `ignore` excluded. */
export function folderFiles(binding: FblBinding, folder: string, files: FblFiles, ignoreCase = files.ignoresCase): FolderFile[] {
  const found: FolderFile[] = [];
  for (const { relative, full } of entriesOf(folder, files, false)) {
    if (binding.body.ignore.some((glob) => globMatches(glob, relative, ignoreCase))) continue;
    const rule = binding.body.files.find((candidate) => globMatches(candidate.glob, relative, ignoreCase));
    if (rule) found.push({ relativePath: relative, fullPath: full, rule });
  }
  return found;
}

/** Every entry under the folder, relative and `/`-separated, in ordinal order, never through a link. */
function entriesOf(folder: string, files: FblFiles, includeFolders: boolean): { relative: string; full: string }[] {
  const found: { relative: string; full: string }[] = [];
  const separator = separatorOf(folder);
  const walk = (directory: string, prefix: string): void => {
    for (const name of files.list(directory)) {
      const full = directory.endsWith(separator) ? directory + name : directory + separator + name;
      const kind = files.kind(full);
      if (kind === 'folder') {
        if (includeFolders) found.push({ relative: prefix + name, full });
        walk(full, `${prefix}${name}/`);
      } else if (kind === 'file') {
        found.push({ relative: prefix + name, full });
      }
    }
  };
  walk(folder, '');
  return found.sort((a, b) => ordinal(a.relative, b.relative));
}

import type { FblBinding } from '../documents/types';
import type { FblFiles } from '../files/fblFiles';
import { baseNameOf, folderOf, isRooted, isWithin, join, normalize } from '../files/paths';
import { messages } from '../messages';
import type { RegistrationDocument } from './registrationDocument';

/** Where a registration's body is (FBL 8.2), or why it is not opened. */
export interface BodyLocation {
  readonly path?: string;
  readonly exists: boolean;
  readonly isFolder: boolean;
  readonly refusal?: string;
  /** A missing body opens empty with `fbl.missing-body`, and nothing is written until the registration names a file. */
  readonly isMissing: boolean;
}

const refused = (refusal: string): BodyLocation => ({ exists: false, isFolder: false, refusal, isMissing: false });

/**
 * Finds a registration's body (FBL 8.2): the `body` header relative to the registration's folder,
 * else the sibling with the registration's base name and the first existing claimed extension, else
 * the registration's folder for a folder binding. A body outside the workspace root, or reached
 * through a link, is refused (FBL 16). The paths are taken as given: a caller that wants them
 * compared as absolute paths gives them as such.
 */
export function locateBody(registrationPath: string, registration: RegistrationDocument, binding: FblBinding, workspaceRoot: string, files: FblFiles): BodyLocation {
  const folder = folderOf(normalize(registrationPath));
  const root = normalize(workspaceRoot);
  const body = registration.body;
  let candidate: string;
  if (body !== undefined) {
    if (isRooted(body)) return refused(messages.bodyAbsolute);
    candidate = join(folder, body);
  } else if (binding.body.isFolder) {
    candidate = folder;
  } else {
    const baseName = baseNameOf(registrationPath);
    const siblings = binding.claims.extensions.map((extension) => join(folder, baseName + extension));
    candidate = siblings.find((sibling) => files.kind(sibling) === 'file') ?? siblings[0] ?? join(folder, baseName);
  }
  if (!isWithin(root, candidate, files.ignoresCase)) return refused(messages.bodyOutside);
  if (throughLink(root, candidate, files)) return refused(messages.bodyThroughLink);
  const isFolder = binding.body.isFolder;
  const exists = files.kind(candidate) === (isFolder ? 'folder' : 'file');
  return { path: candidate, exists, isFolder, isMissing: !exists };
}

/** Whether any component from below the root to the path itself is a link. */
function throughLink(root: string, path: string, files: FblFiles): boolean {
  for (let current = path; current.length > root.length; current = folderOf(current)) {
    if (files.kind(current) === 'link') return true;
    if (folderOf(current) === current) break;
  }
  return false;
}

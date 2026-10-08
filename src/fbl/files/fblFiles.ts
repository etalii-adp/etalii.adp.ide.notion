/**
 * What the library asks of a disk. It reads bytes it is handed and returns bytes, and never writes
 * a file; only three things look at a disk through this: resolving a binding reference from a path,
 * finding a registration's body (FBL 8.2, with the checks of FBL 16), and recognising and listing a
 * folder subject (FBL 10). Paths are the caller's own, with either separator.
 */
export interface FblFiles {
  /** The bytes of a file, or nothing when there is none to read. */
  read(path: string): Uint8Array | undefined;
  /** What is at a path, never following a link: a link is reported as a link, whatever it points at. */
  kind(path: string): 'file' | 'folder' | 'link' | undefined;
  /** The names of a folder's entries, in ordinal order; empty when the folder cannot be listed. */
  list(folder: string): readonly string[];
  /** Whether names differing only in case name the same file here. */
  readonly ignoresCase: boolean;
}

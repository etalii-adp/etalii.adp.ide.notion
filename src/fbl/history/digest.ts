import { createHash } from 'node:crypto';

/** The SHA-256 of bytes, in hexadecimal: what the history compares to notice that a file changed underneath it (FBL 7.2). */
export const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

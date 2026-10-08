import { messages } from './messages';
import { byteLength, decode, encode } from './text/utf8';

/** The eleven splice operations of FBL 6.1. Every write is one of these and nothing else. */
export type SpliceOperation =
  | 'replace-value' | 'insert-key' | 'remove-key' | 'insert-entry' | 'remove-entry'
  | 'ensure-container' | 'remove-container' | 'rewrite-reference'
  | 're-emit-line' | 'open-block' | 'self-close';

export const spliceOperations: readonly SpliceOperation[] = [
  'replace-value', 'insert-key', 'remove-key', 'insert-entry', 'remove-entry',
  'ensure-container', 'remove-container', 'rewrite-reference',
  're-emit-line', 'open-block', 'self-close',
];

/** The replacement of the bytes `start` to `end` with `text`. */
export interface FblSplice {
  readonly operation: SpliceOperation;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * One edit: the splices one model change was planned as, applied together, recorded together and
 * undone together (FBL 6.4). Offsets refer to the body before the edit.
 */
export interface Edit {
  readonly splices: readonly FblSplice[];
  readonly snapshot?: boolean;
}

export const emptyEdit: Edit = { splices: [] };

export const spliceText = (splice: FblSplice): string => `${splice.operation} ${splice.start}-${splice.end} "${splice.text}"`;

/** Applies splices to bytes, in order, offsets referring to the bytes before. */
export function applySplices(bytes: Uint8Array, splices: readonly FblSplice[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let position = 0;
  let length = 0;
  const push = (part: Uint8Array): void => {
    parts.push(part);
    length += part.length;
  };
  for (const splice of splices) {
    if (splice.start < position || splice.end < splice.start || splice.end > bytes.length) {
      throw new Error(messages.splicesOverlap(spliceText(splice), position));
    }
    push(bytes.subarray(position, splice.start));
    push(encode(splice.text));
    position = splice.end;
  }
  push(bytes.subarray(position));
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/**
 * The splices that undo `splices` once applied to `before`: each puts its replaced bytes back, at
 * its offset in the body after the edit, under its own operation (FBL 15.3).
 */
export function inverseSplices(before: Uint8Array, splices: readonly FblSplice[]): FblSplice[] {
  const inverse: FblSplice[] = [];
  let shift = 0;
  for (const splice of splices) {
    const start = splice.start + shift;
    const written = byteLength(splice.text);
    inverse.push({ operation: splice.operation, start, end: start + written, text: decode(before, splice.start, splice.end) });
    shift += written - (splice.end - splice.start);
  }
  return inverse;
}

/** The bytes after an edit, for a caller that holds the bytes itself. */
export const applyEdit = (bytes: Uint8Array, edit: Edit): Uint8Array => applySplices(bytes, edit.splices);

/** The edit that undoes `edit` once it was applied to `bytes`. */
export const inverseOf = (bytes: Uint8Array, edit: Edit): Edit => ({ splices: inverseSplices(bytes, edit.splices) });

/**
 * Splices in body order: sorted by start, those at one offset kept in the order they were planned
 * (FBL 6.5). Overlapping splices are a planning error, reported with `overlap`.
 */
export function orderSplices(splices: readonly FblSplice[], overlap: (first: string, second: string) => string): FblSplice[] {
  const ordered = splices.map((splice, index) => ({ splice, index })).sort((a, b) => a.splice.start - b.splice.start || a.index - b.index).map((entry) => entry.splice);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end) throw new Error(overlap(spliceText(ordered[i - 1]), spliceText(ordered[i])));
  }
  return ordered;
}

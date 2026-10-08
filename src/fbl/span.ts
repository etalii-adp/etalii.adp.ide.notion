/** A range of UTF-8 byte offsets into a body, `end` exclusive. A byte-order mark counts. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export const span = (start: number, end: number): Span => ({ start, end });

export const lengthOf = (range: Span): number => range.end - range.start;

export const sameSpan = (a: Span, b: Span): boolean => a.start === b.start && a.end === b.end;

export const spanText = (range: Span): string => `[${range.start}, ${range.end})`;

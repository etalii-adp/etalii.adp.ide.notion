import { isMap, isScalar, parseAllDocuments } from 'yaml';
import { scalarText } from '../documents/jsonReader';
import type { Marker } from '../documents/types';
import { BoundedRegex, RegexBudgetError } from '../expressions/regexMatcher';
import { defaultRegexSteps } from '../model';
import { BodyText } from '../text/bodyText';

/** The number of lines a pattern marker looks at when it names none (FBL 12.2). */
export const defaultMarkerLines = 20;

/**
 * Evaluates a marker (FBL 12.2) on a body's bytes without reading it through a binding: a root key
 * of a yaml or json body, a prefix of the first line after a byte-order mark, or an expression one
 * of the first lines matches.
 */
export function markerMatches(marker: Marker, bytes: Uint8Array, regexSteps = defaultRegexSteps): boolean {
  const text = new BodyText(bytes);
  if (!text.isValidUtf8) return false;
  const contentOf = (index: number): string => text.text(Math.max(text.lines[index].start, text.bomLength), text.lines[index].contentEnd);
  if (marker.rootKey !== undefined) return hasRootKey(text, marker.rootKey, marker.rootValue ? scalarText(marker.rootValue) : undefined);
  if (marker.firstLine !== undefined) return contentOf(0).startsWith(marker.firstLine);
  if (marker.pattern !== undefined) {
    const regex = new BoundedRegex(marker.pattern, false, regexSteps);
    const lines = Math.min(text.lines.length, marker.lines > 0 ? marker.lines : defaultMarkerLines);
    for (let index = 0; index < lines; index++) {
      try {
        if (regex.isMatch(contentOf(index))) return true;
      } catch (error) {
        // A line the expression takes too long on is read as not matching.
        if (!(error instanceof RegexBudgetError)) throw error;
      }
    }
  }
  return false;
}

/** A root key of a yaml or json body (json is read as the yaml it also is), with its scalar value when one is asked. */
function hasRootKey(text: BodyText, key: string, value: string | undefined): boolean {
  const documents = parseAllDocuments(text.text(text.bomLength, text.length), { uniqueKeys: false, prettyErrors: false, logLevel: 'silent' });
  if (documents.length === 0 || documents.some((document) => document.errors.length > 0)) return false;
  const root = documents[0].contents;
  if (!isMap(root)) return false;
  const written = (node: unknown): string | undefined => (isScalar(node) ? (typeof node.source === 'string' ? node.source : String(node.value)) : undefined);
  for (const pair of root.items) {
    if (written(pair.key) !== key) continue;
    return value === undefined || written(pair.value) === value;
  }
  return false;
}

import type { FblBinding } from '../documents/types';
import { nodeFiles } from '../files/nodeFiles';
import { extensionOf, nameOf } from '../files/paths';
import { decode } from '../text/utf8';
import { globMatches } from './glob';
import { markerMatches } from './markerEvaluator';

// Routing (FBL 12.3) and offering readings (FBL 9.4). The router returns every candidate and never
// chooses between several on the caller's behalf.

/** The part of a body `suggest` looks at (FBL 12.1). */
export const suggestBytes = 64 * 1024;

/**
 * The bindings a bare file routes to (FBL 12.3): those whose `names` match the file name or whose
 * `extensions` include its extension, ignoring case; never a `registrationOnly` binding; and a
 * binding with a marker only when the marker matches, which FBL 12.1 calls the mark a file needs
 * before the binding claims it. `ignoreCase` says whether names are matched ignoring case, which
 * by default is the platform's convention.
 */
export function candidates(fileName: string, bytes: Uint8Array, bindings: readonly FblBinding[], ignoreCase = nodeFiles.ignoresCase): FblBinding[] {
  const name = nameOf(fileName);
  const extension = extensionOf(name).toUpperCase();
  return bindings.filter((binding) => {
    const claims = binding.claims;
    if (claims.registrationOnly) return false;
    const named = claims.names.some((glob) => globMatches(glob, name, ignoreCase));
    const extended = extension.length > 0 && claims.extensions.some((claimed) => claimed.toUpperCase() === extension);
    if (!named && !extended) return false;
    if (claims.marker && !markerMatches(claims.marker, bytes)) return false;
    return !(claims.shared && !claims.marker);
  });
}

/** Whether the binding's `suggest` matches the body's first 64 KiB (FBL 12.3). */
export const suggests = (binding: FblBinding, bytes: Uint8Array): boolean => contains(bytes, binding.claims.suggest);

/**
 * The readings a binding offers for a body (FBL 9.4): each origin in `claims.origins` order, those
 * whose reading's `suggest` matches the body first.
 */
export function readings(binding: FblBinding, bytes: Uint8Array): string[] {
  const origins = binding.claims.origins;
  const suggested = origins.filter((origin) => suggestsReading(binding, origin, bytes));
  return [...new Set([...suggested, ...origins])];
}

/** The reading a bare file opens as (FBL 12.3): the one marked `bare`, else the binding's only origin, else none. */
export function bare(binding: FblBinding): string | undefined {
  for (const [origin, reading] of binding.claims.readings) {
    if (reading.bare) return origin;
  }
  return binding.claims.origins.length === 1 ? binding.claims.origins[0] : undefined;
}

/** Whether a reading's `suggest` matches the body (FBL 9.4). */
export function suggestsReading(binding: FblBinding, origin: string, bytes: Uint8Array): boolean {
  const reading = binding.claims.readings.get(origin);
  return reading !== undefined && contains(bytes, reading.suggest);
}

function contains(bytes: Uint8Array, substrings: readonly string[]): boolean {
  if (substrings.length === 0) return false;
  const head = decode(bytes, 0, Math.min(bytes.length, suggestBytes));
  return substrings.some((substring) => head.includes(substring));
}

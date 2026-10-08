import type { Entry } from './familyReader';

// FBL 4.2 selectors over the entries of a tree (yaml, json) or of an xml document: keys and names,
// `*`, `**`, `{capture}` and `name[@A='v']`, absolute from the root or relative to an entry.

export interface Selected {
  readonly entry: Entry;
  readonly captures: ReadonlyMap<string, string>;
}

type Segment =
  | { readonly kind: 'any' }
  | { readonly kind: 'descendants' }
  | { readonly kind: 'capture'; readonly name: string }
  | { readonly kind: 'name'; readonly name: string; readonly attribute?: string; readonly value?: string };

function parseSegment(text: string): Segment {
  if (text === '*') return { kind: 'any' };
  if (text === '**') return { kind: 'descendants' };
  if (text.startsWith('{') && text.endsWith('}')) return { kind: 'capture', name: text.slice(1, -1) };
  const bracket = text.indexOf('[@');
  if (bracket > 0 && text.endsWith('\']')) {
    const predicate = text.slice(bracket + 2, -1);
    const equals = predicate.indexOf('=\'');
    if (equals > 0) return { kind: 'name', name: text.slice(0, bracket), attribute: predicate.slice(0, equals), value: predicate.slice(equals + 2, -1) };
  }
  return { kind: 'name', name: text };
}

/** The entries `selector` reaches from `from`, in document order, each with its captures. */
export function select(from: Entry, selector: string, attributeEquals?: (entry: Entry, attribute: string, value: string) => boolean): Selected[] {
  const segments = selector.split('/').filter((segment) => segment.length > 0).map(parseSegment);
  const results: Selected[] = [];
  const seen = new Set<Entry>();

  const walk = (entry: Entry, index: number, captures: ReadonlyMap<string, string>): void => {
    if (index === segments.length) {
      if (!seen.has(entry)) {
        seen.add(entry);
        results.push({ entry, captures: new Map(captures) });
      }
      return;
    }
    const segment = segments[index];
    if (segment.kind === 'descendants') {
      walk(entry, index + 1, captures);
      for (const child of entry.children) walk(child, index, captures);
      return;
    }
    for (const child of entry.children) {
      switch (segment.kind) {
        case 'any':
          walk(child, index + 1, captures);
          break;
        case 'capture':
          if (child.name === undefined) break;
          walk(child, index + 1, new Map([...captures, [segment.name, child.name]]));
          break;
        case 'name':
          if (child.name !== segment.name) break;
          if (segment.attribute !== undefined && (!attributeEquals || !attributeEquals(child, segment.attribute, segment.value!))) break;
          walk(child, index + 1, captures);
          break;
      }
    }
  };

  walk(from, 0, new Map());
  return results.sort((a, b) => a.entry.own.start - b.entry.own.start || b.entry.own.end - a.entry.own.end);
}

/** The root a selector starts from: the document root for an absolute selector, else `relativeTo`. */
export const selectorStart = (selector: string, root: Entry, relativeTo: Entry | undefined): Entry => (selector.startsWith('/') || !relativeTo ? root : relativeTo);

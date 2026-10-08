// Finds every CEL expression of a specification by walking it beside DISL's JSON Schema: a value
// the schema types as `CelSource` is CEL, and so is a `GeomExpr` string that is not a percentage
// (DISL 2.5). The schema leaves some values untyped (a shape's parameters, a tool's `initial`), so
// every `{ "cel": … }` object the walk did not reach is added: that form is CEL wherever it stands.
//
// `test/fixtures/disl.schema.json` is a copy of etalii.adp's `specifications/disl/disl.schema.json`.

import { readFileSync } from 'node:fs';

type Schema = boolean | { readonly [keyword: string]: unknown };

const schema = JSON.parse(readFileSync(new URL('../fixtures/disl.schema.json', import.meta.url), 'utf8')) as { $defs: Record<string, Schema | undefined> };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const typeOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;

// A reference into another schema (the inline FBL binding) is not followed: no expression of DISL lives there.
const defOf = (ref: string): string => (ref.startsWith('#/$defs/') ? ref.slice(8) : '');

// Whether a value could be of a schema, as far as choosing a branch of `anyOf` needs: its type, its
// constant, its required members and its closed set of members.
function fits(value: unknown, candidate: Schema): boolean {
  if (typeof candidate === 'boolean') return candidate;
  if (typeof candidate.$ref === 'string' && !fits(value, schema.$defs[defOf(candidate.$ref)] ?? true)) return false;
  const type = typeOf(value);
  const types = candidate.type === undefined ? undefined : ([] as unknown[]).concat(candidate.type);
  if (types && !types.includes(type) && !(type === 'integer' && types.includes('number'))) return false;
  if ('const' in candidate && candidate.const !== value) return false;
  if (Array.isArray(candidate.enum) && !candidate.enum.includes(value)) return false;
  if (typeof candidate.pattern === 'string' && typeof value === 'string' && !new RegExp(candidate.pattern, 'u').test(value)) return false;
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(candidate[key]) && !(candidate[key] as Schema[]).some((branch) => fits(value, branch))) return false;
  }
  if (!isObject(value)) return true;
  if (Array.isArray(candidate.required) && !candidate.required.every((name) => (name as string) in value)) return false;
  if (candidate.additionalProperties !== false) return true;
  const properties = isObject(candidate.properties) ? candidate.properties : {};
  const patterns = Object.keys(isObject(candidate.patternProperties) ? candidate.patternProperties : {});
  return Object.keys(value).every((name) => name in properties || patterns.some((pattern) => new RegExp(pattern, 'u').test(name)));
}

export interface Found {
  /** A JSON Pointer into the specification. */
  readonly path: string;
  readonly cel: string;
  readonly kind: 'expression' | 'geometry' | 'untyped';
}

export function expressionsOf(specification: unknown): Found[] {
  const found = new Map<string, Found>();
  const walk = (value: unknown, candidate: Schema, path: string): void => {
    if (typeof candidate === 'boolean') return;
    if (typeof candidate.$ref === 'string') {
      const name = defOf(candidate.$ref);
      if (name === 'CelSource' && typeof value === 'string') found.set(path, { path, cel: value, kind: 'expression' });
      else if (name === 'GeomExpr') { if (typeof value === 'string' && !/^-?[\d.]+%$/.test(value)) found.set(path, { path, cel: value, kind: 'geometry' }); }
      else walk(value, schema.$defs[name] ?? true, path);
    }
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      for (const branch of (candidate[key] as Schema[] | undefined) ?? []) if (key === 'allOf' || fits(value, branch)) walk(value, branch, path);
    }
    if (isObject(value)) {
      const properties = isObject(candidate.properties) ? candidate.properties : {};
      const patterns = Object.entries(isObject(candidate.patternProperties) ? candidate.patternProperties : {});
      for (const [name, member] of Object.entries(value)) {
        const matching = patterns.filter(([pattern]) => new RegExp(pattern, 'u').test(name));
        if (name in properties) walk(member, properties[name] as Schema, `${path}/${name}`);
        else if (matching.length > 0) for (const [, typed] of matching) walk(member, typed as Schema, `${path}/${name}`);
        else if (isObject(candidate.additionalProperties)) walk(member, candidate.additionalProperties, `${path}/${name}`);
      }
    }
    if (Array.isArray(value)) {
      const prefix = (candidate.prefixItems as Schema[] | undefined) ?? [];
      value.forEach((item, index) => {
        const typed = index < prefix.length ? prefix[index] : candidate.items;
        if (typed !== undefined) walk(item, typed as Schema, `${path}/${index}`);
      });
    }
  };
  walk(specification, schema.$defs.Specification ?? true, '');

  const rest = (value: unknown, path: string): void => {
    if (Array.isArray(value)) value.forEach((item, index) => rest(item, `${path}/${index}`));
    if (!isObject(value)) return;
    if (typeof value.cel === 'string' && !found.has(`${path}/cel`)) found.set(`${path}/cel`, { path: `${path}/cel`, cel: value.cel, kind: 'untyped' });
    for (const [name, member] of Object.entries(value)) rest(member, `${path}/${name}`);
  };
  rest(specification, '');
  return [...found.values()];
}

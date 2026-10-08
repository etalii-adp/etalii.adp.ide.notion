import type { FblBinding } from '../documents/types';
import { baseNameOf, nameOf } from '../files/paths';
import type { PersistencePlugin } from '../plugins/persistencePlugin';
import { encode, isAsciiDigit, isAsciiLetterOrDigit } from '../text/utf8';

// New bodies from a binding's template (FBL 13): `template.byOrigin[origin]` before
// `template.text`, else the plugin's `template` operation; the four placeholders replaced and
// nothing else. A template is text, never evaluated.

const placeholder = /\{(name|base|key|newid:[A-Za-z_][A-Za-z0-9_-]*)\}/g;

/**
 * The bytes of a new body named `fileName`, or nothing when the binding has no template and no
 * plugin was given to make one. `newId` makes an id by DISL's strategy for a rule's type
 * (`{newid:<rule>}`).
 */
export function produceTemplate(binding: FblBinding, origin: string | undefined, fileName: string, newId: (rule: string) => string, plugin?: PersistencePlugin): Uint8Array | undefined {
  const template = binding.template;
  if (template) return encode(replacePlaceholders((origin !== undefined ? template.byOrigin.get(origin) : undefined) ?? template.text, fileName, newId));
  if (binding.plugin && plugin) return plugin.template({ name: nameOf(fileName), placeholders: placeholdersOf(fileName) });
  return undefined;
}

/** Replaces the four placeholder forms of FBL 13 and leaves every other brace literal. */
export function replacePlaceholders(template: string, fileName: string, newId: (rule: string) => string): string {
  const values = placeholdersOf(fileName);
  return template.replace(placeholder, (_match, name: string) => (name.startsWith('newid:') ? newId(name.slice(6)) : values.get(name)!));
}

/** The values of `{name}`, `{base}` and `{key}` for a new file. */
export function placeholdersOf(fileName: string): ReadonlyMap<string, string> {
  const name = nameOf(fileName);
  const base = baseNameOf(name);
  return new Map([['name', name], ['base', base], ['key', templateKey(base)]]);
}

/**
 * `{key}` (FBL 13): every character outside ASCII letters, digits and `_` replaced by `_`, leading
 * and trailing `_` removed, `_` prefixed when it then starts with a digit, and `untitled` when
 * nothing is left.
 */
export function templateKey(baseName: string): string {
  let key = '';
  for (let i = 0; i < baseName.length; i++) key += isAsciiLetterOrDigit(baseName[i]) || baseName[i] === '_' ? baseName[i] : '_';
  key = key.replace(/^_+|_+$/g, '');
  if (key.length === 0) return 'untitled';
  return isAsciiDigit(key[0]) ? `_${key}` : key;
}

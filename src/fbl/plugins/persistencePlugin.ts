import type { Finding } from '../finding';
import type { FblElement } from '../model';
import type { ModelChange } from '../planning/modelChange';
import type { FblSplice } from '../splice';

/** One file a plugin reads: the body itself (`relativePath` empty) or a file of a folder subject. */
export interface PluginFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

/** What `read` is given: the files, and the `args` of the binding's `reader` as the document has them. */
export interface PluginReadRequest {
  readonly files: readonly PluginFile[];
  readonly args?: unknown;
}

/** What `read` delivers: the elements and relations with their source spans, the findings, and whether the body is unreadable. */
export interface PluginReadResult {
  readonly elements: readonly FblElement[];
  readonly findings: readonly Finding[];
  readonly unreadable: boolean;
}

export interface PluginPlanRequest {
  readonly files: readonly PluginFile[];
  readonly last: PluginReadResult;
  readonly change: ModelChange;
  readonly args?: unknown;
}

/** One splice of a plugin's plan, in the file it names (empty for a file body). */
export interface PluginSplice {
  readonly file: string;
  readonly splice: FblSplice;
}

/** What `plan` delivers: splices, or the sentence the host shows when the change is refused. */
export type PluginPlanResult = { readonly planned: readonly PluginSplice[] } | { readonly refused: string };

export interface PluginTemplateRequest {
  readonly name: string;
  readonly placeholders: ReadonlyMap<string, string>;
}

/**
 * The persistence plugin contract of FBL 11.2, as data exchanged through an interface so that a
 * host binds it to its own plugin mechanism. A plugin reads and plans; it never writes files, keeps
 * no undo history and stores no view data (FBL 11.4). No plugin is part of this library.
 */
export interface PersistencePlugin {
  /** The plugin's id, as a binding's `reader.plugin` names it. */
  readonly id: string;
  /** `read`: the model of a body, never failing on content. */
  read(request: PluginReadRequest): PluginReadResult;
  /** `plan`: the splices that realise one model change, or the refusal the host shows. */
  plan(request: PluginPlanRequest): PluginPlanResult;
  /** `template`: the bytes of a new body, asked only when the binding has no `template.text`. */
  template(request: PluginTemplateRequest): Uint8Array;
  /** `watch`: the paths a folder subject's reading depends on beyond its file rules. */
  watch?(last: PluginReadResult): readonly string[];
}

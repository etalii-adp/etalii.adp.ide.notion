// The open document of a store (etalii.adp spec 012, contracts/shared-parts.md, "Interfaces").
// `openDocument` is added to this file by the task that reads a store.

import type { Finding, Model } from '../disl/model';
import type { ModelChange } from '../fbl/planning/modelChange';
import type { CommandHandler } from '../history/command';

export interface OpenDocument {
  /** Elements and relations, as the specification's metamodel types them. */
  readonly model: Model;
  readonly findings: readonly Finding[];
  readonly state: 'ready' | 'read-only' | 'unreadable' | 'unprepared';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The handlers of this document's commands, brought by the store and by a part. */
  register(handler: CommandHandler): void;
  /** One gesture, one command, one step. */
  edit(change: ModelChange): EditResult;
  undo(): EditResult;
  redo(): EditResult;
  prepare(): Promise<void>;
  reload(): Promise<void>;
  subscribe(listener: (event: DocumentEvent) => void): () => void;
  close(): void;
}

/** A refusal carries the specification's or the binding's sentence. */
export type EditResult =
  | { readonly done: true }
  | { readonly done: false; readonly sentence: string };

export type DocumentEvent =
  /** The model differs; draw again. */
  | { readonly kind: 'changed' }
  | { readonly kind: 'status'; readonly status: 'idle' | 'loading' | 'storing' | 'offline' | 'failed' }
  /** The store was read again; the history is empty. */
  | { readonly kind: 'reloaded'; readonly sentence: string };

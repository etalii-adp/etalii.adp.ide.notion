import type { FblBinding } from '../documents/types';
import { findingCodes } from '../finding';
import { SplicedFile } from '../history/splicedFile';
import { messages } from '../messages';
import { FblModel } from '../model';
import type { ModelChange } from '../planning/modelChange';
import type { PlanResult } from '../planning/plan';
import { orderSplices } from '../splice';
import type { PersistencePlugin, PluginReadResult } from './persistencePlugin';

/**
 * A file body read by a persistence plugin (FBL 11.3): the plugin reads and plans, and this host
 * side applies the splices, keeps the history, checks drift and saves, exactly as for a declared
 * body. Without the plugin the body opens read-only with DISL's `std.pluginMissing` (FBL 15.1).
 */
export class PluginBody extends SplicedFile {
  private readonly plugin?: PersistencePlugin;
  private last: PluginReadResult;

  private constructor(bytes: Uint8Array, readonly binding: FblBinding, plugin: PersistencePlugin | undefined, readonly fileName: string) {
    super(bytes);
    this.plugin = plugin && plugin.id === binding.plugin!.plugin ? plugin : undefined;
    this.last = this.readNow();
  }

  /**
   * Opens a body whose binding names a plugin. `plugin` is the one the caller has installed, or
   * nothing; a plugin with another id counts as missing.
   */
  static open(bytes: Uint8Array, binding: FblBinding, plugin?: PersistencePlugin, fileName = 'body'): PluginBody {
    if (!binding.plugin) throw new Error(messages.notReadByPlugin(binding.name));
    return new PluginBody(bytes, binding, plugin, fileName);
  }

  get model(): FblModel {
    return new FblModel(this.last.elements, this.last.findings, this.last.unreadable);
  }

  /** Read-only without the plugin, when the plugin reports the body unreadable, or when the binding is read-only. */
  get isReadOnly(): boolean {
    return !this.plugin || this.last.unreadable || this.binding.readOnly !== undefined;
  }

  plan(change: ModelChange): PlanResult {
    if (!this.plugin) return { refused: this.missingReason };
    if (this.last.unreadable) return { refused: messages.neverWritten };
    const readOnly = this.binding.readOnly;
    if (readOnly !== undefined) return { refused: readOnly.length > 0 ? readOnly : messages.readOnlyFile };
    if (change.kind === 'save') return { planned: { splices: [] } };
    const result = this.plugin.plan({ files: [{ relativePath: '', bytes: this.bytes }], last: this.last, change, args: this.binding.plugin!.args });
    if (!result) throw new Error(messages.pluginNoPlan);
    if ('refused' in result) return { refused: result.refused };
    if (result.planned.some((planned) => planned.file.length > 0)) return { refused: messages.pluginOtherFile };
    // A plugin's splices in body order, as FBL 6.5 applies them; overlapping splices are the plugin's error.
    return { planned: { splices: orderSplices(result.planned.map((planned) => planned.splice), messages.pluginSplicesOverlap) } };
  }

  change(change: ModelChange): PlanResult {
    const result = this.plan(change);
    if ('planned' in result) this.apply(result.planned);
    return result;
  }

  /** Hands the body's bytes to the host's atomic writer, as an open body does; never a read-only body. */
  save(write: (bytes: Uint8Array) => void): void {
    if (this.isReadOnly) throw new Error(messages.pluginBodyReadOnly);
    write(this.bytes);
  }

  private get missingReason(): string {
    return messages.pluginMissing(this.binding.plugin!.plugin);
  }

  private readNow(): PluginReadResult {
    if (!this.plugin) {
      return {
        elements: [],
        findings: [{ code: findingCodes.pluginMissing, severity: 'warning', message: this.missingReason, location: { file: this.fileName, line: 1, column: 1, length: 0 } }],
        unreadable: false,
      };
    }
    return this.plugin.read({ files: [{ relativePath: '', bytes: this.bytes }], args: this.binding.plugin!.args });
  }

  protected reread(): void {
    this.last = this.readNow();
  }
}

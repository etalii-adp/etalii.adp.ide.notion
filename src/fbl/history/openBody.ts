import type { FblBinding } from '../documents/types';
import { messages } from '../messages';
import type { FblModel, FblOptions } from '../model';
import { planEdit } from '../planning/editPlanner';
import type { ModelChange } from '../planning/modelChange';
import type { PlanResult } from '../planning/plan';
import { readBody, type BodyReading } from '../rules/bodyReading';
import { SplicedFile } from './splicedFile';

/**
 * One open body (FBL 9.1): its bytes, its reading through one binding, and the one history of its
 * edits. Reading again after every edit, rather than patching the model, keeps one code path for
 * what a body means.
 */
export class OpenBody extends SplicedFile {
  private latest: BodyReading;

  private constructor(bytes: Uint8Array, readonly binding: FblBinding, readonly options: FblOptions) {
    super(bytes);
    this.latest = readBody(bytes, binding, options);
  }

  static open(bytes: Uint8Array, binding: FblBinding, options: FblOptions = {}): OpenBody {
    return new OpenBody(bytes, binding, options);
  }

  /** The reading the model is taken from, with where every value lives. */
  get reading(): BodyReading {
    return this.latest;
  }

  get model(): FblModel {
    return this.latest.toModel();
  }

  /** An unreadable body (FBL 7.5) and a read-only binding (FBL 3.4) refuse every change and are never saved. */
  get isReadOnly(): boolean {
    return this.latest.unreadable !== undefined || this.binding.readOnly !== undefined;
  }

  /** Plans `change` against the current bytes without applying it. */
  plan(change: ModelChange): PlanResult {
    return planEdit(this.latest, change);
  }

  /** Plans and applies `change`: the planned edit, or the refusal with nothing written. */
  change(change: ModelChange): PlanResult {
    const result = this.plan(change);
    if ('planned' in result) this.apply(result.planned);
    return result;
  }

  /**
   * Hands the body's bytes to `write`, the host's atomic writer (FBL 6.6). The library writes no
   * file itself. Throws for an unreadable or a read-only body, which is the caller's mistake.
   */
  save(write: (bytes: Uint8Array) => void): void {
    if (this.latest.unreadable) throw new Error(messages.unreadableNeverWritten);
    if (this.binding.readOnly !== undefined) throw new Error(messages.readOnlyNeverWritten);
    write(this.bytes);
  }

  protected reread(): void {
    this.latest = readBody(this.bytes, this.binding, this.options);
  }
}

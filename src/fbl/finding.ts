export type FindingSeverity = 'info' | 'warning' | 'error';

/** DISL's source location: the file relative to the subject, and the line, column and length of the entry's own span. */
export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

/**
 * A problem found while reading a body or a registration (FBL 7.4). Reading never fails on
 * content: whatever it cannot read becomes one of these.
 */
export interface Finding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly location: SourceLocation;
}

/** The finding codes FBL defines (FBL 7.4) and the DISL ones it uses (DISL 8.6). */
export const findingCodes = {
  unboundStatement: 'fbl.unbound-statement',
  danglingReference: 'fbl.dangling-reference',
  headerMismatch: 'fbl.header-mismatch',
  duplicateKey: 'fbl.duplicate-key',
  missingBody: 'fbl.missing-body',
  staleViewData: 'fbl.stale-view-data',
  unknownHeader: 'fbl.unknown-header',
  regexTimeout: 'fbl.regex-timeout',
  unparseable: 'std.unparseable',
  unreadableEntry: 'std.unreadableEntry',
  missingId: 'std.missingId',
  duplicateId: 'std.duplicateId',
  pluginMissing: 'std.pluginMissing',
} as const;

/** Whether a severity is at least a warning. */
export const isWarningOrWorse = (severity: FindingSeverity): boolean => severity !== 'info';

// The plug-in's FBL implementation: a host of FBL 0.1 for the yaml, json, xml, lines and blocks
// families (etalii.adp spec 009; docs/fbl.md). It takes an FBL document and a body as bytes, reads
// the body into elements, relations and findings, plans every change as FBL's splices, keeps a
// history with exact undo and drift refusal, and reads and writes the .adp registration. Offsets
// are UTF-8 byte offsets, a byte-order mark included. Nothing here names a tool type or a binding,
// and nothing imports Visual Studio Code or a browser. This file is the library's whole public surface.

// ---- values ----
export type { Span } from './span';
export { applyEdit, inverseOf } from './splice';
export type { Edit, FblSplice, SpliceOperation } from './splice';
export { findingCodes } from './finding';
export type { Finding, FindingSeverity, SourceLocation } from './finding';
export { FblModel } from './model';
export type { FblElement, FblOptions, FblView, IdRequest } from './model';
export type { ModelChange } from './planning/modelChange';
export type { PlanResult } from './planning/plan';

// ---- loading (FBL 14.1, steps 1, 2, 4, 5, 6) ----
export { loadDocument, loadDocumentAt, resolveReference } from './documents/documentLoader';
export type { Loaded, LoadProblem } from './documents/documentLoader';
export type * from './documents/types';

// ---- text (FBL 2.6) ----
export { BodyText } from './text/bodyText';
export type { TextLine } from './text/bodyText';

// ---- bodies (FBL 4 to 7) ----
export { OpenBody } from './history/openBody';
export { driftRedo, driftUndo } from './history/splicedFile';
export type { UndoResult } from './history/splicedFile';

// ---- registrations (FBL 8) ----
export { RegistrationDocument } from './registration/registrationDocument';
export type { Position, RegistrationBlock, RegistrationEntry, RegistrationHeader } from './registration/registrationDocument';
export { OpenRegistration } from './registration/openRegistration';

// ---- files ----
export type { FblFiles } from './files/fblFiles';
export { nodeFiles } from './files/nodeFiles';
export { locateBody } from './registration/bodyLocator';
export type { BodyLocation } from './registration/bodyLocator';
export { LegacySidecar } from './registration/legacySidecar';

// ---- routing and templates (FBL 10.1, 12, 13) ----
export { bare, candidates, readings, suggests, suggestsReading } from './routing/router';
export { markerMatches } from './routing/markerEvaluator';
export { globMatches } from './routing/glob';
export { folderFiles, recogniseFolder } from './routing/folderSubject';
export type { FolderFile } from './routing/folderSubject';
export { produceTemplate, replacePlaceholders, templateKey } from './routing/templateWriter';

// ---- plugins (FBL 11.1 to 11.3, the host's side) ----
export { PluginBody } from './plugins/pluginBody';
export type {
  PersistencePlugin, PluginFile, PluginPlanRequest, PluginPlanResult, PluginReadRequest, PluginReadResult, PluginSplice, PluginTemplateRequest,
} from './plugins/persistencePlugin';

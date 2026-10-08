// What the tests of the interpreter share: the specification and binding the add-on ships, read
// from its folder, and a document read through them.
import { readFileSync } from 'node:fs';
import { loadDocument } from '../../src/fbl/documents/documentLoader';
import { readBody } from '../../src/fbl/rules/bodyReading';
import { createExpressions } from '../../src/disl/expressions';
import { interpretMetamodel } from '../../src/disl/metamodel';
import { bindingOf, interpretPersistence, readModel } from '../../src/disl/persistence';
import { loadSpecification } from '../../src/disl/specification';

const addon = 'addons/gartner-hype-cycle-graph/gartner-hype-cycle-graph';

export const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const hypeCycleJson = (): unknown => json(`${addon}.dis`);
export const mindmapJson = (): unknown => json('test/fixtures/mindmap.dis');

export function tool(source: unknown = hypeCycleJson()) {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  const persistence = interpretPersistence(specification, metamodel).value;
  const binding = bindingOf(persistence, loadDocument(readFileSync(`${addon}.fbl`)).document!)!;
  const expressions = createExpressions(specification, metamodel);
  const read = (body: string | Uint8Array) =>
    readModel(readBody(typeof body === 'string' ? new TextEncoder().encode(body) : body, binding).toModel(), binding, metamodel, persistence);
  const fixture = (name: string) => read(readFileSync(`test/fixtures/gartner-hype-cycle-graph/${name}.ghg`));
  return { specification, metamodel, persistence, binding, expressions, read, fixture };
}

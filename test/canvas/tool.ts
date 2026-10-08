// What the tests of the canvas share: the add-on's specification interpreted section by section,
// and an example document read through its binding.
import { readFileSync, readdirSync } from 'node:fs';
import type { SceneTool } from '../../src/canvas/scene';
import { interpretCoordinates } from '../../src/disl/coordinates';
import { interpretLayout } from '../../src/disl/layout';
import { interpretNotation } from '../../src/disl/notation';
import { interpretViewpoints } from '../../src/disl/viewpoints';
import { tool } from '../disl/tool';

const examples = 'test/examples/gartner-hype-cycle-graph';

export function canvasTool(source?: unknown) {
  const base = tool(source);
  const coordinates = interpretCoordinates(base.specification, base.metamodel);
  const notation = interpretNotation(base.specification, base.metamodel);
  const layout = interpretLayout(base.specification);
  const viewpoints = interpretViewpoints(base.specification, base.metamodel, { notation: notation.value, coordinates: coordinates.value, layout: layout.value });
  const sceneTool: SceneTool = {
    metamodel: base.metamodel, expressions: base.expressions, coordinates: coordinates.value, viewpoints: viewpoints.value,
  };
  const findings = [...coordinates.findings, ...notation.findings, ...layout.findings, ...viewpoints.findings];
  return { ...base, sceneTool, coordinates: coordinates.value, notation: notation.value, layout: layout.value, viewpoints: viewpoints.value, findings };
}

export const exampleNames = (): string[] => readdirSync(examples, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
export const exampleBody = (name: string): Uint8Array => readFileSync(`${examples}/${name}/${name}.ghg`);
export const examplePlaces = (name: string): unknown => JSON.parse(readFileSync(`${examples}/${name}/${name}.places.json`, 'utf8'));

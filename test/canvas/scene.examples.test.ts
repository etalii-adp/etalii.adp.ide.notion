import { describe, expect, it } from 'vitest';
import { createScene, type Scene, type SceneEnd } from '../../src/canvas/scene';
import { canvasTool, exampleBody, exampleNames, examplePlaces } from './tool';

// SC-001 and FR-012 of etalii.adp spec 012-notion-hype-cycle-addon: the scene computed from the
// specification alone has every element of each example where the Visual Studio Code host computes
// it. The places are written by scripts/sync-examples.mjs, whose header describes them.

interface PlaceBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface PlaceEnd { readonly node: string; readonly part?: string; readonly at?: number; readonly side?: string; readonly x?: number; readonly y?: number }
interface Places {
  readonly nodes: readonly { readonly id: string; readonly type: string; readonly label: string; readonly text: string; readonly box: PlaceBox; readonly parts?: readonly { readonly id: string; readonly box: PlaceBox }[] }[];
  readonly edges: readonly { readonly id: string; readonly type: string; readonly from: PlaceEnd; readonly to: PlaceEnd; readonly hidden?: boolean }[];
}

// Two numbers are the same place when they differ by less than 0.5 (contracts/shared-parts.md).
const differs = (here: number | undefined, there: number | undefined): boolean => here === undefined || there === undefined ? here !== there : !(Math.abs(here - there) < 0.5);

function differences(example: string, scene: Scene, places: Places): { nodes: string[]; parts: string[]; edges: string[]; anchored: string[] } {
  const nodes: string[] = [];
  const parts: string[] = [];
  const edges: string[] = [];
  // The ends an anchor of the node places, apart from those stored on a part of it.
  const anchored: string[] = [];
  const said = (list: string[], element: string, what: string, here: unknown, there: unknown): void =>
    void list.push(`${example}: ${element}: ${what} is ${JSON.stringify(here)} here and ${JSON.stringify(there)} at the host`);
  const box = (list: string[], element: string, here: PlaceBox | undefined, there: PlaceBox): void => {
    for (const key of ['x', 'y', 'width', 'height'] as const) if (differs(here?.[key], there[key])) said(list, element, key, here?.[key], there[key]);
  };

  // A part the host cuts a shape into anywhere is one it must not draw where the host does not.
  const cut = new Set(places.nodes.flatMap((node) => (node.parts ?? []).map((part) => part.id)));
  const drawn = new Map(scene.nodes.map((node) => [node.id, node]));
  for (const place of places.nodes) {
    const node = drawn.get(place.id);
    const element = `node ${place.id}`;
    if (!node) { said(nodes, element, 'drawn', false, true); continue; }
    if (node.type.toLowerCase() !== place.type) said(nodes, element, 'type', node.type, place.type);
    if (node.labels[0]?.editText !== place.label) said(nodes, element, 'label', node.labels[0]?.editText, place.label);
    if (node.labels[0]?.text !== place.text) said(nodes, element, 'text', node.labels[0]?.text, place.text);
    box(nodes, element, node.box, place.box);
    for (const part of place.parts ?? []) box(parts, `${element} part ${part.id}`, node.parts.find((candidate) => candidate.id === part.id)?.box, part.box);
    const extra = node.parts.filter((part) => cut.has(part.id) && !(place.parts ?? []).some((other) => other.id === part.id)).map((part) => part.id);
    if (extra.length > 0) said(parts, element, 'parts the host does not draw', extra, []);
  }
  for (const node of scene.nodes) if (!places.nodes.some((place) => place.id === node.id)) said(nodes, `node ${node.id}`, 'drawn', true, false);

  const end = (element: string, which: string, here: SceneEnd | undefined, there: PlaceEnd): void => {
    if (!here) { said(edges, element, `${which} end`, undefined, there); return; }
    if (here.node !== there.node) said(edges, element, `${which}.node`, here.node, there.node);
    const stored = here.fallback ? undefined : here.part;
    if (stored !== there.part) said(edges, element, `${which}.part`, stored, there.part);
    if (there.part !== undefined && differs(here.at === undefined ? undefined : here.at * 1000, there.at === undefined ? undefined : there.at * 1000)) said(edges, element, `${which}.at`, here.at, there.at);
    if (here.side !== there.side) said(edges, element, `${which}.side`, here.side, there.side);
    for (const key of ['x', 'y'] as const) if (differs(here[key], there[key])) said(here.anchor === undefined ? edges : anchored, element, `${which}.${key}`, here[key], there[key]);
  };
  const lines = new Map(scene.edges.map((edge) => [edge.id, edge]));
  for (const place of places.edges) {
    const edge = lines.get(place.id);
    const element = `edge ${place.id}`;
    if (!edge) { said(edges, element, 'in the scene', false, true); continue; }
    if (edge.type.toLowerCase() !== place.type) said(edges, element, 'type', edge.type, place.type);
    if ((edge.hidden !== undefined) !== (place.hidden === true)) said(edges, element, 'hidden', edge.hidden ?? false, place.hidden === true);
    if (place.hidden === true) {
      if (edge.source !== place.from.node || edge.target !== place.to.node) said(edges, element, 'ends', [edge.source, edge.target], [place.from.node, place.to.node]);
      continue;
    }
    end(element, 'from', edge.from, place.from);
    end(element, 'to', edge.to, place.to);
  }
  for (const edge of scene.edges) if (!places.edges.some((place) => place.id === edge.id)) said(edges, `edge ${edge.id}`, 'in the scene', true, false);
  return { nodes, parts, edges, anchored };
}

describe('the scene of every example, beside the places the Visual Studio Code host computes', () => {
  const { sceneTool, read, findings } = canvasTool();

  it('comes from a specification that is interpreted without a finding', () => expect(findings).toEqual([]));

  for (const example of exampleNames()) {
    describe(example, () => {
      const scene = createScene(sceneTool, read(exampleBody(example)).value);
      const found = differences(example, scene, examplePlaces(example) as Places);

      it('is computed for the default viewpoint without a finding', () => {
        expect(scene.viewpoint).toBe(sceneTool.viewpoints.default);
        expect(scene.findings).toEqual([]);
      });
      it('has every node with its type, label, drawn text and box', () => expect(found.nodes).toEqual([]));
      it('has every part of a composite shape with its box', () => expect(found.parts).toEqual([]));
      it('has every edge with its two ends, each on its node, part and side, and a hidden edge hidden', () => expect(found.edges).toEqual([]));
      // A known difference between the specification and the hosts, raised as etalii.adp issue 97 and
      // settled nowhere here (FR-003): the specification says such an end is drawn from the outline,
      // the hosts draw it at the anchor point. When the issue is settled this stops failing, and the
      // `fails` goes.
      it.fails('has every end that an anchor of its node places where the host draws it', () => expect(found.anchored).toEqual([]));
    });
  }
});

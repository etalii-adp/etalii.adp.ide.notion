import { describe, expect, it } from 'vitest';
import { pathData } from '../../src/canvas/geometry';
import { arrangedRows, createScene, type Scene, type SceneNode } from '../../src/canvas/scene';
import { mindmapJson } from '../disl/tool';
import { canvasTool } from './tool';

const { sceneTool, read, fixture, layout } = canvasTool();
const sceneOf = (name: string, options?: Parameters<typeof createScene>[2]): Scene => createScene(sceneTool, fixture(name).value, options);
const node = (scene: Scene, id: string): SceneNode => scene.nodes.find((candidate) => candidate.id === id)!;
const rounded = (value: number): number => Math.round(value * 1000) / 1000;
const boxOf = (scene: Scene, id: string): number[] => { const { x, y, width, height } = node(scene, id).box; return [x, y, width, height].map(rounded); };
// A document of the tool type, written as its binding reads it: a header, and a list of entries for each key.
const entries = (key: string, ...items: Record<string, unknown>[]): string =>
  `${key}:\n${items.map((item) => Object.entries(item).map(([name, value], index) => `${index === 0 ? '  - ' : '    '}${name}: ${Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}\n`).join('')).join('')}`;
const document = (...lists: string[]): string => `gartner-hypecycle-graph: 1\n${lists.join('')}`;

describe('the scene of a document in the default viewpoint', () => {
  // A diagram drawn in years: 4 canvas units a year from 1900, rows 56 apart.
  const scene = sceneOf('triggers-and-notes');

  it('is drawn in the default viewpoint and its coordinate system, without a finding', () => {
    expect(scene).toMatchObject({ viewpoint: 'trueTime', system: 'hypeCycle', filtered: [], findings: [] });
    expect(scene.nodes.map((drawn) => [drawn.id, drawn.type])).toEqual([['transistors', 'Trend'], ['radio', 'Trend'], ['transistor-invented', 'Trigger'], ['note-1', 'Note'], ['note-2', 'Note']]);
    expect(scene.bounds).toEqual({ x: expect.closeTo(183.667, 3), y: 56, width: expect.closeTo(176.333, 3), height: 264 });
  });

  it('places a node by the attributes its placement is bound to, at its anchor', () => {
    expect(boxOf(scene, 'transistors')).toEqual([200, 56, 160, 32]);
    expect(boxOf(scene, 'radio')).toEqual([216, 112, 84, 32]);
    // A trigger is centred on its date and on the middle of its row.
    expect(boxOf(scene, 'transistor-invented')).toEqual([183.667, 64, 16, 16]);
    expect(boxOf(scene, 'note-1')).toEqual([200, 168, 160, 64]);
    expect(boxOf(scene, 'note-2')).toEqual([240, 280, 120, 40]);
    expect(node(scene, 'radio').system).toBe('hypeCycle');
  });

  it('gives a composite shape its parameters, its drawn parts and its outline', () => {
    const radio = node(scene, 'radio');
    expect(radio.shape).toMatchObject({ kind: 'none', name: 'phasedBanner', box: radio.box });
    expect(radio.params).toEqual({ count: 3, b1: expect.closeTo(1 / 3, 9), b2: expect.closeTo(2 / 3, 9), b3: 1 });
    expect(radio.parts.map((part) => part.id)).toEqual(['peakFill', 'troughFill', 'slopeFill', 'chevron1', 'chevron2', 'peak', 'trough', 'slope']);
    expect(radio.parts.slice(5).map((part) => [part.box.x, part.box.width].map(rounded))).toEqual([[216, 12], [228, 28], [256, 28]]);
    expect(radio.outline).toEqual({ kind: 'polygon', points: [{ x: 216, y: 112 }, { x: 284, y: 112 }, { x: 300, y: 128 }, { x: 284, y: 144 }, { x: 216, y: 144 }] });
  });

  it('gives each part its shape, its style over the style of the node, and its tooltip', () => {
    const [fill, , , chevron, , attachment] = node(scene, 'radio').parts;
    expect(fill).toMatchObject({ style: { fill: { token: 'ghg.peak' }, stroke: { width: 0 } }, hit: true, tooltip: 'Peak of Inflated Expectations' });
    expect(fill.shape.kind === 'path' && pathData(fill.shape.commands)).toBe('M 216 112 L 228 112 L 244 128 L 228 144 L 216 144 Z');
    expect(chevron).toMatchObject({ hit: false, style: { fill: 'none', stroke: { color: { token: 'ghg.chevron' }, width: 1.5 } } });
    expect(chevron.shape.kind === 'path' && pathData(chevron.shape.commands)).toBe('M 228 112 L 244 128 L 228 144');
    expect(attachment).toMatchObject({ id: 'peak', shape: { kind: 'rect', name: 'rect' }, hit: false });
    expect(attachment.tooltip).toBeUndefined();
  });

  it('gives a built-in shape its outline and the style of its notation', () => {
    const trigger = node(scene, 'transistor-invented');
    expect(trigger.shape).toMatchObject({ kind: 'ellipse', name: 'ellipse' });
    expect(trigger.outline).toEqual({ kind: 'ellipse', box: trigger.box });
    expect(trigger.style).toEqual({ fill: { token: 'ghg.trigger' }, stroke: { color: { token: 'ghg.trigger' }, width: 1.5 } });
    expect(trigger.parts).toEqual([]);
    expect(node(scene, 'note-1').shape.kind).toBe('rect');
    expect(node(scene, 'note-1').outline).toMatchObject({ kind: 'polygon' });
  });

  it('gives each label its text, the text an editor opens with, and its box', () => {
    const [name] = node(scene, 'transistors').labels;
    // Eleven characters of 14 at an advance of 0.55, 8 before the node and centred on its height.
    expect(name).toMatchObject({ id: 'name', text: 'Transistors', editText: 'Transistors', position: 'outside-left', align: 'end', fontSize: 14, editable: 'inline', wrap: 'none', overflow: 'visible' });
    expect([name.box.x, name.box.y, name.box.width, name.box.height].map(rounded)).toEqual([107.3, 62.9, 84.7, 18.2]);

    const [dated] = node(scene, 'transistor-invented').labels;
    expect(dated).toMatchObject({ text: 'Transistor invented · 1947', editText: 'Transistor invented', align: 'end' });
    expect(rounded(dated.box.x + dated.box.width)).toBe(175.667);

    // Inside a node the text is laid out in the node less its padding.
    const [text] = node(scene, 'note-1').labels;
    expect(text).toMatchObject({ text: 'Dates are illustrative.\n\nSee the readme.', editText: 'Dates are illustrative.\n\nSee the readme.', position: 'center', align: 'center', fontSize: 12, editable: 'multiline', wrap: 'word', overflow: 'ellipsis' });
    expect(text.box).toEqual({ x: 206, y: 174, width: 148, height: 52 });
    expect(text.style.font).toEqual({ color: { token: 'ghg.noteText' }, size: 12 });
  });

  it('gives a node its tooltip, its handles and what a user may do with it', () => {
    expect(node(scene, 'transistor-invented').tooltip).toBe('Trigger: Transistor invented, 1947');
    expect(node(scene, 'transistors').tooltip).toBeUndefined();
    expect(node(scene, 'transistors').handles).toEqual([
      { param: 'b1', x: 240, y: 72, axis: 'x', visible: true }, { param: 'b2', x: 280, y: 72, axis: 'x', visible: true }, { param: 'b3', x: 320, y: 72, axis: 'x', visible: true },
    ]);
    expect(node(scene, 'radio').handles.map((handle) => handle.visible)).toEqual([true, true, false]);
    expect(node(scene, 'transistors')).toMatchObject({ movable: { x: true, y: true }, resizable: { x: true, y: false }, connectable: true, selectable: true, deletable: true, dimmed: false });
    expect(node(scene, 'transistor-invented')).toMatchObject({ movable: { x: true, y: true }, resizable: { x: false, y: false } });
    expect(node(scene, 'note-1')).toMatchObject({ resizable: { x: true, y: true }, connectable: false });
  });

  it('draws an end on the side of the part its relation stores, and the line between two ends', () => {
    const edge = scene.edges.find((candidate) => candidate.id === 'i-13')!;
    expect(edge).toMatchObject({ type: 'Influence', source: 'transistors', target: 'radio', routing: 'bezier', sourceMarker: 'none', targetMarker: 'arrowFilled', stroke: { color: { token: 'ghg.influence' }, width: 1.5 } });
    expect(edge.hidden).toBeUndefined();
    expect(edge.from).toEqual({ node: 'transistors', x: 284, y: 88, side: 'bottom', normal: { x: 0, y: 1 }, part: 'slope', at: 0.5 });
    expect(edge.to).toEqual({ node: 'radio', x: expect.closeTo(217.2, 9), y: 112, side: 'top', normal: { x: 0, y: -1 }, part: 'peak', at: 0.1 });
    // The curve leaves and enters square to the sides its ends sit on.
    expect(edge.curve!.map((point) => [rounded(point.x), rounded(point.y)])).toEqual([[284, 88], [284, 123.49], [217.2, 76.51], [217.2, 112]]);
    expect(pathData(edge.path)).toMatch(/^M 284 88 C 284 123\.49\d*, 217\.2\d* 76\.50\d*, 217\.2\d* 112$/);
  });

  it('draws an end at a fixed anchor from the outline, towards the other end', () => {
    const edge = scene.edges.find((candidate) => candidate.id === 'i-12')!;
    expect(edge.to).toMatchObject({ node: 'transistors', part: 'peak', at: 0.2, side: 'top', x: expect.closeTo(204.8, 9), y: 56 });
    // The anchor nearest the other end says the side; the line starts where the circle faces that end.
    expect(edge.from).toMatchObject({ node: 'transistor-invented', anchor: 'n', side: 'top' });
    expect([edge.from!.x, edge.from!.y, edge.from!.normal.x, edge.from!.normal.y].map(rounded)).toEqual([196.742, 65.816, 0.634, -0.773]);
    expect(edge.from!.part).toBeUndefined();
  });
});

describe('what a scene leaves out, hides and draws by a default', () => {
  it('leaves out a node whose placement has no value, or that has no extent', () => {
    expect(sceneOf('rule-stop-before-start').nodes.map((drawn) => drawn.id)).toEqual(['b']);
    expect(sceneOf('rule-note-position').nodes.map((drawn) => drawn.id)).toEqual(['a']);
    expect(sceneOf('rule-trigger-date').nodes.map((drawn) => drawn.id)).toEqual(['a']);
    expect(sceneOf('not-yaml')).toMatchObject({ nodes: [], edges: [], findings: [] });
    expect(sceneOf('not-yaml').bounds).toBeUndefined();
  });

  it('draws a later entry that uses an id again (DISL 11.5.4)', () => {
    expect(sceneOf('rule-duplicate-id').nodes.map((drawn) => drawn.box.x)).toEqual([0, 480, 1920]);
  });

  it('leaves out a relation with an end that names nothing, or an element its type does not allow there', () => {
    expect(sceneOf('rule-dangling-reference').edges).toEqual([]);
    expect(sceneOf('rule-influence-into-trigger').edges).toEqual([]);
    expect(sceneOf('rule-self-influence').edges.map((edge) => edge.hidden)).toEqual([undefined]);
  });

  it('hides an edge whose end is on a part its node does not draw, and keeps it in the scene', () => {
    const scene = sceneOf('rule-duplicate-hidden');
    expect(scene.edges.map((edge) => [edge.id, edge.hidden])).toEqual([['ab', 'part'], ['ab2', undefined]]);
    expect(scene.edges[0]).toMatchObject({ source: 'a', target: 'b', path: [] });
    expect(scene.edges[0].from).toBeUndefined();
  });

  it('draws an end that names no place of its node at the first place it could name', () => {
    // `hype` is no part: the end is drawn halfway along the top of the first part its attribute allows.
    const [edge] = sceneOf('rule-bad-attachment').edges;
    expect(edge.from).toEqual({ node: 'a', x: 112, y: 0, side: 'top', normal: { x: 0, y: -1 }, part: 'peak', at: 0.5, fallback: true });
    expect(edge.to).toMatchObject({ part: 'peak', side: 'top', at: 0.5 });
    expect(edge.to!.fallback).toBeUndefined();

    const body = (end: Record<string, unknown>) => document(
      entries('trends', { id: 'a', name: 'A', start: '1900-01', stop: '1920-01', phases: 2 }, { id: 'b', name: 'B', start: '1910-01', stop: '1930-01' }),
      entries('influences', { id: 'ab', from: 'a', to: 'b', ...end }),
    );
    const drawn = (end: Record<string, unknown>) => createScene(sceneTool, read(body(end)).value).edges[0];
    // An end with nothing stored, a side that is none, and a fraction beyond the side are no place either.
    expect(drawn({ 'to-phase': 'peak', 'to-edge': 'top', 'to-at': 0.5 })).toMatchObject({ from: { part: 'peak', side: 'top', at: 0.5, fallback: true }, to: { part: 'peak' } });
    expect(drawn({ 'to-phase': 'peak', 'to-edge': 'left', 'to-at': 0.2 }).to).toMatchObject({ part: 'peak', side: 'top', at: 0.5, fallback: true });
    expect(drawn({ 'from-phase': 'peak', 'from-edge': 'bottom', 'from-at': 1.5 }).from).toMatchObject({ side: 'top', fallback: true });
    // A part that is declared for the shape and not drawn hides the edge only when the rest of the end is a place.
    expect(drawn({ 'from-phase': 'slope', 'from-edge': 'bottom', 'from-at': 0.5 }).hidden).toBe('part');
    expect(drawn({ 'from-phase': 'slope', 'from-edge': 'under', 'from-at': 0.5 }).hidden).toBeUndefined();
    // A part of the shape that the attribute of the end cannot hold is no place.
    expect(drawn({ 'from-phase': 'peakFill', 'from-edge': 'bottom', 'from-at': 0.5 }).from).toMatchObject({ part: 'peak', fallback: true });
  });

  it('draws in months a diagram whose unit is none', () => {
    const scene = createScene(sceneTool, read(document('unit: fortnight\n', entries('trends', { id: 'a', name: 'A', start: '1900-02', stop: '1901-02' }))).value);
    expect(boxOf(scene, 'a')).toEqual([4, 0, 48, 32]);
  });
});

describe('the filter of the canvas', () => {
  const body = document(
    entries('trends',
      { id: 'a', name: 'A', start: '1900-01', stop: '1920-01', tags: ['Steam', 'coal'] },
      { id: 'b', name: 'B', start: '1910-01', stop: '1930-01', row: 1, tags: ['coal'] },
      { id: 'c', name: 'C', start: '1910-01', stop: '1930-01', row: 2 }),
    entries('triggers', { id: 't', name: 'T', date: '1890-01', tags: ['steam'] }),
    entries('notes', { id: 'n', text: 'stays', at: '1900-01', row: 4 }),
    entries('influences',
      { id: 'ab', from: 'a', to: 'b', 'from-phase': 'peak', 'from-edge': 'bottom', 'from-at': 0.5, 'to-phase': 'peak', 'to-edge': 'top', 'to-at': 0.5 },
      { id: 'ta', from: 't', to: 'a', 'to-phase': 'peak', 'to-edge': 'top', 'to-at': 0.5 }),
  );
  const model = read(body).value;
  const filteredBy = (value: string[], match?: 'any' | 'all') => createScene(sceneTool, model, { filters: { tags: { value, match } } });

  it('hides nothing while it holds no value', () => {
    expect(createScene(sceneTool, model).filtered).toEqual([]);
    expect(filteredBy([]).nodes).toHaveLength(5);
  });

  it('hides the nodes it applies to that it does not keep, whatever their case, and never another type', () => {
    const scene = filteredBy(['STEAM']);
    expect(scene.filtered).toEqual(['b', 'c']);
    expect(scene.nodes.map((drawn) => drawn.id)).toEqual(['a', 't', 'n']);
    expect(scene.findings).toEqual([]);
  });

  it('marks an edge to or from a hidden node as hidden by the filter', () => {
    expect(filteredBy(['steam']).edges.map((edge) => [edge.id, edge.hidden])).toEqual([['ab', 'filter'], ['ta', undefined]]);
  });

  it('keeps what matches any value, or every value', () => {
    expect(filteredBy(['steam', 'coal']).filtered).toEqual(['c']);
    expect(filteredBy(['steam', 'coal'], 'all').filtered).toEqual(['b', 'c', 't']);
  });
});

describe('the scene of the variant viewpoint, which a layout places', () => {
  const scene = sceneOf('triggers-and-notes', { viewpoint: 'compact' });

  it('is drawn in its own coordinate system', () => {
    expect(scene).toMatchObject({ viewpoint: 'compact', system: 'compact' });
    expect(scene.nodes.every((drawn) => drawn.system === 'compact')).toBe(true);
  });

  it('gives a node the size of the variant, and another node its own', () => {
    // 24 for each visible part of four and of three; a circle and a box keep their size.
    expect(scene.nodes.map((drawn) => [drawn.box.width, drawn.box.height])).toEqual([[96, 32], [72, 32], [16, 16], [160, 64], [120, 40]]);
    expect(node(scene, 'radio').params).toMatchObject({ count: 3, b1: expect.closeTo(1 / 3, 9), b2: expect.closeTo(2 / 3, 9) });
    expect(node(scene, 'transistors').parts.slice(-4).map((part) => [part.box.x, part.box.width])).toEqual([[20, 8], [28, 24], [52, 24], [76, 24]]);
  });

  it('keeps every node on its row', () => {
    expect(scene.nodes.map((drawn) => drawn.box.y)).toEqual([56, 112, 64, 168, 280]);
  });

  it('packs each row from the left in the order of the starts, a gap apart, a target after the middle of its source', () => {
    // On row 1 the circle starts before the banner; the banner on row 2 follows the middle of its source.
    expect(scene.nodes.map((drawn) => [drawn.id, drawn.box.x])).toEqual([['transistors', 20], ['radio', 68], ['transistor-invented', 0], ['note-1', 0], ['note-2', 0]]);
  });

  it('keeps every row a tall node covers clear', () => {
    const body = document(
      entries('trends', { id: 'a', name: 'A', start: '1950-01', stop: '1960-01', row: 1 }),
      entries('notes', { id: 'n', text: 'tall', at: '1940-01', row: 0, width: 100, height: 64 }, { id: 'm', text: 'flat', at: '1945-01', row: 2, width: 50, height: 56 }),
    );
    const packed = createScene(sceneTool, read(body).value, { viewpoint: 'compact' });
    expect(packed.nodes.map((drawn) => [drawn.id, drawn.box.x])).toEqual([['a', 104], ['n', 0], ['m', 0]]);
  });

  it('lets nothing move or change its size, and still draws the edges between the placed nodes', () => {
    expect(scene.nodes.every((drawn) => !drawn.movable.x && !drawn.movable.y && !drawn.resizable.x && !drawn.resizable.y)).toBe(true);
    expect(node(scene, 'transistors').handles.every((handle) => !handle.visible)).toBe(true);
    const edge = scene.edges.find((candidate) => candidate.id === 'i-13')!;
    expect(edge.from).toMatchObject({ part: 'slope', x: 20 + 32 + 12, y: 88 });
    expect(edge.to).toMatchObject({ part: 'peak', x: expect.closeTo(68 + 0.8, 9), y: 112 });
  });

  it('says which expression of the layout could not be evaluated, once for each type', () => {
    expect(scene.findings.map((found) => [found.code, found.severity, found.message])).toEqual([
      ['disl.scene', 'warning', '`int(math.ceil(self.height / 56.0))` could not be evaluated for an element of the type `Trend`, so a default is used: No such key: height'],
      ['disl.scene', 'warning', '`int(math.ceil(self.height / 56.0))` could not be evaluated for an element of the type `Trigger`, so a default is used: No such key: height'],
    ]);
  });

  it('packs only what a filter leaves', () => {
    const filtered = sceneOf('triggers-and-notes', { viewpoint: 'compact', filters: { tags: { value: ['invention'] } } });
    expect(filtered.filtered).toEqual(['transistors', 'radio']);
    expect(filtered.nodes.map((drawn) => drawn.box.x)).toEqual([0, 0, 0]);
  });
});

describe('the rows a rows-only arrangement gives', () => {
  it('are the fewest, by the extents of the nodes with the label before them', () => {
    // The example of DISL 10.2: three spans on rows 0, 1 and 2 go to rows 0, 1 and 0.
    const body = (name: string) => document('unit: year\n', entries('trends',
      { id: 'a', name: 'A', start: '1800-01', stop: '1850-01', row: 0 }, { id: 'b', name: 'B', start: '1840-01', stop: '1900-01', row: 1 }, { id: 'c', name, start: '1860-01', stop: '1900-01', row: 2 }));
    const model = read(body('C')).value;
    expect(Object.fromEntries(arrangedRows(sceneTool, model, createScene(sceneTool, model), layout.algorithms.rowArrange))).toEqual({ a: 0, b: 1, c: 0 });
    // With a name of 19 characters, 125.4 wide at 12, the third span starts before the second and no longer fits after the first.
    const named = read(body('A name that is long')).value;
    expect(Object.fromEntries(arrangedRows(sceneTool, named, createScene(sceneTool, named), layout.algorithms.rowArrange))).toEqual({ a: 0, c: 1, b: 2 });
  });

  it('cover every row a tall node reaches, and keep linked nodes near', () => {
    const model = fixture('triggers-and-notes').value;
    const rows = Object.fromEntries(arrangedRows(sceneTool, model, createScene(sceneTool, model), layout.algorithms.rowArrange));
    // The two-row box opens rows 3 and 4; the row between the linked circle and banner is swapped away.
    expect(rows).toEqual({ 'transistor-invented': 0, transistors: 1, radio: 2, 'note-1': 3, 'note-2': 0 });
    expect(arrangedRows(sceneTool, model, createScene(sceneTool, model), layout.algorithms.rowPacked).size).toBe(0);
  });
});

describe('the scene of another tool type', () => {
  it('is computed without throwing, and says what it could not draw', () => {
    const other = canvasTool(mindmapJson());
    const type = Object.keys(other.metamodel.types).find((name) => other.metamodel.types[name].kind === 'node')!;
    const scene = createScene(other.sceneTool, { diagram: {}, elements: [{ id: 'one', type, attributes: {}, host: {}, ephemeral: false, line: 1 }], relations: [] });
    expect(scene.nodes.map((drawn) => drawn.id)).toEqual(['one']);
    expect(scene.findings.map((found) => found.message).some((message) => message.includes('leaves places to a layout'))).toBe(true);
  });
});

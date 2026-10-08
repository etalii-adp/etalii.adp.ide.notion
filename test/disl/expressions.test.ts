import { describe, expect, it } from 'vitest';
import { createExpressions } from '../../src/disl/expressions';
import { interpretMetamodel, parseYearMonth } from '../../src/disl/metamodel';
import { loadSpecification } from '../../src/disl/specification';
import { expressionsOf } from './expressionsOf';
import { hypeCycleJson, mindmapJson, tool } from './tool';

const ym = (text: string): number => parseYearMonth(text)!;

const document = [
  'gartner-hypecycle-graph: 1',
  'unit: year',
  'trends:',
  '  - id: even',
  '    name: Even',
  '    start: 2000-01',
  '    stop: 2004-01',
  '    tags: [Steam, power]',
  '  - id: pinned',
  '    name: Pinned',
  '    start: 2000-01',
  '    stop: 2004-01',
  '    phases: 4',
  '    peak-end: 2000-07',
  '  - id: two',
  '    name: ""',
  '    start: 2000-01',
  '    stop: 2004-01',
  '    phases: 2',
  '  - id: broken',
  '    name: Broken',
  '    start: 2000-01',
  '    stop: 2001-01',
  '    peak-end: 1999-12',
  '  - id: dateless',
  '    name: Dateless',
  '    start: 20xx-01',
  'triggers:',
  '  - id: spark',
  '    name: Spark',
  '    date: 1999-06',
  '    tags: [steam]',
  'influences:',
  '  - id: a',
  '    from: spark',
  '    to: even',
  '    to-phase: peak',
  '    to-edge: top',
  '    to-at: 0.5',
  '  - id: b',
  '    from: even',
  '    from-phase: slope',
  '    from-edge: bottom',
  '    from-at: 1',
  '    to: pinned',
  '    to-phase: trough',
  '  - id: c',
  '    from: even',
  '    to: nowhere',
  '',
].join('\n');

describe('every expression of the specification', () => {
  const found = expressionsOf(hypeCycleJson());
  const { expressions, specification } = tool();

  it('is found where the schema says expressions live', () => {
    const count = (kind: string): number => found.filter((expression) => expression.kind === kind).length;
    expect({ expression: count('expression'), geometry: count('geometry'), untyped: count('untyped') }).toEqual({ expression: 200, geometry: 95, untyped: 17 });
    for (const name of Object.keys(specification.functions ?? {})) expect(found.map((expression) => expression.path)).toContain(`/functions/${name}/cel`);
  });

  it('is parsed by the library', () => {
    const failed = found.map((expression) => ({ ...expression, error: expressions.compile(expression.cel).error })).filter((expression) => expression.error !== undefined);
    expect(failed).toEqual([]);
  });

  it('has its functions registered without a finding', () => expect(expressions.findings).toEqual([]));

  it('is parsed for another tool type as well', () => {
    const mindmap = loadSpecification(mindmapJson()).value;
    const other = createExpressions(mindmap, interpretMetamodel(mindmap).value);
    const all = expressionsOf(mindmapJson());
    expect(all.length).toBeGreaterThan(50);
    expect(all.filter((expression) => other.compile(expression.cel).error !== undefined)).toEqual([]);
    expect(other.findings).toEqual([]);
  });
});

describe('the specification\'s functions, against answers worked out by hand', () => {
  const { expressions, read } = tool();
  const { value: model } = read(document);
  const world = expressions.over(model);
  const on = (id: string, cel: string, more = {}) => expressions.evaluate(cel, world.scope(id, more));
  const value = (id: string, cel: string, more = {}) => {
    const result = on(id, cel, more);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it('spreads the boundaries of a trend evenly while none is stored', () => {
    // 48 months and four phases: a boundary every 12 months.
    expect(value('even', 'phaseBoundaries(self)')).toEqual([ym('2001-01'), ym('2002-01'), ym('2003-01')]);
    expect(value('even', 'phaseFractions(self)')).toEqual([0.25, 0.5, 0.75]);
    expect(value('even', 'visiblePhases(self)')).toBe(4);
    expect(value('even', 'boundaryFraction(self, 2)')).toBe(0.5);
    expect(value('even', 'boundaryFraction(self, 4)')).toBe(1);
  });

  it('spreads the rest around a stored boundary', () => {
    // Peak ends at 2000-07; the 42 months left are cut in three: 14 and 28 months on.
    expect(value('pinned', 'phaseBoundaries(self)')).toEqual([ym('2000-07'), ym('2001-09'), ym('2002-11')]);
    expect(value('pinned', 'has(self.peakEnd) && !has(self.troughEnd)')).toBe(true);
  });

  it('shows as many phases as the trend says', () => {
    expect(value('two', 'phaseBoundaries(self)')).toEqual([ym('2002-01')]);
    expect(value('two', 'phaseFractions(self)')).toEqual([0.5]);
  });

  it('names a boundary that is out of order', () => {
    expect(value('broken', 'badBoundary(self)')).toBe('peak-end: 1999-12');
    expect(value('even', 'badBoundary(self)')).toBe('');
    // A boundary outside the banner is drawn evenly spread instead.
    expect(value('broken', 'phaseFractions(self)')).toEqual([0.25, 0.5, 0.75]);
  });

  it('reads the diagram where a function says it uses it', () => {
    // The unit is a year: 30% of 48 months is 14.4 months after 2000-01, which lands on 2001-01.
    expect(value('even', 'boundaryMonth(self, 0.3)')).toBe(ym('2001-01'));
    expect(value('even', 'unitMonths(diagram.unit)')).toBe(12);
    expect(value('even', 'dropMonth(double(yearMonth(1987, 5)))')).toBe(ym('1987-01'));
  });

  it('words months, numbers and names', () => {
    expect(value('even', 'monthText(self.start)')).toBe('2000-01');
    expect(value('even', "formatWhen(self.start + 6, 'month', false)")).toBe('Jul 2000');
    expect(value('even', "formatWhen(self.start + 6, 'month', true)")).toBe('July 2000');
    expect(value('even', "formatWhen(self.start + 6, diagram.unit, true)")).toBe('2000');
    expect(value('even', "[atText(0.5), atText(1.0), atText(0.333), sizeText(160.004)]")).toEqual(['0.5', '1.0', '0.33', '160']);
    expect(value('even', "phaseTitle('trough') + '/' + phaseTitle('summit')")).toBe('Trough/summit');
    expect(value('even', "uniqueName('Trend', ['Trend', 'Trend 2'])")).toBe('Trend 3');
    expect(value('even', "uniqueName('Trend', ['Other'])")).toBe('Trend');
    expect(value('even', "listOrNone([]) + listOrNone(['a', 'b'])")).toBe('Nonea\nb');
    expect(value('even', 'tooShort(3, 4)')).toBe('A trend showing 4 phases must be at least 4 months long, one per phase.');
    expect(value('even', 'tooShort(4, 4)')).toBe('');
  });

  it('reads the ends of an influence, stored or not', () => {
    expect(value('a', 'endReadable(self.?toPhase, self.?toEdge, self.?toAt)')).toBe(true);
    expect(value('a', 'endReadable(self.?fromPhase, self.?fromEdge, self.?fromAt)')).toBe(false);
    expect(value('b', 'endSpec(self.?fromPhase, self.?fromEdge, self.?fromAt)')).toBe('slope/bottom/1.0');
    expect(value('b', 'endSpec(self.?toPhase, self.?toEdge, self.?toAt)')).toBe('trough//');
    expect(value('b', 'endText(self.target, self.toPhase)')).toBe('Pinned · Trough');
    expect(value('a', "endText(self.source, '')")).toBe('Spark');
    expect(value('b', "endText(diagram.elementById('two'), 'peak')")).toBe('two · Peak');
  });
});

describe('elements in CEL', () => {
  const { expressions, read, specification } = tool();
  const { value: model } = read(document);
  const world = expressions.over(model, { env: { viewpoint: 'compact' }, view: (id) => (id === 'even' ? { x: 3.5 } : undefined) });
  const value = (id: string | undefined, cel: string, more = {}) => {
    const result = expressions.evaluate(cel, world.scope(id, more));
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it('reads a stored attribute, a default and a zero value, and tells them apart with has()', () => {
    expect(value('even', '[self.id, self.type, self.kind, self.name]')).toEqual(['even', 'Trend', 'node', 'Even']);
    expect(value('even', '[self.phases, self.row]')).toEqual([4, 0]);
    expect(value('even', '[has(self.phases), has(self.start), has(self.peakEnd), has(self.id)]')).toEqual([false, true, false, true]);
    expect(value('even', 'self.peakEnd')).toBe(0);
    expect(value('even', 'self.description')).toBe('');
    expect(value('dateless', '[has(self.start), has(self.stop), self.tags.size()]')).toEqual([false, false, 0]);
    expect(value('even', "self.?peakEnd.orValue(-1) + self.?start.orValue(-1)")).toBe(ym('2000-01') - 1);
    expect(expressions.evaluate('self.colour', world.scope('even'))).toEqual({ ok: false, error: 'No such key: colour' });
  });

  it('keeps integers and other numbers apart', () => {
    expect(value('even', 'self.stop - self.start + 1')).toBe(49);
    expect(value('a', 'self.toAt * 2.0')).toBe(1);
    expect(value('b', 'self.fromAt == 1.0')).toBe(true);
    expect(expressions.evaluate('self.start + 1.5', world.scope('even')).ok).toBe(false);
  });

  it('walks from an element to its neighbours', () => {
    expect(value('even', "self.outgoingOf('Influence').map(r, r.id)")).toEqual(['b', 'c']);
    expect(value('even', "self.incomingOf('Influence').map(r, r.source.name)")).toEqual(['Spark']);
    expect(value('even', '[self.incoming.size(), self.outgoing.size()]')).toEqual([1, 2]);
    expect(value('b', '[self.source, self.target, self.kind]')).toEqual(['even', 'pinned', 'relation']);
    expect(value('b', "[self.isA('Influence'), self.source.isA('Trend'), self.source.isA('Trigger'), self.source == self.target]")).toEqual([true, true, false, false]);
    expect(value('b', "self.source.outgoingOf('Influence').filter(r, r.target == self.target).size()")).toBe(1);
    expect(value('c', '[self.target == null, has(self.target), has(self.source)]')).toEqual([true, false, true]);
    expect(value('spark', 'self.label()')).toBe('Spark');
  });

  it('gives the diagram its attributes and its elements', () => {
    expect(value(undefined, '[diagram.unit, diagram.kind]')).toEqual(['year', 'diagram']);
    expect(value(undefined, "diagram.nodesOfType('Trend').map(n, n.id)")).toEqual(['even', 'pinned', 'two', 'broken', 'dateless']);
    expect(value(undefined, "[diagram.nodes.size(), diagram.relations.size(), diagram.elements.size(), diagram.relationsOfType('Influence').size()]")).toEqual([6, 3, 9, 3]);
    expect(value(undefined, "diagram.elementById('gone') == null")).toBe(true);
    expect(value(undefined, "(diagram.nodesOfType('Trend').map(n, n.tags).flatten() + diagram.nodesOfType('Trigger').map(n, n.tags).flatten()).distinct()")).toEqual(['Steam', 'power', 'steam']);
    const none = expressions.over({ diagram: {}, elements: [], relations: [] });
    expect(expressions.evaluate('[diagram.unit, has(diagram.unit)]', none.scope())).toMatchObject({ value: ['month', false] });
  });

  it('binds env, the view and what a context adds', () => {
    expect(value('even', "[env.viewpoint, env.mode, env.readOnly]")).toEqual(['compact', 'light', false]);
    expect(value('even', 'self.view.x')).toBe(3.5);
    expect(value('pinned', 'self.view == null')).toBe(true);
    expect(value('even', "attribute != 'phases' || (newValue >= 1 && newValue <= 4)", { attribute: 'phases', newValue: 5n })).toBe(false);
    const attributes = tool().metamodel.types.Trend.attributes;
    expect(world.toCel(3, attributes.phases)).toBe(3n);
    expect(world.toCel(undefined, attributes.phases)).toBe(4n);
    expect(world.toCel(['x'], attributes.tags)).toEqual(['x']);
  });

  it('evaluates the rules and sentences of the specification itself', () => {
    const rules = (specification.constraints as { rules: { id: string; rule: string; when?: string; message: { cel: string } }[] }).rules;
    const rule = (id: string) => rules.find((candidate) => candidate.id === id)!;
    expect(value('even', rule('stopAfterStart').rule)).toBe(true);
    expect(value('dateless', rule('stopAfterStart').when!)).toBe(false);
    expect(value('broken', rule('boundaryOrder').rule)).toBe(false);
    expect(value('broken', rule('boundaryOrder').message.cel)).toBe("`broken`'s `peak-end: 1999-12` is out of order or outside 2000-01 to 2001-01.");
    expect(value('a', rule('fromAttachment').when!)).toBe(false);
    expect(value('b', rule('toAttachment').message.cel)).toBe("`b`'s to end (trough//) does not name a phase, a top or bottom edge, and an `at` from 0 to 1.");
    const builtIn = (specification.constraints as { builtIn: Record<string, { message: { cel: string } }> }).builtIn;
    expect(value('c', builtIn['std.references'].message.cel, { detail: { missingId: 'nowhere', end: 'target' } })).toBe('`c` names `nowhere`, which is not a trend in this document.');
    expect(value('b', builtIn['std.endpoints'].message.cel, { detail: {} })).toBe('`even` influences `pinned` 1 times; a trend influences another once in each direction.');
  });
});

describe('the function library', () => {
  const { expressions } = tool();
  const value = (cel: string, scope = {}) => {
    const result = expressions.evaluate(cel, scope);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it('builds, takes apart, reads and writes a year and month', () => {
    expect(value('[yearMonth(0, 1), yearMonth(-1, 12), yearMonth(2026, 9)]')).toEqual([0, -1, 2026 * 12 + 8]);
    expect(value('[yearMonth(-1, 12).year(), yearMonth(-1, 12).month(), yearMonth(2026, 9).year(), yearMonth(2026, 9).month()]')).toEqual([-1, 12, 2026, 9]);
    expect(value("[parseYearMonth('2026-09').hasValue(), parseYearMonth('2026-13').hasValue(), parseYearMonth('soon').hasValue()]")).toEqual([true, false, false]);
    expect(value("parseYearMonth('-3200-01').value()")).toBe(-3200 * 12);
    expect(value("[formatYearMonth(yearMonth(-3200, 1), 'uuuu-MM'), formatYearMonth(yearMonth(987, 3), \"MMM uuuu 'M'\"), formatYearMonth(5, 'M/u')]")).toEqual(['-3200-01', 'Mar 0987 M', '6/0']);
  });

  it('has the numbers of DISL and of CEL\'s math extension', () => {
    expect(value('[math.round(2.5), math.round(-2.5), math.floor(-0.5), math.ceil(0.2), math.trunc(-1.7), math.abs(-3), math.sqrt(9.0)]')).toEqual([3, -3, -1, 1, -1, 3, 3]);
    expect(value('[min(3, 1), max(1, 2, 7, 4), math.least(2.5, 1.5), math.greatest(1, 2, 3), clamp(5, 1, 3), clamp(0, 1, 3), clamp(0.5, 0.0, 1.0)]')).toEqual([1, 7, 1.5, 3, 3, 1, 0.5]);
    expect(value('lists.range(3)')).toEqual([0, 1, 2]);
    expect(value('int(math.round(2.5)) + 1')).toBe(4);
  });

  it('has the texts, the lists and the enums', () => {
    expect(value("[lower('ÉTÉ'), upper('été')]")).toEqual(['été', 'ÉTÉ']);
    expect(value("[[1, 2], [3]].flatten() + ['a', 'b', 'a'].distinct().map(s, s.size())")).toEqual([1, 2, 3, 1, 1]);
    expect(value("['x', 'y'].indexOf('y') + ['x'].indexOf('z')")).toBe(0);
    expect(value("[enumLabel('TimeUnit', 'decade'), enumLabel('TimeUnit', 'aeon'), string(ordinal('slope', 'Phase'))]")).toEqual(['Decade', 'aeon', '2']);
    // The specification declares an average text metric: 0.55 of the font size for each UTF-16 unit.
    expect(value("textWidth('Steam', 12.0)")).toBeCloseTo(5 * 0.55 * 12);
  });

  it('keeps cel.bind, optionals, macros and maps working beside has() and the optional member', () => {
    expect(value("cel.bind(v, m.?a.orValue('none'), v + (has(m.b) ? '!' : '?'))", { m: { b: 1n } })).toBe('none!');
    expect(value("[has(m.a.b), m.?a.?b.hasValue(), m.?z.?b.hasValue(), m.a.?c.orValue(7)]", { m: { a: { b: 'x' } } })).toEqual([true, true, false, 7]);
    expect(value("[1, 2, 3].filter(i, i > 1).map(i, i * 2).exists(i, i == 6) && 'a\\'b\"c\\n'.size() == 6 && -(1 + 2) * 2 == -6 && 1.5e3 > 1e-7")).toBe(true);
    expect(value('optional.of(1).hasValue() ? {"k": [1.0, 2.5]}.k[1] : 0.0')).toBe(2.5);
  });
});

describe('a failure', () => {
  const { expressions } = tool();

  it('is a result, for a text that is not CEL and for an evaluation that fails', () => {
    const broken = expressions.compile('1 +');
    expect(broken.error).toBeTypeOf('string');
    expect(broken.evaluate()).toEqual({ ok: false, error: broken.error });
    expect(expressions.evaluate('1 / 0')).toMatchObject({ ok: false, error: expect.stringContaining('zero') });
    expect(expressions.evaluate('missing + 1')).toMatchObject({ ok: false });
    expect(expressions.evaluate("spread(1, 2)")).toMatchObject({ ok: false });
    expect(expressions.evaluate('visiblePhases(1)')).toMatchObject({ ok: false });
  });

  it('parses a text once, in either form of an expression', () => {
    expect(expressions.compile('1 + 1')).toBe(expressions.compile({ cel: '1 + 1', resultType: 'int' }));
    expect(expressions.evaluate({ cel: '1 + 1' })).toEqual({ ok: true, value: 2, raw: 2n });
  });

  it('reports a function of the specification that cannot be read, and fails where it is called', () => {
    const { specification, metamodel } = tool();
    const functions = {
      twice: { params: [{ name: 'n', type: 'int' }], returns: 'int', cel: 'n * 2' },
      bad: { params: [], returns: 'int', cel: '1 +' },
      max: { params: [{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }], returns: 'int', cel: 'a' },
      depth: { params: [{ name: 'n', type: 'int' }], returns: 'int', recursion: { maxDepth: 3, atMaxDepth: '-1' }, cel: 'n == 0 ? 0 : 1 + depth(n - 1)' },
    };
    const own = createExpressions({ ...specification, functions } as never, metamodel);
    expect(own.findings.map((finding) => finding.message)).toEqual([expect.stringContaining('`max`'), expect.stringContaining('`bad`')]);
    expect(own.evaluate('twice(twice(3))')).toMatchObject({ value: 12 });
    expect(own.evaluate('bad()')).toMatchObject({ ok: false });
    // Three calls deep at most: the fourth gives the value at the limit instead.
    expect(own.evaluate('[depth(2), depth(5)]')).toMatchObject({ value: [2, 2] });
  });
});

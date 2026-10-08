import { describe, expect, it } from 'vitest';
import { interpretConstraints, type ConstraintsSection, type Gesture } from '../../src/disl/constraints';
import { parseYearMonth } from '../../src/disl/metamodel';
import { hypeCycleJson, tool } from './tool';

const header = 'gartner-hypecycle-graph: 1\n';
const trends = 'trends:\n  - id: a\n    name: A\n    start: 1900-01\n    stop: 1920-01\n  - id: b\n    name: B\n    start: 1910-01\n    stop: 1930-01\n';
const trigger = 'triggers:\n  - id: t\n    name: T\n    date: 1899-01\n';
const influence = (id: string, from: string, to: string): string =>
  `  - id: ${id}\n    from: ${from}\n    from-phase: peak\n    from-edge: top\n    from-at: 0.5\n    to: ${to}\n    to-phase: slope\n    to-edge: bottom\n    to-at: 0.5\n`;

// The tool with its `constraints` changed, to reach what the hype cycle graph does not state.
function withConstraints(change: (constraints: ConstraintsSection) => unknown) {
  const json = hypeCycleJson() as { constraints: ConstraintsSection };
  json.constraints = change({ ...json.constraints }) as ConstraintsSection;
  const changed = tool(json);
  const interpreted = interpretConstraints(changed.specification, changed.metamodel, changed.expressions);
  const check = (body: string) => {
    const reading = changed.read(body);
    return interpreted.value.check(reading.value, reading.findings);
  };
  return { ...changed, interpreted, constraints: interpreted.value, check };
}

const shipped = withConstraints((constraints) => constraints);
const rows = (findings: readonly { code: string; element?: string; message: string }[]) => findings.map((found) => [found.code, found.element, found.message]);

describe('the findings of a model', () => {
  it('report a relation once for each limit of its type it breaks, and a group of parallels once', () => {
    expect(rows(shipped.check(header + trends + 'influences:\n' + influence('aa1', 'a', 'a') + influence('aa2', 'a', 'a')))).toEqual([
      ['ghg.duplicate-influence', 'aa2', '`a` influences `a` 2 times; a trend influences another once in each direction.'],
      ['ghg.self-influence', 'aa1', '`aa1` has `a` influence itself; a trend cannot.'],
      ['ghg.self-influence', 'aa2', '`aa2` has `a` influence itself; a trend cannot.'],
    ]);
    expect(rows(shipped.check(header + trends + trigger + 'influences:\n' + influence('at1', 'a', 't') + influence('at2', 'a', 't')))).toEqual([
      ['ghg.duplicate-influence', 'at2', '`a` influences `t` 2 times; a trend influences another once in each direction.'],
      ['ghg.influence-into-trigger', 'at1', '`at1` ends at the trigger `t`; an influence cannot end at a trigger.'],
      ['ghg.influence-into-trigger', 'at2', '`at2` ends at the trigger `t`; an influence cannot end at a trigger.'],
    ]);
    const three = header + trends + 'influences:\n' + influence('ab1', 'a', 'b') + influence('ab2', 'a', 'b') + influence('ab3', 'a', 'b');
    expect(rows(shipped.check(three)).map(([, element]) => element)).toEqual(['ab2']);
    const every = withConstraints((constraints) => ({ ...constraints, builtIn: { ...constraints.builtIn, 'std.endpoints': { ...constraints.builtIn!['std.endpoints'], oncePerGroup: undefined } } }));
    expect(rows(every.check(three)).map(([, element]) => element)).toEqual(['ab2', 'ab3']);
  });

  it('report the holders of one id once, where the built-in says, in the order of the first holder', () => {
    const again = (id: string): string => `  - id: ${id}\n    name: Again\n    start: 1940-01\n    stop: 1950-01\n`;
    const twice = header + trends + again('b') + again('a') + again('a');
    expect(shipped.check(twice).map((found) => [found.code, found.constraint, found.location.line, found.message])).toEqual([
      ['ghg.duplicate-id', 'std.duplicateId', 19, '`a` is declared 3 times; an id names one entry.'],
      ['ghg.duplicate-id', 'std.duplicateId', 11, '`b` is declared 2 times; an id names one entry.'],
    ]);
    const every = withConstraints((constraints) => ({ ...constraints, order: [], builtIn: { ...constraints.builtIn, 'std.duplicateId': { code: 'x.twice' } } }));
    expect(every.check(twice).map((found) => [found.code, found.location.line, found.severity])).toEqual([['x.twice', 11, 'warning'], ['x.twice', 15, 'warning'], ['x.twice', 19, 'warning']]);
  });

  it('report an end that names nothing with the words for that end', () => {
    expect(rows(shipped.check(header + trends + 'influences:\n' + influence('ax', 'x', 'y') + influence('ay', 'a', 'y')))).toEqual([
      ['ghg.dangling-reference', 'ax', '`ax` comes from `x`, which is not a trend or a trigger in this document.'],
      ['ghg.dangling-reference', 'ax', '`ax` names `y`, which is not a trend in this document.'],
      ['ghg.dangling-reference', 'ay', '`ay` names `y`, which is not a trend in this document.'],
    ]);
  });

  it('give a document that cannot be parsed that finding alone, as the specification codes, rates and words it', () => {
    const reading = shipped.fixture('not-yaml');
    const findings = shipped.constraints.check(reading.value, reading.findings);
    expect(findings).toMatchObject([{ code: 'ghg.unreadable-entry', constraint: 'std.unparseable', severity: 'warning', location: { line: 4 } }]);
    expect(findings[0].message).toBe(`The document could not be read as YAML: ${reading.findings[0].message}`);
  });

  it('list what the reader could not read first within its code, in reading order', () => {
    const reading = shipped.fixture('malformed-entries');
    const findings = shipped.constraints.check(reading.value, reading.findings);
    expect(findings.map((found) => [found.code, found.severity, found.message])).toEqual(reading.findings.map((found) => ['ghg.unreadable-entry', 'warning', found.detail?.reason]));
    expect(findings).toHaveLength(4);
  });

  it('keep the order of DISL 8.6 without an order of codes: the reader, the built-ins, then the rules as declared', () => {
    const plain = withConstraints((constraints) => ({ ...constraints, order: undefined }));
    const body = header + 'trends:\n  - id: a\n    name: A\n    start: 1920-01\n    stop: 1900-01\n    phases: 7\n  - id: a\n    name: B\n    start: 1910-01\n    stop: 1930-01\n'
      + 'influences:\n' + influence('ax', 'a', 'x') + influence('aa', 'a', 'a');
    expect(plain.check(body).map((found) => found.code)).toEqual(['ghg.duplicate-id', 'ghg.self-influence', 'ghg.dangling-reference', 'ghg.stop-before-start', 'ghg.phase-count']);
  });

  it('rate a rule by its group, its own severity, the defaults, then as an error, and leave out what is switched off', () => {
    const changed = withConstraints((constraints) => ({
      ...constraints,
      defaults: undefined,
      groups: { quiet: { enabledByDefault: false }, mild: { severityOverride: 'hint' } },
      builtIn: { ...constraints.builtIn, 'std.references': { enabled: false } },
      rules: constraints.rules!.map((rule) => ({
        ...rule,
        ...(rule.id === 'phaseCount' ? { severity: { cel: "self.phases > 5 ? 'info' : 'warning'" } } : {}),
        ...(rule.id === 'triggerDate' ? { group: 'quiet' } : {}),
        ...(rule.id === 'notePosition' ? { group: 'mild' } : {}),
        ...(rule.id === 'boundaryOrder' ? { enabled: false } : {}),
      })),
    }));
    const body = header + 'trends:\n  - id: a\n    name: A\n    start: 1920-01\n    stop: 1900-01\n    phases: 7\n  - id: b\n    name: B\n    start: 1900-01\n    stop: 1920-01\n    peak-end: 1800-01\n'
      + 'triggers:\n  - id: t\n    name: T\nnotes:\n  - id: n\n    text: N\ninfluences:\n' + influence('ax', 'a', 'x');
    expect(changed.check(body).map((found) => [found.constraint, found.severity, found.attribute])).toEqual([
      ['stopAfterStart', 'error', 'stop'], ['phaseCount', 'info', 'phases'], ['notePosition', 'info', undefined],
    ]);
  });

  it('evaluate a rule at the moments its timing lists, and locate its finding at its element', () => {
    const { value: model } = shipped.fixture('rule-phase-count');
    expect(shipped.constraints.check(model, [])).toHaveLength(1);
    expect(shipped.constraints.check(model, [], { timing: 'save' })).toEqual([]);
    expect(shipped.constraints.check(model, [], { file: 'x.ghg' })[0].location).toEqual({ file: 'x.ghg', line: 3, column: 1, length: 0 });
  });

  it('report a rule that cannot be evaluated, pass over one whose `when` cannot, and word a message that cannot with the rule\'s name', () => {
    const changed = withConstraints((constraints) => ({
      ...constraints,
      order: [],
      builtIn: { ...constraints.builtIn, 'std.duplicateId': { code: { cel: "'not a code'" }, message: { cel: 'detail.nothing.more' } } },
      rules: [
        { id: 'fails', scope: 'Trigger', rule: '1 / 0 == 1', message: 'Never shown.' },
        { id: 'noAnswer', scope: 'Trigger', rule: "'yes'" },
        { id: 'skipped', scope: 'Trigger', when: 'self.nothing.more', rule: 'false' },
        { id: 'unworded', code: 'x.unworded', label: 'Worded', scope: 'Trigger', rule: 'false', message: { cel: 'self.nothing.more' } },
        { id: 'localized', scope: 'diagram', rule: 'diagram.nodes.size() == 0', message: { nl: 'Er zijn elementen.', en: 'There are elements.' } },
        { id: 'perItem', scope: 'diagram', forEach: "diagram.nodesOfType('Trigger')", message: { cel: "item.id + ' is item ' + string(index)" }, subject: "'the ' + item.name" },
        { id: 'noList', scope: 'diagram', forEach: '1' },
        { id: 'elsewhere', scope: 'Trigger', rule: 'false', target: "diagram.nodesOfType('Trend')", location: "{'file': 'other.txt', 'line': 7}" },
      ],
    }));
    expect(changed.interpreted.findings).toEqual([]);
    const findings = changed.check(header + trends + '  - id: a\n    name: Again\n    start: 1900-01\n    stop: 1920-01\n' + trigger);
    expect(findings.map((found) => [found.code, found.element, found.message])).toEqual([
      ['std.duplicateId', 'trend@11', expect.stringContaining('Another entry already has the id')],
      ['fails', 't', expect.stringMatching(/^The constraint `fails` could not be evaluated: .+/)],
      ['noAnswer', 't', 'The constraint `noAnswer` could not be evaluated: it gave neither true nor false'],
      ['x.unworded', 't', 'The constraint `Worded` does not hold.'],
      ['localized', undefined, 'There are elements.'],
      ['perItem', 't', 't is item 0'],
      ['noList', undefined, 'The constraint `noList` could not be evaluated: `forEach` did not give a list'],
      ['elsewhere', 'a', 'The constraint `elsewhere` does not hold.'],
      ['disl.constraints', undefined, 'The `code` of the built-in `std.duplicateId` did not give a code, so its findings carry `std.duplicateId`.'],
    ]);
    expect(findings.find((found) => found.constraint === 'perItem')).toMatchObject({ subject: 'the T', severity: 'warning' });
    expect(findings.find((found) => found.constraint === 'elsewhere')?.location).toEqual({ file: 'other.txt', line: 7, column: 0, length: 0 });
  });

  it('say which expression of the constraints cannot be read, and which rule is left out', () => {
    const changed = withConstraints((constraints) => ({
      ...constraints,
      builtIn: { 'std.references': { message: { cel: "'unfinished" } } },
      rules: [{ id: 'broken', scope: 'Trigger', rule: 'self.date >' }, { id: 'perView', over: 'view', rule: 'true' }],
    }));
    expect(changed.interpreted.findings.map((found) => [found.code, found.severity, found.message])).toEqual([
      ['disl.constraints', 'warning', 'The constraint `perView` is evaluated for each view, which this add-on does not support, so it is left out.'],
      ['disl.constraints', 'error', expect.stringMatching(/^The `rule` of the constraint `broken` cannot be read: .+/)],
      ['disl.constraints', 'error', expect.stringMatching(/^The `message` of the built-in `std.references` cannot be read: .+/)],
    ]);
    expect(changed.check(header + trends + trigger).map((found) => found.constraint)).toEqual(['broken']);
  });

  it('say whether findings keep a document from being saved', () => {
    const { value: model } = shipped.fixture('rule-phase-count');
    const blocking = withConstraints((constraints) => ({ ...constraints, blockSaveOn: 'error', defaults: undefined }));
    expect(shipped.constraints.blocksSave(blocking.constraints.check(model))).toBe(false);
    expect(blocking.constraints.blocksSave(blocking.constraints.check(model))).toBe(true);
    expect(blocking.constraints.blocksSave(shipped.constraints.check(model))).toBe(false);
  });
});

describe('what refuses a gesture', () => {
  const { value: model } = shipped.read(header + trends + trigger + 'notes:\n  - id: n\n    text: N\n    row: 1\ninfluences:\n' + influence('ab', 'a', 'b'));
  const sentences = (gesture: Gesture, after?: typeof model): string[] => shipped.constraints.refusals(gesture, model, after).map((refusal) => refusal.message);
  const change = (self: string, attribute: string, newValue: unknown): Gesture => ({ kind: 'change', self, values: { attribute, newValue } });
  const connect = (source: string, target: string): Gesture => ({ kind: 'connect', elements: { source, target }, values: { relationType: 'Influence' } });
  const unreadable = 'This note\'s position cannot be read, so it cannot be resized until it is fixed in the file.';

  it('is the gesture constraints of its kind that do not hold for the element, in the order they are declared', () => {
    expect(sentences(change('a', 'name', 'Steam'))).toEqual([]);
    expect(sentences(change('a', 'name', '  '))).toEqual(['A trend needs a name.']);
    expect(sentences(change('t', 'name', ''))).toEqual(['A trigger needs a name.']);
    expect(sentences(change('n', 'text', ''))).toEqual([]);
    // Every constraint that refuses is listed; the first is the one to show (DISL 8.4).
    expect(sentences(change('a', 'stop', parseYearMonth('1890-01')))).toEqual([
      'A trend must stop after it starts, at least one month later.',
      'A trend showing 4 phases must be at least 4 months long, one per phase.',
    ]);
    expect(sentences(change('a', 'stop', parseYearMonth('1900-03')))).toEqual(['A trend showing 4 phases must be at least 4 months long, one per phase.']);
    expect(sentences(change('a', 'phases', 9))).toEqual(['A trend shows 1 to 4 phases.']);
    expect(sentences(change('a', 'phases', 2))).toEqual([]);
    expect(sentences(change('n', 'width', 12.5))).toEqual([unreadable]);
    expect(sentences(change('n', 'width', 0))).toEqual([unreadable, 'A note needs a width and a height.']);
    expect(shipped.constraints.refusals(change('a', 'phases', 9), model)).toMatchObject([{ code: 'phasesInRange', constraint: 'phasesInRange', severity: 'warning', element: 'a', location: { line: 3 } }]);
  });

  it('is a placement that its constraint does not allow', () => {
    const resize = (x: number, x2: number): Gesture => ({ kind: 'placement', self: 'a', values: { gesture: 'resize', newBounds: { x: BigInt(x), x2: BigInt(x2) } } });
    expect(sentences(resize(100, 200))).toEqual([]);
    expect(sentences(resize(100, 100))).toEqual(['A trend must stop after it starts, at least one month later.']);
    expect(sentences(resize(100, 102))).toEqual(['A trend showing 4 phases must be at least 4 months long, one per phase.']);
    expect(sentences({ kind: 'placement', self: 'a', values: { gesture: 'move' } })).toEqual([]);
  });

  it('is a relation its type does not allow between two elements, in the built-in\'s words for a refusal', () => {
    expect(sentences(connect('b', 'a'))).toEqual([]);
    expect(sentences(connect('t', 'a'))).toEqual([]);
    expect(sentences(connect('a', 't'))).toEqual(['An influence cannot end at a trigger.']);
    expect(sentences(connect('n', 'a'))).toEqual(['An influence is drawn from one trend to another.']);
    expect(sentences(connect('a', 'b'))).toEqual(['This trend already influences that one; a trend influences another once in each direction.']);
    expect(sentences(connect('a', 'a'))).toEqual(['A trend cannot influence itself.']);
    expect(shipped.constraints.refusals(connect('a', 'a'), model)).toMatchObject([{ code: 'std.endpoints', constraint: 'std.endpoints', severity: 'warning' }]);
    // The relation that is reconnected is not a repeat of itself.
    expect(sentences({ ...connect('a', 'b'), self: 'ab' })).toEqual([]);
  });

  it('is worded by the runtime where the built-in has no refusal, and is none where it is switched off', () => {
    const unworded = withConstraints((constraints) => ({ ...constraints, builtIn: { 'std.endpoints': { message: 'Never a refusal.' } } }));
    expect(unworded.constraints.refusals(connect('a', 't'), model).map((refusal) => [refusal.message, refusal.severity])).toEqual([['A relation of the type `Influence` cannot have this target.', 'error']]);
    expect(unworded.constraints.refusals(connect('a', 'a'), model).map((refusal) => refusal.message)).toEqual(['A relation of the type `Influence` cannot connect an element to itself.']);
    expect(unworded.constraints.refusals(connect('a', 'b'), model).map((refusal) => refusal.message)).toEqual(['A relation of the type `Influence` already connects these two elements.']);
    expect(unworded.check(header + trends + 'influences:\n' + influence('aa', 'a', 'a')).map((found) => [found.code, found.severity, found.message])).toEqual([['std.endpoints', 'error', 'Never a refusal.']]);
    const off = withConstraints((constraints) => ({ ...constraints, builtIn: { 'std.endpoints': { enabled: false } } }));
    expect(off.constraints.refusals(connect('a', 't'), model)).toEqual([]);
    expect(off.check(header + trends + 'influences:\n' + influence('aa', 'a', 'a'))).toEqual([]);
  });

  it('is a gesture constraint that cannot be evaluated, and never one that only reports', () => {
    const failing = withConstraints((constraints) => ({
      ...constraints,
      rules: [{ id: 'fails', kind: 'delete', scope: 'Trend', rule: 'self.nothing.more' }, { id: 'reported', kind: 'delete', enforcement: 'report', rule: 'false' }],
    }));
    expect(failing.constraints.refusals({ kind: 'delete', self: 'a' }, model).map((refusal) => refusal.message)).toEqual([expect.stringMatching(/^The constraint `fails` could not be evaluated: /)]);
    expect(failing.constraints.refusals({ kind: 'delete', self: 't' }, model)).toEqual([]);
  });

  it('is an invariant that prevents and that the change would break, never one that is broken already', () => {
    const preventing = withConstraints((constraints) => ({ ...constraints, rules: constraints.rules!.map((rule) => (rule.id === 'phaseCount' ? { ...rule, enforcement: 'prevent' } : rule)) }));
    const withPhases = (id: string, phases: number): typeof model => ({ ...model, elements: model.elements.map((element) => (element.id === id ? { ...element, attributes: { ...element.attributes, phases } } : element)) });
    const move: Gesture = { kind: 'placement', self: 'a', values: { gesture: 'move' } };
    expect(preventing.constraints.refusals(move, model, withPhases('a', 9)).map((refusal) => refusal.message)).toEqual(['`a` shows 9 phases; a trend shows 1 to 4.']);
    expect(preventing.constraints.refusals(move, model, withPhases('a', 3))).toEqual([]);
    expect(preventing.constraints.refusals(move, withPhases('a', 8), withPhases('a', 9))).toEqual([]);
    expect(preventing.constraints.refusals(move, { ...model, elements: model.elements.filter((element) => element.id !== 'a') }, withPhases('a', 9))).toHaveLength(1);
    expect(shipped.constraints.refusals(move, model, withPhases('a', 9))).toEqual([]);
  });
});

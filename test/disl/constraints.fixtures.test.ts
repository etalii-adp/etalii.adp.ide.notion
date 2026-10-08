// Each `rule-*` fixture of the hype cycle graph gives the findings its specification states
// (etalii.adp spec 012-notion-hype-cycle-addon, FR-014). What a fixture must give is what the
// standalone host's parity transcript and the Visual Studio Code host's rules list for it; where
// they state what the specification does not, the specification wins and the case says so.

import { describe, expect, it } from 'vitest';
import { interpretConstraints } from '../../src/disl/constraints';
import { tool } from './tool';

const { specification, metamodel, expressions, fixture, read } = tool();
const interpreted = interpretConstraints(specification, metamodel, expressions);
const constraints = interpreted.value;

interface Row {
  readonly code: string;
  readonly message: string;
  readonly element?: string;
  readonly line: number;
}

const found = (reading: ReturnType<typeof read>): Row[] =>
  constraints.check(reading.value, reading.findings).map((finding) => ({ code: finding.code, message: finding.message, element: finding.element, line: finding.location.line }));

const attachment = 'does not name a phase, a top or bottom edge, and an `at` from 0 to 1.';
const repeated = '`a` influences `b` 2 times; a trend influences another once in each direction.';

// The hosts' findings for each fixture, with the element each is about.
const hosts: Readonly<Record<string, readonly Row[]>> = {
  'rule-bad-attachment': [{ code: 'ghg.bad-attachment', message: `\`ab\`'s from end (hype/bottom/0.5) ${attachment}`, element: 'ab', line: 16 }],
  'rule-boundary-order': [{ code: 'ghg.boundary-order', message: '`a`\'s `trough-end: 1905-01` is out of order or outside 1900-01 to 1920-01.', element: 'a', line: 3 }],
  'rule-dangling-reference': [{ code: 'ghg.dangling-reference', message: '`ax` names `x`, which is not a trend in this document.', element: 'ax', line: 16 }],
  'rule-duplicate-hidden': [{ code: 'ghg.duplicate-influence', message: repeated, element: 'ab2', line: 25 }],
  'rule-duplicate-id': [{ code: 'ghg.duplicate-id', message: '`a` is declared 2 times; an id names one entry.', element: 'trend@15', line: 15 }],
  'rule-duplicate-influence': [{ code: 'ghg.duplicate-influence', message: repeated, element: 'ab2', line: 25 }],
  'rule-influence-into-trigger': [{ code: 'ghg.influence-into-trigger', message: '`at` ends at the trigger `t`; an influence cannot end at a trigger.', element: 'at', line: 15 }],
  'rule-note-position': [{ code: 'ghg.note-position', message: '`n` needs an `at` written as YYYY-MM and a `width` and `height` that are positive numbers; it cannot be drawn without them.', element: 'n', line: 10 }],
  'rule-opposite-directions': [],
  'rule-phase-count': [{ code: 'ghg.phase-count', message: '`a` shows 7 phases; a trend shows 1 to 4.', element: 'a', line: 3 }],
  'rule-self-influence': [{ code: 'ghg.self-influence', message: '`aa` has `a` influence itself; a trend cannot.', element: 'aa', line: 16 }],
  'rule-stop-before-start': [{ code: 'ghg.stop-before-start', message: '`a` stops at 1900-01, not after it starts at 1920-01; a trend is at least a month long.', element: 'a', line: 3 }],
  'rule-trigger-date': [{ code: 'ghg.trigger-date', message: '`t` has no `date` written as YYYY-MM; a trigger cannot be drawn without one.', element: 't', line: 10 }],
  'rule-unreadable-entry': [{ code: 'ghg.unreadable-entry', message: '`colour` is not a key this module reads on a trend; the line is kept.', element: 'b', line: 15 }],
};

// Where the specification gives something else than the hosts do: what it gives, and why.
const stated: Readonly<Record<string, { readonly rows: readonly Row[]; readonly why: string }>> = {
  'rule-dangling-reference': {
    // The finding is the same; the reading locates it at the reference that names nothing (line 21), the hosts at the entry (line 16).
    rows: [{ ...hosts['rule-dangling-reference'][0], line: 21 }],
    why: 'the reading locates a dangling reference at the line of the reference, not of its entry',
  },
  'rule-trigger-date': {
    // DISL 8.7: a malformed value is the reader's `std.unreadableEntry`, which the specification
    // codes `ghg.unreadable-entry` and words as `detail.reason`: the reader's sentence. The hosts
    // report a trigger's unreadable date by `ghg.trigger-date` alone.
    rows: [
      { code: 'ghg.unreadable-entry', message: '`date` of `t` is not a value of the type `yearMonth`, so it is not read: some day', element: 't', line: 10 },
      hosts['rule-trigger-date'][0],
    ],
    why: 'the reader reports the malformed value too, as DISL 8.7 asks, in its own words',
  },
  'rule-unreadable-entry': {
    // The hosts report a key they do not read. The specification states neither that finding nor
    // its sentence: its binding keeps such keys in the host attribute `unknownKeys`, and nothing
    // in `constraints` reads it. So nothing is found.
    rows: [],
    why: 'no constraint and no built-in of the specification reports an unknown key',
  },
};

describe('the constraints of the hype cycle graph', () => {
  it('are read without a finding', () => {
    expect(interpreted.findings).toEqual([]);
  });

  it('find nothing in a clean document', () => {
    expect(found(fixture('rules-clean'))).toEqual([]);
    expect(found(fixture('triggers-and-notes'))).toEqual([]);
  });

  it.each(Object.keys(hosts).filter((name) => !(name in stated)))('%s gives the findings the hosts give', (name) => {
    expect(found(fixture(name))).toEqual(hosts[name]);
  });

  it.each(Object.keys(stated))('%s gives what the specification states, which is not what the hosts give', (name) => {
    expect(found(fixture(name)), stated[name].why).toEqual(stated[name].rows);
    expect(stated[name].rows).not.toEqual(hosts[name]);
  });

  it('reports every finding as a warning, as the specification rates them', () => {
    for (const name of Object.keys(hosts)) {
      const reading = fixture(name);
      for (const finding of constraints.check(reading.value, reading.findings)) expect(finding.severity, `${name} ${finding.code}`).toBe('warning');
    }
  });

  it('lists the findings in the order of the specification\'s codes, and within a code by line', () => {
    const end = (side: string, id: string): string => `    ${side}: ${id}\n    ${side}-phase: peak\n    ${side}-edge: top\n    ${side}-at: 0.5\n`;
    const influence = (id: string, from: string, to: string): string => `  - id: ${id}\n${end('from', from)}${end('to', to)}`;
    const reading = read([
      'gartner-hypecycle-graph: 1',
      'trends:',
      '  - id: a\n    name: A\n    start: 1920-01\n    stop: 1900-01\n    phases: 7',
      '  - id: b\n    name: B\n    start: 1910-01\n    stop: 1930-01\n    peak-end: 1900-01',
      '  - id: a\n    name: Again\n    start: 1940-01\n    stop: 1950-01',
      'triggers:',
      '  - id: t\n    name: T',
      'notes:',
      '  - id: n\n    text: Nowhere',
      'influences:',
      `${influence('bt', 'b', 't')}${influence('bb', 'b', 'b')}${influence('ba', 'b', 'a')}${influence('bx', 'b', 'x')}${influence('ba2', 'b', 'a')}  - id: bad\n${end('from', 'b').replace('top', 'side')}${end('to', 'a')}`,
    ].join('\n'));
    const findings = constraints.check(reading.value, reading.findings);
    expect(findings.map((finding) => [finding.code, finding.element])).toEqual([
      // A third influence from `b` to `a` joins the pair: one finding, at the second.
      ['ghg.duplicate-influence', 'ba2'],
      ['ghg.self-influence', 'bb'],
      ['ghg.stop-before-start', 'a'],
      ['ghg.phase-count', 'a'],
      ['ghg.boundary-order', 'b'],
      ['ghg.bad-attachment', 'bad'],
      ['ghg.dangling-reference', 'bx'],
      ['ghg.duplicate-id', 'trend@13'],
      ['ghg.influence-into-trigger', 'bt'],
      ['ghg.trigger-date', 't'],
      ['ghg.note-position', 'n'],
    ]);
    const order = (specification.constraints as { order: string[] }).order;
    expect(findings.map((finding) => order.indexOf(finding.code))).toEqual([...findings.keys()].map((index) => (index < 8 ? index : index + 1)));
    expect(findings[0].message).toBe('`b` influences `a` 3 times; a trend influences another once in each direction.');
  });
});

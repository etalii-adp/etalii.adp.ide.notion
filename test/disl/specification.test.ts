import { describe, expect, it } from 'vitest';
import { celOf, emptySpecification, isCel, labelOf, loadSpecification, localized } from '../../src/disl/specification';
import { hypeCycleJson, mindmapJson } from './tool';

describe('loadSpecification', () => {
  it('reads the specification the add-on ships without a finding', () => {
    const { value, findings } = loadSpecification(hypeCycleJson());
    expect(findings).toEqual([]);
    expect(value['disl']).toBe('0.3');
    expect(value.language.origin).toBe('gartner/hypecycle-graph');
    expect(Object.keys(value.functions ?? {})).toHaveLength(22);
    expect(value.persistence?.format).toBe('fbl');
  });

  it('reads the specification of another tool type', () => {
    const { value, findings } = loadSpecification(mindmapJson());
    expect(findings).toEqual([]);
    expect(Object.keys(value.metamodel.types ?? {})).toEqual(['Node']);
  });

  it.each([[null], ['a text'], [[1, 2]], [42], [undefined]])('gives an empty specification and a finding for %j', (json) => {
    const { value, findings } = loadSpecification(json);
    expect(value).toEqual(emptySpecification);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'disl.specification', severity: 'error' });
  });

  it('says what an object that is not a specification lacks, and still gives every required part', () => {
    const { value, findings } = loadSpecification({ hello: 'world' });
    expect(findings.map((finding) => finding.severity)).toEqual(['error', 'error', 'error']);
    expect(value).toMatchObject({ disl: '', language: { id: '', version: '' }, metamodel: {} });
  });

  it('refuses a higher major version and warns about a higher minor one', () => {
    const base = { language: { id: 'a.b', version: '1.0.0' }, metamodel: {} };
    expect(loadSpecification({ ...base, disl: '1.0' })).toMatchObject({ value: emptySpecification, findings: [{ severity: 'error' }] });
    const newer = loadSpecification({ ...base, disl: '0.9' });
    expect(newer.findings).toMatchObject([{ severity: 'warning' }]);
    expect(newer.value.language.id).toBe('a.b');
  });

  it('reads the version key of the format DISL came from', () => {
    const { value, findings } = loadSpecification({ dedl: '0.1', language: { id: 'a.b', version: '1.0.0' }, metamodel: {} });
    expect(findings).toEqual([]);
    expect(value['disl']).toBe('0.1');
  });

  it('leaves out a section that is not an object, and reports it', () => {
    const { value, findings } = loadSpecification({ disl: '0.3', language: { id: 'a.b', version: '1.0.0' }, metamodel: {}, forms: 'none', toolbox: [] });
    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('`toolbox`'), expect.stringContaining('`forms`')]);
    expect(value.forms).toBeUndefined();
    expect(value.toolbox).toBeUndefined();
  });
});

describe('texts and expressions', () => {
  it('picks the best text for a locale', () => {
    expect(localized('Plain', 'nl')).toBe('Plain');
    expect(localized({ en: 'State', nl: 'Toestand' }, 'nl-BE')).toBe('Toestand');
    expect(localized({ en: 'State', nl: 'Toestand' }, 'fr')).toBe('State');
    expect(localized({ de: 'Zustand' }, 'fr')).toBe('Zustand');
    expect(localized(undefined)).toBeUndefined();
  });

  it('derives a label from an identifier', () => {
    expect(labelOf('InitialState')).toBe('Initial state');
    expect(labelOf('due_date')).toBe('Due date');
  });

  it('tells CEL in its two forms', () => {
    expect(celOf('a + b')).toBe('a + b');
    expect(celOf({ cel: 'a + b', resultType: 'int' })).toBe('a + b');
    expect(isCel({ cel: 'x' })).toBe(true);
    expect(isCel({ en: 'x' })).toBe(false);
    expect(isCel('x')).toBe(false);
  });
});

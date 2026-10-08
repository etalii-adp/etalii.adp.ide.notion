import { describe, expect, it } from 'vitest';
import { interpretConstraints } from '../../src/disl/constraints';
import { interpretCoordinates } from '../../src/disl/coordinates';
import { createExpressions } from '../../src/disl/expressions';
import { formFor, interpretForms, rowsOf } from '../../src/disl/forms';
import { interpretLayout } from '../../src/disl/layout';
import { defaultsOf, interpretMetamodel } from '../../src/disl/metamodel';
import { emptyModel, type Finding, type Model } from '../../src/disl/model';
import { interpretNotation } from '../../src/disl/notation';
import { interpretPersistence } from '../../src/disl/persistence';
import { loadSpecification, type Specification } from '../../src/disl/specification';
import { interpretToolbox } from '../../src/disl/toolbox';
import { interpretViewpoints } from '../../src/disl/viewpoints';
import { hypeCycleJson, mindmapJson } from './tool';

// The interpreter serves a specification it was not written for (etalii.adp spec 012, US5 scenarios
// 1 and 2, FR-005, FR-028, SC-007), and follows a specification that is changed (US1 scenario 6).

/** Every section interpreted, as the page does it, with what each found. */
function interpret(source: unknown) {
  const loaded = loadSpecification(source);
  const specification = loaded.value;
  const metamodel = interpretMetamodel(specification);
  const expressions = createExpressions(specification, metamodel.value);
  const persistence = interpretPersistence(specification, metamodel.value);
  const coordinates = interpretCoordinates(specification, metamodel.value);
  const notation = interpretNotation(specification, metamodel.value);
  const layout = interpretLayout(specification);
  const viewpoints = interpretViewpoints(specification, metamodel.value, { notation: notation.value, coordinates: coordinates.value, layout: layout.value });
  const constraints = interpretConstraints(specification, metamodel.value, expressions);
  const toolbox = interpretToolbox(specification, metamodel.value);
  const forms = interpretForms(specification, metamodel.value, expressions);
  const findings: Finding[] = [loaded, metamodel, persistence, coordinates, notation, layout, viewpoints, constraints, toolbox, forms].flatMap((each) => [...each.findings]);
  return { specification, metamodel: metamodel.value, toolbox: toolbox.value, forms: forms.value, findings };
}

describe('the specification of another tool type', () => {
  const mindmap = mindmapJson() as Specification;

  it('is loaded and interpreted without throwing', () => {
    expect(() => interpret(mindmap)).not.toThrow();
  });

  it('has every feature the interpreter does not support as a finding that names it', () => {
    const { findings } = interpret(mindmap);
    // Its layout is a plugin's, which no add-on runs: the one thing of it that is reported.
    expect(findings.map((finding) => [finding.code, finding.severity])).toEqual([['disl.layout', 'warning']]);
    expect(findings[0].message).toContain('`plugin:net.etalii.adp.freeplane.mindmapLayout`');

    const asking = { ...mindmap, language: { ...mindmap.language, requires: { features: ['layout.tidyTree', 'form.embedded'], conformance: 'full' as const } } };
    const more = interpret(asking).findings.filter((finding) => finding.code.startsWith('disl.unsupported'));
    expect(more.map((finding) => finding.detail?.feature ?? finding.detail?.conformance)).toEqual(['layout.tidyTree', 'form.embedded', 'full']);
    expect(more.map((finding) => /`(layout\.tidyTree|form\.embedded|full)`/.test(finding.message))).toEqual([true, true, true]);
    expect(more.every((finding) => finding.severity === 'warning')).toBe(true);
  });

  it('has its metamodel interpreted: its types, with their labels, attributes and defaults', () => {
    const { metamodel } = interpret(mindmap);
    expect(Object.values(metamodel.types).map((type) => [type.name, type.kind, type.label])).toEqual([['Node', 'node', 'Node'], ['Branch', 'relation', 'Branch']]);
    expect(Object.keys(metamodel.types.Node.attributes)).toEqual(Object.keys(mindmap.metamodel!.types!.Node.attributes!));
    expect(defaultsOf(metamodel, 'Node')).toMatchObject({ text: '' });
    expect(Object.keys(metamodel.enums)).toEqual(['Side']);
  });

  it('has its toolbox interpreted: its tools with their names, icons and descriptions', () => {
    const { toolbox } = interpret(mindmap);
    expect(toolbox.groups.map((group) => [group.id, group.label, group.tools.map((tool) => [tool.id, tool.kind, tool.label, tool.icon, tool.doc, tool.operation])])).toEqual([
      ['mindmap', 'Mind map', [['node', 'operation', 'Node', 'mdi-card-plus-outline', 'Drop on a node to add a child under it.', 'addChild']]],
    ]);
    expect(toolbox.contextMenus.map((set) => set.for)).toContainEqual(['Node']);
  });

  it('has its forms interpreted: the attributes of an element with the controls its form asks for', () => {
    const { forms } = interpret(mindmap);
    const model: Model = { ...emptyModel, elements: [{ id: 'ID_1', type: 'Node', attributes: { text: 'Centre', link: 'https://example.org' }, host: {}, ephemeral: false, line: 1 }] };
    const subject = { model, element: 'ID_1' };
    const form = formFor(forms, 'Node');
    expect([form.id, form.generated, form.label(subject)]).toEqual(['nodeProperties', false, 'Mind map node']);
    const rows = rowsOf(form.items).filter((row) => row.attribute !== undefined);
    expect(rows.map((row) => [row.attribute, row.widget, row.label(subject), row.value(subject)])).toEqual([
      ['text', 'text', 'Text', 'Centre'], ['notes', 'textarea', expect.any(String), expect.anything()], ['link', 'text', expect.any(String), 'https://example.org'],
    ]);
    expect(rows[2].placeholder(subject)).toBe('Empty to unlink');
  });
});

describe('a specification that is changed in one label and one default', () => {
  // What differs between two values of plain data, as the paths to it.
  const differences = (one: unknown, other: unknown, path = ''): string[] => {
    if (typeof one === 'function' && typeof other === 'function') return [];
    if (typeof one !== 'object' || typeof other !== 'object' || one === null || other === null) return Object.is(one, other) ? [] : [path];
    const names = [...new Set([...Object.keys(one), ...Object.keys(other)])];
    return names.flatMap((name) => differences((one as Record<string, unknown>)[name], (other as Record<string, unknown>)[name], path === '' ? name : `${path}.${name}`));
  };

  const copied = hypeCycleJson();
  const changed = structuredClone(copied) as { toolbox: { groups: { tools: { id: string; label: string }[] }[] }; metamodel: { types: Record<string, { attributes: Record<string, { default?: unknown }> }> } };
  const [tool] = changed.toolbox.groups[0].tools;
  const [type, attribute] = Object.entries(changed.metamodel.types).flatMap(([name, declared]) =>
    Object.entries(declared.attributes ?? {}).filter(([, each]) => typeof each.default === 'number' && each.default > 0).map(([own]) => [name, own] as const))[0];
  const was = changed.metamodel.types[type].attributes[attribute].default as number;
  tool.label = 'Another label';
  changed.metamodel.types[type].attributes[attribute].default = was + 40;

  const before = interpret(copied);
  const after = interpret(changed);

  it('is followed by the toolbox and by the defaults of a new element', () => {
    expect(before.toolbox.tools[tool.id].label).not.toBe('Another label');
    expect(after.toolbox.tools[tool.id].label).toBe('Another label');
    expect(defaultsOf(before.metamodel, type)[attribute]).toBe(was);
    expect(defaultsOf(after.metamodel, type)[attribute]).toBe(was + 40);
    // The property grid shows the default for an element that stores no value.
    const model: Model = { ...emptyModel, elements: [{ id: 'a', type, attributes: {}, host: {}, ephemeral: false, line: 1 }] };
    const row = rowsOf(formFor(after.forms, type).items).find((each) => each.attribute === attribute);
    expect(row?.value({ model, element: 'a' })).toBe(was + 40);
  });

  it('changes nothing else of what the interpreter makes of it', () => {
    expect(differences(before.toolbox, after.toolbox)).toEqual(['groups.0.tools.0.label', `tools.${tool.id}.label`]);
    // The metamodel holds a type's attributes as interpreted and as declared.
    expect(differences(before.metamodel, after.metamodel)).toEqual([`types.${type}.attributes.${attribute}.default`, `types.${type}.declared.attributes.${attribute}.default`]);
    expect(after.findings).toEqual(before.findings);
  });
});

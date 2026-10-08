import { describe, expect, it } from 'vitest';
import { interpretMetamodel } from '../../src/disl/metamodel';
import { loadSpecification } from '../../src/disl/specification';
import { groupsIn, interpretToolbox, setsFor } from '../../src/disl/toolbox';
import { hypeCycleJson } from './tool';

const interpret = (source: unknown) => {
  const specification = loadSpecification(source).value;
  const metamodel = interpretMetamodel(specification).value;
  return { ...interpretToolbox(specification, metamodel), metamodel };
};

const small = (toolbox: object | undefined) => ({
  disl: '0.3', language: { id: 'a.b', version: '1.0.0' },
  metamodel: {
    types: { Shape: { abstract: true, label: 'Shape' }, Box: { extends: 'Shape', label: 'Box', icon: 'box', doc: 'A box.', labelAttribute: 'title', attributes: { title: { type: 'string' } } }, Dot: { extends: 'Shape' } },
    relations: { Link: { source: 'Shape', target: 'Box' } },
  },
  behavior: { operations: { tidy: { label: 'Tidy', for: 'diagram', actions: [] } } },
  ...(toolbox === undefined ? {} : { toolbox }),
});

describe('the toolbox of the hype cycle graph', () => {
  const { value: toolbox, findings, metamodel } = interpret(hypeCycleJson());

  it('is read without a finding', () => expect(findings).toEqual([]));

  it('has one group without a heading, with a tool for each element a user drops', () => {
    expect(toolbox.groups).toHaveLength(1);
    expect(toolbox.groups[0]).toMatchObject({ id: 'hypeCycle', collapsed: false, groups: [] });
    expect(toolbox.groups[0].label).toBeUndefined();
    expect(toolbox.groups[0].tools.map((tool) => [tool.id, tool.label, tool.icon, tool.creates, tool.kind, tool.mode, tool.after])).toEqual([
      ['trend', 'Trend', 'mdi-arrow-right-bold-box-outline', 'Trend', 'create-node', 'drop', 'none'],
      ['trigger', 'Trigger', 'mdi-circle-slice-8', 'Trigger', 'create-node', 'drop', 'none'],
      ['note', 'Note', 'mdi-note-text-outline', 'Note', 'create-node', 'drop', 'editLabel'],
    ]);
    expect(Object.keys(toolbox.tools)).toEqual(['trend', 'trigger', 'note']);
    expect(groupsIn(toolbox, 'compact')).toEqual(toolbox.groups);
  });

  it('gives each tool its tooltip, and the values a new element starts with as literals or as expressions', () => {
    const { trend, note } = toolbox.tools;
    expect(trend.doc).toBe('A trend through the hype cycle. Drop it where it starts; it is a year long with all four phases.');
    expect(trend.initial.phases).toBe(4);
    expect(trend.initial.start).toEqual({ cel: 'dropMonth(double(position.x))' });
    expect(note.initial).toMatchObject({ text: '', width: 160, height: 64 });
    expect(note.size).toEqual([160, 64]);
  });

  it('draws no relation with a tool, and states no place for a drop without a pointer', () => {
    for (const tool of Object.values(toolbox.tools)) {
      expect(tool.relation).toBeUndefined();
      expect(tool.keyboardDrop).toBe('view-centre');
      expect(tool.unavailable).toEqual([]);
    }
  });

  it('has a context menu for each type, for the empty canvas and for a pending connection, none with the standard entries', () => {
    expect(toolbox.contextTools).toEqual([]);
    expect(toolbox.contextMenus.map((set) => set.for)).toEqual([['Trend'], ['Trigger'], ['Note'], ['Influence'], ['diagram'], ['connection']]);
    expect(toolbox.contextMenus.every((set) => set.placement === 'menu' && !set.standardEntries)).toBe(true);
    expect(toolbox.contextMenus.map((set) => set.runSingle)).toEqual([false, false, false, false, false, true]);
    expect(toolbox.contextMenus[4].when).toBe("env.viewpoint == 'trueTime'");
  });

  it('keeps the entries of a menu in their order, with what each one does and the group it stands in', () => {
    const [menu] = setsFor(toolbox.contextMenus, metamodel, 'Trend');
    expect(menu.entries.map((entry) => [entry.kind, entry.label, entry.shortcut, entry.operation, entry.group])).toEqual([
      ['editLabel', 'Rename…', 'F2', undefined, 'edit'],
      ['operation', 'Even phases', undefined, 'evenPhases', 'edit'],
      ['delete', 'Remove', 'Delete', undefined, 'edit'],
      ['operation', 'Arrange diagram', undefined, 'arrange', 'arrange'],
    ]);
    expect(menu.entries[1].visible).toBe('!env.readOnly && (has(self.peakEnd) || has(self.troughEnd) || has(self.slopeEnd))');
    const [pending] = setsFor(toolbox.contextMenus, metamodel, 'connection');
    expect(pending.entries).toMatchObject([{ kind: 'connect', via: 'Influence', label: 'Influence', icon: 'mdi-ray-start-arrow' }]);
    expect(setsFor(toolbox.contextMenus, metamodel, 'diagram')[0].entries.map((entry) => entry.operation)).toEqual(['addTrendHere', 'addTriggerHere', 'addNoteHere', 'arrange']);
  });
});

describe('a toolbox', () => {
  it('that is absent is one group for every 10 concrete types, with a tool that creates each', () => {
    const { value: toolbox, findings } = interpret(small(undefined));
    expect(findings).toEqual([]);
    expect(toolbox.groups).toHaveLength(1);
    expect(toolbox.groups[0].tools.map((tool) => [tool.id, tool.kind, tool.label, tool.mode])).toEqual([['Box', 'create-node', 'Box', 'drag'], ['Dot', 'create-node', 'Dot', 'drag'], ['Link', 'create-edge', 'Link', 'drag']]);
    expect(toolbox.contextMenus).toEqual([]);
  });

  it('takes what a tool does not say from the type it creates', () => {
    const { value: toolbox } = interpret(small({ groups: [{ id: 'all', label: 'All', tools: [{ id: 'box', creates: 'Box' }, { id: 'dot', creates: 'Dot', label: 'A dot', shortcut: 'D' }] }] }));
    expect(toolbox.groups[0].label).toBe('All');
    expect(toolbox.tools.box).toMatchObject({ label: 'Box', icon: 'box', doc: 'A box.', after: 'editLabel', kind: 'create-node' });
    expect(toolbox.tools.dot).toMatchObject({ label: 'A dot', shortcut: 'D', after: 'select' });
  });

  it('says for a tool that draws a relation which types each end may have, subtypes included', () => {
    const { value: toolbox } = interpret(small({ groups: [{ id: 'all', tools: [{ id: 'link', creates: 'Link', mode: 'click-click' }] }] }));
    expect(toolbox.tools.link).toMatchObject({ kind: 'create-edge', mode: 'click-click', relation: { type: 'Link', sources: ['Shape', 'Box', 'Dot'], targets: ['Box'] } });
  });

  it('reads a tool of its library by its id, in a group and outside one, and a tool that runs an operation', () => {
    const { value: toolbox, findings } = interpret(small({
      tools: { box: { id: 'box', creates: 'Box' }, tidy: { id: 'tidy', kind: 'operation', operation: 'tidy', label: 'Tidy up' } },
      groups: [{ id: 'one', viewpoints: ['main'], tools: ['box', 'gone'] }, { id: 'two', groups: [{ id: 'inner', tools: ['box'] }] }],
    }));
    expect(toolbox.groups[0].tools.map((tool) => tool.id)).toEqual(['box']);
    expect(toolbox.groups[1].groups[0].tools.map((tool) => tool.id)).toEqual(['box']);
    expect(toolbox.tools.tidy).toMatchObject({ kind: 'operation', operation: 'tidy', label: 'Tidy up' });
    expect(findings.map((finding) => finding.message)).toEqual(['The group `one` names the tool `gone`, which the toolbox does not declare.']);
    expect(groupsIn(toolbox, 'other').map((group) => group.id)).toEqual(['two']);
  });

  it('reports a tool that creates no type of the specification, and what it does not support', () => {
    const { findings } = interpret(small({
      groups: [{ id: 'all', tools: [{ id: 'ghost', creates: 'Ghost' }, { id: 'box', creates: 'Box', drop: { place: 'under' } }] }],
      contextTools: [{ for: ['Box'], tools: [{ kind: 'operation', operation: 'tidy', forEach: 'self.children' }] }],
    }));
    expect(findings.map((finding) => finding.message)).toEqual([
      'The tool `ghost` creates `Ghost`, which is not a type of this specification.',
      'The tool `ghost` has no `kind` and creates nothing, so it does nothing.',
      'The tool `box` chooses what a drop does by what lies under it, which this add-on does not support; it creates at the drop point.',
      'A context tool is repeated for each item of a list (`forEach`), which this add-on does not support; it is shown once.',
    ]);
  });

  it('adds the standard entries to a context menu unless it says not to, and never to a set of context tools', () => {
    const { value: toolbox, metamodel } = interpret(small({
      contextTools: [{ for: ['Shape'], tools: [{ kind: 'delete' }] }],
      contextMenus: [{ for: ['Box'], tools: [{ kind: 'delete' }] }, { for: ['Dot'], standardEntries: false, tools: [] }],
    }));
    expect(toolbox.contextTools[0]).toMatchObject({ placement: 'around', standardEntries: false });
    expect(toolbox.contextMenus.map((set) => set.standardEntries)).toEqual([true, false]);
    expect(setsFor(toolbox.contextTools, metamodel, 'Dot')).toHaveLength(1);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { applyFilters, drawFilters, drawLegend, filterChoices, sentenceOf, type FilterState } from '../../src/canvas/filters';
import { createScene } from '../../src/canvas/scene';
import { paintsOf } from '../../src/canvas/shapes';
import { tokensOf, type Filter, type Notation } from '../../src/disl/notation';
import { canvasTool, exampleBody } from './tool';

const made = canvasTool();
const model = made.read(exampleBody('electric-vehicles')).value;
const told = { tool: made.sceneTool, model };
const [declared] = Object.values(made.notation.canvas.filters);
let host: HTMLElement;
let changes: FilterState[];
const draw = (state: FilterState = {}, notation: Notation = made.notation) => drawFilters(host, { ...told, notation, state, onChange: (next) => changes.push(next) });
const chips = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-option]')];
const withFilter = (filter: Partial<Filter>): Notation => ({ ...made.notation, canvas: { ...made.notation.canvas, filters: { other: { ...declared, id: 'other', ...filter } } } });

beforeEach(() => {
  host = document.createElement('div');
  document.body.replaceChildren(host);
  changes = [];
});

describe('the controls of the filters', () => {
  it('offers what the filter\'s options give over the model, under the filter\'s label', () => {
    const choices = filterChoices(declared, told);
    expect(choices.length).toBeGreaterThan(1);
    draw();
    const group = host.querySelector('fieldset')!;
    expect(group.dataset.filter).toBe(declared.id);
    expect(group.dataset.control).toBe(declared.control);
    expect(group.querySelector('legend')!.textContent).toBe(sentenceOf(declared.label, told));
    expect(chips().map((chip) => chip.textContent)).toEqual(choices);
    expect(chips().every((chip) => chip.getAttribute('aria-pressed') === 'false' && chip.type === 'button')).toBe(true);
  });

  it('tells the state a chosen chip gives, and shows it pressed when drawn with it', () => {
    draw();
    const [first, second] = chips().map((chip) => chip.dataset.option!);
    chips()[0].click();
    expect(changes).toEqual([{ [declared.id]: { value: [first], match: declared.match.default } }]);
    draw(changes[0]);
    expect(chips().map((chip) => chip.getAttribute('aria-pressed')).slice(0, 2)).toEqual(['true', 'false']);
    chips()[1].click();
    expect(changes[1][declared.id].value).toEqual([first, second]);
    chips()[0].click();
    expect(changes[2][declared.id].value).toEqual([]);
  });

  it('lets the user choose between any and all when the filter allows it', () => {
    draw();
    const toggle = host.querySelector<HTMLButtonElement>('button[data-match]')!;
    expect(toggle.dataset.match).toBe(declared.match.default);
    toggle.click();
    expect(changes[0][declared.id].match).toBe(declared.match.default === 'any' ? 'all' : 'any');
    draw({}, withFilter({ match: { default: 'any', userToggle: false } }));
    expect(host.querySelector('button[data-match]')).toBeNull();
  });

  it('gives the focus back to the control that had it', () => {
    draw();
    chips()[1].focus();
    draw({ [declared.id]: { value: [chips()[1].dataset.option!] } });
    expect(document.activeElement).toBe(chips()[1]);
  });

  it('leaves a filter out that has nothing to choose from', () => {
    drawFilters(host, { tool: made.sceneTool, model: made.read('gartner-hypecycle-graph: 1\ntrends: []\ninfluences: []\n').value, notation: made.notation, state: {}, onChange: () => undefined });
    expect(host.children).toHaveLength(0);
  });

  it('draws a switch, a select and a search as the controls they are', () => {
    draw({}, withFilter({ control: 'switch', default: false }));
    const box = host.querySelector<HTMLInputElement>('input')!;
    expect(box.type).toBe('checkbox');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(changes.at(-1)!.other.value).toBe(true);

    draw({}, withFilter({ control: 'select', default: '' }));
    const select = host.querySelector('select')!;
    expect([...select.options].map((option) => option.value)).toEqual(['', ...filterChoices(declared, told)]);
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    expect(changes.at(-1)!.other.value).toBe(select.options[1].value);

    draw({}, withFilter({ control: 'search', default: '' }));
    const search = host.querySelector<HTMLInputElement>('input')!;
    expect(search.type).toBe('search');
    expect(host.querySelector('label')!.textContent).toBe(sentenceOf(declared.label, told));
  });
});

describe('a filter applied to a scene', () => {
  it('hides the elements the filter does not keep, and every edge to or from them', () => {
    const whole = createScene(made.sceneTool, model);
    const [choice] = filterChoices(declared, told);
    const scene = applyFilters(made.sceneTool, model, { [declared.id]: { value: [choice] } });
    expect(whole.filtered).toEqual([]);
    expect(scene.filtered.length).toBeGreaterThan(0);
    expect(scene.nodes.length).toBe(whole.nodes.length - scene.filtered.length);
    expect(scene.nodes.some((node) => scene.filtered.includes(node.id))).toBe(false);
    const drawn = new Set(scene.nodes.map((node) => node.id));
    expect(scene.edges.filter((edge) => edge.hidden === undefined).every((edge) => drawn.has(edge.source) && drawn.has(edge.target))).toBe(true);
    expect(scene.edges.some((edge) => edge.hidden === 'filter')).toBe(true);
  });

  it('is the whole scene again with the filter at its default', () => {
    const scene = applyFilters(made.sceneTool, model, { [declared.id]: { value: [] } });
    expect(scene.nodes.map((node) => node.id)).toEqual(createScene(made.sceneTool, model).nodes.map((node) => node.id));
  });
});

describe('the legend', () => {
  const legend = made.notation.canvas.legend!;
  const values = made.metamodel.enums[legend.entries[0]].values;
  const drawLegendIn = (mode: string, notation: Notation = made.notation) => drawLegend(host, { notation, metamodel: made.metamodel, paints: paintsOf(made.notation.theme, mode) });

  it('has one swatch for each value of the enum it names, in the value\'s colour of the appearance in use', () => {
    for (const mode of ['light', 'dark']) {
      drawLegendIn(mode);
      const entries = [...host.querySelectorAll<HTMLElement>('li')];
      expect(entries.map((entry) => entry.textContent)).toEqual(values.map((value) => value.label));
      const tokens = tokensOf(made.notation.theme, mode);
      const expected = values.map((value) => {
        const probe = document.createElement('span');
        probe.style.background = String(tokens[(value.color as { token: string }).token]);
        return probe.style.background;
      });
      expect(expected.every((colour) => colour !== '')).toBe(true);
      expect(entries.map((entry) => entry.querySelector<HTMLElement>('span')!.style.background)).toEqual(expected);
    }
    expect(host.querySelector('ul')!.getAttribute('aria-label')).toBeTruthy();
  });

  it('has one swatch for a type it names', () => {
    const [type] = Object.keys(made.metamodel.types);
    drawLegendIn('light', { ...made.notation, canvas: { ...made.notation.canvas, legend: { ...legend, entries: [type] } } });
    expect([...host.querySelectorAll('li')].map((entry) => entry.textContent)).toEqual([made.metamodel.types[type].label]);
  });

  it('is nothing when it is not visible, and when the notation has none', () => {
    drawLegendIn('light', { ...made.notation, canvas: { ...made.notation.canvas, legend: { ...legend, visible: false } } });
    expect(host.children).toHaveLength(0);
    drawLegendIn('light', { ...made.notation, canvas: { ...made.notation.canvas, legend: undefined } });
    expect(host.children).toHaveLength(0);
  });
});

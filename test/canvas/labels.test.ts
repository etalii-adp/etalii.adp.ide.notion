import { describe, expect, it } from 'vitest';
import { drawLabel, layoutLabel, measureOf, wrapText } from '../../src/canvas/labels';
import { createScene, type SceneLabel } from '../../src/canvas/scene';
import { paintsOf } from '../../src/canvas/shapes';
import { tokensOf } from '../../src/disl/notation';
import { canvasTool } from './tool';

const made = canvasTool();
const paints = paintsOf(made.notation.theme, 'light');
// Half the font size a character, 1.2 a line: numbers a test can work out.
const measure = measureOf({ textMetric: { kind: 'average', advance: 0.5, count: 'utf16', lineHeight: 1.2 } });
const widthOf = (text: string) => measure.width(text, 10);

const label = (more: Partial<SceneLabel>): SceneLabel => ({
  id: 'a', text: '', editText: '', box: { x: 0, y: 0, width: 50, height: 100 }, position: 'center', align: 'center', fontSize: 10, style: {}, editable: false, wrap: 'word', overflow: 'visible', ...more,
});

describe('the measure of a text', () => {
  it('is the notation\'s text metric, and the host\'s measure when the metric is the host\'s', () => {
    expect(measureOf(made.notation).width('abcd', 10)).toBeCloseTo(4 * 0.55 * 10);
    expect(measure.lineHeight(10)).toBe(12);
    expect(measure.lineHeight(10, { lineHeight: 2 })).toBe(20);
    expect(measureOf({ textMetric: 'host' }, (text, fontSize) => text.length * fontSize).width('abc', 3)).toBe(9);
  });
});

describe('wrapping', () => {
  it('breaks between words, and keeps a line break of the text', () => {
    expect(wrapText('one two three four', 50, 'word', widthOf)).toEqual(['one two', 'three four']);
    expect(wrapText('one\ntwo three four five', 50, 'word', widthOf)).toEqual(['one', 'two three', 'four five']);
  });

  it('leaves a word whole that is wider than the width', () => {
    expect(wrapText('a extraordinarily b', 50, 'word', widthOf)).toEqual(['a', 'extraordinarily', 'b']);
  });

  it('breaks between characters, or not at all, when the label asks for that', () => {
    expect(wrapText('abcdefghijklmno', 50, 'char', widthOf)).toEqual(['abcdefghij', 'klmno']);
    expect(wrapText('one two three four', 50, 'none', widthOf)).toEqual(['one two three four']);
  });
});

describe('a text that does not fit its box', () => {
  const long = 'one two three four five six';

  it('is left as it is, or cut at the edge of its box', () => {
    expect(layoutLabel(label({ text: long, box: { x: 0, y: 0, width: 50, height: 12 } }), measure)).toMatchObject({ lines: ['one two', 'three four', 'five six'], clip: false });
    const clipped = drawLabel(document, label({ text: long, overflow: 'clip', box: { x: 5, y: 6, width: 50, height: 12 } }), measure, paints);
    const clip = clipped.querySelector('clipPath')!;
    expect(clipped.querySelector('text')!.getAttribute('clip-path')).toBe(`url(#${clip.id})`);
    expect(['x', 'y', 'width', 'height'].map((name) => clip.querySelector('rect')!.getAttribute(name))).toEqual(['5', '6', '50', '12']);
  });

  it('ends in a sign of omission in the last line that has room', () => {
    const laid = layoutLabel(label({ text: long, overflow: 'ellipsis', box: { x: 0, y: 0, width: 50, height: 25 } }), measure);
    expect(laid.lines).toHaveLength(2);
    expect(laid.lines[0]).toBe('one two');
    expect(laid.lines[1].endsWith('…')).toBe(true);
    expect(widthOf(laid.lines[1])).toBeLessThanOrEqual(50);
    expect(layoutLabel(label({ text: 'abcdefghijklmnop', wrap: 'none', overflow: 'ellipsis' }), measure).lines).toEqual(['abcdefghi…']);
    expect(layoutLabel(label({ text: 'short', overflow: 'ellipsis' }), measure).lines).toEqual(['short']);
  });

  it('is drawn smaller until it fits, down to half its size', () => {
    const laid = layoutLabel(label({ text: 'abcdefghijkl', wrap: 'none', overflow: 'shrink' }), measure);
    expect(laid.fontSize).toBeLessThan(10);
    expect(measure.width('abcdefghijkl', laid.fontSize)).toBeLessThanOrEqual(50.01);
    expect(layoutLabel(label({ text: 'a'.repeat(100), wrap: 'none', overflow: 'shrink' }), measure).fontSize).toBe(5);
  });
});

describe('a label as SVG text', () => {
  it('has one line a tspan, held in the middle of its box', () => {
    const text = drawLabel(document, label({ text: 'one two three four' }), measure, paints);
    const lines = [...text.querySelectorAll('tspan')];
    expect(text.tagName).toBe('text');
    expect(text.getAttribute('data-label')).toBe('a');
    expect(lines.map((line) => line.textContent)).toEqual(['one two', 'three four']);
    expect(lines.map((line) => line.getAttribute('y'))).toEqual(['44', '56']);
    expect(lines.map((line) => line.getAttribute('x'))).toEqual(['25', '25']);
    expect(text.getAttribute('text-anchor')).toBe('middle');
    expect(text.getAttribute('font-size')).toBe('10');
  });

  it('is held at the start or the end of its box, at the top or the bottom', () => {
    const start = drawLabel(document, label({ text: 'one', align: 'start', position: 'top-left' }), measure, paints);
    expect([start.getAttribute('text-anchor'), start.querySelector('tspan')!.getAttribute('x'), start.querySelector('tspan')!.getAttribute('y')]).toEqual(['start', '0', '6']);
    const end = drawLabel(document, label({ text: 'one', align: 'end', style: { verticalAlign: 'bottom' } }), measure, paints);
    expect([end.getAttribute('text-anchor'), end.querySelector('tspan')!.getAttribute('x'), end.querySelector('tspan')!.getAttribute('y')]).toEqual(['end', '50', '94']);
  });

  it('takes its font and its colour from the style, and the page\'s text colour when the style gives none', () => {
    const scene = createScene(made.sceneTool, made.fixture('triggers-and-notes').value);
    const styled = scene.nodes.flatMap((node) => node.labels).find((candidate) => typeof candidate.style.font?.color === 'object')!;
    const token = (styled.style.font!.color as { token: string }).token;
    const drawn = drawLabel(document, styled, measureOf(made.notation), paints);
    expect(drawn.getAttribute('fill')).toBe(tokensOf(made.notation.theme, 'light')[token]);
    expect(drawn.getAttribute('font-size')).toBe(String(styled.fontSize));
    expect(drawLabel(document, label({ text: 'one' }), measure, paints).getAttribute('fill')).toBe('currentColor');
  });

  it('draws the labels of an example as the scene laid them out', () => {
    const scene = createScene(made.sceneTool, made.fixture('triggers-and-notes').value);
    const named = scene.nodes.find((node) => node.id === 'transistors')!.labels[0];
    const text = drawLabel(document, named, measureOf(made.notation), paints);
    expect(text.textContent).toBe('Transistors');
    expect(Number(text.querySelector('tspan')!.getAttribute('y'))).toBeCloseTo(named.box.y + named.box.height / 2);
    const remark = scene.nodes.find((node) => node.id === 'note-1')!.labels[0];
    const lines = [...drawLabel(document, remark, measureOf(made.notation), paints).querySelectorAll('tspan')].map((line) => line.textContent);
    // Three lines have room in the box, and the text has more: the last says so.
    expect(lines).toEqual(['Dates are', 'illustrative.', '…']);
  });
});

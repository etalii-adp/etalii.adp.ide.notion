import { describe, expect, it } from 'vitest';
import { createScene } from '../../src/canvas/scene';
import { drawNode, drawShape, paintsOf, strokeOf, svg } from '../../src/canvas/shapes';
import { tokensOf } from '../../src/disl/notation';
import { canvasTool } from './tool';

const made = canvasTool();
const paints = (mode: string) => paintsOf(made.notation.theme, mode);
const scene = createScene(made.sceneTool, made.fixture('triggers-and-notes').value);
const node = (id: string) => scene.nodes.find((candidate) => candidate.id === id)!;
const box = { x: 10, y: 20, width: 80, height: 40 };

describe('a built-in shape', () => {
  it('is a rectangle, an ellipse or nothing', () => {
    const rect = drawShape(document, { kind: 'rect', name: 'rect', box }, { fill: '#123456' }, paints('light'))!;
    expect([rect.tagName, rect.getAttribute('x'), rect.getAttribute('width'), rect.getAttribute('fill'), rect.getAttribute('stroke')]).toEqual(['rect', '10', '80', '#123456', 'none']);
    const ellipse = drawShape(document, { kind: 'ellipse', name: 'ellipse', box }, {}, paints('light'))!;
    expect([ellipse.tagName, ellipse.getAttribute('cx'), ellipse.getAttribute('ry')]).toEqual(['ellipse', '50', '20']);
    expect(drawShape(document, { kind: 'none', name: 'none', box }, {}, paints('light'))).toBeUndefined();
    expect(drawShape(document, { kind: 'rect', name: 'rect', box }, { visible: false }, paints('light'))).toBeUndefined();
  });

  it('rounds a pill and a rounded rectangle, and takes the corner a style states', () => {
    const corner = (name: string, style = {}) => drawShape(document, { kind: 'rect', name, box }, style, paints('light'))!.getAttribute('rx');
    expect(corner('pill')).toBe('20');
    expect(corner('roundedRect')).toBe('8');
    expect(corner('rect')).toBeNull();
    expect(corner('rect', { cornerRadius: 5 })).toBe('5');
  });

  it('is outlined in the text colour of the page when its style gives no fill and no line', () => {
    const bare = drawShape(document, { kind: 'rect', name: 'rect', box }, {}, paints('light'))!;
    expect([bare.getAttribute('fill'), bare.getAttribute('stroke')]).toEqual(['none', 'currentColor']);
  });

  it('draws no line of no width, and a dashed one as it is stated', () => {
    expect(strokeOf({ color: '#000000', width: 0 }, paints('light'))).toEqual({ stroke: 'none' });
    expect(strokeOf({ color: '#000000', width: 2, dash: [4, 2] }, paints('light'))).toEqual({ stroke: '#000000', 'stroke-width': 2, 'stroke-dasharray': '4 2' });
  });
});

describe('a custom and a composite shape', () => {
  const banner = node('transistors');

  it('draws a path as its commands say', () => {
    const part = banner.parts.find((candidate) => candidate.shape.kind === 'path')!;
    const drawn = drawShape(document, part.shape, part.style, paints('light'))!;
    expect(drawn.tagName).toBe('path');
    expect(drawn.getAttribute('d')).toMatch(/^M.*L.*Z$/);
  });

  it('draws every part of a composite shape with its id, the undermost first', () => {
    const group = drawNode(document, banner, paints('light'));
    expect(group.getAttribute('data-element')).toBe(banner.id);
    expect(group.getAttribute('data-type')).toBe(banner.type);
    const drawn = [...group.querySelectorAll('[data-part]')].map((part) => part.getAttribute('data-part'));
    const visible = banner.parts.filter((part) => part.shape.kind !== 'none').map((part) => part.id);
    expect(drawn).toEqual(visible);
    expect(drawn.length).toBeGreaterThan(4);
  });

  it('colours a part from the theme token of the appearance in use', () => {
    const filled = banner.parts.filter((part) => typeof part.style.fill === 'object' && part.style.fill !== null && 'token' in part.style.fill);
    expect(filled.length).toBeGreaterThan(0);
    for (const mode of ['light', 'dark']) {
      const group = drawNode(document, banner, paints(mode));
      for (const part of filled) {
        const token = (part.style.fill as { token: string }).token;
        expect(group.querySelector(`[data-part="${part.id}"]`)?.getAttribute('fill')).toBe(tokensOf(made.notation.theme, mode)[token]);
      }
    }
    const [light, dark] = ['light', 'dark'].map((mode) => drawNode(document, banner, paints(mode)).querySelector('[data-part]')?.getAttribute('fill'));
    expect(light).not.toBe(dark);
  });

  it('gives a node and a part the tooltip the notation gives them', () => {
    const group = drawNode(document, node('transistor-invented'), paints('light'));
    expect(group.querySelector(':scope > title')?.textContent).toContain('Transistor invented');
    const banners = drawNode(document, banner, paints('light'));
    expect(banners.querySelector('[data-part] > title')?.textContent).toBe(banner.parts.find((part) => part.tooltip)?.tooltip);
  });
});

describe('svg', () => {
  it('leaves an attribute out that has no value', () => {
    const drawn = svg(document, 'rect', { x: 1, y: undefined }, svg(document, 'title', {}, 'A title'));
    expect(drawn.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(drawn.hasAttribute('y')).toBe(false);
    expect(drawn.textContent).toBe('A title');
  });
});

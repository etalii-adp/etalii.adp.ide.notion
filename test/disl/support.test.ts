import { describe, expect, it } from 'vitest';
import { loadSpecification, type Specification } from '../../src/disl/specification';
import { supportedFeatures, unsupportedFeatures } from '../../src/disl/support';
import { hypeCycleJson, mindmapJson } from './tool';

describe('the features the interpreter supports', () => {
  it('covers every feature the hype cycle graph requires', () => {
    const specification = loadSpecification(hypeCycleJson()).value;
    expect(specification.language.requires?.features).toHaveLength(12);
    expect(unsupportedFeatures(specification)).toEqual([]);
  });

  it('reports nothing for a specification that requires nothing', () => {
    expect(unsupportedFeatures(loadSpecification(mindmapJson()).value)).toEqual([]);
  });

  it('names each feature it does not support, and no other', () => {
    const mindmap = mindmapJson() as Specification;
    const asking = { ...mindmap, language: { ...mindmap.language, requires: { features: ['layout.tidyTree', supportedFeatures[0], 'form.embedded'] } } };
    const { findings } = loadSpecification(asking);
    expect(findings.map((finding) => finding.detail?.feature)).toEqual(['layout.tidyTree', 'form.embedded']);
    expect(findings[0]).toMatchObject({ code: 'disl.unsupported-feature', severity: 'warning' });
    expect(findings[0].message).toContain('`layout.tidyTree`');
  });

  it('reports a conformance class above its own', () => {
    const mindmap = mindmapJson() as Specification;
    const findings = unsupportedFeatures({ ...mindmap, language: { ...mindmap.language, requires: { conformance: 'full' } } });
    expect(findings.map((finding) => finding.code)).toEqual(['disl.unsupported-conformance']);
  });
});

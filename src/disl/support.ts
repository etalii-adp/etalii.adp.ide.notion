import { finding, type Finding } from './model';
import type { Specification } from './specification';

/**
 * The optional features of DISL (Appendix B.8) this interpreter supports. A specification that
 * requires another one opens with a finding that names it (DISL 15.1), and `docs/disl-support.md`
 * lists both. A feature is added here by the change that builds it, never before.
 */
export const supportedFeatures: readonly string[] = [
  'axis.yearMonth',
  'ruler.adaptive',
  'snap.byGesture',
  'anchor.part',
  'canvas.filters',
  'viewpoint.variants',
  'placement.bound',
  'shape.custom',
  'shape.composite',
  'edge.bezier',
  'label.parse',
  'persistence.fbl',
];

/** The conformance class this interpreter states (DISL 15.1). */
export const conformance = 'standard';

const classes = ['core', 'standard', 'full'];

/** One finding for each feature of `language.requires` that is not supported, and one for a higher conformance class. */
export function unsupportedFeatures(specification: Specification): Finding[] {
  const requires = specification.language.requires;
  const features = Array.isArray(requires?.features) ? requires.features : [];
  const findings = features
    .filter((feature) => !supportedFeatures.includes(feature))
    .map((feature) => finding(
      'disl.unsupported-feature', 'warning',
      `This tool needs the DISL feature \`${feature}\`, which this add-on does not support, so a part of it is missing or works differently.`,
      { detail: { feature } },
    ));
  const wanted = requires?.conformance;
  if (wanted !== undefined && classes.indexOf(wanted) > classes.indexOf(conformance)) {
    findings.push(finding(
      'disl.unsupported-conformance', 'warning',
      `This tool needs a runtime of DISL's conformance class \`${wanted}\`, and this add-on is of class \`${conformance}\`.`,
      { detail: { conformance: wanted } },
    ));
  }
  return findings;
}

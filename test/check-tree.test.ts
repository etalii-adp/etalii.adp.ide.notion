import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/check-tree.mjs searches a built tree for the names test/words.test.ts keeps out of src/
// (etalii.adp spec 012-notion-hype-cycle-addon, contracts/published-tree.md, "Check in Build").

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string): string => readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n');
const work = mkdtempSync(join(tmpdir(), 'adp-check-tree-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// A tree of one add-on's folder, whole, with the given text as its addon.js.
function check(name: string, script: string, without?: string): { status: number | null; said: string } {
  const folder = join(work, name, 'some-tool');
  mkdirSync(folder, { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html>', 'addon.json': '{ "specification": "some-tool.dis", "binding": "some-tool.fbl" }',
    'some-tool.dis': '{}', 'some-tool.fbl': '{}', 'PROVENANCE.md': '', 'addon.js': script, 'addon.css': '',
  };
  for (const [file, text] of Object.entries(files)) if (file !== without) writeFileSync(join(folder, file), text);
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-tree.mjs'), join(work, name)], { encoding: 'utf8' });
  return { status: result.status, said: result.stderr };
}

describe('the check of a built tree', () => {
  it('collects its names from the paths the words test collects them from', () => {
    const test = read('test/words.test.ts');
    const paths = test.slice(test.indexOf('const specificationNames = ['), test.indexOf('\n', test.indexOf('const bindingSelectors = ')));
    expect(paths.length).toBeGreaterThan(1000);
    expect(read('scripts/check-tree.mjs')).toContain(paths);
  });

  it('passes a whole folder that holds no name and no secret', () => {
    expect(check('whole', 'const a="x";a.b(1);')).toEqual({ status: 0, said: '' });
  });

  it('fails on a folder that lacks a file', () => {
    const { status, said } = check('lacking', '', 'some-tool.fbl');
    expect(status).toBe(1);
    expect(said).toContain("its binding, 'some-tool.fbl', is no file of the folder");
  });

  it('fails on an addon.js that holds a name of a tool type', () => {
    const specification = readdirSync(join(root, 'addons'), { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.dis'))[0];
    const { id } = (JSON.parse(read(join('addons', specification))) as { language: { id: string } }).language;
    const { status, said } = check('named', `const a={b:"${id}"};`);
    expect(status).toBe(1);
    expect(said).toContain(`holds '${id}', a name of a tool type`);
  });

  it('fails on a file that reads as a Notion token or a client secret', () => {
    const token = ['ntn', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'].join('_');
    expect(check('token', `fetch(u,{headers:{Authorization:"Bearer ${token}"}});`).said).toContain('addon.js: holds what reads as a Notion token');
    expect(check('client', `const o={client${'_'}secret:"0123456789abcdef"};`).said).toContain('addon.js: holds what reads as a client secret');
  });
});

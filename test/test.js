'use strict';

/**
 * Smoke tests for ai-index. Zero dependencies — plain node + assert.
 * Creates a fixture project in a temp dir, runs the CLI against it and
 * verifies the generated index. Run with: npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'index.js');
const { extractJsTs, extractPy } = require('..');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('     ' + err.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------- unit: extractJsTs

console.log('\nextractJsTs()');

ok('detects exported class with methods', () => {
  const src = [
    'export abstract class BaseApi {',
    '  protected url(path: string) {}',
    '  async send() {}',
    '}',
  ].join('\n');
  const symbols = extractJsTs(src);
  assert.strictEqual(symbols[0].kind, 'class');
  assert.strictEqual(symbols[0].name, 'BaseApi');
  assert.strictEqual(symbols[0].abstract, true);
  assert.deepStrictEqual(symbols[0].methods, ['url', 'send']);
});

ok('detects class inheritance', () => {
  const symbols = extractJsTs('export class BalanceApi extends BaseApi {\n  get() {}\n}');
  assert.strictEqual(symbols[0].extends, 'BaseApi');
});

ok('detects exported functions, interfaces, types and consts', () => {
  const src = [
    'export function uniqueId() {}',
    'export const md5 = (input) => input;',
    'export interface TestCase {}',
    'export type Environment = string;',
    'export const balanceData: BalanceCase[] = [];',
  ].join('\n');
  const kinds = extractJsTs(src).map(s => `${s.kind}:${s.name}`);
  assert.deepStrictEqual(kinds, [
    'fn:uniqueId', 'fn:md5', 'interface:TestCase', 'type:Environment', 'const:balanceData',
  ]);
});

ok('ignores control-flow keywords as methods', () => {
  const src = 'export class A {\n  if (x) {}\n  run() {}\n}';
  const symbols = extractJsTs(src);
  assert.deepStrictEqual(symbols[0].methods, ['run']);
});

// ---------------------------------------------------- unit: extractPy

console.log('\nextractPy()');

ok('detects python classes and methods', () => {
  const src = [
    'class Reporter(Base):',
    '    def __init__(self):',
    '        pass',
    '    def publish(self):',
    '        pass',
    '    def _private(self):',
    '        pass',
    '',
    'def main():',
    '    pass',
  ].join('\n');
  const symbols = extractPy(src);
  assert.strictEqual(symbols[0].name, 'Reporter');
  assert.strictEqual(symbols[0].extends, 'Base');
  assert.deepStrictEqual(symbols[0].methods, ['__init__', 'publish']);
  assert.strictEqual(symbols[1].name, 'main');
});

// ---------------------------------------------------- e2e: CLI on fixture

console.log('\nCLI end-to-end');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-test-'));
const fixtureName = path.basename(fixture); // project name = folder basename

function write(rel, content) {
  const abs = path.join(fixture, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

write('package.json', JSON.stringify({
  name: 'fixture-project',
  description: 'Test fixture',
  scripts: { test: 'echo ok' },
  dependencies: { ajv: '^8.0.0' },
}));
write('src/api/BaseApi.ts', 'export abstract class BaseApi {\n  protected url() {}\n  async send() {}\n}\n');
write('src/api/UserApi.ts', 'export class UserApi extends BaseApi {\n  get() {}\n  create() {}\n}\n');
write('src/helpers/crypto.py', 'def unique_id():\n    pass\n');
write('src/ignored.log', 'not indexable');
// heavy folder that must be skipped
write('node_modules/fake-lib/index.js', 'export function neverIndexed() {}');
// .gitignore support
write('.gitignore', 'secret-folder/\n');
write('secret-folder/hidden.ts', 'export class Hidden {}\n');

const cliOutput = execFileSync('node', [CLI, fixture, '--no-claude'], { encoding: 'utf8' });
const indexPath = path.join(fixture, '.ai-index', 'PROJECT-INDEX.md');
const index = fs.readFileSync(indexPath, 'utf8');

ok('CLI reports success with stats', () => {
  assert.ok(cliOutput.includes('Project indexed: ' + fixtureName));
  assert.match(cliOutput, /Reduction: \d+% fewer tokens/);
});

ok('index file is generated', () => {
  assert.ok(fs.existsSync(indexPath));
});

ok('index contains project metadata from package.json', () => {
  assert.match(index, /Description: Test fixture/);
  assert.match(index, /Dependencies: ajv/);
});

ok('index contains TS class signatures', () => {
  assert.match(index, /class BaseApi \(abstract\): url, send/);
  assert.match(index, /class UserApi extends BaseApi: get, create/);
});

ok('index contains Python symbols', () => {
  assert.match(index, /fn unique_id\(\)/);
});

ok('node_modules is never indexed', () => {
  assert.ok(!index.includes('neverIndexed'));
  assert.ok(!index.includes('fake-lib'));
});

ok('.gitignore patterns are respected', () => {
  assert.ok(!index.includes('Hidden'));
  assert.ok(!index.includes('secret-folder'));
});

ok('non-code files are excluded', () => {
  assert.ok(!index.includes('ignored.log'));
});

ok('--no-claude skips CLAUDE.md creation', () => {
  assert.ok(!fs.existsSync(path.join(fixture, 'CLAUDE.md')));
});

// CLAUDE.md integration (second run, without --no-claude)
execFileSync('node', [CLI, fixture], { encoding: 'utf8' });

ok('default run creates CLAUDE.md with ai-index block', () => {
  const claude = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /<!-- ai-index:start -->/);
  assert.match(claude, /PROJECT-INDEX\.md/);
});

ok('re-run updates the block without duplicating it', () => {
  execFileSync('node', [CLI, fixture], { encoding: 'utf8' });
  const claude = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  const count = (claude.match(/<!-- ai-index:start -->/g) || []).length;
  assert.strictEqual(count, 1);
});

ok('list command shows the fixture project', () => {
  const listOutput = execFileSync('node', [CLI, 'list'], { encoding: 'utf8' });
  assert.ok(listOutput.includes(fixtureName));
});

// cleanup: temp fixture + its entry in the global registry
fs.rmSync(fixture, { recursive: true, force: true });
const registryPath = path.join(os.homedir(), '.ai-index', 'registry.json');
try {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  delete registry[fixtureName];
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
} catch { /* no registry */ }

console.log(`\n${passed} assertions passed${process.exitCode ? ' — WITH FAILURES ❌' : ' — all green ✅'}\n`);

'use strict';

/**
 * Smoke tests for ai-index. Zero dependencies — plain node + assert.
 * Creates a fixture project in a temp dir, runs the CLI against it and
 * verifies every command. AI_INDEX_HOME points the global registry to a
 * temp dir so tests never touch the user's real ~/.ai-index.
 * Run with: npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'index.js');
const { extractJsTs, extractPy } = require('..');

// Isolated global registry for the whole test run
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-home-'));
const ENV = { ...process.env, AI_INDEX_HOME: tempHome };

function cli(args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: ENV });
}

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

// ---------------------------------------------------- e2e: fixture project

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

// ---- index ----

const indexOutput = cli(['index', fixture, '--no-claude']);
const indexPath = path.join(fixture, '.ai-index', 'PROJECT-INDEX.md');
const index = fs.readFileSync(indexPath, 'utf8');

ok('`index` reports success with stats', () => {
  assert.ok(indexOutput.includes('Project indexed: ' + fixtureName));
  assert.match(indexOutput, /Reduction: \d+% fewer tokens/);
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

ok('bare `ai-index <path>` still indexes (backward compatible)', () => {
  const out = cli([fixture, '--no-claude']);
  assert.ok(out.includes('Project indexed: ' + fixtureName));
});

// ---- status ----

ok('`status` reports up to date right after indexing', () => {
  const out = cli(['status', fixture]);
  assert.match(out, /Up to date/);
});

ok('`status` detects outdated index when a file changes', () => {
  // "touch" the file: its mtime becomes newer than the index (spawning the
  // previous CLI processes guarantees the index is at least some ms older)
  const now = new Date();
  fs.utimesSync(path.join(fixture, 'src/api/UserApi.ts'), now, now);
  const out = cli(['status', fixture]);
  assert.match(out, /Outdated — 1 file\(s\) changed/);
});

ok('`update` refreshes the index back to up to date', () => {
  cli(['update', fixture, '--no-claude']);
  const out = cli(['status', fixture]);
  assert.match(out, /Up to date/);
});

// ---- CLAUDE.md integration ----

cli(['index', fixture]);

ok('default `index` creates CLAUDE.md with ai-index block', () => {
  const claude = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /<!-- ai-index:start -->/);
  assert.match(claude, /PROJECT-INDEX\.md/);
});

ok('re-run updates the block without duplicating it', () => {
  cli(['index', fixture]);
  const claude = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  const count = (claude.match(/<!-- ai-index:start -->/g) || []).length;
  assert.strictEqual(count, 1);
});

// ---- list ----

ok('`list` shows the fixture project', () => {
  const out = cli(['list']);
  assert.ok(out.includes(fixtureName));
});

// ---- export / import ----

const exportFile = path.join(tempHome, 'exported.ai-index.json');

ok('`export --out` creates a portable JSON file with the index', () => {
  const out = cli(['export', fixture, '--out', exportFile]);
  assert.match(out, /Export ready/);
  const payload = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
  assert.strictEqual(payload.format, 'ia-project-indexer/1');
  assert.strictEqual(payload.project, fixtureName);
  assert.ok(payload.index.includes('class BaseApi'));
});

ok('`export` auto-indexes a project that has no index yet', () => {
  const freshProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-fresh-'));
  fs.writeFileSync(path.join(freshProject, 'app.js'), 'export function hello() {}\n');
  const out = cli(['export', freshProject, '--no-claude', '--out', path.join(tempHome, 'fresh.json')]);
  assert.match(out, /indexing it first/);
  assert.match(out, /Export ready/);
  fs.rmSync(freshProject, { recursive: true, force: true });
});

const importTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-import-'));
const importName = path.basename(importTarget);

ok('`import` loads an exported index on another machine (fresh folder)', () => {
  const out = cli(['import', exportFile, importTarget]);
  assert.match(out, /Import complete/);
  const imported = fs.readFileSync(path.join(importTarget, '.ai-index', 'PROJECT-INDEX.md'), 'utf8');
  assert.ok(imported.includes('class BaseApi'));
  const claude = fs.readFileSync(path.join(importTarget, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /PROJECT-INDEX\.md/);
});

ok('imported project appears in `list` marked as imported', () => {
  const out = cli(['list']);
  assert.ok(out.includes(importName));
  assert.ok(out.includes('📥'));
});

ok('`import` rejects a non-JSON file', () => {
  const badFile = path.join(tempHome, 'bad.json');
  fs.writeFileSync(badFile, 'this is not json {{{', 'utf8');
  assert.throws(() => cli(['import', badFile, importTarget]), /Not a valid JSON/);
});

ok('`import` rejects JSON with an unrecognized format', () => {
  const wrongFile = path.join(tempHome, 'wrong.json');
  fs.writeFileSync(wrongFile, JSON.stringify({ format: 'something-else', index: '# hi' }), 'utf8');
  assert.throws(() => cli(['import', wrongFile, importTarget]), /Unrecognized format/);
});

ok('`import` rejects a missing file with a friendly error', () => {
  assert.throws(() => cli(['import', path.join(tempHome, 'ghost.json'), importTarget]), /File not found/);
});

fs.rmSync(importTarget, { recursive: true, force: true });

// ---- remove ----

ok('`remove --yes` deletes index, registry entry and CLAUDE.md block', () => {
  const out = cli(['remove', fixture, '--yes']);
  assert.match(out, /removed/);
  assert.ok(!fs.existsSync(path.join(fixture, '.ai-index')));
  assert.ok(!fs.existsSync(path.join(fixture, 'CLAUDE.md'))); // only contained our block
  assert.ok(!cli(['list']).includes(fixtureName));
});

ok('`remove` on a non-indexed project reports nothing to remove', () => {
  const out = cli(['remove', fixture, '--yes']);
  assert.match(out, /Nothing to remove/);
});

ok('`remove` preserves user content in CLAUDE.md', () => {
  write('CLAUDE.md', '# My project rules\n\nAlways use TypeScript.\n');
  cli(['index', fixture]);
  cli(['remove', fixture, '--yes']);
  const claude = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.includes('Always use TypeScript.'));
  assert.ok(!claude.includes('ai-index:start'));
});

// ---- clean ----

ok('`clean --yes` clears the global registry', () => {
  cli(['index', fixture, '--no-claude']);
  const out = cli(['clean', '--yes']);
  assert.match(out, /Global memory cleared/);
  assert.match(cli(['list']), /No projects indexed yet/);
});

ok('`clean --all --yes` also deletes project .ai-index folders', () => {
  cli(['index', fixture, '--no-claude']);
  assert.ok(fs.existsSync(path.join(fixture, '.ai-index')));
  cli(['clean', '--all', '--yes']);
  assert.ok(!fs.existsSync(path.join(fixture, '.ai-index')));
});

// ---- help / version ----

ok('`help` lists every command', () => {
  const out = cli(['help']);
  for (const word of ['index', 'update', 'status', 'list', 'export', 'import', 'remove', 'clean']) {
    assert.ok(out.includes(word), 'missing command in help: ' + word);
  }
});

ok('--version prints the package version', () => {
  const version = require('../package.json').version;
  assert.ok(cli(['--version']).includes(version));
});

// cleanup
fs.rmSync(fixture, { recursive: true, force: true });
fs.rmSync(tempHome, { recursive: true, force: true });

console.log(`\n${passed} assertions passed${process.exitCode ? ' — WITH FAILURES ❌' : ' — all green ✅'}\n`);

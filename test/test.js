'use strict';

/**
 * Smoke tests for ai-index. Zero dependencies — plain node + assert.
 * Creates a fixture project in a temp dir, runs the CLI against it and
 * verifies every command. IA_INDEX_HOME points the global registry to a
 * temp dir so tests never touch the user's real ~/.ia-index.
 * Run with: npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', 'index.js');
const { extractJsTs, extractPy, extractGo, extractJavaCs, extractPhp, extractRuby } = require('..');

// Isolated global registry for the whole test run
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-home-'));
const ENV = { ...process.env, IA_INDEX_HOME: tempHome };

// spawnSync with piped stderr keeps the test output clean: expected error
// messages from negative tests never leak to the console (they used to look
// like failures during `npm publish`). Failures throw with stderr attached.
function cli(args) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error((r.stderr || '') + (r.stdout || ''));
  return r.stdout;
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
    'fn:uniqueId',
    'fn:md5',
    'interface:TestCase',
    'type:Environment',
    'const:balanceData',
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

// ---------------------------------------------------- unit: more languages

console.log('\nextractGo() / extractJavaCs() / extractPhp() / extractRuby()');

ok('Go: structs, interfaces, methods and functions', () => {
  const src = [
    'type Server struct {',
    '}',
    'type Store interface {',
    '}',
    'func (s *Server) Start() error {',
    '}',
    'func NewServer() *Server {',
    '}',
  ].join('\n');
  const symbols = extractGo(src);
  assert.strictEqual(symbols[0].kind, 'class');
  assert.strictEqual(symbols[0].name, 'Server');
  assert.deepStrictEqual(symbols[0].methods, ['Start']);
  assert.strictEqual(symbols[1].kind, 'interface');
  assert.strictEqual(symbols[2].name, 'NewServer');
});

ok('Java/C#: classes with public methods, interfaces and enums', () => {
  const src = [
    'public class OrderService {',
    '    public Order createOrder(String id) {',
    '    }',
    '    private void internalOnly() {',
    '    }',
    '}',
    'public interface Repository {',
    '}',
    'public enum Status {',
    '}',
  ].join('\n');
  const symbols = extractJavaCs(src);
  assert.strictEqual(symbols[0].name, 'OrderService');
  assert.deepStrictEqual(symbols[0].methods, ['createOrder']); // private excluded
  assert.strictEqual(symbols[1].kind, 'interface');
  assert.strictEqual(symbols[2].kind, 'enum');
});

ok('PHP: classes with methods and standalone functions', () => {
  const src = [
    'class Invoice extends Document {',
    '    public function total() {',
    '    }',
    '}',
    'function format_money($n) {',
    '}',
  ].join('\n');
  const symbols = extractPhp(src);
  assert.strictEqual(symbols[0].name, 'Invoice');
  assert.strictEqual(symbols[0].extends, 'Document');
  assert.deepStrictEqual(symbols[0].methods, ['total']);
  assert.strictEqual(symbols[1].name, 'format_money');
});

ok('Ruby: classes with methods', () => {
  const src = ['class Parser < Base', '  def parse!', '  end', 'end'].join('\n');
  const symbols = extractRuby(src);
  assert.strictEqual(symbols[0].name, 'Parser');
  assert.strictEqual(symbols[0].extends, 'Base');
  assert.deepStrictEqual(symbols[0].methods, ['parse!']);
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

write(
  'package.json',
  JSON.stringify({
    name: 'fixture-project',
    description: 'Test fixture',
    scripts: { test: 'echo ok' },
    dependencies: { ajv: '^8.0.0' },
  }),
);
write(
  'src/api/BaseApi.ts',
  'export abstract class BaseApi {\n  protected url() {}\n  async send() {}\n}\n',
);
write(
  'src/api/UserApi.ts',
  'export class UserApi extends BaseApi {\n  get() {}\n  create() {}\n}\n',
);
write('src/helpers/crypto.py', 'def unique_id():\n    pass\n');
write(
  'src/server/main.go',
  'type Server struct {\n}\nfunc (s *Server) Start() error {\n}\nfunc main() {\n}\n',
);
write('src/ignored.log', 'not indexable');
// heavy folder that must be skipped
write('node_modules/fake-lib/index.js', 'export function neverIndexed() {}');
// .gitignore support
write('.gitignore', 'secret-folder/\n');
write('secret-folder/hidden.ts', 'export class Hidden {}\n');

// ---- index ----

const indexOutput = cli(['index', fixture, '--no-claude']);
const indexPath = path.join(fixture, '.ia-index', 'PROJECT-INDEX.md');
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

ok('index contains Go symbols', () => {
  assert.match(index, /class Server: Start/);
  assert.match(index, /fn main\(\)/);
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

ok('--no-claude / --no-ai-config skips all AI config files', () => {
  assert.ok(!fs.existsSync(path.join(fixture, 'CLAUDE.md')));
  assert.ok(!fs.existsSync(path.join(fixture, 'AGENTS.md')));
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

// ---- multi-assistant AI config integration ----

write('.cursorrules', 'Always use TypeScript strict mode.\n'); // pre-existing user file

cli(['index', fixture]);

ok('default `index` creates CLAUDE.md with ai-index block', () => {
  const claude = fs.readFileSync(path.join(fixture, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /<!-- ai-index:start -->/);
  assert.match(claude, /PROJECT-INDEX\.md/);
});

ok('default `index` also creates AGENTS.md (open agents standard)', () => {
  const agents = fs.readFileSync(path.join(fixture, 'AGENTS.md'), 'utf8');
  assert.match(agents, /<!-- ai-index:start -->/);
  assert.match(agents, /PROJECT-INDEX\.md/);
});

ok('pre-existing .cursorrules gets the block, user content preserved', () => {
  const rules = fs.readFileSync(path.join(fixture, '.cursorrules'), 'utf8');
  assert.ok(rules.includes('Always use TypeScript strict mode.'));
  assert.match(rules, /<!-- ai-index:start -->/);
});

ok('copilot-instructions.md is NOT created when it does not exist', () => {
  assert.ok(!fs.existsSync(path.join(fixture, '.github', 'copilot-instructions.md')));
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

const exportFile = path.join(tempHome, 'exported.ia-index.json');

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
  const out = cli([
    'export',
    freshProject,
    '--no-claude',
    '--out',
    path.join(tempHome, 'fresh.json'),
  ]);
  assert.match(out, /indexing it first/);
  assert.match(out, /Export ready/);
  fs.rmSync(freshProject, { recursive: true, force: true });
});

const importTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-import-'));
const importName = path.basename(importTarget);

ok('`import` loads an exported index on another machine (fresh folder)', () => {
  const out = cli(['import', exportFile, importTarget]);
  assert.match(out, /Import complete/);
  const imported = fs.readFileSync(
    path.join(importTarget, '.ia-index', 'PROJECT-INDEX.md'),
    'utf8',
  );
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
  assert.throws(
    () => cli(['import', path.join(tempHome, 'ghost.json'), importTarget]),
    /File not found/,
  );
});

fs.rmSync(importTarget, { recursive: true, force: true });

// ---- remove ----

ok('`remove --yes` deletes index, registry entry and all AI config blocks', () => {
  const out = cli(['remove', fixture, '--yes']);
  assert.match(out, /removed/);
  assert.ok(!fs.existsSync(path.join(fixture, '.ia-index')));
  assert.ok(!fs.existsSync(path.join(fixture, 'CLAUDE.md'))); // only contained our block
  assert.ok(!fs.existsSync(path.join(fixture, 'AGENTS.md'))); // only contained our block
  const rules = fs.readFileSync(path.join(fixture, '.cursorrules'), 'utf8');
  assert.ok(rules.includes('Always use TypeScript strict mode.')); // user content preserved
  assert.ok(!rules.includes('ai-index:start')); // our block stripped
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

// ---- edge cases & hardening ----

ok('refuses to index the home folder (safety net)', () => {
  assert.throws(() => cli(['index', os.homedir()]), /Refusing to index/);
});

ok('two projects with the same folder name never collide in the registry', () => {
  const parentA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-a-'));
  const parentB = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-b-'));
  const projA = path.join(parentA, 'my-api');
  const projB = path.join(parentB, 'my-api');
  fs.mkdirSync(projA);
  fs.mkdirSync(projB);
  fs.writeFileSync(path.join(projA, 'a.js'), 'export function fromA() {}\n');
  fs.writeFileSync(path.join(projB, 'b.js'), 'export function fromB() {}\n');
  cli(['index', projA, '--no-claude']);
  cli(['index', projB, '--no-claude']);
  const out = cli(['list']);
  assert.ok(out.includes(parentA.replace(/\\/g, '\\')) || out.includes(projA));
  assert.ok(out.includes(projB));
  fs.rmSync(parentA, { recursive: true, force: true });
  fs.rmSync(parentB, { recursive: true, force: true });
});

ok('`export --out` creates missing parent folders', () => {
  const deepOut = path.join(tempHome, 'new', 'deep', 'folder', 'out.ia-index.json');
  cli(['export', fixture, '--no-claude', '--out', deepOut]);
  assert.ok(fs.existsSync(deepOut));
});

ok('malformed .gitignore patterns never crash the indexer', () => {
  write('.gitignore', 'secret-folder/\n[[[*bad(regex\n');
  const out = cli(['index', fixture, '--no-claude']);
  assert.match(out, /Project indexed/);
  write('.gitignore', 'secret-folder/\n'); // restore
});

ok('empty and unreadable files are handled gracefully', () => {
  write('src/empty.ts', '');
  const out = cli(['index', fixture, '--no-claude']);
  assert.match(out, /Project indexed/);
  const idx = fs.readFileSync(path.join(fixture, '.ia-index', 'PROJECT-INDEX.md'), 'utf8');
  assert.ok(idx.includes('empty.ts'));
});

// ---- quiet / if-changed / legacy migration ----

ok('`update --quiet` prints a single friendly line', () => {
  const out = cli(['update', fixture, '--quiet', '--no-claude']);
  assert.match(out.trim(), /^⚡ ia-index: .+ updated \(\d+ files, \d+% tokens saved\)$/);
});

ok('`update --if-changed` skips instantly when index is fresh', () => {
  const out = cli(['update', fixture, '--if-changed', '--no-claude']);
  assert.match(out, /already fresh/);
});

ok('`update --if-changed` re-indexes when a file changed', () => {
  const now = new Date();
  fs.utimesSync(path.join(fixture, 'src/api/UserApi.ts'), now, now);
  const out = cli(['update', fixture, '--if-changed', '--quiet', '--no-claude']);
  assert.match(out, /updated/);
});

ok('legacy .ai-index folder is migrated away on index', () => {
  const legacy = path.join(fixture, '.ai-index');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'PROJECT-INDEX.md'), 'old', 'utf8');
  cli(['index', fixture, '--no-claude']);
  assert.ok(!fs.existsSync(legacy));
  assert.ok(fs.existsSync(path.join(fixture, '.ia-index', 'PROJECT-INDEX.md')));
});

// ---- hook (pre-commit) ----

ok('`hook` installs a pre-commit hook in .git/hooks', () => {
  fs.mkdirSync(path.join(fixture, '.git'), { recursive: true });
  const out = cli(['hook', fixture]);
  assert.match(out, /hook installed/);
  const hook = fs.readFileSync(path.join(fixture, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.ok(hook.startsWith('#!/bin/sh'));
  assert.ok(hook.includes('ia-index update --quiet --if-changed --no-ai-config'));
});

ok('`hook` re-run updates the block without duplicating it', () => {
  cli(['hook', fixture]);
  const hook = fs.readFileSync(path.join(fixture, '.git', 'hooks', 'pre-commit'), 'utf8');
  const count = (hook.match(/>>> ia-index pre-commit hook >>>/g) || []).length;
  assert.strictEqual(count, 1);
});

ok('`hook` prefers .husky/pre-commit when Husky is present', () => {
  const huskyDir = path.join(fixture, '.husky');
  fs.mkdirSync(huskyDir, { recursive: true });
  fs.writeFileSync(path.join(huskyDir, 'pre-commit'), 'npx lint-staged\n', 'utf8');
  const out = cli(['hook', 'install', fixture]);
  assert.match(out, /Husky/);
  const hook = fs.readFileSync(path.join(huskyDir, 'pre-commit'), 'utf8');
  assert.ok(hook.includes('npx lint-staged')); // user content preserved
  assert.ok(hook.includes('ia-index update'));
});

ok('`hook remove` strips the block and preserves user content', () => {
  cli(['hook', 'remove', fixture]);
  const hook = fs.readFileSync(path.join(fixture, '.husky', 'pre-commit'), 'utf8');
  assert.ok(hook.includes('npx lint-staged'));
  assert.ok(!hook.includes('ia-index update'));
  fs.rmSync(path.join(fixture, '.husky'), { recursive: true, force: true });
});

ok('`hook remove` deletes a hook file that only contained our block', () => {
  cli(['hook', 'remove', fixture]); // now targets .git/hooks/pre-commit
  assert.ok(!fs.existsSync(path.join(fixture, '.git', 'hooks', 'pre-commit')));
});

// ---- auto-gitignore (fixture has a .git dir at this point) ----

ok('index auto-adds .ia-index/ and *.ia-index.json to .gitignore in git repos', () => {
  cli(['index', fixture, '--no-claude']);
  const gi = fs.readFileSync(path.join(fixture, '.gitignore'), 'utf8');
  assert.ok(gi.includes('.ia-index/'));
  assert.ok(gi.includes('*.ia-index.json'));
  assert.ok(gi.includes('secret-folder/')); // user content preserved
});

ok('re-index never duplicates .gitignore entries', () => {
  cli(['index', fixture, '--no-claude']);
  cli(['index', fixture, '--no-claude']);
  const gi = fs.readFileSync(path.join(fixture, '.gitignore'), 'utf8');
  assert.strictEqual((gi.match(/^\.ia-index\/$/gm) || []).length, 1);
  assert.strictEqual((gi.match(/^\*\.ia-index\.json$/gm) || []).length, 1);
});

ok('gitignore is NOT touched outside a git repo', () => {
  const noGit = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-index-nogit-'));
  fs.writeFileSync(path.join(noGit, 'app.js'), 'export function x() {}\n');
  cli(['index', noGit, '--no-claude']);
  assert.ok(!fs.existsSync(path.join(noGit, '.gitignore')));
  fs.rmSync(noGit, { recursive: true, force: true });
});

// ---- stats ----

ok('`stats` shows the global savings dashboard', () => {
  cli(['clean', '--yes']); // start from a clean registry
  cli(['index', fixture, '--no-claude']);
  const out = cli(['stats']);
  assert.match(out, /Projects indexed:\s+1/);
  assert.match(out, /Every AI session saves/);
});

ok('`stats` on an empty registry shows a friendly message', () => {
  cli(['clean', '--yes']);
  assert.match(cli(['stats']), /No projects indexed yet/);
});

// ---- clean ----

ok('`clean --yes` clears the global registry', () => {
  cli(['index', fixture, '--no-claude']);
  const out = cli(['clean', '--yes']);
  assert.match(out, /Global memory cleared/);
  assert.match(cli(['list']), /No projects indexed yet/);
});

ok('`clean --all --yes` also deletes project .ia-index folders', () => {
  cli(['index', fixture, '--no-claude']);
  assert.ok(fs.existsSync(path.join(fixture, '.ia-index')));
  cli(['clean', '--all', '--yes']);
  assert.ok(!fs.existsSync(path.join(fixture, '.ia-index')));
});

// ---- help / version ----

ok('`help` lists every command', () => {
  const out = cli(['help']);
  for (const word of [
    'index',
    'update',
    'status',
    'list',
    'stats',
    'export',
    'import',
    'remove',
    'clean',
  ]) {
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

console.log(
  `\n${passed} assertions passed${process.exitCode ? ' — WITH FAILURES ❌' : ' — all green ✅'}\n`,
);

#!/usr/bin/env node
/**
 * ai-index — Ultra-compact project indexer for LLMs.
 *
 * Instead of letting your AI assistant explore the codebase (thousands of
 * tokens in searches and file reads), it reads ONE compact file:
 * .ai-index/PROJECT-INDEX.md
 *
 * Usage:
 *   ai-index               Index the current directory
 *   ai-index <path>        Index the given path
 *   ai-index list          List indexed projects
 *   ai-index --no-claude   Index without touching CLAUDE.md
 *   ai-index --help        Help
 *
 * Zero dependencies. Node >= 16. Windows / macOS / Linux.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = require('./package.json').version;
const HOME_DIR = path.join(os.homedir(), '.ai-index');
const REGISTRY = path.join(HOME_DIR, 'registry.json');

// Folders that are never indexed (the #1 cause of hung indexers)
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage',
  'test-results', 'allure-results', 'allure-report', '.scannerwork',
  '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', 'vendor',
  '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode', '.vs',
  'bin', 'obj', 'target', '.gradle', '.ai-index', '.codebase-memory',
  '.husky', '.github', 'tmp', 'temp', 'logs',
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'Gemfile.lock', 'poetry.lock', 'Cargo.lock', '.DS_Store', 'Thumbs.db',
]);

// Extensions whose content is analyzed (class/function signatures)
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
// Extensions that are only listed (they exist, but are not analyzed)
const LIST_EXTS = new Set([
  '.json', '.md', '.yml', '.yaml', '.xml', '.html', '.css', '.scss',
  '.sql', '.sh', '.ps1', '.java', '.cs', '.go', '.rb', '.php',
]);

const MAX_FILE_SIZE = 512 * 1024; // skip analyzing files > 512KB

// ---------------------------------------------------------------- helpers

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }
function tokens(bytes) { return Math.round(bytes / 4); } // ~4 chars per token

function loadGitignore(root) {
  const patterns = [];
  try {
    const raw = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    for (let line of raw.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      patterns.push(line.replace(/^\/+|\/+$/g, ''));
    }
  } catch { /* no .gitignore */ }
  return patterns;
}

function isGitignored(relPath, name, patterns) {
  for (const p of patterns) {
    if (p.includes('*')) {
      const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (rx.test(name) || rx.test(relPath)) return true;
    } else if (name === p || relPath === p || relPath.startsWith(p + '/')) {
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------- signature extraction

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'typeof',
  'await', 'else', 'do', 'try', 'throw', 'super', 'function', 'constructor',
]);

function extractJsTs(content) {
  const out = [];
  const lines = content.split(/\r?\n/);
  let currentClass = null;

  for (const line of lines) {
    // classes
    let m = line.match(/^\s*export\s+(?:default\s+)?(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/) ||
            line.match(/^(abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (m) {
      currentClass = { name: m[2], abstract: !!m[1], extends: m[3] || null, methods: [] };
      out.push({ kind: 'class', ...currentClass });
      continue;
    }
    // methods inside a class (indented)
    if (currentClass) {
      m = line.match(/^\s{2,6}(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(?:async\s+)?(\w+)\s*\(/);
      if (m && !JS_KEYWORDS.has(m[1]) && !currentClass.methods.includes(m[1])) {
        currentClass.methods.push(m[1]);
        continue;
      }
      if (/^\}/.test(line)) currentClass = null;
    }
    // exported functions
    m = line.match(/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/);
    if (m) { out.push({ kind: 'fn', name: m[1] }); continue; }
    // exported arrow functions
    m = line.match(/^\s*export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/);
    if (m) { out.push({ kind: 'fn', name: m[1] }); continue; }
    // exported interfaces / types / enums
    m = line.match(/^\s*export\s+(?:declare\s+)?(interface|type|enum)\s+(\w+)/);
    if (m) { out.push({ kind: m[1], name: m[2] }); continue; }
    // exported consts (data)
    m = line.match(/^\s*export\s+const\s+(\w+)\s*(?::\s*([\w[\]<>. ]+))?\s*=/);
    if (m) { out.push({ kind: 'const', name: m[1], type: m[2] || null }); continue; }
  }
  return out;
}

function extractPy(content) {
  const out = [];
  let currentClass = null;
  for (const line of content.split(/\r?\n/)) {
    let m = line.match(/^class\s+(\w+)(?:\(([^)]*)\))?:/);
    if (m) {
      currentClass = { name: m[1], extends: m[2] || null, methods: [] };
      out.push({ kind: 'class', ...currentClass });
      continue;
    }
    m = line.match(/^(\s*)def\s+(\w+)/);
    if (m) {
      if (m[1].length > 0 && currentClass) {
        if (!m[2].startsWith('_') || m[2] === '__init__') currentClass.methods.push(m[2]);
      } else {
        currentClass = null;
        out.push({ kind: 'fn', name: m[2] });
      }
    }
  }
  return out;
}

function formatSymbols(symbols) {
  const parts = [];
  for (const s of symbols) {
    if (s.kind === 'class') {
      let head = `class ${s.name}`;
      if (s.abstract) head += ' (abstract)';
      if (s.extends) head += ` extends ${s.extends}`;
      if (s.methods.length) head += `: ${s.methods.join(', ')}`;
      parts.push(head);
    } else if (s.kind === 'interface' || s.kind === 'type' || s.kind === 'enum') {
      parts.push(`${s.kind} ${s.name}`);
    } else if (s.kind === 'fn') {
      parts.push(`fn ${s.name}()`);
    } else if (s.kind === 'const') {
      parts.push(`const ${s.name}${s.type ? ': ' + s.type.trim() : ''}`);
    }
  }
  return parts;
}

// ------------------------------------------------------------------- walker

function walk(root, gitignore) {
  const files = [];
  let totalBytes = 0;

  function visit(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        if (isGitignored(relPath, e.name, gitignore)) continue;
        visit(path.join(dir, e.name), relPath);
      } else if (e.isFile()) {
        if (IGNORE_FILES.has(e.name)) continue;
        if (isGitignored(relPath, e.name, gitignore)) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!CODE_EXTS.has(ext) && !LIST_EXTS.has(ext)) continue;
        let size = 0;
        try { size = fs.statSync(path.join(dir, e.name)).size; } catch { continue; }
        totalBytes += size;
        files.push({ relPath, abs: path.join(dir, e.name), ext, size });
      }
    }
  }

  visit(root, '');
  return { files, totalBytes };
}

// ------------------------------------------------------------ index builder

function buildIndex(root, opts = {}) {
  const projectName = path.basename(root);
  const gitignore = loadGitignore(root);
  const { files, totalBytes } = walk(root, gitignore);

  if (files.length === 0) {
    console.error('⚠️  No indexable files found in: ' + root);
    process.exit(1);
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  // group by folder
  const byDir = new Map();
  for (const f of files) {
    const dir = path.dirname(f.relPath).replace(/\\/g, '/');
    const key = dir === '.' ? '(root)' : dir;
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key).push(f);
  }

  const lines = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  lines.push(`# PROJECT INDEX — ${projectName}`);
  lines.push('');
  lines.push(`> Generated by ai-index v${VERSION} · ${now}`);
  lines.push(`> ${files.length} files · source ${kb(totalBytes)} (~${tokens(totalBytes).toLocaleString()} tokens)`);
  lines.push('>');
  lines.push('> 🧠 **Instruction for the LLM:** this index summarizes the WHOLE project.');
  lines.push('> Consult it first (structure, classes, methods). Only open a source');
  lines.push('> file when you need the exact body of a function.');
  lines.push('');

  // package.json → scripts and key deps
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    lines.push('## Project');
    if (pkg.description) lines.push(`- Description: ${pkg.description}`);
    if (pkg.scripts) lines.push(`- npm scripts: ${Object.keys(pkg.scripts).join(', ')}`);
    const deps = Object.keys(pkg.dependencies || {}).concat(Object.keys(pkg.devDependencies || {}));
    if (deps.length) lines.push(`- Dependencies: ${deps.join(', ')}`);
    lines.push('');
  } catch { /* no package.json */ }

  lines.push('## Structure & symbols');
  lines.push('');

  for (const [dir, dirFiles] of byDir) {
    lines.push(`### 📂 ${dir}/`);
    for (const f of dirFiles) {
      const name = path.basename(f.relPath);
      if (CODE_EXTS.has(f.ext) && f.size <= MAX_FILE_SIZE) {
        let content = '';
        try { content = fs.readFileSync(f.abs, 'utf8'); } catch { /* skip */ }
        const symbols = f.ext === '.py' ? extractPy(content) : extractJsTs(content);
        const parts = formatSymbols(symbols);
        if (parts.length) {
          lines.push(`- **${name}** — ${parts.join(' · ')}`);
        } else {
          lines.push(`- ${name}`);
        }
      } else {
        lines.push(`- ${name}`);
      }
    }
    lines.push('');
  }

  const indexContent = lines.join('\n');
  const outDir = path.join(root, '.ai-index');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'PROJECT-INDEX.md');
  fs.writeFileSync(outFile, indexContent, 'utf8');

  const indexBytes = Buffer.byteLength(indexContent, 'utf8');
  const reduction = Math.max(0, Math.round((1 - indexBytes / totalBytes) * 100));

  // global registry
  fs.mkdirSync(HOME_DIR, { recursive: true });
  let registry = {};
  try { registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { /* new */ }
  registry[projectName] = {
    path: root,
    indexedAt: new Date().toISOString(),
    files: files.length,
    sourceKB: +(totalBytes / 1024).toFixed(1),
    indexKB: +(indexBytes / 1024).toFixed(1),
    reduction: reduction + '%',
  };
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2), 'utf8');

  // CLAUDE.md integration (opt-out with --no-claude)
  if (!opts.noClaude) updateClaudeMd(root);

  console.log('');
  console.log(`✅ Project indexed: ${projectName}`);
  console.log('');
  console.log(`   📄 Index:     ${outFile}`);
  console.log(`   📦 Files:     ${files.length}`);
  console.log(`   📊 Source:    ${kb(totalBytes)}  (~${tokens(totalBytes).toLocaleString()} tokens)`);
  console.log(`   🗜️  Index:     ${kb(indexBytes)}  (~${tokens(indexBytes).toLocaleString()} tokens)`);
  console.log(`   💰 Reduction: ${reduction}% fewer tokens`);
  console.log('');
  console.log('   Next: your LLM reads .ai-index/PROJECT-INDEX.md instead of');
  console.log('   exploring the whole codebase.' + (opts.noClaude ? '' : ' (CLAUDE.md already configured)'));
  console.log('');
}

function updateClaudeMd(root) {
  const claudeMd = path.join(root, 'CLAUDE.md');
  const START = '<!-- ai-index:start -->';
  const END = '<!-- ai-index:end -->';
  const block = [
    START,
    '## 🧠 Project index (token saver)',
    '',
    'This project has a compact index at `.ai-index/PROJECT-INDEX.md`.',
    '**Read it FIRST** before using Glob/Grep/Read to explore: it contains the',
    'full structure, classes, methods and functions of the entire codebase.',
    'Only open source files when you need the exact body of a function.',
    'If the code changed significantly, regenerate with: `ai-index`',
    END,
  ].join('\n');

  let content = '';
  try { content = fs.readFileSync(claudeMd, 'utf8'); } catch { /* new file */ }

  if (content.includes(START)) {
    content = content.replace(new RegExp(START + '[\\s\\S]*?' + END), block);
  } else {
    content = content ? content.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  }
  fs.writeFileSync(claudeMd, content, 'utf8');
}

// ---------------------------------------------------------------- commands

function listProjects() {
  let registry = {};
  try { registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { /* empty */ }
  const names = Object.keys(registry);
  if (!names.length) {
    console.log('📭 No projects indexed yet. Run `ai-index` inside a project.');
    return;
  }
  console.log('');
  console.log('📦 Indexed projects:');
  console.log('');
  for (const name of names) {
    const p = registry[name];
    console.log(`   ${name}`);
    console.log(`     path:     ${p.path}`);
    console.log(`     indexed:  ${p.indexedAt.slice(0, 16).replace('T', ' ')}`);
    console.log(`     files:    ${p.files} · source ${p.sourceKB} KB → index ${p.indexKB} KB (${p.reduction} fewer tokens)`);
    console.log('');
  }
}

function help() {
  console.log(`
ai-index v${VERSION} — ultra-compact project indexer for LLMs

Usage:
  ai-index               Index the current directory
  ai-index <path>        Index the given path
  ai-index list          List indexed projects
  ai-index --no-claude   Index without updating CLAUDE.md
  ai-index --version     Version
  ai-index --help        This help

Generates .ai-index/PROJECT-INDEX.md: a compact summary of structure,
classes, methods and functions. Your LLM reads it instead of exploring
the codebase → massive token reduction. Compatible with Claude, ChatGPT,
Gemini, Cursor and any AI assistant. Windows / macOS / Linux.
`);
}

// ------------------------------------------------------------------- main

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('-')));
  const positional = args.filter(a => !a.startsWith('-'));
  const cmd = positional[0];

  if (flags.has('--help') || flags.has('-h')) { help(); return; }
  if (flags.has('--version') || flags.has('-v')) { console.log('ai-index ' + VERSION); return; }
  if (cmd === 'list') { listProjects(); return; }

  const target = path.resolve(cmd || '.');
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('❌ Invalid path: ' + target);
    process.exit(1);
  }
  buildIndex(target, { noClaude: flags.has('--no-claude') });
}

if (require.main === module) {
  main();
} else {
  module.exports = { extractJsTs, extractPy, formatSymbols, walk, buildIndex, loadGitignore, isGitignored };
}

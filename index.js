#!/usr/bin/env node
/**
 * IA Project Indexer (ia-index) — Ultra-compact project indexer for LLMs.
 *
 * Instead of letting your AI assistant explore the codebase (thousands of
 * tokens in searches and file reads), it reads ONE compact file:
 * .ia-index/PROJECT-INDEX.md
 *
 * Commands:
 *   ia-index                       Interactive menu
 *   ia-index index [path]          Create / update the index
 *   ia-index update [path]         Same as index
 *   ia-index status [path]         Is the project indexed? Is it up to date?
 *   ia-index list                  List all indexed projects
 *   ia-index export [path]         Export the index to a portable file
 *   ia-index import <file> [path]  Load an exported index on this machine
 *   ia-index remove [path]         Delete a project's index
 *   ia-index clean                 Clear the global memory (registry)
 *
 * Flags:
 *   --out <file>  With export: custom output file
 *   --no-claude   Don't touch CLAUDE.md when indexing/importing
 *   --yes, -y     Skip confirmation prompts
 *   --all         With clean: also delete every project's .ia-index folder
 *
 * Zero dependencies. Node >= 16. Windows / macOS / Linux. 100% local.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const VERSION = require('./package.json').version;
const EXPORT_FORMAT = 'ia-project-indexer/1';
const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10MB cap for imported files
// IA_INDEX_HOME override keeps tests fully isolated from the real registry.
const HOME_DIR = process.env.IA_INDEX_HOME || path.join(os.homedir(), '.ia-index');
const REGISTRY = path.join(HOME_DIR, 'registry.json');
const LEGACY_HOME = path.join(os.homedir(), '.ai-index'); // pre-1.4.0 location
const INDEX_DIR = '.ia-index';
const LEGACY_INDEX_DIR = '.ai-index'; // pre-1.4.0 folder name inside projects

// ANSI colors — auto-disabled on non-TTY output (pipes, CI) and with NO_COLOR.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = code => s => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  green: paint('32'), yellow: paint('33'), cyan: paint('36'),
  magenta: paint('35'), red: paint('31'), bold: paint('1'), dim: paint('2'),
};

// Folders that are never indexed (the #1 cause of hung indexers)
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'coverage',
  'test-results', 'allure-results', 'allure-report', '.scannerwork',
  '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', 'vendor',
  '__pycache__', '.venv', 'venv', 'env', '.idea', '.vscode', '.vs',
  'bin', 'obj', 'target', '.gradle', '.ia-index', '.ai-index', '.codebase-memory',
  '.husky', '.github', 'tmp', 'temp', 'logs',
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'Gemfile.lock', 'poetry.lock', 'Cargo.lock', '.DS_Store', 'Thumbs.db',
]);

// Extensions whose content is analyzed (class/function signatures)
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.cs', '.php', '.rb',
]);
// Extensions that are only listed (they exist, but are not analyzed)
const LIST_EXTS = new Set([
  '.json', '.md', '.yml', '.yaml', '.xml', '.html', '.css', '.scss',
  '.sql', '.sh', '.ps1',
]);

const MAX_FILE_SIZE = 512 * 1024; // skip analyzing files > 512KB

// ---------------------------------------------------------------- helpers

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }
function tokens(bytes) { return Math.round(bytes / 4); } // ~4 chars per token

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function confirm(question, autoYes) {
  if (autoYes) return true;
  if (!process.stdin.isTTY) return false;
  const answer = await ask(question + ' (y/N) ');
  return /^y(es)?$/i.test(answer);
}

// Registry entries are keyed by the project's absolute path (two folders with
// the same name must never overwrite each other). Older registries were keyed
// by folder name — normalize keeps both formats working.
function normalizeRegistry(raw) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue;
    const p = val.path || key;
    out[p] = { name: val.name || path.basename(p), ...val, path: p };
  }
  return out;
}

function loadRegistry() {
  try { return normalizeRegistry(JSON.parse(fs.readFileSync(REGISTRY, 'utf8'))); } catch { /* try legacy */ }
  // one-time migration from the pre-1.4.0 home (~/.ai-index)
  if (!process.env.IA_INDEX_HOME) {
    try {
      const legacy = normalizeRegistry(JSON.parse(fs.readFileSync(path.join(LEGACY_HOME, 'registry.json'), 'utf8')));
      saveRegistry(legacy);
      fs.rmSync(LEGACY_HOME, { recursive: true, force: true });
      return legacy;
    } catch { /* no legacy registry either */ }
  }
  return {};
}

function saveRegistry(registry) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(registry, null, 2), 'utf8');
}

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
      try {
        const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        if (rx.test(name) || rx.test(relPath)) return true;
      } catch { /* malformed pattern — skip it */ }
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

function extractGo(content) {
  const out = [];
  const types = new Map();
  for (const line of content.split(/\r?\n/)) {
    let m = line.match(/^type\s+(\w+)\s+(struct|interface)\b/);
    if (m) {
      const t = { name: m[1], methods: [] };
      types.set(m[1], t);
      out.push({ kind: m[2] === 'interface' ? 'interface' : 'class', ...t });
      continue;
    }
    m = line.match(/^func\s+\(\w+\s+\*?(\w+)\)\s+(\w+)\s*\(/); // method with receiver
    if (m) {
      const t = types.get(m[1]);
      if (t) t.methods.push(m[2]);
      else out.push({ kind: 'fn', name: m[1] + '.' + m[2] });
      continue;
    }
    m = line.match(/^func\s+(\w+)\s*\(/);
    if (m) out.push({ kind: 'fn', name: m[1] });
  }
  return out;
}

const JAVACS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do',
  'try', 'throw', 'using', 'lock', 'foreach', 'get', 'set', 'this', 'base',
]);

function extractJavaCs(content) {
  const out = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    let m = line.match(/^\s*(?:public\s+|private\s+|protected\s+|internal\s+)?(?:static\s+|abstract\s+|final\s+|sealed\s+|partial\s+)*(class|interface|enum|record)\s+(\w+)(?:\s*(?:extends|:)\s*(\w+))?/);
    if (m) {
      current = { name: m[2], extends: m[3] || null, methods: [] };
      out.push({ kind: (m[1] === 'class' || m[1] === 'record') ? 'class' : m[1], ...current });
      continue;
    }
    m = line.match(/^\s+(?:public|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+|final\s+|abstract\s+|synchronized\s+)*[\w<>[\],?\s]+?\s+(\w+)\s*\(/);
    if (m && current && !JAVACS_KEYWORDS.has(m[1]) && !current.methods.includes(m[1])) {
      current.methods.push(m[1]);
    }
  }
  return out;
}

function extractPhp(content) {
  const out = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    let m = line.match(/^\s*(?:abstract\s+|final\s+)*(class|interface|trait)\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (m) {
      current = { name: m[2], extends: m[3] || null, methods: [] };
      out.push({ kind: m[1] === 'interface' ? 'interface' : 'class', ...current });
      continue;
    }
    m = line.match(/^(\s*)(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+(\w+)/);
    if (m) {
      if (m[1].length > 0 && current) {
        if (!m[2].startsWith('__') && !current.methods.includes(m[2])) current.methods.push(m[2]);
      } else {
        current = null;
        out.push({ kind: 'fn', name: m[2] });
      }
    }
  }
  return out;
}

function extractRuby(content) {
  const out = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    let m = line.match(/^\s*(class|module)\s+([A-Z]\w*)(?:\s*<\s*(\w+))?/);
    if (m) {
      current = { name: m[2], extends: m[3] || null, methods: [] };
      out.push({ kind: 'class', ...current });
      continue;
    }
    m = line.match(/^(\s*)def\s+(?:self\.)?(\w+[?!]?)/);
    if (m) {
      if (m[1].length > 0 && current) {
        if (!current.methods.includes(m[2])) current.methods.push(m[2]);
      } else {
        current = null;
        out.push({ kind: 'fn', name: m[2] });
      }
    }
  }
  return out;
}

function extractorFor(ext) {
  switch (ext) {
    case '.py': return extractPy;
    case '.go': return extractGo;
    case '.java': case '.cs': return extractJavaCs;
    case '.php': return extractPhp;
    case '.rb': return extractRuby;
    default: return extractJsTs;
  }
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

const MAX_DEPTH = 30; // guards against pathological trees and symlink cycles

function walk(root, gitignore) {
  const files = [];
  let totalBytes = 0;

  function visit(dir, rel, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const e of entries) {
      const relPath = rel ? rel + '/' + e.name : e.name;
      if (e.isSymbolicLink()) continue; // never follow links — avoids cycles and surprises
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        if (isGitignored(relPath, e.name, gitignore)) continue;
        visit(path.join(dir, e.name), relPath, depth + 1);
      } else if (e.isFile()) {
        if (IGNORE_FILES.has(e.name)) continue;
        if (isGitignored(relPath, e.name, gitignore)) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!CODE_EXTS.has(ext) && !LIST_EXTS.has(ext)) continue;
        let stat;
        try { stat = fs.statSync(path.join(dir, e.name)); } catch { continue; }
        totalBytes += stat.size;
        files.push({ relPath, abs: path.join(dir, e.name), ext, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }

  visit(root, '', 0);
  return { files, totalBytes };
}

// ---------------------------------------------------------- command: index

function cmdIndex(root, opts = {}) {
  // safety net: indexing a drive root or the home folder would scan everything
  if (root === path.parse(root).root || root === os.homedir()) {
    console.error(`🛑 Refusing to index ${root} — that would scan your entire ${root === os.homedir() ? 'home folder' : 'drive'}.`);
    console.error('   👉 cd into a specific project folder and run ia-index there.');
    process.exit(1);
  }

  const projectName = path.basename(root);
  const gitignore = loadGitignore(root);
  const { files, totalBytes } = walk(root, gitignore);

  if (files.length === 0) {
    console.error('⚠️  No indexable files found in: ' + root);
    process.exit(1);
  }

  // one-time migration: drop the pre-1.4.0 folder (its data is regenerated here)
  const legacyDir = path.join(root, LEGACY_INDEX_DIR);
  if (fs.existsSync(legacyDir)) fs.rmSync(legacyDir, { recursive: true, force: true });

  // --if-changed: skip everything if no file is newer than the current index
  // (this is what makes the pre-commit hook feel instant)
  const existingIndex = path.join(root, INDEX_DIR, 'PROJECT-INDEX.md');
  if (opts.ifChanged && fs.existsSync(existingIndex)) {
    const indexMtime = fs.statSync(existingIndex).mtimeMs;
    if (!files.some(f => f.mtimeMs > indexMtime)) {
      if (!opts.quiet) console.log(`✅ Index already fresh — nothing to do. ⚡`);
      return;
    }
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
  lines.push(`> Generated by IA Project Indexer v${VERSION} · ${now}`);
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
        const symbols = extractorFor(f.ext)(content);
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
  const outDir = path.join(root, '.ia-index');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'PROJECT-INDEX.md');
  fs.writeFileSync(outFile, indexContent, 'utf8');

  const indexBytes = Buffer.byteLength(indexContent, 'utf8');
  const reduction = Math.max(0, Math.round((1 - indexBytes / totalBytes) * 100));

  const registry = loadRegistry();
  registry[root] = {
    name: projectName,
    path: root,
    indexedAt: new Date().toISOString(),
    files: files.length,
    sourceKB: +(totalBytes / 1024).toFixed(1),
    indexKB: +(indexBytes / 1024).toFixed(1),
    reduction: reduction + '%',
    timesIndexed: ((registry[root] && registry[root].timesIndexed) || 0) + 1,
  };
  saveRegistry(registry);

  // Multi-assistant integration (opt-out with --no-ai-config / --no-claude)
  const touched = opts.noClaude ? [] : updateAiConfigs(root);

  if (opts.quiet) {
    console.log(`⚡ ia-index: ${projectName} updated (${files.length} files, ${reduction}% tokens saved)`);
    return;
  }

  console.log('');
  console.log(c.green(c.bold(`🎉 Done! Project indexed: ${projectName} ✨`)));
  console.log('');
  console.log(`   📄 Index:     ${c.cyan(outFile)}`);
  console.log(`   📦 Files:     ${files.length} scanned`);
  console.log(`   📊 Source:    ${kb(totalBytes)}  ${c.dim(`(~${tokens(totalBytes).toLocaleString()} tokens)`)}`);
  console.log(`   🗜️  Index:     ${kb(indexBytes)}  ${c.dim(`(~${tokens(indexBytes).toLocaleString()} tokens)`)}`);
  console.log(`   💰 Reduction: ${c.green(c.bold(`${reduction}% fewer tokens`))} 🚀`);
  if (touched.length) {
    console.log(`   🤖 AI configs ready: ${c.cyan(touched.join(' · '))} ✅`);
  }
  console.log('');
  console.log(c.dim('   💡 Tip: your AI assistant now reads .ia-index/PROJECT-INDEX.md'));
  console.log(c.dim('      instead of exploring the whole codebase.'));
  console.log(c.dim('   🔄 Code changed a lot? Just run: ia-index update'));
  if (indexBytes > 150 * 1024) {
    console.log('');
    console.log(c.yellow('   ⚠️  Your index is quite large (>150 KB). Consider adding build output'));
    console.log(c.yellow('      or generated folders to .gitignore so they are excluded.'));
  }
  console.log('');
}

const BLOCK_START = '<!-- ai-index:start -->';
const BLOCK_END = '<!-- ai-index:end -->';

// One command configures EVERY assistant: files with createIfMissing are
// always written; the others only get the block if the user already has them.
const AI_CONFIG_FILES = [
  { file: 'CLAUDE.md', createIfMissing: true },                                  // Claude Code
  { file: 'AGENTS.md', createIfMissing: true },                                  // open agents standard (Codex, Cursor, Jules…)
  { file: '.cursorrules', createIfMissing: false },                              // Cursor (legacy rules file)
  { file: path.join('.github', 'copilot-instructions.md'), createIfMissing: false }, // GitHub Copilot
];

function aiBlock() {
  return [
    BLOCK_START,
    '## 🧠 Project index (token saver)',
    '',
    'This project has a compact index at `.ia-index/PROJECT-INDEX.md`.',
    '**Read it FIRST** before searching or reading files to explore: it contains',
    'the full structure, classes, methods and functions of the entire codebase.',
    'Only open source files when you need the exact body of a function.',
    'If the code changed significantly, regenerate with: `ia-index update`',
    BLOCK_END,
  ].join('\n');
}

function updateAiConfigs(root) {
  const touched = [];
  const block = aiBlock();
  for (const target of AI_CONFIG_FILES) {
    const abs = path.join(root, target.file);
    let content = '';
    try { content = fs.readFileSync(abs, 'utf8'); }
    catch { if (!target.createIfMissing) continue; }

    if (content.includes(BLOCK_START)) {
      content = content.replace(new RegExp(BLOCK_START + '[\\s\\S]*?' + BLOCK_END), block);
    } else {
      content = content ? content.trimEnd() + '\n\n' + block + '\n' : block + '\n';
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    touched.push(target.file);
  }
  return touched;
}

function stripAiConfigs(root) {
  for (const target of AI_CONFIG_FILES) {
    const abs = path.join(root, target.file);
    let content = '';
    try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (!content.includes(BLOCK_START)) continue;

    content = content.replace(new RegExp('\\n*' + BLOCK_START + '[\\s\\S]*?' + BLOCK_END + '\\n*'), '\n').trim();
    if (content) {
      fs.writeFileSync(abs, content + '\n', 'utf8');
    } else {
      fs.unlinkSync(abs); // the file only contained our block
    }
  }
}

// --------------------------------------------------------- command: status

function cmdStatus(root) {
  const projectName = path.basename(root);
  const indexFile = path.join(root, '.ia-index', 'PROJECT-INDEX.md');
  const registry = loadRegistry();
  const entry = registry[root];

  console.log('');
  console.log(c.bold(`📊 Status — ${c.cyan(projectName)}`));
  console.log('');

  if (!fs.existsSync(indexFile)) {
    console.log('   📭 This project is not indexed yet — but that\'s easy to fix!');
    console.log(`   👉 Just run: ${c.green('ia-index index')}  (takes less than a second ⚡)`);
    console.log('');
    return;
  }

  const indexMtime = fs.statSync(indexFile).mtimeMs;
  const { files } = walk(root, loadGitignore(root));
  const changed = files.filter(f => f.mtimeMs > indexMtime).length;

  if (entry) {
    console.log(`   🕒 Indexed:   ${String(entry.indexedAt).slice(0, 16).replace('T', ' ')}`);
    console.log(`   📦 Files:     ${entry.files} · source ${entry.sourceKB} KB → index ${entry.indexKB} KB ${c.green(`(${entry.reduction} fewer tokens)`)}`);
    if (entry.imported) console.log(`   📥 Imported:  from "${entry.imported.from}" ${c.dim(`(exported ${String(entry.imported.exportedAt).slice(0, 16).replace('T', ' ')})`)}`);
  } else {
    console.log(`   📄 Index:     ${c.cyan(indexFile)}`);
  }

  if (changed === 0) {
    console.log(`   💚 State:     ${c.green('✅ Up to date — your AI has fresh knowledge!')}`);
  } else {
    console.log(`   🟡 State:     ${c.yellow(`⚠️  Outdated — ${changed} file(s) changed since last index`)}`);
    console.log(`   👉 Refresh it with: ${c.green('ia-index update')}  ⚡`);
  }
  console.log('');
}

// ----------------------------------------------------------- command: list

function cmdList() {
  const registry = loadRegistry();
  const names = Object.keys(registry);
  if (!names.length) {
    console.log('');
    console.log('📭 No projects indexed yet — let\'s change that!');
    console.log(`   👉 Run ${c.green('ia-index index')} inside any project to get started 🚀`);
    console.log('');
    return;
  }
  console.log('');
  console.log(c.bold(`📦 Your indexed projects (${names.length}):`));
  console.log('');
  for (const p of Object.values(registry)) {
    console.log(`   ⚡ ${c.cyan(c.bold(p.name))}${p.imported ? ' 📥' : ''}`);
    console.log(`      📍 Path:     ${p.path}`);
    console.log(`      🕒 Indexed:  ${String(p.indexedAt).slice(0, 16).replace('T', ' ')}`);
    console.log(`      📊 Files:    ${p.files ?? '?'} · source ${p.sourceKB ?? '?'} KB → index ${p.indexKB ?? '?'} KB ${c.green(`(${p.reduction ?? '?'} fewer tokens 💰)`)}`);
    console.log('');
  }
}

// ----------------------------------------------------------- command: hook

const HOOK_START = '# >>> ia-index pre-commit hook >>>';
const HOOK_END = '# <<< ia-index pre-commit hook <<<';

function hookBlock() {
  return [
    HOOK_START,
    '# Keeps the AI project index fresh on every commit.',
    '# Ultra fast: skips instantly when nothing changed (--if-changed).',
    'command -v ia-index >/dev/null 2>&1 && ia-index update --quiet --if-changed --no-ai-config || true',
    HOOK_END,
  ].join('\n');
}

function hookTarget(root) {
  // Husky-managed repos keep hooks in .husky/ — respect that.
  if (fs.existsSync(path.join(root, '.husky'))) {
    return { file: path.join(root, '.husky', 'pre-commit'), kind: 'Husky' };
  }
  return { file: path.join(root, '.git', 'hooks', 'pre-commit'), kind: 'git' };
}

function cmdHookInstall(root) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    console.error('❌ Not a git repository: ' + root);
    process.exit(1);
  }
  const { file, kind } = hookTarget(root);

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { /* new hook file */ }

  const already = content.includes(HOOK_START);
  if (already) {
    content = content.replace(new RegExp(HOOK_START + '[\\s\\S]*?' + HOOK_END), hookBlock());
  } else if (content) {
    content = content.trimEnd() + '\n\n' + hookBlock() + '\n';
  } else {
    content = '#!/bin/sh\n\n' + hookBlock() + '\n';
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  try { fs.chmodSync(file, 0o755); } catch { /* windows */ }

  console.log('');
  console.log(c.green(c.bold(`🪝 Pre-commit hook ${already ? 'updated' : 'installed'}! ✨`)));
  console.log('');
  console.log(`   📄 Hook:    ${c.cyan(file)}  ${c.dim(`(${kind})`)}`);
  console.log(`   📂 Project: ${path.basename(root)}`);
  console.log('');
  console.log(c.dim('   💡 From now on, every `git commit` refreshes the index automatically.'));
  console.log(c.dim('      If nothing changed, it skips in milliseconds — commits stay fast ⚡'));
  console.log(c.dim('   🗑️  Uninstall anytime with: ia-index hook remove'));
  console.log('');
}

function cmdHookRemove(root) {
  const { file } = hookTarget(root);
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch {
    console.log('📭 No pre-commit hook found — nothing to remove. ✨');
    return;
  }
  if (!content.includes(HOOK_START)) {
    console.log('📭 The ia-index hook is not installed here — nothing to remove. ✨');
    return;
  }
  content = content.replace(new RegExp('\\n*' + HOOK_START + '[\\s\\S]*?' + HOOK_END + '\\n*'), '\n').trim();
  if (content && content !== '#!/bin/sh') {
    fs.writeFileSync(file, content + '\n', 'utf8');
  } else {
    fs.unlinkSync(file); // the hook only contained our block
  }
  console.log(c.green('✅ Pre-commit hook removed. Your commits are hook-free again! 👋'));
}

// ---------------------------------------------------------- command: stats

function cmdStats() {
  const registry = loadRegistry();
  const names = Object.keys(registry);
  if (!names.length) {
    console.log('');
    console.log('📭 No projects indexed yet — no savings to show… for now! 😉');
    console.log(`   👉 Run ${c.green('ia-index index')} inside any project to start saving tokens 🚀`);
    console.log('');
    return;
  }

  let srcKB = 0, idxKB = 0, totalFiles = 0, reindexes = 0;
  for (const name of names) {
    const p = registry[name];
    srcKB += Number(p.sourceKB) || 0;
    idxKB += Number(p.indexKB) || 0;
    totalFiles += Number(p.files) || 0;
    reindexes += Number(p.timesIndexed) || 1;
  }
  const srcTokens = Math.round(srcKB * 1024 / 4);
  const idxTokens = Math.round(idxKB * 1024 / 4);
  const savedPerSession = srcTokens - idxTokens;
  const pct = srcTokens ? Math.max(0, Math.round((1 - idxTokens / srcTokens) * 100)) : 0;

  console.log('');
  console.log(c.bold(c.cyan('📈 Global savings — IA Project Indexer')));
  console.log('');
  console.log(`   📦 Projects indexed:   ${names.length}`);
  console.log(`   🗂️  Files covered:      ${totalFiles.toLocaleString()}`);
  console.log(`   📊 Source analyzed:    ${srcKB.toFixed(1)} KB  ${c.dim(`(~${srcTokens.toLocaleString()} tokens)`)}`);
  console.log(`   🗜️  Index size:         ${idxKB.toFixed(1)} KB  ${c.dim(`(~${idxTokens.toLocaleString()} tokens)`)}`);
  console.log(`   🔄 Times (re)indexed:  ${reindexes}`);
  console.log('');
  console.log(`   💰 ${c.green(c.bold(`Every AI session saves ~${savedPerSession.toLocaleString()} tokens (${pct}%)`))} 🚀`);
  console.log(c.dim('      …and those savings repeat on EVERY new session, in every project.'));
  console.log('');
}

// --------------------------------------------------------- command: export

function cmdExport(root, opts = {}) {
  const projectName = path.basename(root);
  const indexFile = path.join(root, '.ia-index', 'PROJECT-INDEX.md');

  if (!fs.existsSync(indexFile)) {
    console.log(`📭 "${projectName}" is not indexed yet — indexing it first ⚡`);
    cmdIndex(root, opts);
  }

  const registry = loadRegistry();
  const entry = registry[root] || null;

  const payload = {
    format: EXPORT_FORMAT,
    tool: 'ia-project-indexer',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    project: projectName,
    stats: entry ? {
      files: entry.files, sourceKB: entry.sourceKB,
      indexKB: entry.indexKB, reduction: entry.reduction,
    } : null,
    index: fs.readFileSync(indexFile, 'utf8'),
  };

  const outFile = path.resolve(opts.out || `${projectName}.ia-index.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true }); // --out may point into a new folder
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

  console.log('');
  console.log(c.green(c.bold(`📤 Export ready! ✨`)));
  console.log('');
  console.log(`   📄 File:     ${c.cyan(outFile)}`);
  console.log(`   📦 Project:  ${projectName}`);
  console.log(`   📊 Size:     ${kb(fs.statSync(outFile).size)}`);
  console.log('');
  console.log(c.dim('   💡 Move this file to another machine (USB, cloud, chat…) and run:'));
  console.log(`      ${c.green(`ia-index import ${path.basename(outFile)}`)}  ${c.dim('(inside the target project folder)')}`);
  console.log('');
}

// --------------------------------------------------------- command: import

function cmdImport(file, targetRoot, opts = {}) {
  // --- validations (security first!) ---
  if (!file) {
    console.error(`❌ Missing file. Usage: ${c.green('ia-index import <file.ia-index.json> [target-folder]')}`);
    return false;
  }
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
    console.error('❌ File not found: ' + absFile);
    return false;
  }
  if (fs.statSync(absFile).size > MAX_IMPORT_SIZE) {
    console.error(`❌ File too large (max ${MAX_IMPORT_SIZE / 1024 / 1024}MB). This doesn't look like a valid export.`);
    return false;
  }

  let payload;
  try { payload = JSON.parse(fs.readFileSync(absFile, 'utf8')); }
  catch {
    console.error('❌ Not a valid JSON file. Expected an export created with: ia-index export');
    return false;
  }

  if (!payload || typeof payload !== 'object' || payload.format !== EXPORT_FORMAT) {
    console.error('❌ Unrecognized format. Expected an export created with: ia-index export');
    return false;
  }
  if (typeof payload.index !== 'string' || !payload.index.trim() || payload.index.length > MAX_IMPORT_SIZE) {
    console.error('❌ The export file has no valid index content.');
    return false;
  }

  // --- write the index into the target project ---
  const projectName = path.basename(targetRoot);
  const outDir = path.join(targetRoot, '.ia-index');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'PROJECT-INDEX.md');
  fs.writeFileSync(outFile, payload.index, 'utf8');

  const stats = (payload.stats && typeof payload.stats === 'object') ? payload.stats : {};
  const registry = loadRegistry();
  registry[targetRoot] = {
    name: projectName,
    path: targetRoot,
    indexedAt: new Date().toISOString(),
    files: Number.isFinite(stats.files) ? stats.files : null,
    sourceKB: Number.isFinite(stats.sourceKB) ? stats.sourceKB : null,
    indexKB: Number.isFinite(stats.indexKB) ? stats.indexKB : +(Buffer.byteLength(payload.index, 'utf8') / 1024).toFixed(1),
    reduction: typeof stats.reduction === 'string' ? stats.reduction.slice(0, 10) : '?',
    imported: {
      from: String(payload.project || 'unknown').slice(0, 200),
      exportedAt: String(payload.exportedAt || '').slice(0, 30),
      toolVersion: String(payload.version || '').slice(0, 20),
    },
  };
  saveRegistry(registry);

  const touched = opts.noClaude ? [] : updateAiConfigs(targetRoot);

  console.log('');
  console.log(c.green(c.bold(`📥 Import complete! Welcome aboard, "${registry[targetRoot].imported.from}" ✨`)));
  console.log('');
  console.log(`   📄 Index:    ${c.cyan(outFile)}`);
  console.log(`   📍 Project:  ${projectName}`);
  if (touched.length) console.log(`   🤖 AI configs ready: ${c.cyan(touched.join(' · '))} ✅`);
  console.log('');
  console.log(c.dim('   💡 Your AI assistant on THIS machine can now read the index.'));
  console.log(c.dim('   🔄 Have the source code here too? Run `ia-index update` to regenerate it locally.'));
  console.log('');
  return true;
}

// --------------------------------------------------------- command: remove

async function cmdRemove(root, opts = {}) {
  const projectName = path.basename(root);
  const indexDir = path.join(root, '.ia-index');
  const registry = loadRegistry();
  const hasIndex = fs.existsSync(indexDir);
  const hasEntry = !!registry[root];

  if (!hasIndex && !hasEntry) {
    console.log(`📭 Nothing to remove — "${projectName}" is not indexed. All clean! ✨`);
    return;
  }

  const proceed = await confirm(`🗑️  Delete the index of ${c.cyan(`"${projectName}"`)} (folder .ia-index/ + registry entry + CLAUDE.md block)?`, opts.yes);
  if (!proceed) { console.log(`👌 No worries — nothing was touched. ${c.dim('(Use --yes to skip this prompt.)')}`); return; }

  if (hasIndex) fs.rmSync(indexDir, { recursive: true, force: true });
  if (hasEntry) { delete registry[root]; saveRegistry(registry); }
  stripAiConfigs(root);

  console.log(c.green(`✅ Index of "${projectName}" removed. Bye bye index! 👋`));
  console.log(c.dim(`   💡 You can re-index anytime with: ia-index index`));
}

// ---------------------------------------------------------- command: clean

async function cmdClean(opts = {}) {
  const registry = loadRegistry();
  const names = Object.keys(registry);

  if (!names.length && !fs.existsSync(HOME_DIR)) {
    console.log('📭 Global memory is already empty — nothing to clean! ✨');
    return;
  }

  console.log('');
  console.log(c.yellow(c.bold('🧹 Heads up! This will clear the global memory (registry of indexed projects):')));
  console.log('');
  for (const p of Object.values(registry)) console.log(`   📦 ${c.cyan(p.name)}  ${c.dim(`(${p.path})`)}`);
  console.log('');
  if (opts.all) console.log(c.red('   ⚠️  --all: each project\'s .ia-index/ folder and CLAUDE.md block will be DELETED too.'));
  else console.log(c.dim('   💡 Each project\'s .ia-index/ folder stays on disk. Add --all to delete those too.'));
  console.log('');

  const proceed = await confirm('Proceed?', opts.yes);
  if (!proceed) { console.log(`👌 No worries — nothing was touched. ${c.dim('(Use --yes to skip this prompt.)')}`); return; }

  if (opts.all) {
    for (const p of Object.values(registry)) {
      try {
        fs.rmSync(path.join(p.path, '.ia-index'), { recursive: true, force: true });
        stripAiConfigs(p.path);
        console.log(`   🗑️  ${p.name}: .ia-index/ deleted ✅`);
      } catch { console.log(c.yellow(`   ⚠️  ${p.name}: could not delete .ia-index/`)); }
    }
  }

  fs.rmSync(HOME_DIR, { recursive: true, force: true });
  console.log(c.green('✅ Global memory cleared. Fresh start! 🌱'));
}

// ----------------------------------------------------------- interactive menu

async function menu() {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);

  for (;;) {
    const indexed = fs.existsSync(path.join(cwd, '.ia-index', 'PROJECT-INDEX.md'));

    console.log('');
    console.log(c.bold(c.cyan(`⚡ IA Project Indexer v${VERSION}`)) + c.dim(' — make your AI assistant cheaper and faster 💰'));
    console.log('');
    console.log(`   📂 Current project: ${c.bold(projectName)} ${indexed ? c.green('✅ indexed') : c.yellow('📭 not indexed yet')}`);
    console.log('');
    console.log(c.bold('   What would you like to do?'));
    console.log('');
    console.log(`   ${c.cyan('1')}) 📦 Index / update this project  ${c.dim('(takes <1 second ⚡)')}`);
    console.log(`   ${c.cyan('2')}) 📊 Check status of this project`);
    console.log(`   ${c.cyan('3')}) 📋 List all my indexed projects`);
    console.log(`   ${c.cyan('4')}) 📈 Show my global token savings`);
    console.log(`   ${c.cyan('5')}) 📤 Export this project's index  ${c.dim('(share it with another machine)')}`);
    console.log(`   ${c.cyan('6')}) 📥 Import an exported index`);
    console.log(`   ${c.cyan('7')}) 🪝 Auto-update on every git commit  ${c.dim('(pre-commit hook)')}`);
    console.log(`   ${c.cyan('8')}) 🗑️  Remove this project's index`);
    console.log(`   ${c.cyan('9')}) 🧹 Clean global memory`);
    console.log(`   ${c.cyan('0')}) 👋 Exit`);
    console.log('');

    const choice = await ask(c.bold('Choose an option [0-9]: '));
    console.log('');

    if (choice === '0' || /^(q|quit|exit)$/i.test(choice)) {
      console.log('👋 See you later! Happy coding! ✨');
      return;
    }

    switch (choice) {
      case '1': cmdIndex(cwd); break;
      case '2': cmdStatus(cwd); break;
      case '3': cmdList(); break;
      case '4': cmdStats(); break;
      case '5': cmdExport(cwd); break;
      case '6': {
        // strip quotes — Windows "Copy as path" pastes the path wrapped in them
        const file = (await ask('📥 Path to the .ia-index.json file: ')).replace(/^["']+|["']+$/g, '');
        if (file) cmdImport(file, cwd);
        else console.log('👌 No file given — nothing was imported.');
        break;
      }
      case '7': cmdHookInstall(cwd); break;
      case '8': await cmdRemove(cwd); break;
      case '9': await cmdClean(); break;
      default: console.log(c.yellow(`🤔 "${choice}" is not an option — pick a number from the menu.`)); break;
    }

    // back to the menu after every action — Enter continues, q quits
    const back = await ask(c.dim('↩️  Press Enter to go back to the menu (or q to quit): '));
    if (/^(q|quit|exit|0)$/i.test(back.trim())) {
      console.log('👋 See you later! Happy coding! ✨');
      return;
    }
  }
}

// ------------------------------------------------------------------- help

function help() {
  console.log(`
⚡ IA Project Indexer v${VERSION} — make your AI assistant cheaper and faster 💰

🎮 Commands:
  ia-index                       🧭 Interactive menu (easiest way to start!)
  ia-index index [path]          📦 Create / update the index (default: current dir)
  ia-index update [path]         🔄 Same as index — refresh after code changes
  ia-index status [path]         📊 Is the project indexed? Is it up to date?
  ia-index list                  📋 List all your indexed projects
  ia-index stats                 📈 Global token-savings dashboard
  ia-index export [path]         📤 Export the index to a portable file
  ia-index import <file> [path]  📥 Load an exported index on this machine
  ia-index hook [install]        🪝 Auto-update the index on every git commit
  ia-index hook remove           🪝 Uninstall the pre-commit hook
  ia-index remove [path]         🗑️  Delete a project's index (asks first!)
  ia-index clean                 🧹 Clear the global memory (asks first!)
  ia-index help                  💬 This help

🚩 Flags:
  --out <file>    With export: custom output file
  --no-ai-config  Don't touch AI config files (CLAUDE.md, AGENTS.md…)
  --quiet, -q     One-line output (great for hooks and CI)
  --if-changed    Skip instantly when no file changed since last index
  --yes, -y       Skip confirmation prompts (for remove / clean)
  --all           With clean: also delete every project's .ia-index/ folder
  --version, -v   Show version

💡 How it works:
   Generates .ia-index/PROJECT-INDEX.md — a compact summary of your
   project's structure, classes, methods and functions. Your LLM reads
   it instead of exploring the codebase → up to 99% fewer tokens! 🚀

🤖 One command configures EVERY assistant: CLAUDE.md + AGENTS.md are
   set up automatically, and .cursorrules / copilot-instructions.md
   are updated when they exist.

🗣️  Signature extraction: TypeScript · JavaScript · Python · Go ·
   Java · C# · PHP · Ruby

🌐 Works with Claude, ChatGPT, Gemini, Cursor and any AI assistant.
🖥️  Windows / macOS / Linux · 🔒 100% local · 📦 Zero dependencies
`);
}

// ------------------------------------------------------------------- main

const COMMANDS = new Set(['index', 'update', 'status', 'list', 'stats', 'export', 'import', 'hook', 'remove', 'delete', 'rm', 'clean', 'help']);

async function main() {
  const raw = process.argv.slice(2);
  const args = [];
  let outFile = null;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--out' || raw[i] === '-o') { outFile = raw[++i]; continue; }
    if (raw[i].startsWith('--out=')) { outFile = raw[i].slice(6); continue; }
    args.push(raw[i]);
  }

  const flags = new Set(args.filter(a => a.startsWith('-')));
  const positional = args.filter(a => !a.startsWith('-'));

  const opts = {
    noClaude: flags.has('--no-ai-config') || flags.has('--no-claude'), // --no-claude kept as alias
    yes: flags.has('--yes') || flags.has('-y'),
    all: flags.has('--all'),
    quiet: flags.has('--quiet') || flags.has('-q'),
    ifChanged: flags.has('--if-changed'),
    out: outFile,
  };

  if (flags.has('--help') || flags.has('-h')) { help(); return; }
  if (flags.has('--version') || flags.has('-v')) { console.log('ia-index ' + VERSION); return; }

  const first = positional[0];
  const cmd = COMMANDS.has(first) ? first : null;

  if (!cmd && !first) {
    if (process.stdin.isTTY) { await menu(); } else { help(); }
    return;
  }

  if (cmd === 'help') { help(); return; }
  if (cmd === 'list') { cmdList(); return; }
  if (cmd === 'stats') { cmdStats(); return; }
  if (cmd === 'clean') { await cmdClean(opts); return; }
  if (cmd === 'import') {
    const target = path.resolve(positional[2] || '.');
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      console.error('❌ Invalid target folder: ' + target);
      process.exit(1);
    }
    if (!cmdImport(positional[1], target, opts)) process.exit(1);
    return;
  }
  if (cmd === 'hook') {
    const HOOK_ACTIONS = new Set(['install', 'remove', 'uninstall']);
    const action = HOOK_ACTIONS.has(positional[1]) ? positional[1] : 'install';
    const target = path.resolve(HOOK_ACTIONS.has(positional[1]) ? (positional[2] || '.') : (positional[1] || '.'));
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      console.error('❌ Invalid path: ' + target);
      process.exit(1);
    }
    if (action === 'install') cmdHookInstall(target);
    else cmdHookRemove(target);
    return;
  }

  // `ia-index <path>` (no subcommand) still indexes that path — backward compatible.
  const target = path.resolve(cmd ? (positional[1] || '.') : (first || '.'));
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('❌ Invalid path: ' + target);
    process.exit(1);
  }

  if (cmd === 'status') { cmdStatus(target); return; }
  if (cmd === 'export') { cmdExport(target, opts); return; }
  if (cmd === 'remove' || cmd === 'delete' || cmd === 'rm') { await cmdRemove(target, opts); return; }
  // index / update / bare path
  cmdIndex(target, opts);
}

if (require.main === module) {
  main().catch(err => { console.error('❌ ' + err.message); process.exit(1); });
} else {
  module.exports = {
    extractJsTs, extractPy, extractGo, extractJavaCs, extractPhp, extractRuby,
    extractorFor, formatSymbols, walk, loadGitignore, isGitignored,
  };
}

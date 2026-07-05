#!/usr/bin/env node
/**
 * IA Project Indexer (ia-index) — Ultra-compact project indexer for LLMs.
 *
 * Instead of letting your AI assistant explore the codebase (thousands of
 * tokens in searches and file reads), it reads ONE compact file:
 * .ai-index/PROJECT-INDEX.md
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
 *   --all         With clean: also delete every project's .ai-index folder
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
// AI_INDEX_HOME override keeps tests fully isolated from the real registry.
const HOME_DIR = process.env.AI_INDEX_HOME || path.join(os.homedir(), '.ai-index');
const REGISTRY = path.join(HOME_DIR, 'registry.json');

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
  'bin', 'obj', 'target', '.gradle', '.ai-index', '.codebase-memory',
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

function loadRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')); } catch { return {}; }
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
        let stat;
        try { stat = fs.statSync(path.join(dir, e.name)); } catch { continue; }
        totalBytes += stat.size;
        files.push({ relPath, abs: path.join(dir, e.name), ext, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }

  visit(root, '');
  return { files, totalBytes };
}

// ---------------------------------------------------------- command: index

function cmdIndex(root, opts = {}) {
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
  const outDir = path.join(root, '.ai-index');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'PROJECT-INDEX.md');
  fs.writeFileSync(outFile, indexContent, 'utf8');

  const indexBytes = Buffer.byteLength(indexContent, 'utf8');
  const reduction = Math.max(0, Math.round((1 - indexBytes / totalBytes) * 100));

  const registry = loadRegistry();
  registry[projectName] = {
    path: root,
    indexedAt: new Date().toISOString(),
    files: files.length,
    sourceKB: +(totalBytes / 1024).toFixed(1),
    indexKB: +(indexBytes / 1024).toFixed(1),
    reduction: reduction + '%',
    timesIndexed: ((registry[projectName] && registry[projectName].timesIndexed) || 0) + 1,
  };
  saveRegistry(registry);

  // Multi-assistant integration (opt-out with --no-ai-config / --no-claude)
  const touched = opts.noClaude ? [] : updateAiConfigs(root);

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
  console.log(c.dim('   💡 Tip: your AI assistant now reads .ai-index/PROJECT-INDEX.md'));
  console.log(c.dim('      instead of exploring the whole codebase.'));
  console.log(c.dim('   🔄 Code changed a lot? Just run: ia-index update'));
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
    'This project has a compact index at `.ai-index/PROJECT-INDEX.md`.',
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
  const indexFile = path.join(root, '.ai-index', 'PROJECT-INDEX.md');
  const registry = loadRegistry();
  const entry = registry[projectName];

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
  for (const name of names) {
    const p = registry[name];
    console.log(`   ⚡ ${c.cyan(c.bold(name))}${p.imported ? ' 📥' : ''}`);
    console.log(`      📍 Path:     ${p.path}`);
    console.log(`      🕒 Indexed:  ${String(p.indexedAt).slice(0, 16).replace('T', ' ')}`);
    console.log(`      📊 Files:    ${p.files ?? '?'} · source ${p.sourceKB ?? '?'} KB → index ${p.indexKB ?? '?'} KB ${c.green(`(${p.reduction ?? '?'} fewer tokens 💰)`)}`);
    console.log('');
  }
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
  const indexFile = path.join(root, '.ai-index', 'PROJECT-INDEX.md');

  if (!fs.existsSync(indexFile)) {
    console.log(`📭 "${projectName}" is not indexed yet — indexing it first ⚡`);
    cmdIndex(root, opts);
  }

  const registry = loadRegistry();
  const entry = registry[projectName] || null;

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

  const outFile = path.resolve(opts.out || `${projectName}.ai-index.json`);
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
    console.error(`❌ Missing file. Usage: ${c.green('ia-index import <file.ai-index.json> [target-folder]')}`);
    process.exit(1);
  }
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) {
    console.error('❌ File not found: ' + absFile);
    process.exit(1);
  }
  if (fs.statSync(absFile).size > MAX_IMPORT_SIZE) {
    console.error(`❌ File too large (max ${MAX_IMPORT_SIZE / 1024 / 1024}MB). This doesn't look like a valid export.`);
    process.exit(1);
  }

  let payload;
  try { payload = JSON.parse(fs.readFileSync(absFile, 'utf8')); }
  catch {
    console.error('❌ Not a valid JSON file. Expected an export created with: ia-index export');
    process.exit(1);
  }

  if (!payload || typeof payload !== 'object' || payload.format !== EXPORT_FORMAT) {
    console.error('❌ Unrecognized format. Expected an export created with: ia-index export');
    process.exit(1);
  }
  if (typeof payload.index !== 'string' || !payload.index.trim() || payload.index.length > MAX_IMPORT_SIZE) {
    console.error('❌ The export file has no valid index content.');
    process.exit(1);
  }

  // --- write the index into the target project ---
  const projectName = path.basename(targetRoot);
  const outDir = path.join(targetRoot, '.ai-index');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'PROJECT-INDEX.md');
  fs.writeFileSync(outFile, payload.index, 'utf8');

  const stats = (payload.stats && typeof payload.stats === 'object') ? payload.stats : {};
  const registry = loadRegistry();
  registry[projectName] = {
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
  console.log(c.green(c.bold(`📥 Import complete! Welcome aboard, "${registry[projectName].imported.from}" ✨`)));
  console.log('');
  console.log(`   📄 Index:    ${c.cyan(outFile)}`);
  console.log(`   📍 Project:  ${projectName}`);
  if (touched.length) console.log(`   🤖 AI configs ready: ${c.cyan(touched.join(' · '))} ✅`);
  console.log('');
  console.log(c.dim('   💡 Your AI assistant on THIS machine can now read the index.'));
  console.log(c.dim('   🔄 Have the source code here too? Run `ia-index update` to regenerate it locally.'));
  console.log('');
}

// --------------------------------------------------------- command: remove

async function cmdRemove(root, opts = {}) {
  const projectName = path.basename(root);
  const indexDir = path.join(root, '.ai-index');
  const registry = loadRegistry();
  const hasIndex = fs.existsSync(indexDir);
  const hasEntry = !!registry[projectName];

  if (!hasIndex && !hasEntry) {
    console.log(`📭 Nothing to remove — "${projectName}" is not indexed. All clean! ✨`);
    return;
  }

  const proceed = await confirm(`🗑️  Delete the index of ${c.cyan(`"${projectName}"`)} (folder .ai-index/ + registry entry + CLAUDE.md block)?`, opts.yes);
  if (!proceed) { console.log(`👌 No worries — nothing was touched. ${c.dim('(Use --yes to skip this prompt.)')}`); return; }

  if (hasIndex) fs.rmSync(indexDir, { recursive: true, force: true });
  if (hasEntry) { delete registry[projectName]; saveRegistry(registry); }
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
  for (const name of names) console.log(`   📦 ${c.cyan(name)}  ${c.dim(`(${registry[name].path})`)}`);
  console.log('');
  if (opts.all) console.log(c.red('   ⚠️  --all: each project\'s .ai-index/ folder and CLAUDE.md block will be DELETED too.'));
  else console.log(c.dim('   💡 Each project\'s .ai-index/ folder stays on disk. Add --all to delete those too.'));
  console.log('');

  const proceed = await confirm('Proceed?', opts.yes);
  if (!proceed) { console.log(`👌 No worries — nothing was touched. ${c.dim('(Use --yes to skip this prompt.)')}`); return; }

  if (opts.all) {
    for (const name of names) {
      const projectPath = registry[name].path;
      try {
        fs.rmSync(path.join(projectPath, '.ai-index'), { recursive: true, force: true });
        stripAiConfigs(projectPath);
        console.log(`   🗑️  ${name}: .ai-index/ deleted ✅`);
      } catch { console.log(c.yellow(`   ⚠️  ${name}: could not delete .ai-index/`)); }
    }
  }

  fs.rmSync(HOME_DIR, { recursive: true, force: true });
  console.log(c.green('✅ Global memory cleared. Fresh start! 🌱'));
}

// ----------------------------------------------------------- interactive menu

async function menu() {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const indexed = fs.existsSync(path.join(cwd, '.ai-index', 'PROJECT-INDEX.md'));

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
  console.log(`   ${c.cyan('7')}) 🗑️  Remove this project's index`);
  console.log(`   ${c.cyan('8')}) 🧹 Clean global memory`);
  console.log(`   ${c.cyan('9')}) 👋 Exit`);
  console.log('');

  const choice = await ask(c.bold('Choose an option [1-9]: '));
  console.log('');

  switch (choice) {
    case '1': cmdIndex(cwd); break;
    case '2': cmdStatus(cwd); break;
    case '3': cmdList(); break;
    case '4': cmdStats(); break;
    case '5': cmdExport(cwd); break;
    case '6': {
      const file = await ask('📥 Path to the .ai-index.json file: ');
      if (file) cmdImport(file, cwd);
      else console.log('👌 No file given — nothing was imported.');
      break;
    }
    case '7': await cmdRemove(cwd); break;
    case '8': await cmdClean(); break;
    case '9': default: console.log('👋 See you later! Happy coding! ✨'); break;
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
  ia-index remove [path]         🗑️  Delete a project's index (asks first!)
  ia-index clean                 🧹 Clear the global memory (asks first!)
  ia-index help                  💬 This help

🚩 Flags:
  --out <file>    With export: custom output file
  --no-ai-config  Don't touch AI config files (CLAUDE.md, AGENTS.md…)
  --yes, -y       Skip confirmation prompts (for remove / clean)
  --all           With clean: also delete every project's .ai-index/ folder
  --version, -v   Show version

💡 How it works:
   Generates .ai-index/PROJECT-INDEX.md — a compact summary of your
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

const COMMANDS = new Set(['index', 'update', 'status', 'list', 'stats', 'export', 'import', 'remove', 'delete', 'rm', 'clean', 'help']);

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
    cmdImport(positional[1], target, opts);
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

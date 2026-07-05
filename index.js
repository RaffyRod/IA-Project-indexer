#!/usr/bin/env node
/**
 * ai-index — Ultra-compact project indexer for LLMs.
 *
 * Instead of letting your AI assistant explore the codebase (thousands of
 * tokens in searches and file reads), it reads ONE compact file:
 * .ai-index/PROJECT-INDEX.md
 *
 * Commands:
 *   ai-index                Interactive menu
 *   ai-index index [path]   Create / update the index
 *   ai-index update [path]  Same as index
 *   ai-index status [path]  Is the project indexed? Is it up to date?
 *   ai-index list           List all indexed projects
 *   ai-index remove [path]  Delete a project's index
 *   ai-index clean          Clear the global memory (registry)
 *
 * Flags:
 *   --no-claude   Don't touch CLAUDE.md when indexing
 *   --yes, -y     Skip confirmation prompts
 *   --all         With clean: also delete every project's .ai-index folder
 *
 * Zero dependencies. Node >= 16. Windows / macOS / Linux.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const VERSION = require('./package.json').version;
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

  const registry = loadRegistry();
  registry[projectName] = {
    path: root,
    indexedAt: new Date().toISOString(),
    files: files.length,
    sourceKB: +(totalBytes / 1024).toFixed(1),
    indexKB: +(indexBytes / 1024).toFixed(1),
    reduction: reduction + '%',
  };
  saveRegistry(registry);

  // CLAUDE.md integration (opt-out with --no-claude)
  if (!opts.noClaude) updateClaudeMd(root);

  console.log('');
  console.log(c.green(c.bold(`🎉 Done! Project indexed: ${projectName} ✨`)));
  console.log('');
  console.log(`   📄 Index:     ${c.cyan(outFile)}`);
  console.log(`   📦 Files:     ${files.length} scanned`);
  console.log(`   📊 Source:    ${kb(totalBytes)}  ${c.dim(`(~${tokens(totalBytes).toLocaleString()} tokens)`)}`);
  console.log(`   🗜️  Index:     ${kb(indexBytes)}  ${c.dim(`(~${tokens(indexBytes).toLocaleString()} tokens)`)}`);
  console.log(`   💰 Reduction: ${c.green(c.bold(`${reduction}% fewer tokens`))} 🚀`);
  console.log('');
  console.log(c.dim('   💡 Tip: your AI assistant now reads .ai-index/PROJECT-INDEX.md'));
  console.log(c.dim('      instead of exploring the whole codebase.' + (opts.noClaude ? '' : ' CLAUDE.md is ready ✅')));
  console.log(c.dim('   🔄 Code changed a lot? Just run: ai-index update'));
  console.log('');
}

const CLAUDE_START = '<!-- ai-index:start -->';
const CLAUDE_END = '<!-- ai-index:end -->';

function updateClaudeMd(root) {
  const claudeMd = path.join(root, 'CLAUDE.md');
  const block = [
    CLAUDE_START,
    '## 🧠 Project index (token saver)',
    '',
    'This project has a compact index at `.ai-index/PROJECT-INDEX.md`.',
    '**Read it FIRST** before using Glob/Grep/Read to explore: it contains the',
    'full structure, classes, methods and functions of the entire codebase.',
    'Only open source files when you need the exact body of a function.',
    'If the code changed significantly, regenerate with: `ai-index update`',
    CLAUDE_END,
  ].join('\n');

  let content = '';
  try { content = fs.readFileSync(claudeMd, 'utf8'); } catch { /* new file */ }

  if (content.includes(CLAUDE_START)) {
    content = content.replace(new RegExp(CLAUDE_START + '[\\s\\S]*?' + CLAUDE_END), block);
  } else {
    content = content ? content.trimEnd() + '\n\n' + block + '\n' : block + '\n';
  }
  fs.writeFileSync(claudeMd, content, 'utf8');
}

function stripClaudeMd(root) {
  const claudeMd = path.join(root, 'CLAUDE.md');
  let content = '';
  try { content = fs.readFileSync(claudeMd, 'utf8'); } catch { return; }
  if (!content.includes(CLAUDE_START)) return;

  content = content.replace(new RegExp('\\n*' + CLAUDE_START + '[\\s\\S]*?' + CLAUDE_END + '\\n*'), '\n').trim();
  if (content) {
    fs.writeFileSync(claudeMd, content + '\n', 'utf8');
  } else {
    fs.unlinkSync(claudeMd); // the file only contained our block
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
    console.log(`   👉 Just run: ${c.green('ai-index index')}  (takes less than a second ⚡)`);
    console.log('');
    return;
  }

  const indexMtime = fs.statSync(indexFile).mtimeMs;
  const { files } = walk(root, loadGitignore(root));
  const changed = files.filter(f => f.mtimeMs > indexMtime).length;

  if (entry) {
    console.log(`   🕒 Indexed:   ${entry.indexedAt.slice(0, 16).replace('T', ' ')}`);
    console.log(`   📦 Files:     ${entry.files} · source ${entry.sourceKB} KB → index ${entry.indexKB} KB ${c.green(`(${entry.reduction} fewer tokens)`)}`);
  } else {
    console.log(`   📄 Index:     ${c.cyan(indexFile)}`);
  }

  if (changed === 0) {
    console.log(`   💚 State:     ${c.green('✅ Up to date — your AI has fresh knowledge!')}`);
  } else {
    console.log(`   🟡 State:     ${c.yellow(`⚠️  Outdated — ${changed} file(s) changed since last index`)}`);
    console.log(`   👉 Refresh it with: ${c.green('ai-index update')}  ⚡`);
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
    console.log(`   👉 Run ${c.green('ai-index index')} inside any project to get started 🚀`);
    console.log('');
    return;
  }
  console.log('');
  console.log(c.bold(`📦 Your indexed projects (${names.length}):`));
  console.log('');
  for (const name of names) {
    const p = registry[name];
    console.log(`   ⚡ ${c.cyan(c.bold(name))}`);
    console.log(`      📍 Path:     ${p.path}`);
    console.log(`      🕒 Indexed:  ${p.indexedAt.slice(0, 16).replace('T', ' ')}`);
    console.log(`      📊 Files:    ${p.files} · source ${p.sourceKB} KB → index ${p.indexKB} KB ${c.green(`(${p.reduction} fewer tokens 💰)`)}`);
    console.log('');
  }
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
  stripClaudeMd(root);

  console.log(c.green(`✅ Index of "${projectName}" removed. Bye bye index! 👋`));
  console.log(c.dim(`   💡 You can re-index anytime with: ai-index index`));
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
        stripClaudeMd(projectPath);
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
  console.log(c.bold(c.cyan(`⚡ ai-index v${VERSION}`)) + c.dim(' — make your AI assistant cheaper and faster 💰'));
  console.log('');
  console.log(`   📂 Current project: ${c.bold(projectName)} ${indexed ? c.green('✅ indexed') : c.yellow('📭 not indexed yet')}`);
  console.log('');
  console.log(c.bold('   What would you like to do?'));
  console.log('');
  console.log(`   ${c.cyan('1')}) 📦 Index / update this project  ${c.dim('(takes <1 second ⚡)')}`);
  console.log(`   ${c.cyan('2')}) 📊 Check status of this project`);
  console.log(`   ${c.cyan('3')}) 📋 List all my indexed projects`);
  console.log(`   ${c.cyan('4')}) 🗑️  Remove this project's index`);
  console.log(`   ${c.cyan('5')}) 🧹 Clean global memory`);
  console.log(`   ${c.cyan('6')}) 👋 Exit`);
  console.log('');

  const choice = await ask(c.bold('Choose an option [1-6]: '));
  console.log('');

  switch (choice) {
    case '1': cmdIndex(cwd); break;
    case '2': cmdStatus(cwd); break;
    case '3': cmdList(); break;
    case '4': await cmdRemove(cwd); break;
    case '5': await cmdClean(); break;
    case '6': default: console.log('👋 See you later! Happy coding! ✨'); break;
  }
}

// ------------------------------------------------------------------- help

function help() {
  console.log(`
⚡ ai-index v${VERSION} — make your AI assistant cheaper and faster 💰

🎮 Commands:
  ai-index                 🧭 Interactive menu (easiest way to start!)
  ai-index index [path]    📦 Create / update the index (default: current dir)
  ai-index update [path]   🔄 Same as index — refresh after code changes
  ai-index status [path]   📊 Is the project indexed? Is it up to date?
  ai-index list            📋 List all your indexed projects
  ai-index remove [path]   🗑️  Delete a project's index (asks first!)
  ai-index clean           🧹 Clear the global memory (asks first!)
  ai-index help            💬 This help

🚩 Flags:
  --no-claude    Don't touch CLAUDE.md when indexing
  --yes, -y      Skip confirmation prompts (for remove / clean)
  --all          With clean: also delete every project's .ai-index/ folder
  --version, -v  Show version

💡 How it works:
   Generates .ai-index/PROJECT-INDEX.md — a compact summary of your
   project's structure, classes, methods and functions. Your LLM reads
   it instead of exploring the codebase → up to 99% fewer tokens! 🚀

🌐 Works with Claude, ChatGPT, Gemini, Cursor and any AI assistant.
🖥️  Windows / macOS / Linux · 🔒 100% local · 📦 Zero dependencies
`);
}

// ------------------------------------------------------------------- main

const COMMANDS = new Set(['index', 'update', 'status', 'list', 'remove', 'delete', 'rm', 'clean', 'help']);

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('-')));
  const positional = args.filter(a => !a.startsWith('-'));

  const opts = {
    noClaude: flags.has('--no-claude'),
    yes: flags.has('--yes') || flags.has('-y'),
    all: flags.has('--all'),
  };

  if (flags.has('--help') || flags.has('-h')) { help(); return; }
  if (flags.has('--version') || flags.has('-v')) { console.log('ai-index ' + VERSION); return; }

  const first = positional[0];
  const cmd = COMMANDS.has(first) ? first : null;
  // `ai-index <path>` (no subcommand) still indexes that path — backward compatible.
  const target = path.resolve(cmd ? (positional[1] || '.') : (first || '.'));

  if (!cmd && !first) {
    if (process.stdin.isTTY) { await menu(); } else { help(); }
    return;
  }

  if (cmd === 'help') { help(); return; }
  if (cmd === 'list') { cmdList(); return; }
  if (cmd === 'clean') { await cmdClean(opts); return; }

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('❌ Invalid path: ' + target);
    process.exit(1);
  }

  if (cmd === 'status') { cmdStatus(target); return; }
  if (cmd === 'remove' || cmd === 'delete' || cmd === 'rm') { await cmdRemove(target, opts); return; }
  // index / update / bare path
  cmdIndex(target, opts);
}

if (require.main === module) {
  main().catch(err => { console.error('❌ ' + err.message); process.exit(1); });
} else {
  module.exports = { extractJsTs, extractPy, formatSymbols, walk, loadGitignore, isGitignored };
}

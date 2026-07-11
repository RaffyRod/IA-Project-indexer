<div align="center">

# ⚡ IA Project Indexer

### Cut your AI assistant's token usage by up to **99%** — with one command.

[![npm version](https://img.shields.io/npm/v/ia-project-indexer.svg?color=2563eb)](https://www.npmjs.com/package/ia-project-indexer)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 16](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)
[![tests: 63](https://img.shields.io/badge/tests-63%20passing-success.svg)](test/test.js)

**Works with Claude · ChatGPT · Gemini · Cursor · Copilot · any AI assistant**

```bash
npm install -g ia-project-indexer
```

</div>

---

## 🤔 Why?

Every time you ask an AI assistant about your code, it **explores your project**:
searches, file reads, directory listings… thousands of tokens burned **every
single session** before it even answers you.

`ia-index` generates **one ultra-compact Markdown index** of your project.
Your assistant reads that instead. Same knowledge, ~1% of the tokens.

| Real measurement (42-file TypeScript project) | Tokens |
|---|---|
| ❌ Assistant explores the source code | ~75,000 |
| ✅ Assistant reads the index | **~850** |
| 💰 **Savings, repeated every session** | **99%** |

## 🚀 Quick start

```bash
cd your-project
ia-index index        # done. < 1 second ⚡
```

```
🎉 Done! Project indexed: your-project ✨

   📄 Index:     .ia-index/PROJECT-INDEX.md
   📦 Files:     42 scanned
   📊 Source:    293.0 KB  (~75,016 tokens)
   🗜️  Index:     3.3 KB   (~850 tokens)
   💰 Reduction: 99% fewer tokens 🚀
   🤖 AI configs ready: CLAUDE.md · AGENTS.md ✅
```

That's it. Claude Code, Codex and friends now read the index automatically.
Prefer menus? Just run `ia-index` with no arguments. 🧭

## 📦 Installation — two modes

Requires **Node.js ≥ 16**. Windows, macOS and Linux. Pick per use case
(they coexist fine):

### Mode 1 — Global 🌍 (personal use, many projects)

One install, use it in every repo on your machine:

```bash
npm install -g ia-project-indexer     # npm
pnpm add -g ia-project-indexer        # pnpm
yarn global add ia-project-indexer    # yarn
```

Verify: `ia-index --version`

### Mode 2 — devDependency 👥 (team use, one project)

Pin the version in the project so **the whole team gets it automatically**
with their regular `npm install` — zero extra setup:

```bash
npm install --save-dev ia-project-indexer   # npm
pnpm add -D ia-project-indexer              # pnpm
yarn add -D ia-project-indexer              # yarn
```

Run it via `npx ia-index` (or `pnpm exec ia-index`). The **pre-commit hook
resolves the binary automatically**: global install first, then the project's
`node_modules/.bin/ia-index` — so the hook works for every teammate the
moment they clone and install. 🚀

## 📁 It's per-project — index ALL your projects

Each project gets **its own independent index**, and you can index as many as
you want (`ia-index list` shows them all). And here's the key:
**the project does NOT need to be "AI-ready"** —

- 🕰️ **Legacy codebases** with zero AI setup? Index them — that's where the
  savings are biggest, because the AI knows nothing about them.
- 🗣️ **Any language, any stack** — signature extraction for 8 languages, and
  every other file is still mapped in the structure.
- 🧳 **Projects you just cloned** — index first, ask questions second. Your
  assistant starts every session already knowing the whole layout.
- 🏠 **100% local by design** — the index lives inside each project, the
  registry lives in your home folder, and **`.ia-index/` + `*.ia-index.json`
  are added to the project's `.gitignore` automatically**. Nothing is ever
  committed or uploaded by accident.

## 💬 What can the AI answer instantly?

Real Q&A on a real indexed project — every answer comes from the ~850-token
index, **without opening a single source file**:

| You ask | The AI answers instantly |
|---|---|
| *"Where is the refund logic?"* | `src/api/TransactionApi.ts` → method `refund` |
| *"Where are credentials loaded?"* | `src/config/ConfigLoader.ts` → `getCredentials` |
| *"Which classes extend BaseApi?"* | All 6, each with its methods |
| *"How do I run only smoke tests?"* | `npm run test:smoke` |
| *"Where do I add a new endpoint?"* | `src/api/` — follow the `BaseApi` pattern |

For *"how does X work inside?"* the AI opens **exactly one file** (the index
tells it which) instead of exploring — still a fraction of the cost. And for
plain-text searches it falls back to grep, **never worse** than before.

## 🪝 Keep the index always fresh: pre-commit setup

The index describes your code **at the moment you ran `ia-index index`**. So
the one thing to configure is: *refresh it when the code changes*. One command
does it, per project:

```bash
cd your-project
ia-index hook
```

```
🪝 Pre-commit hook installed! ✨

   📄 Hook:    .husky/pre-commit  (Husky)
   📂 Project: your-project
```

**What it installs and how it behaves:**

- 🔍 Detects your setup: appends to `.husky/pre-commit` if you use **Husky**
  (your existing lines like `npx lint-staged` are preserved), otherwise uses
  the native `.git/hooks/pre-commit`
- ⚡ **Instant when nothing changed** — the hook runs with `--if-changed`, so
  it skips in milliseconds and your commits never feel slower
- 🤫 **One quiet line** when it does update — commit output stays clean
- 📦 **Finds the binary anywhere** — global install first, then the project's
  devDependency (`node_modules/.bin`, works with npm/pnpm/yarn shims)
- 🛡️ **Never blocks a commit** — if `ia-index` isn't available at all on a
  teammate's machine, the hook is a silent no-op (safe to commit the Husky file)
- 🗑️ Uninstall anytime: `ia-index hook remove` (only our block is removed)

<details>
<summary><b>Prefer to configure it manually?</b> (custom hook managers, CI, etc.)</summary>

Add this block wherever your workflow runs before/after changes land:

```sh
if command -v ia-index >/dev/null 2>&1; then
  ia-index update --quiet --if-changed --no-ai-config || true
elif [ -x "./node_modules/.bin/ia-index" ]; then
  "./node_modules/.bin/ia-index" update --quiet --if-changed --no-ai-config || true
fi
```

It's the exact block the hook installs (global install → devDependency
fallback → silent no-op) — copy it into lefthook, pre-push, a task runner
or a CI job.

</details>

Result: your AI assistant's knowledge is **always in sync with your latest
commit**, with zero effort. 🧠

## 🎮 Commands

| Command | What it does |
|---|---|
| `ia-index` | 🧭 Interactive menu |
| `ia-index index [path]` | 📦 Create / update the index |
| `ia-index update [path]` | 🔄 Alias of `index` |
| `ia-index status [path]` | 📊 Indexed? Up to date? |
| `ia-index list` | 📋 All your indexed projects |
| `ia-index stats` | 📈 Global token-savings dashboard |
| `ia-index export [path]` | 📤 Export the index to a portable file |
| `ia-index import <file> [path]` | 📥 Load an exported index |
| `ia-index hook [install\|remove]` | 🪝 Manage the pre-commit hook |
| `ia-index remove [path]` | 🗑️ Delete a project's index *(asks first)* |
| `ia-index clean` | 🧹 Clear the global memory *(asks first)* |

<details>
<summary><b>🚩 Flags</b></summary>

| Flag | Effect |
|---|---|
| `--out <file>` | With `export`: custom output file |
| `--no-ai-config` | Don't touch AI config files (`CLAUDE.md`, `AGENTS.md`…) |
| `--quiet`, `-q` | One-line output (great for hooks and CI) |
| `--if-changed` | Skip instantly when no file changed since last index |
| `--yes`, `-y` | Skip confirmation prompts |
| `--all` | With `clean`: also delete every project's `.ia-index/` folder |

</details>

## 🤖 One command configures every assistant

| Assistant | Setup |
|---|---|
| **Claude Code** | ✅ Automatic — `CLAUDE.md` written for you |
| **Codex / Jules / agents standard** | ✅ Automatic — `AGENTS.md` written for you |
| **Cursor** | ✅ Automatic if `.cursorrules` exists |
| **GitHub Copilot** | ✅ Automatic if `.github/copilot-instructions.md` exists |
| **ChatGPT / Gemini (web)** | 📎 Attach `PROJECT-INDEX.md` to the chat |

Blocks are added between markers — **your own content is never touched**, and
`ia-index remove` strips only our block.

## 📤 Take your index anywhere

```bash
ia-index export                          # machine A → my-project.ia-index.json
ia-index import my-project.ia-index.json  # machine B → ready to go
```

One portable JSON file. Imports are validated (format, types, 10MB cap) before
anything is written.

## 🥊 Why not an MCP server or an embeddings-based indexer?

| | ⚡ IA Project Indexer | MCP / embeddings indexers |
|---|---|---|
| **Setup** | 1 command | Server config per AI client |
| **Dependencies** | 0 | Databases, embeddings, daemons |
| **Works with** | Anything that reads text | Only MCP-compatible clients |
| **Output** | Readable Markdown | Opaque vector store |
| **Portability** | Export → 1 file → import | Re-index every machine |
| **Speed** | < 1 second | Minutes on first index |
| **Can it hang?** | Never | Frequently on `node_modules` |

Embeddings shine for *"find code about X"* in huge monorepos. For the everyday
need — *instant project context without burning tokens* — a compact, readable
index wins.

## 🗣️ Language support

**Signature extraction** (classes, methods, functions, interfaces, inheritance):

`TypeScript` `JavaScript` `Python` `Go` `Java` `C#` `PHP` `Ruby`

**Listed in structure:** JSON, YAML, Markdown, HTML, CSS, SQL, shell scripts.

## 📍 Where things live (all local)

| What | Where | Committed? |
|---|---|---|
| The index | `your-project/.ia-index/PROJECT-INDEX.md` | 🙈 Auto-gitignored |
| Export files | `<project>.ia-index.json` | 🙈 Auto-gitignored |
| Global registry | `~/.ia-index/registry.json` | Outside the repo |
| AI configs | `CLAUDE.md`, `AGENTS.md` | ✅ Yours to commit — they help the whole team |

`ia-index` adds `.ia-index/` and `*.ia-index.json` to your `.gitignore`
automatically the first time you index a git repo (never duplicates, never
touches your existing entries). The index is a **local artifact**: every dev
regenerates it in under a second — or keeps it fresh automatically with
`ia-index hook`.

## 🔒 Security & privacy

- **100% local** — zero network calls, zero telemetry
- **Read-only scan** — never modifies your source code
- **No code execution** — never runs, evals or requires your project's code
- **Validated imports** — format, type and size checks before writing anything

## 🧪 Tests

```bash
npm test   # 63 assertions, zero test dependencies
```

Covers signature extraction in all 8 languages, folder exclusion, `.gitignore`
support (including malformed patterns), every CLI command, the pre-commit hook
(git + Husky), import validation, legacy migration, registry collision safety,
drive-root protection and the multi-assistant config integration.

## 📜 License

[MIT](LICENSE) © [RaffyRod](https://github.com/RaffyRod) — 100% original code,
zero third-party dependencies.

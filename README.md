# ⚡ IA Project Indexer

[![npm version](https://img.shields.io/npm/v/ia-project-indexer.svg)](https://www.npmjs.com/package/ia-project-indexer)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 16](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)

> **Ultra-compact codebase indexer for LLMs — cut AI token usage by up to 99%.** 🚀
> One command, one portable Markdown index, works with **Claude, ChatGPT, Gemini, Cursor, Copilot and any AI assistant**.

`ia-index` scans your project in **under 1 second** and generates one
ultra-compact index file. Your AI assistant reads that file instead of
exploring your whole codebase — saving thousands of tokens **every session**.

## 🔥 The problem

Every time you ask an AI assistant about your code, it runs searches and reads
entire files to understand the project. That exploration repeats **every
session** and burns thousands of tokens (= money and context window) before it
even answers your question.

## 💡 The solution

**Real result** (42-file Playwright/TypeScript project):

| | Tokens |
|---|---|
| ❌ LLM explores the source code | ~75,000 |
| ✅ LLM reads the index | **~850** |
| 💰 Reduction | **99%** |

## ✨ Features

- 🧭 **Interactive menu** — just run `ia-index` and pick an option
- 🗂️ **Full map** — every relevant folder and file, grouped by directory
- 🏗️ **Signatures** — classes, methods, functions, interfaces, types and exported consts
- 📤 **Export / Import** — move an index between machines, no re-scan needed
- 📦 **Project metadata** — npm scripts and dependencies from `package.json`
- 🚫 **Never hangs** — skips `node_modules`, `.git`, `dist` and 30+ heavy folders, plus your `.gitignore`
- 🤖 **Auto-configures `CLAUDE.md`** — Claude Code reads the index first, automatically (opt out with `--no-claude`)
- 🔒 **100% local** — no network, no telemetry, no cloud
- 📦 **Zero dependencies** — one file of plain Node.js

## 🚀 Installation

Requires **Node.js ≥ 16**. Same command on Windows, macOS and Linux:

```bash
npm install -g ia-project-indexer
```

Or straight from GitHub:

```bash
git clone https://github.com/RaffyRod/IA-Project-indexer.git
npm install -g ./IA-Project-indexer
```

Verify:

```bash
ia-index --version
```

## 🎮 Usage

### The easy way — interactive menu

```bash
cd /path/to/your/project
ia-index
```

```
⚡ IA Project Indexer v1.2.0 — make your AI assistant cheaper and faster 💰

   📂 Current project: my-api-project 📭 not indexed yet

   What would you like to do?

   1) 📦 Index / update this project  (takes <1 second ⚡)
   2) 📊 Check status of this project
   3) 📋 List all my indexed projects
   4) 📤 Export this project's index  (share it with another machine)
   5) 📥 Import an exported index
   6) 🗑️  Remove this project's index
   7) 🧹 Clean global memory
   8) 👋 Exit

Choose an option [1-8]:
```

### Direct commands

| Command | What it does |
|---|---|
| `ia-index index [path]` | 📦 Create / update the index (default: current dir) |
| `ia-index update [path]` | 🔄 Same as `index` — refresh after code changes |
| `ia-index status [path]` | 📊 Is the project indexed? Is it up to date? |
| `ia-index list` | 📋 List all your indexed projects |
| `ia-index export [path]` | 📤 Export the index to a portable file |
| `ia-index import <file> [path]` | 📥 Load an exported index on this machine |
| `ia-index remove [path]` | 🗑️ Delete a project's index (asks for confirmation) |
| `ia-index clean` | 🧹 Clear the global memory (asks for confirmation) |
| `ia-index help` | 💬 Show help |

### Flags

| Flag | Effect |
|---|---|
| `--out <file>` | With `export`: custom output file |
| `--no-claude` | Don't touch `CLAUDE.md` when indexing/importing |
| `--yes`, `-y` | Skip confirmation prompts (for `remove` / `clean`) |
| `--all` | With `clean`: also delete every project's `.ai-index/` folder |
| `--version`, `-v` | Show version |

## 📤 Move your index to another machine

Indexed on your desktop but need it on your laptop? Export it:

```bash
# Machine A — inside the project
ia-index export
```

```
📤 Export ready! ✨

   📄 File:     my-api-project.ai-index.json
   📦 Project:  my-api-project
   📊 Size:     3.5 KB

   💡 Move this file to another machine (USB, cloud, chat…) and run:
      ia-index import my-api-project.ai-index.json  (inside the target project folder)
```

Then on the other machine:

```bash
# Machine B — inside the target project folder
ia-index import my-api-project.ai-index.json
```

```
📥 Import complete! Welcome aboard, "my-api-project" ✨

   💡 Your AI assistant on THIS machine can now read the index. CLAUDE.md is ready ✅
   🔄 Have the source code here too? Run `ia-index update` to regenerate it locally.
```

Imported files are validated (format, type and size checks) before anything is
written — a corrupted or foreign file is rejected with a friendly error.

## 🤖 How each assistant uses it

| Assistant | Setup |
|---|---|
| **Claude Code** | ✅ Automatic — `ia-index` adds the instruction to `CLAUDE.md` |
| **Cursor** | Add to `.cursorrules`: *"Read `.ai-index/PROJECT-INDEX.md` before exploring code"* |
| **GitHub Copilot** | Same line in `.github/copilot-instructions.md` |
| **ChatGPT / Gemini (web)** | Attach or paste `PROJECT-INDEX.md` at the start of the chat |

The index is plain Markdown — no protocols (MCP), no servers, no vendor lock-in.
If your assistant can read text, it works. 🌐

## 🗣️ Supported languages

- **Signature extraction:** TypeScript, JavaScript (`.ts .tsx .js .jsx .mjs .cjs`), Python (`.py`)
- **Listed in structure:** JSON, YAML, Markdown, HTML, CSS, SQL, Java, C#, Go, Ruby, PHP, shell scripts

## 📍 Storage

- Index: `YOUR_PROJECT/.ai-index/PROJECT-INDEX.md`
- Global registry: `~/.ai-index/registry.json`
- Exports: `<project>.ai-index.json` (portable, plain JSON)

**Git tip:** add `.ai-index/` to your `.gitignore` (each dev regenerates it in a
second) — or commit it so the whole team shares it.

## 🔒 Security & privacy

- **100% local** — zero network calls, zero telemetry, nothing leaves your machine.
- **Read-only scan** — indexing never modifies your source code.
- **Validated imports** — format, type and 10MB size checks before writing anything.
- **No code execution** — the tool never runs, evals or requires your project's code; it only reads text.
- The index contains only *your own* code's structure (names of files, classes and methods).

## 🧪 Test

```bash
npm test
```

35 assertions covering signature extraction (TS/JS/Python), folder exclusion,
`.gitignore` support, every CLI command (`index`, `update`, `status`, `list`,
`export`, `import`, `remove`, `clean`), import validation and the CLAUDE.md
integration.

## 📜 License

[MIT](LICENSE) © [RaffyRod](https://github.com/RaffyRod)

100% original code, zero third-party dependencies — free to use, modify and
distribute.

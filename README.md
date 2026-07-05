# ⚡ ai-index — IA Project Indexer

> Ultra-compact project indexer for LLMs — cut AI token usage by up to **99%**. 🚀
> Works with **Claude, ChatGPT, Gemini, Cursor, Copilot and any AI assistant**.

## 🔥 The problem

Every time you ask an AI assistant about your code, it runs searches and reads
entire files to understand the project. That exploration repeats **every
session** and burns thousands of tokens before it even answers your question.

## 💡 The solution

`ai-index` scans your project in **under 1 second** and generates **one
ultra-compact Markdown file** with everything an LLM needs to know:

```
.ai-index/PROJECT-INDEX.md
```

Your assistant reads that file instead of exploring the codebase.

**Real result** (42-file Playwright/TypeScript project):

| | Tokens |
|---|---|
| ❌ LLM explores the source code | ~75,000 |
| ✅ LLM reads the index | **~850** |
| 💰 Reduction | **99%** |

## ✨ Features

- 🧭 **Interactive menu** — just run `ai-index` and pick an option
- 🗂️ **Full map** — every relevant folder and file, grouped by directory
- 🏗️ **Signatures** — classes, methods, functions, interfaces, types and exported consts
- 📦 **Project metadata** — npm scripts and dependencies from `package.json`
- 🚫 **Never hangs** — skips `node_modules`, `.git`, `dist`, build output and 30+ heavy folders, plus your `.gitignore`
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
ai-index --version
```

## 🎮 Usage

### The easy way — interactive menu

```bash
cd /path/to/your/project
ai-index
```

```
⚡ ai-index v1.1.0 — make your AI assistant cheaper and faster 💰

   📂 Current project: my-api-project 📭 not indexed yet

   What would you like to do?

   1) 📦 Index / update this project  (takes <1 second ⚡)
   2) 📊 Check status of this project
   3) 📋 List all my indexed projects
   4) 🗑️  Remove this project's index
   5) 🧹 Clean global memory
   6) 👋 Exit

Choose an option [1-6]:
```

### Direct commands

| Command | What it does |
|---|---|
| `ai-index index [path]` | 📦 Create / update the index (default: current dir) |
| `ai-index update [path]` | 🔄 Same as `index` — refresh after code changes |
| `ai-index status [path]` | 📊 Is the project indexed? Is it up to date? |
| `ai-index list` | 📋 List all your indexed projects |
| `ai-index remove [path]` | 🗑️ Delete a project's index (asks for confirmation) |
| `ai-index clean` | 🧹 Clear the global memory (asks for confirmation) |
| `ai-index help` | 💬 Show help |

### Flags

| Flag | Effect |
|---|---|
| `--no-claude` | Don't touch `CLAUDE.md` when indexing |
| `--yes`, `-y` | Skip confirmation prompts (for `remove` / `clean`) |
| `--all` | With `clean`: also delete every project's `.ai-index/` folder |
| `--version`, `-v` | Show version |

### Example: index a project

```bash
cd /path/to/your/project
ai-index index
```

```
🎉 Done! Project indexed: my-api-project ✨

   📄 Index:     .ai-index/PROJECT-INDEX.md
   📦 Files:     42 scanned
   📊 Source:    293.0 KB  (~75,016 tokens)
   🗜️  Index:     3.3 KB   (~850 tokens)
   💰 Reduction: 99% fewer tokens 🚀

   💡 Tip: your AI assistant now reads .ai-index/PROJECT-INDEX.md
      instead of exploring the whole codebase. CLAUDE.md is ready ✅
   🔄 Code changed a lot? Just run: ai-index update
```

### Example: check if your index is fresh

```bash
ai-index status
```

```
📊 Status — my-api-project

   🕒 Indexed:   2026-07-05 01:54
   📦 Files:     42 · source 293 KB → index 3.3 KB (99% fewer tokens)
   🟡 State:     ⚠️  Outdated — 3 file(s) changed since last index
   👉 Refresh it with: ai-index update  ⚡
```

## 🤖 How each assistant uses it

| Assistant | Setup |
|---|---|
| **Claude Code** | ✅ Automatic — `ai-index` adds the instruction to `CLAUDE.md` |
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

**Git tip:** add `.ai-index/` to your `.gitignore` (each dev regenerates it in a
second) — or commit it so the whole team shares it.

## 🧪 Test

```bash
npm test
```

28 assertions covering signature extraction (TS/JS/Python), folder exclusion,
`.gitignore` support, every CLI command (`index`, `update`, `status`, `list`,
`remove`, `clean`) and the CLAUDE.md integration.

## 📜 License

[MIT](LICENSE) © [RaffyRod](https://github.com/RaffyRod)

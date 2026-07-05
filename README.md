<div align="center">

# ⚡ IA Project Indexer

### Cut your AI assistant's token usage by up to **99%** — with one command.

[![npm version](https://img.shields.io/npm/v/ia-project-indexer.svg?color=2563eb)](https://www.npmjs.com/package/ia-project-indexer)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node >= 16](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-success.svg)](package.json)
[![tests: 59](https://img.shields.io/badge/tests-59%20passing-success.svg)](test/test.js)

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

## 🪝 Set-and-forget: auto-update on every commit

```bash
ia-index hook
```

Installs a **pre-commit hook** (native `.git/hooks` or **Husky** — detected
automatically) that refreshes the index on every commit:

- ⚡ **Instant when nothing changed** — `--if-changed` skips in milliseconds
- 🤫 **One quiet line** when it updates — your commit output stays clean
- 🛡️ **Never blocks a commit** — if `ia-index` is missing, the hook is a no-op
- 🗑️ Uninstall anytime: `ia-index hook remove`

Your AI assistant's knowledge is now always fresh, with zero effort. 🧠

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

## 📍 Where things live

| What | Where |
|---|---|
| The index | `your-project/.ia-index/PROJECT-INDEX.md` |
| Global registry | `~/.ia-index/registry.json` |
| Exports | `<project>.ia-index.json` |

**Git tip:** add `.ia-index/` to `.gitignore` (regenerates in a second) — or
commit it so the whole team shares it.

## 🔒 Security & privacy

- **100% local** — zero network calls, zero telemetry
- **Read-only scan** — never modifies your source code
- **No code execution** — never runs, evals or requires your project's code
- **Validated imports** — format, type and size checks before writing anything

## 🧪 Tests

```bash
npm test   # 59 assertions, zero test dependencies
```

Covers signature extraction in all 8 languages, folder exclusion, `.gitignore`
support (including malformed patterns), every CLI command, the pre-commit hook
(git + Husky), import validation, legacy migration, registry collision safety,
drive-root protection and the multi-assistant config integration.

## 📜 License

[MIT](LICENSE) © [RaffyRod](https://github.com/RaffyRod) — 100% original code,
zero third-party dependencies.

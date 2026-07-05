# ⚡ ai-index — IA Project Indexer

> Ultra-compact project indexer for LLMs — cut AI token usage by up to **99%**.
> Works with **Claude, ChatGPT, Gemini, Cursor, Copilot and any AI assistant**.

[🇪🇸 Versión en español más abajo](#-versión-en-español)

---

## The problem

Every time you ask an AI assistant about your code, it runs searches and reads
entire files to understand the project. That exploration repeats **every
session** and burns thousands of tokens before it even answers your question.

## The solution

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

## Features

- 🗂️ **Full map** — every relevant folder and file, grouped by directory
- 🏗️ **Signatures** — classes, methods, functions, interfaces, types and exported consts
- 📦 **Project metadata** — npm scripts and dependencies from `package.json`
- 🚫 **Never hangs** — skips `node_modules`, `.git`, `dist`, build output and 30+ heavy folders, plus your `.gitignore`
- 🤖 **Auto-configures `CLAUDE.md`** — Claude Code reads the index first, automatically (opt out with `--no-claude`)
- 🔒 **100% local** — no network, no telemetry, no cloud
- 📦 **Zero dependencies** — one file of plain Node.js

## Installation

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

## Usage

```bash
cd /path/to/your/project
ai-index                 # index the current directory
```

Output:

```
✅ Project indexed: my-api-project

   📄 Index:     .ai-index/PROJECT-INDEX.md
   📦 Files:     42
   📊 Source:    293.0 KB  (~75,016 tokens)
   🗜️  Index:     3.3 KB   (~850 tokens)
   💰 Reduction: 99% fewer tokens
```

More commands:

```bash
ai-index <path>          # index a specific path
ai-index list            # list all indexed projects
ai-index --no-claude     # index without touching CLAUDE.md
ai-index --help          # help
```

Re-index whenever the code changes significantly — it takes under a second.

## How each assistant uses it

| Assistant | Setup |
|---|---|
| **Claude Code** | ✅ Automatic — `ai-index` adds the instruction to `CLAUDE.md` |
| **Cursor** | Add to `.cursorrules`: *"Read `.ai-index/PROJECT-INDEX.md` before exploring code"* |
| **GitHub Copilot** | Same line in `.github/copilot-instructions.md` |
| **ChatGPT / Gemini (web)** | Attach or paste `PROJECT-INDEX.md` at the start of the chat |

The index is plain Markdown — no protocols (MCP), no servers, no vendor lock-in.
If your assistant can read text, it works.

## Supported languages

- **Signature extraction:** TypeScript, JavaScript (`.ts .tsx .js .jsx .mjs .cjs`), Python (`.py`)
- **Listed in structure:** JSON, YAML, Markdown, HTML, CSS, SQL, Java, C#, Go, Ruby, PHP, shell scripts

## Storage

- Index: `YOUR_PROJECT/.ai-index/PROJECT-INDEX.md`
- Global registry: `~/.ai-index/registry.json`

**Git tip:** add `.ai-index/` to your `.gitignore` (each dev regenerates it in a
second) — or commit it so the whole team shares it.

## Test

```bash
npm test
```

17 assertions covering signature extraction (TS/JS/Python), folder exclusion,
`.gitignore` support, CLAUDE.md integration and the CLI end-to-end.

---

## 🇪🇸 Versión en español

### El problema

Cada vez que le preguntas algo a tu asistente de IA sobre tu código, este ejecuta
búsquedas y lee archivos completos para entender el proyecto. Esa exploración se
repite en **cada sesión** y consume miles de tokens antes de responder.

### La solución

`ai-index` escanea tu proyecto en **menos de 1 segundo** y genera **un solo
archivo Markdown ultra-compacto** (`.ai-index/PROJECT-INDEX.md`) con todo lo que
un LLM necesita: estructura, clases, métodos, funciones y dependencias. Tu
asistente lee ese archivo en vez de explorar el código → **hasta 99% menos tokens**.

### Instalación

Requiere **Node.js ≥ 16**. Mismo comando en Windows, macOS y Linux:

```bash
npm install -g ia-project-indexer
```

### Uso

```bash
cd /ruta/a/tu/proyecto
ai-index                 # indexa el directorio actual
ai-index list            # lista proyectos indexados
ai-index --no-claude     # indexa sin tocar CLAUDE.md
```

Re-indexa cuando el código cambie — tarda menos de un segundo.

### Compatibilidad

- **Claude Code:** automático (ai-index configura `CLAUDE.md` por ti)
- **Cursor / Copilot:** una línea en `.cursorrules` / `copilot-instructions.md`
- **ChatGPT / Gemini:** adjunta o pega el índice al inicio del chat

100% local: sin red, sin telemetría, sin cloud. Cero dependencias.

---

## License

[MIT](LICENSE) © [RaffyRod](https://github.com/RaffyRod)

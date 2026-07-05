# Security Policy

## Why this package is hard to compromise

IA Project Indexer is designed with a minimal attack surface:

- **Zero dependencies** — there is no third-party code to poison. The classic
  npm supply-chain attack (compromising a transitive dependency) has nothing
  to grab onto here.
- **No install scripts** — no `postinstall`, `preinstall` or any lifecycle
  hook that runs on `npm install` from the registry. Installing this package
  executes **nothing**. (The `prepare` script only runs for contributors
  working inside a git clone — it wires up the repo's own lint hooks — and
  never runs on registry installs.)
- **No network access** — the code contains no `http`, `https`, `net` or
  `fetch` usage. Nothing is downloaded, nothing is uploaded, no telemetry.
- **No dynamic code execution** — no `eval`, no `new Function`, no dynamic
  `require`. The tool only reads text files and writes Markdown/JSON.
- **Published allowlist** — the npm package ships exactly three files
  (`index.js`, `README.md`, `LICENSE`) via the `files` field; nothing else
  from the repo can leak into a release.
- **Tests gate every release** — `prepublishOnly` runs the full 54-assertion
  suite; a release cannot be published with failing tests.
- **Validated inputs** — imported index files are checked for format, types
  and size (10MB cap) before anything is written to disk.

## Verifying a release yourself

```bash
npm pack ia-project-indexer --dry-run   # list exactly what ships
npm view ia-project-indexer scripts     # confirm: no install hooks
```

## Reporting a vulnerability

Please open a private report via GitHub Security Advisories on
[RaffyRod/IA-Project-indexer](https://github.com/RaffyRod/IA-Project-indexer/security/advisories),
or email **elraffy3@gmail.com**. You should receive a response within a few
days. Please do not open public issues for security reports.

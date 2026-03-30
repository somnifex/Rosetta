<div align="center">

<img src="public/Logo.png" alt="Rosetta logo" width="120" />

# Rosetta

**Decode every document. Bridge every language.**

A local-first desktop app for structured PDF parsing, AI translation, semantic search, and source-grounded document chat.

[English](README.md) | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-GPL%20v3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-ffc131)]()

[Download](https://github.com/somnifex/Rosetta/releases) | [Quick Start](#quick-start) | [Use Cases](#use-cases) | [Contributing](#contributing)

</div>

## What Is Rosetta

Rosetta is an open-source desktop application for people who work with long, complex documents across languages.

Instead of doing one-off file translation, Rosetta helps you build a reusable knowledge workflow:

- import documents into a persistent library
- parse PDF layout with structure awareness
- translate with configurable AI providers
- index content for semantic retrieval
- ask questions with source grounding
- sync and back up your workspace data

## Why Rosetta

Most document translators focus on quick conversion.
Rosetta focuses on ongoing knowledge work.

It is designed for scenarios like:

- reading and translating research papers over time
- maintaining multilingual internal documentation
- searching and reusing previously processed content
- controlling providers, prompts, and storage yourself

## Core Highlights

- Structured PDF parsing with MinerU integration
- Multi-channel AI routing for chat, translation, embedding, and reranking
- Semantic search and RAG chat over your own document library
- Task center for parsing, translation, and indexing jobs
- Local backup and WebDAV sync
- Cross-platform desktop experience with multilingual UI

## Quick Start

### 1. Download

Get the latest release from [GitHub Releases](https://github.com/somnifex/Rosetta/releases).

| Platform | Package formats     |
| -------- | ------------------- |
| Windows  | `.msi`, `.exe`      |
| macOS    | `.dmg`              |
| Linux    | `.deb`, `.AppImage` |

### 2. First 3 Minutes

1. Install and open Rosetta.
2. Go to `Settings` and configure at least one AI provider channel.
3. Connect to an external MinerU service, or initialize the built-in MinerU environment.
4. Import a document into your library.
5. Run Parse -> Translate -> Index.
6. Use Search or Chat with source references.

### 3. Typical Workflow

```text
Import -> Parse -> Translate -> Index -> Search / Chat -> Backup
```

## Use Cases

- Research reading and bilingual note workflows
- Technical manual translation and terminology alignment
- Team knowledge archival with retrievable document memory
- Personal document intelligence base with AI-assisted Q&A

## Data and Privacy

Rosetta is local-first by design.
Runtime data is stored in your system app data directory rather than the repository workspace.

Typical stored data includes:

- imported document copies
- SQLite metadata and indexes
- MinerU runtime assets
- local cache and generated artifacts

You choose which external AI services to connect, and what content to send.

## Contributing

Contributions are welcome in product UX, stability, translation quality, and platform support.

Before opening a pull request, please run:

```bash
npm run build
cd src-tauri && cargo check
```

### Build from Source (Optional)

Requirements:

- Node.js 18+
- Rust stable
- Tauri 2 prerequisites
- Python 3.x (needed for built-in MinerU or optional zvec backend)

```bash
git clone https://github.com/somnifex/Rosetta.git
cd Rosetta
npm install
npm run tauri:dev
```

## Roadmap

- [x] Document library management
- [x] MinerU integration
- [x] Multi-channel LLM translation workflow
- [x] Search and RAG chat
- [x] WebDAV sync and local backup
- [x] Multilingual interface
- [ ] Batch translation workflows
- [ ] Richer annotation and review tools
- [ ] More export and collaboration options

## License

Rosetta is licensed under the [GNU General Public License v3.0](LICENSE).

## Acknowledgments

- [Tauri](https://tauri.app/)
- [MinerU](https://github.com/opendatalab/MinerU)
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)

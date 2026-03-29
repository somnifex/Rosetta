<div align="center">

<img src="public/Logo.png" alt="Rosetta logo" width="120" />

# Rosetta

**Decode every document. Bridge every language.**

A desktop application for structured PDF parsing, AI-powered translation, semantic search, and document-centric knowledge work.

[English](README.md) | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-GPL%20v3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-ffc131)]()
[![Status](https://img.shields.io/badge/status-active%20development-2ea44f)]()

[Download](https://github.com/somnifex/Rosetta/releases) | [Features](#features) | [Getting Started](#getting-started) | [Build from Source](#build-from-source) | [Contributing](#contributing)

</div>

Rosetta is built for people who read, translate, organize, and revisit complex documents across languages: research papers, technical manuals, internal reports, academic drafts, and long-form reference material.

Instead of treating a PDF as a disposable upload, Rosetta turns it into a reusable knowledge asset:

- parse it with structure awareness
- translate it with configurable AI channels
- index it for retrieval
- search it semantically
- chat over it with source grounding
- back it up locally or via WebDAV

## Features

### Structured PDF Parsing

- Layout-aware parsing powered by [MinerU](https://github.com/opendatalab/MinerU)
- Better preservation of headings, sections, tables, and reading order
- Support for both external MinerU services and built-in local setup

### AI Translation Workflow

- Separate `chat`, `translate`, `embed`, and `rerank` channels
- Priority routing and failover support
- Custom translation prompts for tone, terminology, and consistency
- Compatible with OpenAI-compatible providers including OpenAI, Azure OpenAI, Ollama, LM Studio, and similar services

### Search and RAG Chat

- Full-text search with semantic retrieval
- Document chunking and vector indexing
- Source-aware question answering over your personal document library

### Document Library

- Import PDF, Markdown, and plain text files
- Organize documents with categories and tags
- Track parsing, translation, and indexing progress per document

### Task Center

- Unified task list for parsing, translation, and indexing jobs
- Progress monitoring, cancellation, and cleanup

### Backup and Sync

- Local import and export for workspace backup
- WebDAV sync for moving settings and data across devices

### Desktop-First Experience

- Cross-platform desktop app built with Tauri
- Local-first runtime data storage
- Multi-language interface with light and dark theme support

## Why Rosetta

Many PDF translation tools are optimized for one-time conversion. Rosetta is designed for iterative knowledge work.

It is useful when you need to:

- maintain a growing library instead of handling a single file once
- preserve document structure before translating
- search and ask questions across previously processed content
- keep control over providers, prompts, and storage
- run a practical workflow from import to retrieval inside one desktop app

## Getting Started

### Download

Prebuilt binaries for Windows, macOS, and Linux are published on the [Releases](https://github.com/somnifex/Rosetta/releases) page.

| Platform | Package formats     |
| -------- | ------------------- |
| Windows  | `.msi`, `.exe`      |
| macOS    | `.dmg`              |
| Linux    | `.deb`, `.AppImage` |

### First Run

1. Install Rosetta from the latest release.
2. Open `Settings` and configure at least one AI channel.
3. Connect to an external MinerU service, or initialize the built-in MinerU environment.
4. Import a document into the library.
5. Parse, translate, index, then use Search or Chat on top of it.

## Typical Workflow

```text
Import -> Parse -> Translate -> Index -> Search / Chat -> Back up
```

## Build from Source

### Requirements

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- Python 3.x

  Only required when using built-in MinerU or the optional `zvec` backend

### Development

```bash
git clone https://github.com/somnifex/Rosetta.git
cd Rosetta
npm install
npm run tauri:dev
```

### Release Build

```bash
npm run tauri:build
```

Build artifacts are generated under `src-tauri/target/release/bundle/`.

## Project Structure

```text
Rosetta/
├── src/                # React frontend
├── src-tauri/          # Rust backend and Tauri configuration
├── packages/types/     # Shared TypeScript types
└── scripts/            # Utility and release-prep scripts
```

## Data and Privacy

Rosetta is local-first by design. Runtime data is stored in the system application data directory instead of inside the repository workspace.

That includes:

- imported document copies
- the SQLite database
- MinerU environments and models
- caches and generated indexes

## Contributing

Contributions are welcome, especially around:

- translation quality and workflow polish
- performance and stability
- packaging and release hardening
- localization and documentation

Before opening a pull request, please verify:

- `npm run build`
- `cargo check` in `src-tauri`

## Roadmap

- [x] Document library management
- [x] MinerU integration
- [x] Multi-channel LLM translation workflow
- [x] Search and RAG chat
- [x] WebDAV sync and local backup
- [x] Multi-language interface
- [ ] Batch translation workflows
- [ ] Richer annotation and review tools
- [ ] More export and collaboration features

## License

Rosetta is licensed under the [GNU General Public License v3.0](LICENSE).

If you distribute modified versions of this project, the GPLv3 requires that the corresponding source code and the same license terms remain available to downstream users.

## Acknowledgments

- [Tauri](https://tauri.app/)
- [MinerU](https://github.com/opendatalab/MinerU)
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
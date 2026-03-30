<div align="center">

<img src="public/Logo.png" alt="Rosetta logo" width="120" />

# Rosetta

**解析每一份文档，连接每一种语言。**

一款面向复杂文档工作流的桌面应用，提供结构化 PDF 解析、AI 翻译、语义检索与文档知识管理能力。

[English](README.md) | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-GPL%20v3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-ffc131)]()
[![Status](https://img.shields.io/badge/status-active%20development-2ea44f)]()

[下载](https://github.com/somnifex/Rosetta/releases) | [功能特性](#功能特性) | [快速开始](#快速开始) | [源码构建](#源码构建) | [参与贡献](#参与贡献)

</div>

Rosetta 面向需要长期处理多语言复杂文档的用户，例如科研论文、技术手册、内部报告、学术草稿以及各类长文参考资料。

它不是把 PDF 当作一次性上传文件处理，而是把文档变成可复用的知识资产：

- 先做结构化解析
- 再用可配置的 AI 通道翻译
- 为内容建立索引
- 用语义方式搜索
- 基于来源进行问答
- 最后做本地或 WebDAV 备份

## 功能特性

### 结构化 PDF 解析

- 基于 [MinerU](https://github.com/opendatalab/MinerU) 的版面感知解析
- 更好保留标题、章节、表格与阅读顺序
- 同时支持外部 MinerU 服务与内置本地部署模式

### AI 翻译工作流

- 分离 `chat`、`translate`、`embed`、`rerank` 四类通道
- 支持优先级路由与故障切换
- 可自定义翻译提示词，控制语气、术语与一致性
- 兼容 OpenAI 兼容接口，包括 OpenAI、Azure OpenAI、Ollama、LM Studio 等服务

### 搜索与 RAG 问答

- 支持全文检索与语义检索结合
- 支持文档切块与向量索引
- 支持面向个人文档库的带来源问答

### 文档库管理

- 支持导入 PDF、Markdown 与纯文本文件
- 支持分类、标签与文档组织
- 可跟踪每篇文档的解析、翻译与索引状态

### 任务中心

- 在统一任务列表中查看解析、翻译和索引任务
- 支持进度监控、取消与清理

### 备份与同步

- 支持工作区的本地导入导出
- 支持通过 WebDAV 在设备间同步配置与数据

### 桌面优先体验

- 基于 Tauri 构建的跨平台桌面应用
- 本地优先的数据存储方式
- 提供多语言界面与浅色/深色主题支持

### 阅读器快捷键与高亮工作流

- PDF 缩放快捷键：`Ctrl/Cmd +`、`Ctrl/Cmd -`、`Ctrl/Cmd 0`、`Ctrl/Cmd + 鼠标滚轮`
- 高亮采用手动保存：修改先进入草稿状态，只有显式保存才落盘
- 阅读器内支持历史操作：`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 重做
- 支持快速保存：`Ctrl/Cmd+S` 或阅读器内保存按钮

## 为什么选择 Rosetta

很多 PDF 翻译工具更适合“一次翻完就结束”的场景，而 Rosetta 面向的是持续性的知识工作流。

当你需要下面这些能力时，它会更合适：

- 维护一个持续增长的文档库，而不是一次只处理一篇文件
- 在翻译前尽量保留原始文档结构
- 对已经处理过的内容反复搜索和提问
- 自己控制模型通道、提示词和数据存储位置
- 在一个桌面应用里完成从导入到检索的完整流程

## 快速开始

### 下载

Windows、macOS 和 Linux 的预构建版本会发布在 [Releases](https://github.com/somnifex/Rosetta/releases) 页面。

| 平台      | 安装包格式              |
| ------- | ------------------ |
| Windows | `.msi`、`.exe`      |
| macOS   | `.dmg`             |
| Linux   | `.deb`、`.AppImage` |

### 首次使用

1. 安装最新版本的 Rosetta。
2. 打开 `Settings`，至少配置一个 AI 通道。
3. 连接外部 MinerU 服务，或者初始化内置 MinerU 环境。
4. 在文档库中导入一篇文档。
5. 依次完成解析、翻译和索引。
6. 使用搜索或对话功能继续处理文档内容。

## 典型工作流

```text
导入 -> 解析 -> 翻译 -> 索引 -> 搜索 / 对话 -> 备份
```

## 源码构建

### 环境要求

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- Python 3.x

  仅在使用内置 MinerU 或可选 `zvec` 后端时需要

### 本地开发

```bash
git clone https://github.com/somnifex/Rosetta.git
cd Rosetta
npm install
npm run tauri:dev
```

### 构建发布版

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 项目结构

```text
Rosetta/
├── src/                # React 前端
├── src-tauri/          # Rust 后端与 Tauri 配置
├── packages/types/     # 共享 TypeScript 类型
└── scripts/            # 工具与发布辅助脚本
```

## 数据与隐私

Rosetta 采用本地优先设计。运行时数据会写入系统应用数据目录，而不是仓库工作区。

包括：

- 导入后的文档副本
- SQLite 数据库
- MinerU 运行环境与模型
- 缓存与生成索引

## 参与贡献

欢迎围绕以下方向参与改进：

- 翻译质量与工作流体验
- 性能与稳定性
- 打包、发布与跨平台完善
- 本地化与文档内容

提交 Pull Request 前，建议至少验证：

- `npm run build`
- 在 `src-tauri` 下执行 `cargo check`

## 路线图

- [x] 文档库管理
- [x] MinerU 集成
- [x] 多通道 LLM 翻译工作流
- [x] 搜索与 RAG 问答
- [x] WebDAV 同步与本地备份
- [x] 多语言界面
- [ ] 批量翻译工作流
- [ ] 更丰富的批注与审阅能力
- [ ] 更多导出与协作特性

## 许可证

Rosetta 采用 [GNU General Public License v3.0](LICENSE) 许可证发布。

如果你分发修改后的版本，GPLv3 要求你继续向下游用户提供对应源代码，并保持相同的许可证条款。

## 致谢

- [Tauri](https://tauri.app/)
- [MinerU](https://github.com/opendatalab/MinerU)
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
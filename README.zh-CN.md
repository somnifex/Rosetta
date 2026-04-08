<div align="center">

<img src="public/Logo.png" alt="Rosetta logo" width="120" />

# Rosetta

**一张本地优先的桌面文档工作台，适合那些你会反复回看的文档。**

一款本地优先的开源桌面应用，用来阅读、翻译、索引和追问长文档。

[English](README.md) | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-GPL%20v3-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-ffc131)

[下载](https://github.com/somnifex/Rosetta/releases) | [快速开始](#快速开始) | [从源码构建](#从源码构建) | [参与贡献](#参与贡献)

</div>

## 为什么是 Rosetta

很多文档工具只适合做一次性转换：上传，翻译，导出，然后结束。Rosetta 更适合那些你还会继续使用的文档。

它把长篇 PDF 和文本文件放回一个持续可用的工作流里：文档库、阅读器、翻译流程、索引和带来源的对话都在同一个桌面应用里。导入一次，之后的解析、翻译、检索、回看和追问都围绕同一份材料展开。

## 设计取向

- 本地优先。文档、索引、提示词和生成产物都保存在你的机器上，位于系统应用数据目录。
- 尊重结构。Rosetta 会尽量先保留版面和内容层次，而不是一开始就把 PDF 压平成纯文本。
- 该可配的地方都能配。`chat`、`translate`、`embed`、`rerank` 可以分别使用不同的服务、模型和运行参数。
- 面向重复使用。文档导入后，不是“处理完就结束”，而是可以继续翻译、索引、检索、抽取字段和对话。

## 它能做什么

- 建立可长期维护的文档库，支持文件夹、分类、标签和字段抽取模板。
- 通过内置 MinerU、外部服务或官方 API 解析 PDF。
- 在原文、译文和对照阅读之间切换。
- 把 `chat`、`translate`、`embed`、`rerank` 拆成独立通道来管理。
- 调整翻译提示词、切片策略、并发、限速和失败切换。
- 用直接匹配和语义检索搜索自己的文档库。
- 对文档发问，并回看支撑答案的来源片段。
- 在任务中心追踪解析、翻译和索引进度。
- 导出本地备份，或通过 WebDAV 同步工作区数据。

## 适合什么场景

- 长期阅读论文、手册、标准和技术报告
- 需要多语言对照的内部资料
- 想把零散 PDF 变成可检索、可回查的个人知识库
- 重视术语一致性、来源可追溯和后续复用的翻译工作流

## 快速开始

### 1. 下载

在 [GitHub Releases](https://github.com/somnifex/Rosetta/releases) 获取最新版本。

| 平台    | 安装包格式              |
| ------- | ----------------------- |
| Windows | `.msi`、`.exe`      |
| macOS   | `.dmg`                |
| Linux   | `.deb`、`.AppImage` |

### 2. 首次启动

1. 安装并启动 Rosetta。
2. 在 `Settings` 中至少配置一个模型服务通道。
3. 选择 MinerU 模式：内置、外部，或官方 API。
4. 导入文档到文档库。
5. 执行 `Parse -> Translate -> Index`。
6. 在 `Search`、`Chat` 或阅读器里继续工作。

### 3. 典型流程

```text
导入 -> 解析 -> 翻译 -> 索引 -> 阅读 / 搜索 / 对话 -> 备份
```

## 从源码构建

环境要求：

- Node.js 18+
- Rust stable
- Tauri 2 prerequisites
- Python 3.x，用于内置 MinerU 运行时或可选的 zvec 后端

```bash
git clone https://github.com/somnifex/Rosetta.git
cd Rosetta
npm install
npm run tauri:dev
```

## 数据与隐私

Rosetta 默认采用本地优先设计。运行时数据存储在系统应用数据目录，而不是仓库目录。

常见数据包括：

- 导入后的文档副本
- SQLite 元数据与索引
- MinerU 运行时文件与下载的模型
- 本地缓存、生成产物和备份文件

Rosetta 只会连接你显式配置的外部服务。哪些服务可以访问文档内容，由你自己决定。

## 路线图

- [x] 文档库管理
- [x] MinerU 集成
- [x] 多通道模型路由
- [x] 搜索与带来源对话
- [x] WebDAV 同步与本地备份
- [x] 多语言界面
- [ ] 批量翻译工作流
- [ ] 更丰富的批注与审阅能力
- [ ] 更多导出与协作能力

## 参与贡献

欢迎在产品体验、稳定性、解析质量、翻译质量、文档和跨平台支持等方向提交贡献。

提交 Pull Request 前，建议先执行：

```bash
npm run build
cd src-tauri && cargo check
```

## 许可证

Rosetta 采用 [GNU General Public License v3.0](LICENSE) 许可证。

## 致谢

- [Tauri](https://tauri.app/)
- [MinerU](https://github.com/opendatalab/MinerU)
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- Rosetta 也受益于 [GitHub](https://github.com/)、[Reddit](https://www.reddit.com/) 和 [Linux.do](https://linux.do/) 上大量公开的 issue、讨论和排障记录。很多项目并不是一个人“做出来”的，通常是这样慢慢长出来的。

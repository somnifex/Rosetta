<div align="center">

<img src="public/Logo.png" alt="Rosetta logo" width="120" />

# Rosetta

**解析每一份文档，连接每一种语言。**

一款本地优先的开源桌面应用，提供结构化 PDF 解析、AI 翻译、语义检索与带来源问答能力。

[English](README.md) | [简体中文](README.zh-CN.md)

[![License](https://img.shields.io/badge/license-GPL%20v3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)]()
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-ffc131)]()

[下载](https://github.com/somnifex/Rosetta/releases) | [快速开始](#快速开始) | [适用场景](#适用场景) | [参与贡献](#参与贡献)

</div>

## Rosetta 是什么

Rosetta 面向长期处理多语言复杂文档的用户，不是一次性“上传-翻译-下载”工具。

它把文档转化为可持续复用的知识资产：

- 导入并管理文档库
- 进行结构化 PDF 解析
- 通过可配置 AI 通道翻译
- 建立语义索引与检索能力
- 基于来源进行问答
- 备份与跨设备同步

## 为什么选择 Rosetta

多数文档翻译工具偏向快速转换。
Rosetta 更关注持续性的知识工作流。

你可以在这些场景中受益：

- 长期阅读与翻译科研论文
- 维护多语言技术文档与报告
- 复用历史处理结果进行检索和问答
- 自主控制模型通道、提示词与存储位置

## 核心能力

- 基于 MinerU 的结构化 PDF 解析
- `chat`、`translate`、`embed`、`rerank` 多通道 AI 路由
- 面向个人文档库的语义检索与 RAG 问答
- 任务中心统一管理解析、翻译、索引进度
- 本地备份与 WebDAV 同步
- 跨平台桌面体验与多语言界面

## 快速开始

### 1. 下载

在 [GitHub Releases](https://github.com/somnifex/Rosetta/releases) 获取最新版本。

| 平台      | 安装包格式              |
| ------- | ------------------ |
| Windows | `.msi`、`.exe`      |
| macOS   | `.dmg`             |
| Linux   | `.deb`、`.AppImage` |

### 2. 3 分钟上手

1. 安装并启动 Rosetta。
2. 在 `Settings` 中至少配置一个 AI 通道。
3. 连接外部 MinerU 服务，或初始化内置 MinerU 环境。
4. 导入文档到文档库。
5. 执行 解析 -> 翻译 -> 索引。
6. 通过搜索或对话继续使用结果。

### 3. 典型流程

```text
导入 -> 解析 -> 翻译 -> 索引 -> 搜索 / 对话 -> 备份
```

## 适用场景

- 双语科研阅读与知识沉淀
- 技术手册翻译与术语一致性维护
- 团队内部知识资料归档与可检索化
- 个人文档知识库与 AI 辅助问答

## 数据与隐私

Rosetta 采用本地优先设计。
运行时数据存储在系统应用数据目录，而不是仓库目录。

常见数据包括：

- 导入后的文档副本
- SQLite 元数据与索引
- MinerU 运行环境相关文件
- 本地缓存和生成产物

你可以自主决定连接哪些外部 AI 服务，以及发送哪些内容。

## 参与贡献

欢迎在产品体验、稳定性、翻译质量、跨平台支持等方向提交贡献。

提交 Pull Request 前，建议先执行：

```bash
npm run build
cd src-tauri && cargo check
```

### 从源码运行（可选）

环境要求：

- Node.js 18+
- Rust stable
- Tauri 2 prerequisites
- Python 3.x（仅在使用内置 MinerU 或可选 zvec 后端时需要）

```bash
git clone https://github.com/somnifex/Rosetta.git
cd Rosetta
npm install
npm run tauri:dev
```

## 路线图

- [x] 文档库管理
- [x] MinerU 集成
- [x] 多通道 LLM 翻译工作流
- [x] 搜索与 RAG 问答
- [x] WebDAV 同步与本地备份
- [x] 多语言界面
- [ ] 批量翻译工作流
- [ ] 更丰富的批注与审阅能力
- [ ] 更多导出与协作能力

## 许可证

Rosetta 采用 [GNU General Public License v3.0](LICENSE) 许可证。

## 致谢

- [Tauri](https://tauri.app/)
- [MinerU](https://github.com/opendatalab/MinerU)
- [Radix UI](https://www.radix-ui.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- 也感谢 Reddit、GitHub、Linux.do 等开源与交流社区。一路上读过很多项目源码、issue、经验贴和讨论串，从中学到了非常多东西，这些分享也在潜移默化中影响了 Rosetta 的形成。

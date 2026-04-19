# Agent Docx Project

这是一个专为 Agent 设计的模块化 Python 项目，旨在通过简单的 API 实现对 `.docx` 文档的自动化读、写和编辑操作。

## 功能特性

- **读取 (`DocxReader`)**: 能够提取文档中的所有文本、段落，并支持查找特定文本。
- **写入 (`DocxWriter`)**: 支持创建新文档，添加标题和段落。
- **编辑 (`DocxEditor`)**: 支持对现有文档进行文本替换、在末尾追加内容等操作。

## 环境要求

本项目依赖 `python-docx` 库。

### 安装步骤

1. 确保您的系统中已安装 Python 3。
2. 安装依赖库：

```bash
pip install python-docx
```

## 项目结构

- `src/modules/`: 核心逻辑模块。
  - `reader.py`: 文档读取功能。
  - `writer.py`: 文档创建功能。
  - `editor.py`: 文档编辑功能。
- `examples/`: 示例脚本。
- `tests/`: 单元测试目录（待扩展）。

## 使用示例

您可以运行 `examples/demo.py` 来查看该项目的实际操作效果。

```bash
cd docx_agent_project
python3 examples/demo.py
```

## 快速开始 (代码片段)

### 替换文本示例

```python
from src.modules.editor import DocxEditor

editor = DocxEditor("my_document.docx")
editor.replace_text("旧文本", "新文本")
editor.save()
```

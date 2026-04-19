# Docx Reader Project

A simple Python project to read text from `.docx` files.

## Installation

1. Ensure you have Python installed.
2. Clone this repository.
3. Install the dependencies:

```bash
pip install -r docx_reader/requirements.txt
```

## Usage

Run the CLI tool using `python3`:

```bash
python3 docx_reader/main.py path/to/your/file.docx
```

To list paragraphs separately:

```bash
python3 docx_reader/main.py path/to/your/file.docx --list
```

## Features

- Read all text from a `.docx` file.
- List paragraphs with indices.

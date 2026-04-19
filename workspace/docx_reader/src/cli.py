import argparse
import sys
from docx_reader.src.reader import DocxReader

def main():
    parser = argparse.ArgumentParser(description="Read text from a .docx file.")
    parser.add_argument("file_path", help="Path to the .docx file")
    parser.add_argument("--list", action="store_true", help="List paragraphs instead of printing full text")

    args = parser.parse_args()

    reader = DocxReader(args.file_path)

    if args.list:
        paragraphs = reader.read_paragraphs()
        if paragraphs and not paragraphs[0].startswith("Error"):
            for i, para in enumerate(paragraphs):
                print(f"[{i}] {para}")
        else:
            print(paragraphs[0] if paragraphs else "No content found.")
    else:
        text = reader.read_text()
        print(text)

if __name__ == "__main__":
    main()

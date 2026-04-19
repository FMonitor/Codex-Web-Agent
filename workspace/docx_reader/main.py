import sys
import os

# Add the docx_reader directory to sys.path to allow imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '.')))

from docx_reader.src.cli import main

if __name__ == "__main__":
    main()

from typing import List, Dict, Any, Optional

def get_tool_description() -> Dict[str, Any]:
    """
    Returns a structured description of the DocxEditor tools 
    that can be used by an LLM/Agent to understand how to call them.
    """
    return {
        "name": "docx_editor",
        "description": "A tool for reading, creating, and editing .docx files.",
        "methods": [
            {
                "name": "create_new_docx",
                "description": "Creates a new empty .docx file.",
                "parameters": {
                    "file_path": "The path where the new file should be saved."
                }
            },
            {
                "name": "open_docx",
                "description": "Opens an existing .docx file for editing.",
                "parameters": {
                    "file_path": "The path to the existing .docx file."
                }
            },
            {
                "name": "add_paragraph",
                "description": "Adds a new paragraph of text to the document.",
                "parameters": {
                    "file_path": "The path to the .docx file.",
                    "text": "The text to be added as a paragraph.",
                    "style": "Optional: The style name (e.g., 'Normal')."
                }
            },
            {
                "name": "add_heading",
                "description": "Adds a heading to the document.",
                "parameters": {
                    "file_path": "The path to the .docx file.",
                    "text": "The text for the heading.",
                    "level": "The heading level (integer from 1 to 9)."
                }
            },
            {
                "name": "add_table",
                "description": "Adds a table to the document.",
                "parameters": {
                    "file_path": "The path to the .docx file.",
                    "rows": "Number of rows.",
                    "cols": "Number of columns.",
                    "data": "Optional: A 2D list of strings representing initial cell content."
                }
            },
            {
                "name": "read_all_text",
                "description": "Reads all text from the document.",
                "parameters": {
                    "file_path": "The path to the .docx file."
                }
            },
            {
                "name": "save_file",
                "description": "Saves the current state of the document to a file.",
                "parameters": {
                    "file_path": "The path where the document should be saved."
                }
            }
        ]
    }

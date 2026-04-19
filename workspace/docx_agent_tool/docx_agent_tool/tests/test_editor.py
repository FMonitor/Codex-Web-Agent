import unittest
import os
import sys

# Add the parent directory to sys.path so we can import docx_agent_tool
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from docx_agent_tool.editor import DocxEditor

class TestDocxEditor(unittest.TestCase):
    def setUp(self):
        self.test_file = "test_output.docx"
        if os.path.exists(self.test_file):
            os.remove(self.test_file)

    def tearDown(self):
        if os.path.exists(self.test_file):
            os.remove(self.test_file)

    def test_create_and_save(self):
        editor = DocxEditor()
        editor.add_paragraph("Hello World")
        editor.save(self.test_file)
        self.assertTrue(os.path.exists(self.test_file))

    def test_read_content(self):
        # Create
        editor = DocxEditor()
        editor.add_paragraph("First line")
        editor.add_paragraph("Second line")
        editor.save(self.test_file)
        
        # Read
        reader = DocxEditor(self.test_file)
        text = reader.get_text()
        self.assertIn("First line", text)
        self.assertIn("Second line", text)

    def test_add_heading(self):
        editor = DocxEditor()
        editor.add_heading("Main Title", level=1)
        editor.save(self.test_file)
        
        reader = DocxEditor(self.test_file)
        text = reader.get_text()
        self.assertIn("Main Title", text)

    def test_add_table(self):
        editor = DocxEditor()
        data = [["Header1", "Header2"], ["Row1Col1", "Row1Col2"]]
        editor.add_table(rows=2, cols=2, data=data)
        editor.save(self.test_file)
        
        reader = DocxEditor(self.test_file)
        text = reader.get_text()
        self.assertIn("Row1Col1", text)
        self.assertIn("Row1Col2", text)

if __name__ == "__main__":
    unittest.main()

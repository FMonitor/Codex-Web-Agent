from src.modules.reader import DocxReader
from src.modules.writer import DocxWriter
from src.modules.editor import DocxEditor
import os

def run_demo():
    demo_file = "demo_output.docx"
    
    # 1. 测试 Writer: 创建新文档
    print("--- 步骤 1: 使用 DocxWriter 创建文档 ---")
    writer = DocxWriter()
    writer.add_heading("Agent Docx Project Demo", level=0)
    writer.add_paragraph("这是一个由 Agent 自动生成的测试文档。")
    writer.add_paragraph("欢迎使用本项目！")
    writer.save(demo_file)
    print(f"已成功创建文档: {demo_file}")

    # 2. 测试 Reader: 读取文档内容
    print("\n--- 步骤 2: 使用 DocxReader 读取文档 ---")
    reader = DocxReader(demo_file)
    content = reader.get_all_text()
    print("读取到的内容如下:")
    print(content)

    # 3. 测试 Editor: 修改文档
    print("\n--- 步骤 3: 使用 DocxEditor 修改文档 ---")
    editor = DocxEditor(demo_file)
    editor.replace_text("欢迎使用本项目！", "这是被修改后的内容。")
    editor.add_paragraph_to_end("这是追加的新段落。")
    editor.save("demo_modified.docx")
    print("修改已完成，已保存为 demo_modified.docx")

    # 清理 demo 文件 (可选)
    # os.remove(demo_file)

if __name__ == "__main__":
    # 为了能让示例脚本在项目根目录运行，我们需要将 src 加入 sys.path
    import sys
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    run_demo()

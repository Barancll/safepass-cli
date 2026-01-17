#!/usr/bin/env python3
"""Update CSS version parameters in all HTML templates"""

import re
from pathlib import Path

def update_css_versions(template_dir):
    """Add ?v={{ APP_VERSION }} to all CSS static references"""
    
    # Pattern to match static CSS references without version
    pattern = r"{% static 'css/([^']+\.css)' %}"
    replacement = r"{% static 'css/\1' %}?v={{ APP_VERSION }}"
    
    html_files = list(Path(template_dir).rglob("*.html"))
    updated_files = []
    
    for file_path in html_files:
        content = file_path.read_text(encoding='utf-8')
        original_content = content
        
        # Replace all CSS static references
        content = re.sub(pattern, replacement, content)
        
        if content != original_content:
            file_path.write_text(content, encoding='utf-8')
            updated_files.append(file_path)
            print(f"✅ Updated: {file_path.relative_to(template_dir)}")
    
    print(f"\n🎉 Updated {len(updated_files)} files")
    return updated_files

if __name__ == "__main__":
    template_dir = Path(__file__).parent / "safepass" / "templates"
    update_css_versions(template_dir)

import re

with open('app.js', 'r') as f:
    app_js = f.read()

# Find all function definitions
functions = re.findall(r'function\s+\w+\s*\(.*?\)\s*\{[\s\S]*?\}', app_js)

# Find the DOMContentLoaded listener
dom_content_loaded = re.search(r'document\.addEventListener\s*\(\s*[\'"]DOMContentLoaded[\'"]\s*,\s*\(.*?\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*;', app_js)

# Separate the functions that should be global
global_functions = []
local_functions = []
for func in functions:
    if 'compressPointsWithHeader' in func or \
       'decompressPointsWithHeader' in func or \
       'parseTopFile' in func or \
       'convertToTop' in func:
        global_functions.append(func)
    else:
        local_functions.append(func)

# Remove the global functions from the DOMContentLoaded listener
dom_content_loaded_str = dom_content_loaded.group(0)
for func in global_functions:
    dom_content_loaded_str = dom_content_loaded_str.replace(func, '')

# Create the new file content
new_content = f"""
const TOP_HEADER_SIZE = 32;
const TOP_PACKET_SIZE = 6;
const TOP_HEIGHT = 12000;

{''.join(global_functions)}

{dom_content_loaded_str}
"""

with open('app.js', 'w') as f:
    f.write(new_content)
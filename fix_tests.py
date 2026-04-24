import re

with open("gzmo-daemon/src/__tests__/frontmatter.test.ts", "r") as f:
    content = f.read()

# Remove the two unrequested test blocks
content = re.sub(r'describe\("frontmatter updateFrontmatter".*?\n\}\);\n', '', content, flags=re.DOTALL)
content = re.sub(r'describe\("frontmatter appendToTask".*?\n\}\);\n', '', content, flags=re.DOTALL)

# Revert the import to just parseTask
content = content.replace(
    'import { parseTask, updateFrontmatter, appendToTask } from "../frontmatter";',
    'import { parseTask } from "../frontmatter";'
)

with open("gzmo-daemon/src/__tests__/frontmatter.test.ts", "w") as f:
    f.write(content.strip() + "\n")

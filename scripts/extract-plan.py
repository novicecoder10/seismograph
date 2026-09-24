"""Write the tagged code blocks of a plan to disk.

  python3 scripts/extract-plan.py PLAN --tests PATH...   test files only
  python3 scripts/extract-plan.py PLAN --impl  PATH...   implementation files only

Blocks are tagged in the plan with <!-- file: path --> immediately before their
fence. Only the named paths are written, so a task's tests can land and fail
before its implementation exists.
"""
import re
import sys
from pathlib import Path

plan, mode, *wanted = sys.argv[1:]
text = Path(plan).read_text()
blocks = dict(
    re.findall(r"<!-- file: (\S+) -->\n```(?:ts|tsx)\n(.*?)\n```", text, flags=re.S)
)
for path in wanted:
    if path not in blocks:
        sys.exit(f"no block tagged {path}")
    is_test = ".test." in path
    if (mode == "--tests") != is_test:
        continue
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(blocks[path] + "\n")
    print("wrote", path)

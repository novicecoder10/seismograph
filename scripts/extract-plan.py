"""Write the tagged code blocks of a plan to disk.

  python3 scripts/extract-plan.py PLAN --tests PATH...   test files only
  python3 scripts/extract-plan.py PLAN --impl  PATH...   implementation files only
  python3 scripts/extract-plan.py PLAN --sync  PATH...   copy files BACK into the plan

--sync exists because tests find real errors in plans; when a block is corrected
on disk, the plan is corrected to match so it stays an accurate record.

Blocks are tagged in the plan with <!-- file: path --> immediately before their
fence. Only the named paths are written, so a task's tests can land and fail
before its implementation exists.
"""
import re
import sys
from pathlib import Path

plan, mode, *wanted = sys.argv[1:]
text = Path(plan).read_text()

if mode == "--sync":
    for path in wanted:
        body = Path(path).read_text().rstrip("\n")
        pattern = r"(<!-- file: " + re.escape(path) + r" -->\n```(?:ts|tsx)\n).*?(\n```)"
        text, n = re.subn(pattern, lambda m: m.group(1) + body + m.group(2), text, count=1, flags=re.S)
        if n != 1:
            sys.exit(f"no block tagged {path}")
        print("synced", path)
    Path(plan).write_text(text)
    sys.exit(0)
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

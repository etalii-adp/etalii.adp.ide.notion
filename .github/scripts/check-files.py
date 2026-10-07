"""Checks the files this repository holds while it has no plug-in code yet.

Every tracked JSON and YAML file must parse, and every relative link in a tracked markdown file must
point at a file or folder that exists. Prints one line per problem and exits 1 when there is any.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
problems = []

files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.splitlines()
for name in files:
    path = Path(name)
    if not path.is_file():
        continue
    suffix = path.suffix.lower()
    try:
        if suffix == ".json":
            json.loads(path.read_text(encoding="utf-8"))
        elif suffix in (".yml", ".yaml"):
            list(yaml.safe_load_all(path.read_text(encoding="utf-8")))
        elif suffix == ".md":
            text = re.sub(r"```.*?```", "", path.read_text(encoding="utf-8"), flags=re.DOTALL)
            text = re.sub(r"`[^`\n]*`", "", text)
            for target in LINK.findall(text):
                target = target.split("#", 1)[0]
                if not target or re.match(r"^[a-z][a-z0-9+.-]*:", target, re.IGNORECASE):
                    continue
                if not (path.parent / target).exists():
                    problems.append(f"{name}: link to missing {target}")
    except (ValueError, yaml.YAMLError) as error:
        problems.append(f"{name}: does not parse: {error}")

for problem in problems:
    print(problem)
print(f"Checked {len(files)} files, {len(problems)} problem(s).")
sys.exit(1 if problems else 0)

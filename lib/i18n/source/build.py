"""Writes lib/i18n/th.ts, ru.ts and zh.ts from ui.py, ui2.py, messages.py and messages2.py, and checks placeholders.
Run from the repo root: python3 lib/i18n/source/build.py"""
import json, os, re, sys
sys.dont_write_bytecode = True  # no __pycache__ next to the translations
sys.path.insert(0, os.path.dirname(__file__))
from ui import UI
from messages import MESSAGES
from ui2 import UI2
try:
    from messages2 import MESSAGES2
except ImportError:
    MESSAGES2 = []

rows = UI + MESSAGES + UI2 + MESSAGES2
seen, problems = {}, []
for en, *tr in rows:
    if en in seen and seen[en] != tr:
        problems.append(f"Two different translations for: {en}")
    seen[en] = tr
    want = sorted(re.findall(r"\{\w+\}", en))
    for lang, text in zip(("th", "ru", "zh"), tr):
        if sorted(re.findall(r"\{\w+\}", text)) != want:
            problems.append(f"{lang}: placeholders differ in: {en}")
if problems:
    print("\n".join(problems)); sys.exit(1)

names = {"th": "Thai", "ru": "Russian", "zh": "Chinese (Simplified)"}
out_dir = os.path.join(os.path.dirname(__file__), "..")
for i, lang in enumerate(("th", "ru", "zh")):
    lines = [f"// {names[lang]} translations of the staff screens. Generated from lib/i18n/source/*.py:",
             "// edit those files and run `python3 lib/i18n/source/build.py`, not this file.",
             "const dict: Record<string, string> = {"]
    for en, tr in seen.items():
        lines.append(f"  {json.dumps(en, ensure_ascii=False)}: {json.dumps(tr[i], ensure_ascii=False)},")
    lines += ["};", "export default dict;", ""]
    open(os.path.join(out_dir, f"{lang}.ts"), "w", encoding="utf-8").write("\n".join(lines))
print(f"{len(seen)} texts written for th, ru, zh")

#!/usr/bin/env python3
"""Build data.js from Collins pairs."""
import json, re

pairs = json.load(open("collins_pairs.json", encoding="utf-8"))

def classify(p):
    es = p["es"]; en = p["en"]
    # Sentence if: ends with ., ?, !, contains ¿¡, has ≥5 tokens, or starts with capital verb phrase
    if re.search(r"[.?!…]$", es) or "¿" in es or "¡" in es: return "sentence"
    if len(es.split()) >= 5 or len(en.split()) >= 5: return "sentence"
    return "word"

for p in pairs:
    p["kind"] = classify(p)

chapters = sorted({p["chapter"] for p in pairs})
out_lines = ["// Auto-generated from Collins Spanish 3000 PDF — do not edit by hand.",
             "// Re-run build_data.py to regenerate.",
             "const DATA = ["]
for p in pairs:
    def esc(s): return s.replace("\\","\\\\").replace('"','\\"')
    out_lines.append(f'  {{es:"{esc(p["es"])}", en:"{esc(p["en"])}", ch:"{p["chapter"]}", k:"{p["kind"]}"}},')
out_lines.append("];")
out_lines.append("window.DATA = DATA;")
out_lines.append(f'window.DATA_CHAPTERS = {json.dumps(chapters)};')

with open("data.js", "w", encoding="utf-8") as f:
    f.write("\n".join(out_lines))

print(f"Wrote data.js with {len(pairs)} entries across {len(chapters)} chapters")

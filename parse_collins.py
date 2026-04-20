#!/usr/bin/env python3
"""Parse Collins Spanish 3000 words PDF text into {en, es} pairs."""
import re, json, sys

SRC = "collins.txt"

# Load
with open(SRC, encoding="utf-8") as f:
    raw = f.read()

# Drop initial front-matter before the first section header
start = raw.find("the essentials | lo esencial")
if start > 0:
    raw = raw[start:]

lines = raw.split("\n")

# Normalize quotes and strip page numbers (lines that are only digits)
def clean(l):
    return l.rstrip()

lines = [clean(l) for l in lines]

# Find page numbers (lines with just a number, often right-aligned)
def is_page_num(l):
    s = l.strip()
    return s.isdigit() and len(s) <= 3

lines = [l if not is_page_num(l) else "" for l in lines]

# Determine column ranges. Columns are consistently separated by 2+ spaces.
# Approach: find "gap" columns — character positions that are space on most non-empty lines.
# Simpler: split each line on runs of 2+ spaces into cells plus their starting positions.

def split_cells(line):
    """Return list of (start_col, text) for each non-empty cell separated by 2+ spaces."""
    cells = []
    for m in re.finditer(r"\S(?:[^\s]|(?<! ) (?! ))*", line):
        # Use simpler: find runs of non-spaces or single-space-within
        pass
    # Use regex to split by 2+ spaces but keep positions
    cells = []
    i = 0
    while i < len(line):
        if line[i] == " ":
            i += 1; continue
        # find end: where 2+ spaces in a row occur
        m = re.search(r"  +", line[i:])
        end = i + m.start() if m else len(line)
        cells.append((i, line[i:end].rstrip()))
        i = end
    return cells

# Cluster cell-start columns across all lines to determine column boundaries.
from collections import Counter
col_starts = Counter()
for l in lines:
    for start, txt in split_cells(l):
        col_starts[start] += 1

# Pick top 3 clusters
common_starts = sorted([s for s,_ in col_starts.most_common(40)])
# Cluster nearby starts (within 4 chars)
clusters = []
for s in common_starts:
    placed = False
    for c in clusters:
        if abs(c[-1] - s) <= 5:
            c.append(s); placed=True; break
    if not placed:
        clusters.append([s])
# Keep clusters with enough support
clusters = [c for c in clusters if sum(col_starts[x] for x in c) > 30]
# Sort by mean start
clusters.sort(key=lambda c: sum(c)/len(c))
col_bounds = [min(c) for c in clusters]
# We expect ~3 columns. Fall back if not.
if len(col_bounds) < 3:
    col_bounds = [0, 27, 54]
print(f"Detected column starts: {col_bounds}", file=sys.stderr)

# Assign each cell to the nearest column by its start
def assign_col(start):
    best = 0; bd = 999
    for i, b in enumerate(col_bounds):
        d = abs(start - b)
        if d < bd: bd = d; best = i
    return best

NUM_COLS = len(col_bounds)

# Build per-column stream of lines (blank where absent)
col_lines = [[] for _ in range(NUM_COLS)]
for l in lines:
    cells = split_cells(l)
    # Skip lines with page headers/footers or section dividers (contain " | " in a single cell)
    assigned = [""] * NUM_COLS
    for start, txt in cells:
        ci = assign_col(start)
        # if multiple cells hit same col, concat (rare)
        if assigned[ci]:
            assigned[ci] += " " + txt
        else:
            assigned[ci] = txt
    for i in range(NUM_COLS):
        col_lines[i].append(assigned[i])

# Within each column, split into "records" separated by blank lines.
def records(col):
    rec = []
    out = []
    for l in col:
        if l.strip() == "":
            if rec:
                out.append(rec); rec = []
        else:
            rec.append(l.strip())
    if rec: out.append(rec)
    return out

ES_CHARS = set("áéíóúñü¿¡")
ES_STARTS = re.compile(r"^(el |la |los |las |un |una |unos |unas |al |del |de |a |en |con |por |para |que |y |o |no |sí|mi |tu |su |es |está|son |están|tengo|eres|soy|soy\.|\.{3}\s?el |\.{3}\s?la )", re.I)
ES_TYPICAL = re.compile(r"(ción\b|dad\b|mente\b|ando\b|iendo\b|oso\b|osa\b)")

def is_spanish(text):
    if any(c in ES_CHARS for c in text.lower()): return True
    # Check for Spanish function words
    tokens = re.findall(r"[a-záéíóúñü]+", text.lower())
    spanish_hits = sum(1 for t in tokens if t in {
        "el","la","los","las","un","una","unos","unas","del","al","de","a","en","con","por","para","y","o","no","si","es","son","muy","con","que","como","pero","porque","entre","hasta","desde","durante","tengo","soy","estoy","soy","eres","tiene","tienes","hay","he","ha","este","esta","estos","estas","ese","esa","esos","esas","mi","tu","su","nuestro","vuestro","lo","le","me","te","se","nos","os","cuando","donde","cual","cuales","quien","quienes","qué","cómo","dónde","cuándo","cuánto","por favor","gracias","perdone","perdón","buenos","buenas"
    })
    return spanish_hits >= 1 and not re.search(r"\b(the|and|of|to|is|are|you|your|my|what|how|when|where|with|have|has|for|in|on|at|this|that|these|those|do|does|did|can|could|would|should|will|about|from|I|we|they|he|she|it|please|thank|thanks|sorry|yes|no)\b", text, re.I)

SECTION_RE = re.compile(r"\s\|\s")

# Top-level chapters (from TOC) — drive by original line order.
TOP_CHAPTERS = [
    ("essentials", "the essentials | lo esencial"),
    ("transport", "transport | el transporte"),
    ("home", "in the home | en casa"),
    ("shops", "at the shops | en las tiendas"),
    ("day-to-day", "day-to-day | el día a día"),
    ("leisure", "leisure | el tiempo libre"),
    ("sport", "sport | el deporte"),
    ("health", "health | la salud"),
    ("earth", "planet earth | el planeta tierra"),
    ("celebrations", "celebrations and festivals"),
]

# Build per-line chapter map by scanning the flat `lines` list.
line_chapter = [""] * len(lines)
current = "essentials"
for i, l in enumerate(lines):
    s = l.strip().lower()
    for key, marker in TOP_CHAPTERS:
        if marker.split(" | ")[0] in s and " | " in s:
            current = key; break
        if key == "celebrations" and s.startswith("celebrations and festivals"):
            current = key; break
    line_chapter[i] = current

pairs = []
seen = set()
# Track current sub-section per column via scanning records with original line numbers.
for ci in range(NUM_COLS):
    # Build records with line-index provenance for this column.
    rec = []
    rec_start = None
    col = col_lines[ci]
    for li, l in enumerate(col):
        if l.strip() == "":
            if rec:
                _emit = (rec, rec_start)
                # Inline process
                rec_lines, start_li = _emit
                if not any(SECTION_RE.search(x) for x in rec_lines):
                    if sum(len(x) for x in rec_lines) >= 3:
                        split_idx = None
                        for j, x in enumerate(rec_lines):
                            if is_spanish(x):
                                split_idx = j; break
                        if split_idx and split_idx > 0:
                            en_part = re.sub(r"\s+", " ", " ".join(rec_lines[:split_idx]).strip())
                            es_part = re.sub(r"\s+", " ", " ".join(rec_lines[split_idx:]).strip())
                            if 1 <= len(en_part) <= 200 and 1 <= len(es_part) <= 200:
                                key = (en_part.lower(), es_part.lower())
                                if key not in seen:
                                    seen.add(key)
                                    pairs.append({
                                        "en": en_part,
                                        "es": es_part,
                                        "chapter": line_chapter[start_li] if start_li is not None else "essentials",
                                    })
                rec = []; rec_start = None
        else:
            if not rec: rec_start = li
            rec.append(l.strip())
    # ignore trailing record
    continue
# Skip the old loop below.
if False:
    for ci in range(NUM_COLS):
        for rec in records(col_lines[ci]):
            if any(SECTION_RE.search(l) for l in rec): continue
        # Skip likely page numbers / tiny fragments
        if sum(len(l) for l in rec) < 3: continue
        # Find the split point between English block and Spanish block.
        # Heuristic: first line that is Spanish marks start of Spanish block.
        split_idx = None
        for i, l in enumerate(rec):
            if is_spanish(l):
                split_idx = i; break
        if split_idx is None or split_idx == 0:
            continue  # no English part or no Spanish part
        en_part = " ".join(rec[:split_idx]).strip()
        es_part = " ".join(rec[split_idx:]).strip()
        # Clean soft ellipses
        en_part = re.sub(r"\s+", " ", en_part)
        es_part = re.sub(r"\s+", " ", es_part)
        # Skip junk
        if len(en_part) < 1 or len(es_part) < 1: continue
        if len(en_part) > 200 or len(es_part) > 200: continue
        key = (en_part.lower(), es_part.lower())
        if key in seen: continue
        seen.add(key)
        pairs.append({"en": en_part, "es": es_part})

print(f"Extracted {len(pairs)} pairs", file=sys.stderr)
with open("collins_pairs.json", "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)

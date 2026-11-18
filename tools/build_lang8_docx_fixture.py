#!/usr/bin/env python3
"""
Extract the eight uploaded questionnaire masters into one JSON fixture.

Source of truth: Translation-8-languages/*.docx plus the English master
Revised_questionnaire Sept14.docx. Nothing is paraphrased: every string is
copied verbatim, except that bracketed routing/reviewer notes are dropped
([...]) as requested, and bullet glyphs are removed.

Two document layouts are supported, both produced by the same template:
  * inline : `ID_C_1_4_a : prompt text` on one paragraph, options after it
  * bare   : `ID_C_1_4_a` alone on its paragraph, prompt on the next one

Section E is special: ID_E_2 carries three things in one bucket -- the
recommend question, the gift-card question and the definitions appendix. The
appendix starts at the definitions heading; everything after it is keyed
separately so the app can use it for tooltips.

Output: tests/fixtures/lang8-docx.json
  {
    "home":  [ ...ordered homepage/letter/consent lines... ],
    "q":     { "ID_A_01": "prompt", ... },
    "o":     { "ID_A_01": ["option", ...], ... },
    "defs":  { "english term": "translated definition", ... },   # appendix
    "defs_lines": [ ...verbatim appendix lines... ]
  }
keyed by language code, with "_en" for the English master.

Run: python tools/build_lang8_docx_fixture.py
"""
import glob
import io
import json
import os
import re

import docx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Translation-8-languages")
EN_DOC = os.path.join(ROOT, "Revised_questionnaire Sept14.docx")
OUT = os.path.join(ROOT, "tests", "fixtures", "lang8-docx.json")

CODES = {
    "Arabic": "ar", "French": "fr", "Hindi": "hi", "Italian": "it",
    "Mandarin": "zh", "Portuguese": "pt", "Spanish": "es", "Tagalog": "tl",
}

# A bracketed note is not wording. A markdown link, [label](url), IS wording:
# the consent question carries the two document links that way.
NOTE = re.compile(r"\[[^\]\n]*\](?!\()")
BULLET = re.compile(r"^[•\u2022\u25aa\u25cf\-\u2013\u2014\*\t\s]+")
INLINE_ID = re.compile(r"^(ID_[A-Za-z0-9_]+)\s*[:：]\s*(.*)$")
BARE_ID = re.compile(r"^(ID_[A-Za-z0-9_]+)$")

# Where the definitions/tooltips appendix begins inside ID_E_2. The heading is
# translated, so match the English master's own heading text through the
# per-language variant list instead of guessing.
DEFS_HEADINGS = (
    "definitions", "definiciones", "définitions", "definições", "definizioni",
    "تعريفات", "التعريفات والنصوص التوضيحية", "परिभाषाएँ", "परिभाषा", "定义",
    "mga kahulugan", "kahulugan",
)


def clean(line: str) -> str:
    """Drop routing notes and bullet glyphs, keep the wording exactly."""
    s = NOTE.sub("", line)
    s = BULLET.sub("", s)
    return re.sub(r"[ \t]+", " ", s).strip()


def paragraphs(path):
    for p in docx.Document(path).paragraphs:
        t = p.text.strip()
        if t:
            yield t


def is_defs_heading(line: str) -> bool:
    low = line.strip().lower()
    return any(low.startswith(h) for h in DEFS_HEADINGS)


def parse(path):
    """Return (home_lines, buckets) for one document.

    buckets is an ordered list of [label, prompt, [options...]] so the E_2
    split can be done afterwards without losing order.
    """
    home = []
    buckets = []
    cur = None
    started = False

    for raw in paragraphs(path):
        line = clean(raw)
        if not line:
            continue
        m_in = INLINE_ID.match(line)
        m_bare = BARE_ID.match(line)
        if m_in:
            started = True
            cur = [m_in.group(1), m_in.group(2).strip(), []]
            buckets.append(cur)
            continue
        if m_bare:
            started = True
            cur = [m_bare.group(1), None, []]
            buckets.append(cur)
            continue
        if not started:
            home.append(line)
            continue
        if cur is None:
            continue
        if cur[1] is None:            # bare layout: this line is the prompt
            cur[1] = line
        else:
            cur[2].append(line)

    return home, buckets


def split_e2(buckets):
    """Split the ID_E_2 bucket into recommend / gift card / definitions."""
    out = []
    for label, prompt, opts in buckets:
        if label != "ID_E_2":
            out.append([label, prompt, opts])
            continue
        # find the definitions heading
        head = next((i for i, o in enumerate(opts) if is_defs_heading(o)), None)
        body = opts if head is None else opts[:head]
        appendix = [] if head is None else opts[head + 1:]

        # body: recommend question (prompt + 3 options), then the gift-card
        # block whose prompt is the line ending in '?' or naming the draw.
        split = None
        for i, o in enumerate(body):
            if i and re.search(r"[?？؟]", o):
                split = i
                break
        if split is None:
            out.append([label, prompt, body])
        else:
            out.append(["ID_E_2", prompt, body[:split]])
            out.append(["ID_E_2_GIFT", body[split], body[split + 1:]])
        out.append(["ID_E_2_DEFS", None, appendix])
    return out


def build():
    fixture = {}
    sources = [(EN_DOC, "_en")] + [
        (p, CODES[os.path.basename(p).split("_")[0]])
        for p in sorted(glob.glob(os.path.join(SRC, "*.docx")))
    ]
    for path, code in sources:
        home, buckets = parse(path)
        buckets = split_e2(buckets)
        q, o, defs, defs_lines = {}, {}, {}, []
        for label, prompt, opts in buckets:
            if label == "ID_E_2_DEFS":
                defs_lines = opts
                continue
            if prompt:
                q[label] = prompt
            if opts:
                o[label] = opts
        fixture[code] = {"home": home, "q": q, "o": o,
                         "defs_lines": defs_lines,
                         "labels": [b[0] for b in buckets]}
    return fixture


def main():
    fx = build()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(fx, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    for code in sorted(fx):
        d = fx[code]
        print(f"{code:<4} home={len(d['home']):>3} q={len(d['q']):>3} "
              f"o={len(d['o']):>3} defs={len(d['defs_lines']):>3}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""Build a per-language fixture from the reviewed questionnaire documents.

Reads Translation-Final.zip in place (nothing is extracted to disk) and writes
tests/fixtures/lang-docx.json: for each app language, the reviewed wording of
the question prompts and option labels that the shipped dictionaries were
missing.

Why this exists
  The Bengali build (tools/build_bn_docx_fixture.py) covered one language. The
  other thirteen languages were built from an earlier pass and never received
  twelve question prompts or the option lists of twenty-two questions, so a
  French, Arabic or Mandarin respondent saw those questions in English. This
  script reads the same reviewed documents for those languages and emits the
  missing wording, so nothing is invented.

How blocks pair
  * Both label layouts in the documents are handled: "ID_A_02: question text"
    and a label alone on its line with the question text on the next.
  * Option lines pair positionally between the English block and the target
    block, and only when both blocks have the same number of lines. A block
    that does not pair is refused and reported, never guessed at.
  * The unlabelled Section E keeps its English routing notes in every document,
    so it is located by the "[If Not sure, Probably not, or Definitely not]"
    line and read at fixed offsets that are first checked against English.

Run from the project root:  python tools/build_lang_docx_fixture.py
Requires Translation-Final.zip in the project root.
"""
import io
import json
import re
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ZIP = "Translation-Final.zip"
OUT = "tests/fixtures/lang-docx.json"

EN_PART = "1. English Questionnaire.docx"
# app language code -> the reviewed document for it
PARTS = {
    "ar": "4. Arabic Questionnaire.docx",
    "de": "17. German Questionnaire.docx",
    "es": "10. Spanish Questionnaire.docx",
    "fr": "3. French Questionnaire.docx",
    "gu": "5. Gujarati Questionnaire.docx",
    "hi": "6. Hindi Questionnaire.docx",
    "it": "7. Italian Questionnaire.docx",
    "pa": "9. Punjabi Questionnaire.docx",
    "pt": "15. Portuguese Questionnaire.docx",
    "ta": "12. Tamil Questionnaire.docx",
    "tl": "11. Tagalog Questionnaire.docx",
    "uk": "13. Ukrainian Questionnaire.docx",
    "ur": "14. Urdu Questionnaire.docx",
    "zh": "8. Mandarin Questionnaire.docx",
}
PREFIX = "Final Reviewed Versions/"


def part_name(fragment):
    """The archive stores every document under one folder."""
    return PREFIX + fragment

# A label with the question text on the same line, or a bare label.
LABEL_COLON = re.compile(r"^(ID_[A-E]_\d+(?:_[0-9a-z]+)*)\s*:\s*(.*)$")
LABEL_BARE = re.compile(r"^(ID_[A-E]_\d+(?:_[0-9a-z]+)*)\s*(\[[^\]]*\]\s*)*$")
APPENDIX = re.compile(r"^\s*Question\s+ID_")
NOTE_REVIEWERS = re.compile(r"^\[Note to reviewers", re.I)
# The leave-factors routing note keeps its English wording in every document.
E_NOTSURE = re.compile(r"\[\s*If\s+Not\s+sure", re.I)


def paragraphs(zf, part):
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(zf.read(part))).read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        t = "".join(n.text or "" for n in p.iter(W + "t"))
        if t.strip():
            out.append(t.strip())
    return out


def norm(s):
    s = s.replace("\u00a0", " ").replace("\u200b", "")
    for a, b in (("\u2013", "-"), ("\u2014", "-"), ("\u2019", "'"), ("\u2018", "'"),
                 ("\u201c", '"'), ("\u201d", '"'), ("\u2265", ">=")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()


def body_stop(lines):
    for i, line in enumerate(lines):
        if APPENDIX.match(line):
            return i
    return len(lines)


def labelled_blocks(lines):
    """label -> (index of prompt line, prompt text, option lines)."""
    stop = body_stop(lines)
    out = {}
    i = 0
    while i < stop:
        line = lines[i]
        m = LABEL_COLON.match(line) or LABEL_BARE.match(line)
        if not m:
            i += 1
            continue
        label = m.group(1)
        if label in out:  # first wording wins, as in the questionnaire body
            i += 1
            continue
        text = m.group(2).strip() if m.re is LABEL_COLON else ""
        start = i
        if not text or re.fullmatch(r"(\[[^\]]*\]\s*)+", text):
            if i + 1 < stop:
                text = lines[i + 1]
                start = i + 1
        opts = []
        j = start + 1
        while j < stop:
            nxt = LABEL_COLON.match(lines[j]) or LABEL_BARE.match(lines[j])
            if nxt:
                break
            if not NOTE_REVIEWERS.match(lines[j]):
                opts.append(lines[j])
            j += 1
        out[label] = (start, text, opts)
        i = start + 1
    return out


def pair(store, problems, where, en_opts, tr_opts):
    """Pair option lines positionally; refuse rather than guess."""
    if len(en_opts) != len(tr_opts):
        problems.append(f"{where}: {len(en_opts)} English lines vs {len(tr_opts)} translated - not paired")
        return
    for en_o, tr_o in zip(en_opts, tr_opts):
        k = norm(en_o)
        if not k or not tr_o.strip():
            continue
        store.setdefault(k, tr_o.strip())


def section_e(lines, tag, problems):
    """The three retention questions, anchored on the English routing note.

    Some documents keep the routing note on its own line and put the question
    underneath it (Arabic, German, Urdu); others run the note into the question
    (English, French, and most of the rest). The offsets below start from the
    question line, so find that first.
    """
    hit = next((i for i, l in enumerate(lines) if E_NOTSURE.search(l)), None)
    if hit is None:
        problems.append(f"{tag}: no Section E routing note")
        return None
    inline = re.sub(r"^(\[[^\]]*\]\s*)+", "", lines[hit]).strip()
    base = hit if inline else hit + 1
    e = {"q1": lines[hit - 6], "q1_opts": lines[hit - 5:hit],
         "leave": lines[base], "leave_opts": lines[base + 1:base + 18],
         "specify": lines[base + 18], "q3": lines[base + 19], "q3_opts": lines[base + 20:base + 23]}
    # A bracket line or the specify line in the wrong place means the offsets
    # do not fit this document; refuse rather than write a wrong question.
    if re.fullmatch(r"(\[[^\]]*\]\s*)+", e["leave"].strip()) or "[" in e["q1"] or "[" in e["q3"]:
        problems.append(f"{tag}: Section E offsets do not fit")
        return None
    return e


def main():
    z = zipfile.ZipFile(ZIP)
    en_lines = paragraphs(z, part_name(EN_PART))
    en_seg = labelled_blocks(en_lines)
    en_e = section_e(en_lines, "English", [])
    out, report = {}, {}
    problems_all = []

    for code, part in PARTS.items():
        problems = []
        lines = paragraphs(z, part_name(part))
        seg = labelled_blocks(lines)

        q, o = {}, {}
        for label, (_, en_text, en_opts) in en_seg.items():
            t = seg.get(label)
            if not t:
                problems.append(f"{label}: missing from this document")
                continue
            q[label] = t[1]
            pair(o, problems, label, en_opts, t[2])

        e = section_e(lines, code, problems)
        if e and en_e:
            # checked shapes: 5 / 17 / 3 option lines
            if (len(e["q1_opts"]), len(e["leave_opts"]), len(e["q3_opts"])) == \
               (len(en_e["q1_opts"]), len(en_e["leave_opts"]), len(en_e["q3_opts"])):
                q["ID_E_1"] = e["q1"]
                q["ID_E_2"] = e["leave"]
                q["ID_E_3"] = e["q3"]
                q["please_specify_e"] = e["specify"]
                pair(o, problems, "Section E q1", en_e["q1_opts"], e["q1_opts"])
                pair(o, problems, "Section E leave", en_e["leave_opts"], e["leave_opts"])
                pair(o, problems, "Section E q3", en_e["q3_opts"], e["q3_opts"])
            else:
                problems.append("Section E: option counts differ - not paired")

        out[code] = {"q": q, "o": o}
        report[code] = (len(q), len(o), len(problems))
        problems_all += [f"{code}: {p}" for p in problems]

    # English reference, so the applier can prove each label really is the
    # question it thinks it is before anything is written.
    out["_en"] = {
        "q": {label: t[1] for label, t in en_seg.items()},
        "o": {norm(t): t for t in (l for s in en_seg.values() for l in s[2])},
    }
    if en_e:
        out["_en"]["q"]["ID_E_1"] = en_e["q1"]
        out["_en"]["q"]["ID_E_2"] = en_e["leave"]
        out["_en"]["q"]["ID_E_3"] = en_e["q3"]
        out["_en"]["q"]["please_specify_e"] = en_e["specify"]
        for line in en_e["q1_opts"] + en_e["leave_opts"] + en_e["q3_opts"]:
            out["_en"]["o"][norm(line)] = line

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)

    print(f"wrote {OUT}")
    print("code  prompts  options  refusals")
    for code, (nq, no, npb) in sorted(report.items()):
        print(f"{code:5} {nq:7} {no:8} {npb:9}")
    if problems_all:
        print(f"\n{len(problems_all)} notes:")
        for p in problems_all[:40]:
            print("  " + p)
        if len(problems_all) > 40:
            print(f"  ... {len(problems_all) - 40} more")


if __name__ == "__main__":
    main()

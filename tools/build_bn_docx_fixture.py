#!/usr/bin/env python
"""Build the Bengali parity fixture from the uploaded questionnaire docx.

Reads Translation-Final.zip in place (nothing is extracted to disk) and writes
tests/fixtures/bn-docx.json: the Bengali text exactly as that document has it,
keyed by the app's question ids and by the app's English option values.

How the pairing works
  * Each document is read paragraph by paragraph. Question blocks start at an
    `ID_x_nn:` label (the questionnaire body) or at a known anchor for the
    unlabelled blocks (consent, eligibility, Section E, prize draw, picklist).
  * Option lines pair positionally inside a block, and only when the English and
    Bangla block have the same number of lines - a block that does not pair is
    refused rather than guessed at.
  * Because the same English option repeats across questions, all blocks feed one
    English -> Bangla map. Where the document itself words an option two ways the
    most common wording wins; ties and variants are printed.
  * ID_C_4_2_a ("[If Yes] Select all barriers that apply", student branch) is
    damaged in the uploaded document: 19 English options, 18 Bangla ones, and the
    Bangla is the C_2 barrier list pasted in. It is therefore never used as a
    source; barrier wording comes from the three aligned lists.

Run from the project root:  python tools/build_bn_docx_fixture.py
Requires Translation-Final.zip in the project root.
"""
import io
import json
import os
import re
import subprocess
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ZIP = "Translation-Final.zip"
EN_PART = "Final Reviewed Versions/1. English Questionnaire.docx"
BN_PART = "Final Reviewed Versions/2. সু নিউকামার সার্ভে ২০২৬.docx"
OUT = "tests/fixtures/bn-docx.json"

LABEL = re.compile(r"(ID_[A-E]_\d+(?:_[0-9a-z]+)*)\s*:\s*")
APPENDIX_MARK = re.compile(r"^\s*Question\s+ID_")
SKIP_SEGMENTS = {"ID_C_4_2_a"}  # damaged in the source document


def paragraphs(zf, part):
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(zf.read(part))).read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        t = "".join(n.text or "" for n in p.iter(W + "t"))
        if t.strip():
            out.append(t.strip())
    return out


def segments(lines):
    """Question blocks of the questionnaire body, keyed by label, first wins."""
    stop = len(lines)
    for i, line in enumerate(lines):
        if APPENDIX_MARK.match(line):
            stop = i
            break
    segs, cur = {}, None
    for i in range(stop):
        m = LABEL.search(lines[i])
        if m:
            cur = {"label": m.group(1), "text": lines[i][m.end():].strip(), "options": []}
            segs.setdefault(m.group(1), cur)
        elif cur is not None:
            cur["options"].append(lines[i])
    return segs


def norm(s):
    """Matching key only: the stored Bangla is never normalised."""
    s = s.replace("\u00a0", " ").replace("\u200b", "")
    for a, b in (("\u2013", "-"), ("\u2014", "-"), ("\u2019", "'"), ("\u2018", "'"),
                 ("\u201c", '"'), ("\u201d", '"'), ("\u2265", ">=")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip().lower()


def add_block(store, variants, en_opts, bn_opts, where, problems):
    if len(en_opts) != len(bn_opts):
        problems.append(f"{where}: {len(en_opts)} English lines vs {len(bn_opts)} Bangla - not paired")
        return
    for en_o, bn_o in zip(en_opts, bn_opts):
        k = norm(en_o)
        if not k or not bn_o.strip():
            continue
        variants.setdefault(k, []).append(bn_o.strip())


def resolve_variants(store, variants, problems):
    """Most common wording wins; ties keep the first block's wording."""
    for key, seen in variants.items():
        counts = {}
        for v in seen:
            counts[v] = counts.get(v, 0) + 1
        best = max(counts.values())
        winner = next(v for v in seen if counts[v] == best)
        store[key] = winner
        if len(counts) > 1:
            problems.append(
                f"document words {key[:58]!r} {len(counts)} ways; using the wording "
                f"in {best} of {len(seen)} lists"
            )


def app_questions():
    js = """
const fs = require("fs");
const sb = { window: {}, document: { createElement: () => ({ style: {} }) } };
sb.window = sb;
new Function("window", "document", fs.readFileSync("survey-data.js", "utf8"))(sb, sb.document);
const Q = sb.SURVEY.QUESTIONS.map((q) => ({
  id: q.id,
  options: (q.options || []).map((o) => (typeof o === "string" ? o : o.value)),
}));
process.stdout.write(JSON.stringify(Q));
"""
    os.makedirs("_build", exist_ok=True)
    with open("_build/appq.js", "w", encoding="utf-8") as f:
        f.write(js)
    res = subprocess.run(["node", "_build/appq.js"], capture_output=True)
    return {q["id"]: q["options"] for q in json.loads(res.stdout.decode("utf-8"))}


# app question id -> questionnaire label. Written out so the pairing is
# reviewable; every entry was checked against the English wording.
MAP = {
    "moved_from": "ID_A_01", "province": "ID_A_01_a", "country_moved_from": "ID_A_01_b",
    "gender": "ID_A_02", "age_group": "ID_A_03", "immigration_category": "ID_A_04_a",
    "non_permanent_category": "ID_A_04_a_i", "permanent_category": "ID_A_04_b_i",
    "identity_groups": "ID_A_04_b", "reason": "ID_A_05",
    "recent_credential": "ID_B_01", "program_name": "ID_B_02", "program_name_other": "ID_B_02_a",
    "program_location": "ID_B_03", "highest_education": "ID_B_04", "highest_credential": "ID_B_04_a",
    "highest_program_name": "ID_B_04_b", "highest_program_name_other": "ID_B_04_b_1",
    "highest_completed_location": "ID_B_04_c", "current_program": "ID_B_05",
    "current_program_name": "ID_B_05_a", "current_program_name_other": "ID_B_05_a_1",
    "employed_before": "ID_C_01", "previous_job_title": "ID_C_01_a", "home_emp_before": "ID_C_01_b",
    "home_country_job": "ID_C_01_b_1", "employment_status": "ID_C_02",
    "current_job_title": "ID_C_1_1", "intended_job": "ID_C_1_2", "intended_job_title": "ID_C_1_2_a",
    "job_search_help": "ID_C_1_3", "work_barriers": "ID_C_1_4_a", "work_support": "ID_C_1_4_b",
    "skill_match": "ID_C_1_5", "work_confidence": "ID_C_1_6",
    "unemployed_intended_job": "ID_C_2_1", "unemployed_barrier_gate": "ID_C_2_2",
    "unemployment_reasons": "ID_C_2_2_a", "unemployed_support": "ID_C_2_2_b",
    "not_looking_reasons": "ID_C_3_1", "not_looking_expect_look": "ID_C_3_2",
    "not_looking_intended_job": "ID_C_3_2_a", "not_looking_barrier_gate": "ID_C_3_2_b",
    "not_looking_barriers": "ID_C_3_2_b_1", "not_looking_support": "ID_C_3_2_b_2",
    "student_working": "ID_C_4_1", "student_current_job": "ID_C_4_1_a",
    "student_job_relevant": "ID_C_4_1_b", "student_skill_match": "ID_C_4_1_c",
    "student_confidence": "ID_C_4_1_d", "student_job_help": "ID_C_4_1_e",
    "student_barrier_gate": "ID_C_4_2", "student_barriers": "ID_C_1_4_a",
    "student_support": "ID_C_4_2_b", "planned_intended_job": "ID_C_4_3",
    "skills": "ID_D_1",
}

# "Please specify" prompts all come from the document's own wording.
SPECIFY = ["non_permanent_other", "reason_other", "program_name_other", "highest_program_name_other",
           "current_program_name_other", "job_search_other", "work_barriers_other",
           "work_support_other", "unemployment_reasons_other", "unemployed_support_other",
           "not_looking_other", "not_looking_barriers_other", "not_looking_support_other",
           "student_job_help_other", "student_barriers_other", "student_support_other",
           "leave_factors_other"]


def main():
    z = zipfile.ZipFile(ZIP)
    en_lines = paragraphs(z, EN_PART)
    bn_lines = paragraphs(z, BN_PART)
    en_seg, bn_seg = segments(en_lines), segments(bn_lines)

    problems = []
    store, variants = {}, {}
    APP = app_questions()

    # 1. Every labelled block that pairs, except the damaged one.
    for label, e in en_seg.items():
        if label in SKIP_SEGMENTS:
            continue
        b = bn_seg.get(label)
        if not b:
            problems.append(f"label {label} missing from the Bangla document")
            continue
        add_block(None, variants, e["options"], b["options"], label, problems)

    # 2. The unlabelled blocks, by anchor. Section E and the prize draw have the
    #    same shape in both documents, so their lines pair.
    en_head = next(i for i, l in enumerate(en_lines) if l.startswith("Section E: Retention"))
    bn_head = next(i for i, l in enumerate(bn_lines) if l.startswith("বিভাগ ই"))
    e_block = en_lines[en_head:en_head + 30]
    b_block = bn_lines[bn_head:bn_head + 30]
    add_block(None, variants, e_block, b_block, "Section E", problems)
    en_prize = next(i for i, l in enumerate(en_lines) if l.strip() == "Prize Draw")
    bn_prize = next(i for i, l in enumerate(bn_lines) if l.strip() == "পুরস্কার ড্র")
    add_block(None, variants, en_lines[en_prize:en_prize + 6], bn_lines[bn_prize:bn_prize + 6],
              "Prize Draw", problems)

    # 3. Front matter: consent and eligibility, anchored by their wording.
    en_c = next(i for i, l in enumerate(en_lines) if l.startswith("After reading the Survey Information Letter"))
    bn_c = next(i for i, l in enumerate(bn_lines) if "ইনফরমেশন লেটার" in l and "পড়ার পর" in l)
    add_block(None, variants, en_lines[en_c:en_c + 3], bn_lines[bn_c:bn_c + 3], "Consent", problems)
    en_e = next(i for i, l in enumerate(en_lines) if l.startswith("Did you move to Sault Ste. Marie after November"))
    bn_e = next(i for i, l in enumerate(bn_lines) if "২০২১ সালের নভেম্বরের পর" in l)
    add_block(None, variants, en_lines[en_e:en_e + 3], bn_lines[bn_e:bn_e + 3], "Eligibility", problems)

    # 4. Country picklist ("Picklist 1"), same length in both documents.
    en_pk = next(i for i, l in enumerate(en_lines) if l.strip() == "Picklist 1")
    bn_pk = next(i for i, l in enumerate(bn_lines) if l.strip() == "পিকলিস্ট 1")
    add_block(None, variants, en_lines[en_pk + 1:], bn_lines[bn_pk + 1:], "Picklist 1", problems)

    resolve_variants(store, variants, problems)

    # Question text comes from the label's own block; option text from the map.
    out = {}

    def entry(text, options):
        return {"label": "", "text": text, "options": {k: store[k] for k in options if k in store and store[k]}}

    for app_id, label in MAP.items():
        b = bn_seg.get(label)
        if not b:
            problems.append(f"{app_id}: no Bangla block for {label}")
            continue
        got = entry(b["text"], [norm(v) for v in APP.get(app_id, [])])
        got["label"] = label
        out[app_id] = got

    out["consent"] = entry(bn_lines[bn_c], [norm(x) for x in en_lines[en_c + 1:en_c + 3]])
    out["eligible"] = entry(bn_lines[bn_e], [norm(x) for x in en_lines[en_e + 1:en_e + 3]])
    out["retain_5_years"] = entry(bn_lines[bn_head + 1], [norm(x) for x in en_lines[en_head + 2:en_head + 7]])
    out["leave_factors"] = entry(bn_lines[bn_head + 7], [norm(x) for x in en_lines[en_head + 8:en_head + 26]])
    out["recommend_survey"] = entry(bn_lines[bn_head + 26], [norm(x) for x in en_lines[en_head + 27:en_head + 30]])
    out["gift_card_draw"] = entry(
        bn_lines[bn_prize + 1],
        [norm(re.sub(r"^[12]\.\s*", "", x)) for x in en_lines[en_prize + 3:en_prize + 5]],
    )
    out["gift_card_draw"]["label"] = "Prize Draw"

    # The barrier gate question is dynamic: the app shows one of three wordings
    # chosen by branch (keys work_barrier.a/.b/.c). The document carries exactly
    # those three, as ID_C_1_4_i / _ii / _iii.
    for key, label in (("work_barrier.a", "ID_C_1_4_i"),
                       ("work_barrier.b", "ID_C_1_4_ii"),
                       ("work_barrier.c", "ID_C_1_4_iii")):
        b = bn_seg.get(label)
        if not b:
            problems.append(f"{key}: no Bangla block for {label}")
            continue
        out[key] = {"label": label, "text": b["text"], "options": {}}

    specify_key = norm("please specify")
    specify_bn = store.get(specify_key)
    if not specify_bn:
        problems.append("the document has no 'please specify' line")
    for app_id in SPECIFY:
        if app_id not in APP:
            continue
        out[app_id] = {"label": "Please specify", "text": specify_bn or "", "options": {}}
        if APP[app_id]:
            problems.append(f"{app_id}: expected a free-text field but it has options")

    app = APP
    missing = []
    for app_id in app:
        if app_id not in out:
            missing.append(f"{app_id}: not in the document")
            continue
        for v in app[app_id]:
            if norm(v) not in out[app_id]["options"]:
                missing.append(f"{app_id}: {v[:70]!r}")

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"source": f"{ZIP} :: {BN_PART}", "questions": out,
                   "options": store}, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")

    print(f"wrote {OUT}: {len(out)} questions, "
          f"{sum(len(v['options']) for v in out.values())} option translations")
    print(f"document problems: {len(problems)}")
    for p in problems:
        print("  !", p)
    print(f"app strings the document does not cover: {len(missing)}")
    for m in missing:
        print("  -", m)


if __name__ == "__main__":
    main()

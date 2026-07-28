# Generate pre-recorded TTS clips for question/option strings via edge-tts
# (free neural voices). Punjabi uses gTTS (Google, free); Kurdish has no free
# TTS and is skipped. Writes public/audio/<lang>/<bucket>_<safe>.mp3 + updates
# public/audio/manifest.json.
#   python _audio_gen.py <jobs.json> <out_root> <lang1,lang2|all>
import sys, os, json, re, hashlib, asyncio
import edge_tts

VOICE = {
    "en": "en-CA-ClaraNeural", "fr": "fr-CA-SylvieNeural", "es": "es-ES-ElviraNeural",
    "pt": "pt-BR-FranciscaNeural", "it": "it-IT-ElsaNeural", "de": "de-DE-KatjaNeural",
    "pl": "pl-PL-ZofiaNeural", "uk": "uk-UA-PolinaNeural", "fi": "fi-FI-NooraNeural",
    "tl": "fil-PH-BlessicaNeural", "hi": "hi-IN-SwaraNeural", "bn": "bn-BD-NabanitaNeural",
    "gu": "gu-IN-DhwaniNeural", "ta": "ta-IN-PallaviNeural", "ml": "ml-IN-SobhanaNeural",
    "zh": "zh-CN-XiaoxiaoNeural", "ar": "ar-SA-ZariyahNeural", "ur": "ur-PK-UzmaNeural",
}
GTTS_LANG = {"pa": "pa"}      # Punjabi via gTTS
NO_TTS = {"ku"}               # no free TTS available

jobs_path, out_root, want = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(jobs_path, encoding="utf-8"))
jobs = data["jobs"]
langs = set(VOICE) | set(GTTS_LANG) if want == "all" else set(want.split(","))

def safe(bucket, key):
    if bucket == "q":
        return "q_" + re.sub(r"[^a-zA-Z0-9]+", "_", key)
    return "o_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]

manifest_path = os.path.join(out_root, "manifest.json")
manifest = {}
if os.path.exists(manifest_path):
    manifest = json.load(open(manifest_path, encoding="utf-8"))

sem = asyncio.Semaphore(8)
made = {"ok": 0, "fail": 0, "bytes": 0}

async def one_edge(job):
    lang = job["lang"]
    d = os.path.join(out_root, lang)
    os.makedirs(d, exist_ok=True)
    fn = safe(job["bucket"], job["key"]) + ".mp3"
    fp = os.path.join(d, fn)
    rel = "audio/%s/%s" % (lang, fn)
    async with sem:
        try:
            c = edge_tts.Communicate(job["text"], VOICE[lang])
            await c.save(fp)
            sz = os.path.getsize(fp)
            if sz < 200:
                raise RuntimeError("tiny file")
            made["ok"] += 1; made["bytes"] += sz
            manifest.setdefault(lang, {})[job["bucket"] + "/" + job["key"]] = rel
        except Exception as e:
            made["fail"] += 1
            print("FAIL", lang, job["bucket"], job["key"][:30], repr(e)[:80])

def one_gtts(job):
    from gtts import gTTS
    lang = job["lang"]
    d = os.path.join(out_root, lang); os.makedirs(d, exist_ok=True)
    fn = safe(job["bucket"], job["key"]) + ".mp3"
    fp = os.path.join(d, fn); rel = "audio/%s/%s" % (lang, fn)
    try:
        gTTS(job["text"], lang=GTTS_LANG[lang]).save(fp)
        made["ok"] += 1; made["bytes"] += os.path.getsize(fp)
        manifest.setdefault(lang, {})[job["bucket"] + "/" + job["key"]] = rel
    except Exception as e:
        made["fail"] += 1; print("FAIL(gtts)", lang, job["key"][:30], repr(e)[:80])

async def main():
    edge_jobs = [j for j in jobs if j["lang"] in langs and j["lang"] in VOICE]
    gtts_jobs = [j for j in jobs if j["lang"] in langs and j["lang"] in GTTS_LANG]
    skipped = sorted({j["lang"] for j in jobs if j["lang"] in langs and j["lang"] in NO_TTS})
    print("edge jobs:", len(edge_jobs), "| gtts jobs:", len(gtts_jobs), "| no-tts langs:", skipped)
    # edge in batches
    B = 40
    for i in range(0, len(edge_jobs), B):
        await asyncio.gather(*(one_edge(j) for j in edge_jobs[i:i + B]))
        print("  ...%d/%d" % (min(i + B, len(edge_jobs)), len(edge_jobs)))
    for j in gtts_jobs:
        one_gtts(j)
    os.makedirs(out_root, exist_ok=True)
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False)
    mb = made["bytes"] / 1e6
    print("\nOK %d  FAIL %d  size %.1f MB  (%.1f KB avg)" %
          (made["ok"], made["fail"], mb, (made["bytes"] / max(made["ok"], 1)) / 1e3))

asyncio.run(main())

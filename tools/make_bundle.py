# -*- coding: utf-8 -*-
"""Builds Phils_Checks\\PhilsChecksPlugin\\Resources\\checks.zip, the checks the plugin carries.

    python Phils_Checks\\tools\\make_bundle.py

The list of checks is tools\\phils_installer\\catalog.json (the one Install_Phils_tools.exe
uses), so the plugin and the installer offer the same checks. The zip holds:

  index.txt     one line per check and language: id, lang, .cms file, help file ('' = none)
  manifest.txt  one line per file: lang/name, SHA-256
  en/, es/, fr/  the files of each language, flat, as in a cms folder, plus the shared
                  files their checks need (ptx_goto.py + ParatextGoTo.exe)

A check without a Spanish or French version is run from en/. Entries get a fixed date, so the zip
(and with it the plugin dll) only changes when a file changes. Run this before building the
plugin whenever a check changes.
"""
import hashlib
import io
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CATALOG = os.path.join(REPO, "tools", "phils_installer", "catalog.json")
OUT = os.path.join(os.path.dirname(HERE), "PhilsChecksPlugin", "Resources", "checks.zip")
LANGS = ("en", "es", "fr")

# project_checker only starts <projects>\cms\ProjectChecker.exe, so it cannot run from the
# plugin's own folder.
LEFT_OUT = {"project_checker"}


def main():
    catalog = json.load(io.open(CATALOG, encoding="utf-8"))
    files = {l: {} for l in LANGS}   # lang -> name -> bytes
    index = []

    def put(lang, path):
        full = os.path.join(REPO, path)
        if not os.path.isfile(full):
            raise SystemExit("Missing file: " + path)
        data = open(full, "rb").read()
        name = os.path.basename(path)
        old = files[lang].get(name)
        if old is not None and old != data:
            raise SystemExit("Two different files named %s in %s/" % (name, lang))
        files[lang][name] = data
        return name

    by_id = dict((c["id"], c) for c in catalog["cms"])
    for c in catalog["cms"]:
        if c["id"] in LEFT_OUT:
            continue
        for lang in LANGS:
            if lang not in c:
                continue
            paths = c[lang]
            if not paths[0].lower().endswith(".cms"):
                raise SystemExit("%s/%s: the first file must be the .cms" % (c["id"], lang))
            names = [put(lang, p) for p in paths]
            text = io.open(os.path.join(REPO, paths[0]), encoding="utf-8-sig").read()
            if not re.search(r"^\\check\s+\S", text, re.M):
                raise SystemExit("No \\check line in " + paths[0])
            helpfile = next((n for n in names if n.lower().endswith(".rtf")), "")
            index.append("\t".join([c["id"], lang, names[0], helpfile]))
            for need in c.get("needs", []):
                if need in catalog["shared"]:
                    for p in catalog["shared"][need]:
                        put(lang, p)
                elif need in by_id:
                    # A check that runs other checks (All Reports) finds them beside itself.
                    other = by_id[need]
                    for p in other.get(lang) or other["en"]:
                        put(lang, p)
                else:
                    raise SystemExit("%s needs unknown %s" % (c["id"], need))

    manifest = []
    for lang in LANGS:
        for name in sorted(files[lang], key=lambda s: s.lower()):
            manifest.append("%s/%s\t%s" % (lang, name, hashlib.sha256(files[lang][name]).hexdigest()))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    def entry(z, name, data):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)

    with zipfile.ZipFile(OUT, "w") as z:
        entry(z, "index.txt", ("\n".join(index) + "\n").encode("utf-8"))
        entry(z, "manifest.txt", ("\n".join(manifest) + "\n").encode("utf-8"))
        for lang in LANGS:
            for name in sorted(files[lang], key=lambda s: s.lower()):
                entry(z, "%s/%s" % (lang, name), files[lang][name])
    print("wrote %s (%d checks in %d languages, %d files, %d KB)" % (
        os.path.relpath(OUT, REPO), len(set(l.split("\t")[0] for l in index)), len(LANGS),
        len(manifest), os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()

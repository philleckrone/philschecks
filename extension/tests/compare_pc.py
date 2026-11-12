# -*- coding: utf-8 -*-
# Compares the extension's checks with Project Checker's (already diff-tested against the original
# CMS scripts): for each project and check it runs
#   ProjectChecker.exe --cli --project DIR --check ID --json A.json
#   "Paratext 10.exe" tests/run_ext.js DIR ID B.json            (ELECTRON_RUN_AS_NODE=1)
# and diffs the findings (book, chapter, verse, offsets, message, category, text, extra) and the
# report data. It must show 0 differences.
#     python tests/compare_pc.py [--checks shortv1,titles,nested] PROJECTDIR...
#     python tests/compare_pc.py --all "C:\My Paratext 8 Projects"
import argparse, json, os, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
PCEXE = os.path.join(REPO, 'Project_Checker', 'ProjectChecker', 'bin', 'Release', 'ProjectChecker.exe')
P10 = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'paratext-10-studio', 'Paratext 10.exe')
RUN_EXT = os.path.join(HERE, 'run_ext.js')
CHECKS = ['shortv1', 'titles', 'nested', 'refnomark', 'qerrors', 'footnotes']
FIELDS = ['book', 'bookCode', 'chapter', 'verse', 'begin', 'end', 'msg', 'category', 'text', 'inList', 'extra']


def run(cmd, env=None):
    p = subprocess.run(cmd, capture_output=True, env=env)
    if p.returncode != 0:
        raise RuntimeError('%s failed: %s' % (os.path.basename(cmd[0]), p.stderr.decode('utf-8', 'replace')[-2000:]))


def load(path):
    with open(path, encoding='utf-8-sig') as f:
        return json.load(f)


def compare(project, check, tmp):
    name = os.path.basename(project.rstrip('\\/'))
    a = os.path.join(tmp, '%s_%s_pc.json' % (name, check))
    b = os.path.join(tmp, '%s_%s_ext.json' % (name, check))
    try:
        run([PCEXE, '--cli', '--project', project, '--check', check, '--json', a])
        run([P10, RUN_EXT, project, check, b], dict(os.environ, ELECTRON_RUN_AS_NODE='1'))
    except RuntimeError as e:
        return ['%s %s: %s' % (name, check, e)], 0
    x, y = load(a), load(b)
    diffs = []
    fx, fy = x['findings'], y['findings']
    if len(fx) != len(fy):
        diffs.append('%s %s: %d findings in Project Checker, %d in the extension' % (name, check, len(fx), len(fy)))
    for i, (p, q) in enumerate(zip(fx, fy)):
        for k in FIELDS:
            if p.get(k) != q.get(k):
                diffs.append('%s %s #%d %s %s:%s: %s: %r != %r' % (name, check, i, p.get('bookCode'), p.get('chapter'),
                                                                p.get('verse'), k, p.get(k), q.get(k)))
                break
        if len(diffs) > 20:
            break
    if x.get('report') != y.get('report'):
        rx, ry = x.get('report') or {}, y.get('report') or {}
        keys = sorted(set(rx) | set(ry))
        for k in keys:
            if rx.get(k) != ry.get(k):
                va, vb = rx.get(k), ry.get(k)
                if isinstance(va, list) and isinstance(vb, list):
                    for j, (r1, r2) in enumerate(zip(va, vb)):
                        if r1 != r2:
                            diffs.append('%s %s report %s[%d]: %r != %r' % (name, check, k, j, r1, r2))
                            break
                    else:
                        diffs.append('%s %s report %s: %d rows != %d' % (name, check, k, len(va), len(vb)))
                else:
                    diffs.append('%s %s report %s: %r != %r' % (name, check, k, va, vb))
    return diffs, len(fx)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all')
    ap.add_argument('--checks', default=','.join(CHECKS))
    ap.add_argument('projects', nargs='*')
    a = ap.parse_args()
    projects = list(a.projects)
    if a.all:
        for n in sorted(os.listdir(a.all)):
            d = os.path.join(a.all, n)
            if os.path.isfile(os.path.join(d, 'Settings.xml')):
                projects.append(d)
    checks = a.checks.split(',')
    jobs = [(p, c) for p in projects for c in checks]
    tmp = tempfile.mkdtemp(prefix='pc_compare_')
    total_diffs = 0
    findings = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for diffs, n in ex.map(lambda j: compare(j[0], j[1], tmp), jobs):
            findings += n
            for d in diffs:
                print(d)
            total_diffs += len(diffs)
    print('%d project(s) x %d check(s), %d findings: %d difference(s)' % (len(projects), len(checks), findings, total_diffs))
    sys.exit(1 if total_diffs else 0)


if __name__ == '__main__':
    main()

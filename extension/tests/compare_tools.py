# -*- coding: utf-8 -*-
# Compares the built-in tools' JavaScript cores with the P9 plugins' C# test hosts.
#   python tests/compare_tools.py nm  PROJECT... | --all DIR
#   python tests/compare_tools.py nbt PROJECT... | --all DIR
# nm:  "scan" output line by line; then on a scratch copy each "convert ... All" (the C# test host
#      with rights ALL) against the JS convert: the CHANGE/TOTAL lines and every book file byte
#      for byte.
# nbt: (see compare_nbt in this file) on copies WITHOUT BookNames.xml, as in Paratext 10.
# Only book files are copied: *.SFM whose name holds its \id code (as the test hosts read them),
# plus Settings.xml. Must show 0 differences.
import argparse, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(EXT))
P10 = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'paratext-10-studio', 'Paratext 10.exe')
RUN_TOOL = os.path.join(HERE, 'run_tool.js')
HOSTS = {
    'nm': os.path.join(REPO, 'Numbered_Markers', 'tests', 'TestHost', 'bin', 'Release', 'NumberedMarkersTestHost.exe'),
    'nbt': os.path.join(REPO, 'Numbered_Book_Titles', 'tests', 'TestHost', 'bin', 'Release', 'NumberedBookTitlesTestHost.exe'),
}


def run(cmd, env=None):
    p = subprocess.run(cmd, capture_output=True, env=env)
    out = p.stdout.decode('utf-8', 'replace').replace('\r\n', '\n')
    if p.returncode != 0:
        raise RuntimeError('%s exited %d: %s' % (os.path.basename(cmd[0]), p.returncode,
                                                 (p.stderr.decode('utf-8', 'replace') or out)[-1500:]))
    return out


def js(*args):
    return run([P10, RUN_TOOL] + list(args), dict(os.environ, ELECTRON_RUN_AS_NODE='1'))


def copy_project(src, dst, booknames=True):
    os.makedirs(dst)
    for name in os.listdir(src):
        full = os.path.join(src, name)
        if not os.path.isfile(full):
            continue
        low = name.lower()
        if low.endswith('.bak'):
            continue
        if low == 'settings.xml' or (booknames and low == 'booknames.xml') or is_book(full):
            shutil.copy2(full, os.path.join(dst, name))


def is_book(path):
    """A file whose text starts with \\id (what both test hosts look for), whatever its name."""
    with open(path, 'rb') as f:
        head = f.read(8)
    return head.startswith(b'\\id') or head.startswith(b'\xef\xbb\xbf\\id')


def books_of(folder):
    out = {}
    for name in os.listdir(folder):
        full = os.path.join(folder, name)
        if os.path.isfile(full) and name.lower() != 'settings.xml':
            with open(full, 'rb') as f:
                out[name] = f.read()
    return out


def diff_lines(label, a, b, limit=8):
    if a == b:
        return []
    la, lb = a.splitlines(), b.splitlines()
    out = []
    for i in range(max(len(la), len(lb))):
        x = la[i] if i < len(la) else '<none>'
        y = lb[i] if i < len(lb) else '<none>'
        if x != y:
            out.append('%s line %d:\n   C#: %s\n   JS: %s' % (label, i + 1, x[:300], y[:300]))
            if len(out) >= limit:
                break
    return out or ['%s: differ (line endings?)' % label]


def compare_nm(project, tmp):
    name = os.path.basename(project.rstrip('\\/'))
    diffs = diff_lines(name + ' scan', run([HOSTS['nm'], 'scan', project]), js('nm', 'scan', project))
    a = os.path.join(tmp, name + '_cs')
    b = os.path.join(tmp, name + '_js')
    copy_project(project, a)
    copy_project(project, b)
    out_a = run([HOSTS['nm'], 'convert', a, 'All', 'ALL', os.path.join(tmp, name + '_bak')])
    out_a = '\n'.join(l for l in out_a.splitlines() if l.startswith(('CHANGE', 'TOTAL'))) + '\n'
    diffs += diff_lines(name + ' convert', out_a, js('nm', 'convert', b, 'All'))
    fa, fb = books_of(a), books_of(b)
    for f in sorted(fa):
        if fa[f] != fb.get(f):
            # Numbered Markers' C# test host always reads UTF-8, and .NET and JavaScript replace
            # invalid bytes differently: a book that is not UTF-8 cannot be compared byte for byte
            # (in Paratext 10, Paratext decodes the text itself). The counts are still compared.
            with open(os.path.join(project, f), 'rb') as fh:
                original = fh.read()
            try:
                original.decode('utf-8')
            except UnicodeDecodeError:
                print('%s convert: %s is not UTF-8; file not compared (counts were)' % (name, f))
                continue
            diffs.append('%s convert: %s differs after converting' % (name, f))
    shutil.rmtree(a, ignore_errors=True)
    shutil.rmtree(b, ignore_errors=True)
    return diffs


def compare_nbt(project, tmp):
    """Twice: without BookNames.xml (Paratext 10 without a chosen folder), then with it (a chosen folder)."""
    return compare_nbt_once(project, tmp, False) + compare_nbt_once(project, tmp, True)


def compare_nbt_once(project, tmp, booknames):
    name = os.path.basename(project.rstrip('\\/')) + ('+booknames' if booknames else '')
    a = os.path.join(tmp, name + '_cs')
    b = os.path.join(tmp, name + '_js')
    copy_project(project, a, booknames=booknames)
    copy_project(project, b, booknames=booknames)
    diffs = []
    for mode in ('scan', 'suggest'):
        diffs += diff_lines('%s %s' % (name, mode), run([HOSTS['nbt'], mode, a]), js('nbt', mode, b))
    out_a = run([HOSTS['nbt'], 'fix', a, 'ALL', os.path.join(tmp, name + '_bak')])
    drop = ('STOPPED', 'NOPERMISSION', 'BUSY', 'FAILED', 'HISTORY', 'WRITES', 'BACKUPS')
    out_a = '\n'.join(l for l in out_a.splitlines() if not l.startswith(drop)) + '\n'
    diffs += diff_lines(name + ' fix', out_a, js('nbt', 'fix', b))
    fa, fb = books_of(a), books_of(b)
    for f in sorted(fa):
        if fa[f] != fb.get(f):
            diffs.append('%s fix: %s differs after fixing' % (name, f))
    shutil.rmtree(a, ignore_errors=True)
    shutil.rmtree(b, ignore_errors=True)
    return diffs


HOSTS['ps'] = os.path.join(REPO, 'Project_Settings', 'tests', 'TestHost', 'bin', 'Release', 'ProjectSettingsTestHost.exe')
META_RE = re.compile(r'^<p class="meta">[^\n]*<code>[^\n]*$', re.M)   # file path and date
WARN_RE = re.compile(r' <span class="warn">[^<]*</span>')            # "font not installed" (C# only)


def normalize_ps(html):
    return WARN_RE.sub('', META_RE.sub('<p class="meta">(file and date)', html.replace('\r\n', '\n')))


def compare_ps(project, tmp):
    name = os.path.basename(project.rstrip('\\/'))
    empty_cms = os.path.join(tmp, 'emptycms')
    os.makedirs(empty_cms, exist_ok=True)
    diffs = []
    for lang in ('en', 'es', 'fr'):
        a = os.path.join(tmp, '%s_%s_cs.html' % (name, lang))
        b = os.path.join(tmp, '%s_%s_js.html' % (name, lang))
        run([HOSTS['ps'], 'report', project, a, lang, empty_cms])
        js('ps', 'report', project, lang, b)
        with open(a, encoding='utf-8') as f:
            x = normalize_ps(f.read())
        with open(b, encoding='utf-8') as f:
            y = normalize_ps(f.read())
        diffs += diff_lines('%s report %s' % (name, lang), x, y, limit=4)
    return diffs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('tool', choices=['nm', 'nbt', 'ps'])
    ap.add_argument('--all')
    ap.add_argument('projects', nargs='*')
    a = ap.parse_args()
    projects = list(a.projects)
    if a.all:
        for n in sorted(os.listdir(a.all)):
            d = os.path.join(a.all, n)
            if os.path.isfile(os.path.join(d, 'Settings.xml')):
                projects.append(d)
    tmp = tempfile.mkdtemp(prefix='tools_compare_')
    fn = {'nm': compare_nm, 'nbt': compare_nbt, 'ps': compare_ps}[a.tool]
    total = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        for p, diffs in zip(projects, ex.map(lambda p: _safe(fn, p, tmp), projects)):
            for d in diffs:
                print(d)
            total += len(diffs)
    shutil.rmtree(tmp, ignore_errors=True)
    print('%s: %d project(s), %d difference(s)' % (a.tool, len(projects), total))
    sys.exit(1 if total else 0)


def _safe(fn, p, tmp):
    try:
        return fn(p, tmp)
    except Exception as e:
        return ['%s: %s' % (os.path.basename(p), e)]


if __name__ == '__main__':
    main()

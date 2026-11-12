# -*- coding: utf-8 -*-
# Builds the Phils Custom (cms) Checks extension for Paratext 10.
#     python tools/build.py
# Writes dist/philsChecks/ (the extension folder: manifest.json, package.json, src/main.js,
# contributions/, assets/) and release/philsChecks_<version>.zip (the same files at the zip root).
#
# Extensions may only require papi modules (no relative files, no fs, no eval), so src/main.js is
# one file: the files of src/order.json (the checks), then the web view HTML, the built-in usfm.sty and the version as string
# constants, then src/main.js. The result is syntax-checked with Paratext 10's own Node.
import json, os, shutil, subprocess, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'src')
DIST = os.path.join(ROOT, 'dist', 'philsChecks')
RELEASE = os.path.join(ROOT, 'release')
USFM_STY = os.path.join(ROOT, '..', '..', 'Project_Checker', 'ProjectChecker', 'Resources', 'usfm.sty')
P10 = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'paratext-10-studio', 'Paratext 10.exe')
# Marker Spaces (Marker_Spaces/extension) is built in too: its scanner (core.js), window and backend
# come from there, so they stay one source; its backend is wrapped in its own scope (MarkerSpaces).
MS = os.path.join(ROOT, '..', '..', 'Marker_Spaces', 'extension')
MS_USFM_STY = os.path.join(MS, '..', 'MarkerSpacesPlugin', 'Resources', 'usfm.sty')
COPY = ['manifest.json', 'package.json', 'contributions', 'assets']


def read(path):
    with open(path, encoding='utf-8-sig') as f:
        return f.read()


def js_string(text):
    # JSON is a valid JavaScript string literal; keep it ASCII so no encoding can damage it.
    return json.dumps(text, ensure_ascii=True)


def marker_spaces():
    ms_main = read(os.path.join(MS, 'src', 'main.js'))
    tail = 'exports.activate = activate;\nexports.deactivate = deactivate;'
    if tail not in ms_main:
        sys.exit('Marker Spaces main.js no longer ends with its exports')
    ms_main = ms_main.replace(tail, 'return { activate, deactivate, openWindow };')
    ms_version = json.loads(read(os.path.join(MS, 'manifest.json')))['version']
    return [
        read(os.path.join(MS, 'src', 'core.js')),
        'const MS_VERSION = %s;' % js_string(ms_version),
        'const MS_WEB_VIEW_HTML = %s;' % js_string(read(os.path.join(MS, 'src', 'marker-spaces.web-view.html'))),
        'const MS_USFM_STY = %s;' % js_string(read(MS_USFM_STY)),
        '// Marker Spaces backend (Marker_Spaces/extension/src/main.js), in its own scope.',
        'const MarkerSpaces = (function () {',
        ms_main,
        '})();',
    ]


# Built-in tools (src/tools/<folder>): core.js (Paratext-free), strings.json (tools/
# extract_cs_strings.py), window.html (with /*COMMON_CSS*/ and /*COMMON_JS*/ from
# src/tools/window-common.html) and backend.js, wrapped in its own scope as const <name>.
TOOLS = [
    # (folder, prefix of its constants, name of its backend)
    ('numbered-markers', 'NM', 'NumberedMarkers'),
    ('numbered-book-titles', 'NBT', 'NumberedBookTitles'),
    ('project-settings', 'PS', 'ProjectSettings'),
    ('autocorrect', 'AC', 'AutoCorrect'),
]
# Tools whose window runs the core itself (/*TOOL_CORE*/ in window.html): the core, then this
# call with the tool's data (a JSON string of the file named).
WINDOW_CORE = {
    'autocorrect': ('ACCore.init(%s);', os.path.join('AutoCorrect', 'AutoCorrectEditor', 'Services', 'UnicodeBlockService.cs')),
}
# Data files a tool's backend reads, embedded as string constants (name, path from the repo).
TOOL_DATA = {
    'project-settings': [
        ('PS_SETTINGS_TXT', os.path.join('Project_Settings', 'ProjectSettingsPlugin', 'Resources', 'settings.txt')),
        ('PS_USFM_STY', os.path.join('Project_Settings', 'ProjectSettingsPlugin', 'Resources', 'usfm.sty')),
    ],
}


def common_parts():
    html = read(os.path.join(SRC, 'tools', 'window-common.html'))
    css = html.split('<style>', 1)[1].split('</style>', 1)[0]
    js = html.split('<script>', 1)[1].split('</script>', 1)[0]
    return css, js


def tool_window(folder):
    css, js = common_parts()
    html = read(os.path.join(SRC, 'tools', folder, 'window.html'))
    for marker in ('/*COMMON_CSS*/', '/*COMMON_JS*/'):
        if marker not in html:
            sys.exit('%s/window.html has no %s' % (folder, marker))
    html = html.replace('/*COMMON_CSS*/', css).replace('/*COMMON_JS*/', js)
    if folder in WINDOW_CORE:
        call, rel = WINDOW_CORE[folder]
        core = read(os.path.join(SRC, 'tools', folder, 'core.js'))
        data = js_string(read(os.path.join(ROOT, '..', '..', rel)))
        if '/*TOOL_CORE*/' not in html:
            sys.exit('%s/window.html has no /*TOOL_CORE*/' % folder)
        html = html.replace('/*TOOL_CORE*/', core + '\n' + call % data)
    return html


def tools():
    parts = [read(os.path.join(SRC, 'tools', 'shared.js'))]
    for folder, prefix, name in TOOLS:
        d = os.path.join(SRC, 'tools', folder)
        parts += [
            read(os.path.join(d, 'core.js')),
            'const %s_STRINGS = %s;' % (prefix, json.dumps(json.loads(read(os.path.join(d, 'strings.json'))), ensure_ascii=True)),
            'const %s_WINDOW_HTML = %s;' % (prefix, js_string(tool_window(folder))),
        ] + ['const %s = %s;' % (const, js_string(read(os.path.join(ROOT, '..', '..', rel)))) for const, rel in TOOL_DATA.get(folder, [])] + [
            '// %s backend (src/tools/%s/backend.js), in its own scope.' % (name, folder),
            'const %s = (function () {' % name,
            read(os.path.join(d, 'backend.js')),
            '})();',
        ]
    return parts


def all_scripts(html):
    """Every <script> of a window, joined (they share one global scope)."""
    out = []
    rest = html
    while '<script>' in rest:
        rest = rest.split('<script>', 1)[1]
        out.append(rest.split('</script>', 1)[0])
        rest = rest.split('</script>', 1)[1]
    return '\n;\n'.join(out)


def main():
    manifest = json.loads(read(os.path.join(ROOT, 'manifest.json')))
    version = manifest['version']
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, 'src'))
    for name in COPY:
        src = os.path.join(ROOT, name)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, name))
        else:
            shutil.copy2(src, os.path.join(DIST, name))

    main_js = '\n'.join([
        '// Phils Custom (cms) Checks %s for Paratext 10. Built by tools/build.py from src/ - do not edit.' % version,
        "'use strict';",
    ] + [read(os.path.join(SRC, f)) for f in json.loads(read(os.path.join(SRC, 'order.json')))] + [
        'const PCX_VERSION = %s;' % js_string(version),
        'const PCX_WEB_VIEW_HTML = %s;' % js_string(read(os.path.join(SRC, 'phils-checks.web-view.html'))),
        'const PCX_USFM_STY = %s;' % js_string(read(USFM_STY)),
    ] + marker_spaces() + tools() + [
        read(os.path.join(SRC, 'main.js')),
    ])
    out = os.path.join(DIST, 'src', 'main.js')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(main_js)

    if os.path.exists(P10):
        env = dict(os.environ, ELECTRON_RUN_AS_NODE='1')
        p = subprocess.run([P10, '--check', out], capture_output=True, env=env)
        if p.returncode != 0:
            sys.stderr.write(p.stderr.decode('utf-8', 'replace'))
            sys.exit('main.js has a syntax error')
        # The web view's own script is checked too (it runs in the window, not in Node).
        windows = [('phils-checks.web-view.html', read(os.path.join(SRC, 'phils-checks.web-view.html')), '__PCX_BOOT__'),
                   ('marker-spaces.web-view.html', read(os.path.join(MS, 'src', 'marker-spaces.web-view.html')), '__MS_BOOT__')]
        windows += [(folder + '/window.html', tool_window(folder), '__BOOT__') for folder, _, _ in TOOLS]
        for html_path, html, boot in windows:
            script = all_scripts(html).replace(boot, '{"strings":{}}')
            tmp = os.path.join(ROOT, 'dist', 'webview-check.js')
            with open(tmp, 'w', encoding='utf-8') as f:
                f.write(script)
            p = subprocess.run([P10, '--check', tmp], capture_output=True, env=env)
            os.remove(tmp)
            if p.returncode != 0:
                sys.stderr.write(p.stderr.decode('utf-8', 'replace'))
                sys.exit('the web view script %s has a syntax error' % os.path.basename(html_path))
    else:
        print('Paratext 10 not found: syntax not checked')

    os.makedirs(RELEASE, exist_ok=True)
    zip_path = os.path.join(RELEASE, 'philsChecks_%s.zip' % version)
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, dirs, files in os.walk(DIST):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(folder, name)
                z.write(full, os.path.relpath(full, DIST).replace(os.sep, '/'))
    print('built %s (%d bytes)' % (out, os.path.getsize(out)))
    print('packed %s' % zip_path)


if __name__ == '__main__':
    main()

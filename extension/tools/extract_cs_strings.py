# -*- coding: utf-8 -*-
# Writes src/tools/<tool>/strings.json from a P9 plugin's Strings.cs, so the Paratext 10 window
# shows the same text as the plugin: {"en": {...}, "es": {...}, "fr": {...}, "version": "1.7"}.
# It reads the English(), Spanish() and French() methods: assignments  s.Name = "..." + "...";
# and arrays  s.Name = new[] { "...", "..." };  Then src/tools/<tool>/extra.json (strings the
# P10 window needs that the plugin has not, or P10 versions of plugin strings) is laid over it.
#     python tools/extract_cs_strings.py
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ROOT))

TOOLS = {
    'numbered-markers': os.path.join(REPO, 'Numbered_Markers', 'NumberedMarkersPlugin', 'Strings.cs'),
    'numbered-book-titles': os.path.join(REPO, 'Numbered_Book_Titles', 'NumberedBookTitlesPlugin', 'Strings.cs'),
    'project-settings': os.path.join(REPO, 'Project_Settings', 'ProjectSettingsPlugin', 'Strings.cs'),
}
METHODS = {'en': 'English', 'es': 'Spanish', 'fr': 'French'}
# Tools whose strings are WPF resource files (Strings.<lang>.xaml), not a Strings.cs.
XAML_TOOLS = {
    'autocorrect': os.path.join(REPO, 'AutoCorrect', 'AutoCorrectEditor', 'Resources'),
}
# Plugins whose methods have other names.
TOOL_METHODS = {'project-settings': {'en': 'English', 'es': 'MakeSpanish', 'fr': 'MakeFrench'}}

LITERAL = r'"(?:[^"\\]|\\.)*"'
ASSIGN = re.compile(r's\.(\w+)\s*=\s*((?:' + LITERAL + r'\s*\+?\s*)+);')
ARRAY = re.compile(r's\.(\w+)\s*=\s*new\s*(?:string)?\s*\[\s*\]\s*\{((?:\s*' + LITERAL + r'\s*,?)+)\s*\}\s*;')


def unescape(lit):
    body = lit[1:-1]
    out = []
    i = 0
    while i < len(body):
        c = body[i]
        if c != '\\':
            out.append(c)
            i += 1
            continue
        e = body[i + 1]
        if e == 'u':
            out.append(chr(int(body[i + 2:i + 6], 16)))
            i += 6
            continue
        out.append({'n': '\n', 'r': '\r', 't': '\t', '0': '\0', '\\': '\\', '"': '"', "'": "'"}[e])
        i += 2
    return ''.join(out)


def method_body(src, name):
    m = re.search(r'(?:public|private|internal) static Strings ' + name + r'\(\)\s*\{', src)
    if not m:
        raise SystemExit('no %s() in Strings.cs' % name)
    depth = 1
    i = m.end()
    while depth:
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
        elif src[i] == '"':
            i = src.index('"', i + 1) if src[i + 1] != '"' else i + 1
            while src[i - 1] == '\\' and src[i - 2] != '\\':
                i = src.index('"', i + 1)
        i += 1
    return src[m.end():i - 1]


def strings_of(body):
    d = {}
    for m in ARRAY.finditer(body):
        d[m.group(1)] = [unescape(x) for x in re.findall(LITERAL, m.group(2))]
    for m in ASSIGN.finditer(body):
        d[m.group(1)] = ''.join(unescape(x) for x in re.findall(LITERAL, m.group(2)))
    return d


def read_xaml(folder, lang):
    import xml.etree.ElementTree as ET
    root = ET.parse(os.path.join(folder, 'Strings.%s.xaml' % lang)).getroot()
    out = {}
    for el in root:
        key = el.get('{http://schemas.microsoft.com/winfx/2006/xaml}Key')
        if key is not None:
            # WPF access keys: "_File" -> "File" ("__" is a literal underscore).
            out[key] = (el.text or '').replace('__', '\uE000').replace('_', '').replace('\uE000', '_')
    return out


def write(tool, out):
    folder = os.path.join(ROOT, 'src', 'tools', tool)
    # The strings every tool window shares (the project folder button...), then the tool's own.
    common = json.load(open(os.path.join(ROOT, 'src', 'tools', 'common-strings.json'), encoding='utf-8'))
    for lang in METHODS:
        out[lang].update(common.get(lang, {}))
    extra_path = os.path.join(folder, 'extra.json')
    if os.path.exists(extra_path):
        extra = json.load(open(extra_path, encoding='utf-8'))
        for lang in METHODS:
            out[lang].update(extra.get(lang, {}))
    missing = sorted(k for k in out['en'] if any(k not in out[l] for l in METHODS))
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'strings.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=True, indent=1, sort_keys=True)
    print('%s: %d strings, version %s%s' % (tool, len(out['en']), out['version'],
                                            ('; not in every language: ' + ', '.join(missing)) if missing else ''))


def main():
    for tool, folder in XAML_TOOLS.items():
        out = {lang: read_xaml(folder, lang) for lang in METHODS}
        out['version'] = ''
        write(tool, out)
    for tool, cs in TOOLS.items():
        src = open(cs, encoding='utf-8-sig').read()
        methods = TOOL_METHODS.get(tool, METHODS)
        out = {lang: strings_of(method_body(src, meth)) for lang, meth in methods.items()}
        v = re.search(r'ToolVersion\s*=\s*"([^"]*)"', src)
        out['version'] = v.group(1) if v else ''
        write(tool, out)

if __name__ == '__main__':
    main()

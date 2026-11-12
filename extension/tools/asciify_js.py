# -*- coding: utf-8 -*-
# Replaces every non-ASCII or control character (except tab, LF, CR) in the extension's .js files
# with a backslash-u escape, which means the same inside JavaScript strings and regexes. The Write
# tool turns typed escapes into the characters themselves, and a literal U+2028/U+2029 ends a regex.
#     python tools/asciify_js.py
import glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BS = chr(92)


def unit(n):
    return BS + 'u%04X' % n


def escape(text):
    out = []
    for ch in text:
        n = ord(ch)
        if n > 0x7E or (n < 0x20 and ch not in '\t\n\r'):
            if n > 0xFFFF:
                n -= 0x10000
                out.append(unit(0xD800 + (n >> 10)) + unit(0xDC00 + (n & 0x3FF)))
            else:
                out.append(unit(n))
        else:
            out.append(ch)
    return ''.join(out)


for path in glob.glob(os.path.join(ROOT, 'src', '**', '*.js'), recursive=True) + glob.glob(os.path.join(ROOT, 'tests', '*.js')):
    with open(path, encoding='utf-8-sig') as f:
        text = f.read()
    new = escape(text)
    if new != text:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(new)
        print('escaped', os.path.relpath(path, ROOT))

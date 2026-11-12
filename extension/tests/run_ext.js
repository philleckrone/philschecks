// Runs one of the extension's checks (src/, loaded in src/order.json order) on a Paratext project
// folder and writes JSON shaped like Project Checker's
//   ProjectChecker.exe --cli --project DIR --check ID --json OUT
// so tests/compare_pc.py can diff the two. Books and stylesheets are read as Project Checker reads
// them (ProjectLoader.cs, StylesheetService.cs).
//   ELECTRON_RUN_AS_NODE=1 "Paratext 10.exe" tests/run_ext.js PROJECTDIR CHECKID OUT.json [OPTIONS.json]
//   ... run_ext.js PROJECTDIR CHECKID --html OUT.html [LANG]    (the report section, for a look)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
for (const f of JSON.parse(fs.readFileSync(path.join(SRC, 'order.json'), 'utf8')))
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
/* global PC */
const BUNDLED_STY = path.join(__dirname, '..', '..', '..', 'Project_Checker', 'ProjectChecker', 'Resources', 'usfm.sty');

function codePageLabel(cp) {
  if (cp === 65001) return 'utf-8';
  if (cp === 874 || (cp >= 1250 && cp <= 1258)) return 'windows-' + cp;
  if (cp >= 28591 && cp <= 28605) return 'iso-8859-' + (cp - 28590);
  if (cp === 20127) return 'ascii';
  return 'utf-8';
}

/** File.ReadAllText(path, encoding): a BOM wins over the given encoding. */
function readText(file, label) {
  const b = fs.readFileSync(file);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  return new TextDecoder(label).decode(b);
}

function xmlDecode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The first <Name>text</Name> directly in Settings.xml, or null. */
function setting(xml, name) {
  const m = new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(xml);
  if (m) return xmlDecode(m[1]);
  return new RegExp('<' + name + '\\s*/>').test(xml) ? '' : null;
}

function attrOf(tag, name) {
  const m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag);
  return m ? xmlDecode(m[1]) : '';
}

/** BookCatalog.FileNumber */
function fileNumber(n) {
  if (n >= 1 && n <= 39) return String(n).padStart(2, '0');
  if (n >= 40 && n <= 99) return String(n + 1).padStart(2, '0');
  if (n >= 100 && n <= 123) {
    const k = n - 100;
    return String.fromCharCode(65 + Math.floor(k / 10)) + (k % 10);
  }
  return null;
}

/** ProjectLoader.Load + FindBooks + ReadBook */
function loadProject(dir) {
  const xml = readText(path.join(dir, 'Settings.xml'), 'utf-8');
  let pre = null;
  let post = null;
  let form = null;
  const naming = /<Naming\b[^>]*>/.exec(xml);
  if (naming) {
    pre = attrOf(naming[0], 'PrePart');
    post = attrOf(naming[0], 'PostPart');
    form = attrOf(naming[0], 'BookNameForm');
  }
  if (post === null) post = setting(xml, 'FileNamePostPart') || '';
  if (pre === null) pre = setting(xml, 'FileNamePrePart') || '';
  if (form === null) form = setting(xml, 'FileNameBookNameForm') || '41MAT';
  const cp = parseInt((setting(xml, 'Encoding') || '65001').trim(), 10) || 65001;
  const label = codePageLabel(cp);
  const found = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const up = name.toUpperCase();
    if (up.endsWith('.BAK')) continue;
    if (!up.startsWith(pre.toUpperCase()) || !up.endsWith(post.toUpperCase())) continue;
    if (name.length < pre.length + post.length + 2) continue;
    const middle = up.substring(pre.length, name.length - post.length);
    for (let n = 1; n <= PC.usfm.BOOKS.length; n++) {
      const code = PC.usfm.BOOKS[n - 1];
      const num = fileNumber(n);
      const expected = form === 'MAT' ? code : form === '41' ? num : form === 'MAT41' ? code + num : num + code;
      if (middle === expected.toUpperCase()) {
        if (!found.has(n)) found.set(n, full);
        break;
      }
    }
  }
  return Array.from(found.keys())
    .sort((a, b) => a - b)
    .map((n) => ({ num: n, code: PC.usfm.bookCode(n), text: readText(found.get(n), label) }));
}

/** StylesheetService.Load: usfm.sty above the project (else the bundled one) + custom.sty. */
function readSty(file) {
  if (!fs.existsSync(file)) return new Map();
  let b = fs.readFileSync(file);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) {
    text = new TextDecoder('windows-1252').decode(b);
  }
  return PC.sty.parse(text);
}

function loadSty(dir) {
  let base = readSty(path.join(path.dirname(path.resolve(dir)), 'usfm.sty'));
  if (base.size === 0) base = readSty(BUNDLED_STY);
  return PC.sty.merge(base, readSty(path.join(dir, 'custom.sty')));
}

function main() {
  const [dir, id, out] = process.argv.slice(2);
  const def = PC.checks.get(id);
  if (!def) throw new Error('Unknown check id: ' + id);
  const html = out === '--html';
  const options = !html && process.argv[5] ? JSON.parse(fs.readFileSync(process.argv[5], 'utf8')) : {};
  const result = PC.runCheck(def, { books: loadProject(dir), options, sty: loadSty(dir) });
  if (html) {
    const lang = process.argv[6] || 'en';
    const page =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + PC.report.css(def) + '</style></head><body><div class="pc-report">' +
      PC.report.section(def, result, lang) + '</div></body></html>';
    fs.writeFileSync(process.argv[5], page, 'utf8');
    return;
  }
  const findings = result.findings.map((f) => ({
    book: f.bookNum,
    bookCode: f.bookCode,
    chapter: f.chapter,
    verse: f.verse,
    begin: f.begin,
    end: f.end,
    msg: f.message,
    category: f.category,
    text: f.text,
    inList: f.inList,
    extra: f.extra,
  }));
  fs.writeFileSync(out, JSON.stringify({ check: id, findings, report: def.diffData ? def.diffData(result) : null }), 'utf8');
}

if (require.main === module) main();
module.exports = { loadProject, loadSty };

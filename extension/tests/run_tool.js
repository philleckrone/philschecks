// Runs a built-in tool's core (src/tools/<tool>/core.js) on a folder of SFM files and prints what
// that plugin's C# test host prints, so tests/compare_tools.py can diff them.
//   ELECTRON_RUN_AS_NODE=1 "Paratext 10.exe" tests/run_tool.js nm scan FOLDER
//   ... run_tool.js nm convert FOLDER FAMILIES       (All, or e.g. "io:remove,mt"; writes the files)
//   ... run_tool.js nbt scan|suggest FOLDER
//   ... run_tool.js nbt fix FOLDER ROWS              (All = every row that can change; writes)
// Books are found as the test hosts find them: *.SFM whose first line is \id XXX and whose
// name holds the code.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
for (const f of JSON.parse(fs.readFileSync(path.join(SRC, 'order.json'), 'utf8')))
  vm.runInThisContext(fs.readFileSync(path.join(SRC, f), 'utf8'), { filename: f });
for (const t of ['numbered-markers', 'numbered-book-titles', 'project-settings']) {
  const core = path.join(SRC, 'tools', t, 'core.js');
  if (fs.existsSync(core)) vm.runInThisContext(fs.readFileSync(core, 'utf8'), { filename: t + '/core.js' });
}
/* global PC, NMCore, NBTCore, PSCore */

function readUtf8(file) {
  const b = fs.readFileSync(file);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  return new TextDecoder('utf-8').decode(b);
}

/** FolderBookSource: book number -> file, in book order. */
function findBooks(folder) {
  const files = new Map();
  for (const name of fs.readdirSync(folder)) {
    if (!/\.sfm$/i.test(name)) continue;
    const full = path.join(folder, name);
    const first = readUtf8(full).split(/\r\n|\n|\r/)[0];
    const m = /^\uFEFF?\\id\s+(\w{3})/.exec(first);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const num = PC.usfm.bookNumber(code);
    if (num === 0) continue;
    if (path.basename(name, path.extname(name)).toUpperCase().indexOf(code) < 0) continue;
    files.set(num, full);
  }
  return Array.from(files.keys())
    .sort((a, b) => a - b)
    .map((n) => ({ num: n, code: PC.usfm.bookCode(n), file: files.get(n) }));
}

function cap(b) {
  return b ? 'True' : 'False';
}

// ------------------------------------------------------------ Numbered Markers

function nmScan(books) {
  const scan = NMCore.newResult();
  books.forEach((b) => NMCore.scanBook(scan, b.code, readUtf8(b.file), 'intro'));
  return scan;
}

function chapterList(places) {
  return Array.from(places.chapters.entries())
    .map(([book, chs]) => book + ':' + chs.join('/'))
    .join(',');
}

function nmPrintScan(scan) {
  scan.families
    .filter((f) => f.isUsed())
    .forEach((f) => {
      const one = f.oneFormDirection();
      console.log(
        [f.name, 'bare=' + f.bare, 'levels=' + f.levelList(true), 'other=' + f.levelList(false), 'mixed=' + cap(f.isMixed()),
          'canRemove=' + cap(f.canRemoveNumber()), 'default=' + f.defaultDirection(), 'oneForm=' + (one || '-'),
          'level1=' + chapterList(f.level1Places), 'books=' + chapterList(f.barePlaces)].join('\t'),
      );
    });
}

function nmConvert(books, spec) {
  const scan = nmScan(books);
  const choices = {};
  if (spec.toLowerCase() === 'all') NMCore.mixed(scan).forEach((f) => (choices[f.name] = f.defaultDirection()));
  else
    spec.split(',').forEach((part) => {
      const nd = part.trim().replace(/^\\+/, '').split(':');
      choices[nd[0]] = nd.length > 1 && nd[1] === 'remove' ? NMCore.REMOVE : NMCore.ADD;
    });
  let total = 0;
  let booksChanged = 0;
  books.forEach((b) => {
    const chapters = NMCore.chaptersFor(scan, choices, b.code);
    if (chapters.length === 0) return;
    const text = readUtf8(b.file);
    const r = NMCore.convertBook(text, chapters, choices);
    if (r.changedChapters.length === 0) return;
    fs.writeFileSync(b.file, r.text, 'utf8');
    booksChanged++;
    NMCore.NAMES.forEach((name) => {
      const n = r.counts[name] || 0;
      if (n > 0) {
        console.log(`CHANGE ${b.code} ${name} ${choices[name]} ${n}`);
        total += n;
      }
    });
  });
  console.log(`TOTAL ${total} BOOKS ${booksChanged}`);
}

// ------------------------------------------------------------ Numbered Book Titles

const NBT_EN = JSON.parse(fs.readFileSync(path.join(SRC, 'tools', 'numbered-book-titles', 'strings.json'), 'utf8')).en;
const PY_KEYS = ['digit', 'digit_nbsp', 'digit_nospace', 'digit_period', 'digit_suffix', 'roman', 'after_digit', 'after_roman', 'word'];

function codePageLabel(cp) {
  if (cp === 65001) return 'utf-8';
  if (cp === 874 || (cp >= 1250 && cp <= 1258)) return 'windows-' + cp;
  if (cp >= 28591 && cp <= 28605) return 'iso-8859-' + (cp - 28590);
  return 'utf-8';
}

/** The test host's FolderBookSource: Settings.xml naming and <Encoding>. */
function nbtSource(folder) {
  const settings = path.join(folder, 'Settings.xml');
  let label = 'utf-8';
  let pre = '';
  let post = '.SFM';
  if (fs.existsSync(settings)) {
    const xml = fs.readFileSync(settings, 'utf8');
    const enc = /<Encoding>(\d+)<\/Encoding>/.exec(xml);
    if (enc && enc[1] !== '65001') label = codePageLabel(parseInt(enc[1], 10));
    const mp = /<FileNamePrePart>([^<]*)<\/FileNamePrePart>/.exec(xml);
    const mq = /<FileNamePostPart>([^<]*)<\/FileNamePostPart>/.exec(xml);
    if (mp) pre = mp[1];
    if (mq && mq[1].length > 0) post = mq[1];
  }
  const read = (file) => {
    const b = fs.readFileSync(file);
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
    return new TextDecoder(label).decode(b);
  };
  const files = new Map();
  for (const name of fs.readdirSync(folder)) {
    const full = path.join(folder, name);
    if (!fs.statSync(full).isFile()) continue;
    if (!name.toUpperCase().startsWith(pre.toUpperCase()) || !name.toUpperCase().endsWith(post.toUpperCase())) continue;
    const first = read(full).split(/\r\n|\n|\r/)[0];
    const m = /^\uFEFF?\\id\s+(\w{3})/.exec(first);
    if (!m) continue;
    const code = m[1].toUpperCase();
    const num = PC.usfm.bookNumber(code);
    if (num === 0) continue;
    if (path.basename(name, path.extname(name)).toUpperCase().indexOf(code) < 0) continue;
    files.set(num, full);
  }
  // Writing in the project's encoding: UTF-8, or a single-byte code page (built from its decoder).
  let table = null;
  const write = (file, text) => {
    if (label === 'utf-8') return fs.writeFileSync(file, text, 'utf8');
    if (!table) {
      table = new Map();
      const dec = new TextDecoder(label);
      for (let i = 0; i < 256; i++) {
        const c = dec.decode(new Uint8Array([i]));
        if (!table.has(c)) table.set(c, i);
      }
    }
    const out = Buffer.alloc(text.length);
    for (let i = 0; i < text.length; i++) out[i] = table.has(text[i]) ? table.get(text[i]) : 0x3f;
    return fs.writeFileSync(file, out);
  };
  const list = Array.from(files.keys())
    .sort((a, b) => a - b)
    .map((n) => ({ num: n, code: PC.usfm.bookCode(n), file: files.get(n) }));
  return { books: list, read, write, folder };
}

/** With the folder's BookNames.xml when there is one (as the window sends it after choosing the folder). */
function nbtScan(src) {
  const bn = path.join(src.folder, 'BookNames.xml');
  const names = fs.existsSync(bn) ? NBTCore.parseBookNames(readUtf8(bn)) : null;
  return NBTCore.scan(src.books.map((b) => ({ num: b.num, code: b.code, text: src.read(b.file) })), names);
}

function he(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** PrintCmsRows: the summary line and the rows as toc_examiner.py writes them. */
function nbtPrintRows(r) {
  console.log(`<p>${r.books.length} numbered book(s), ${r.issueCount} inconsistency(ies) found.</p>`);
  r.issues.forEach((i) => {
    const fr = i.result;
    let total = 0;
    fr.counts.forEach((v) => (total += v));
    let usual;
    if (fr.usual !== null) usual = `${he(NBT_EN.StyleNames[fr.usual])} (${fr.counts.get(fr.usual)} of ${total} books)`;
    else {
      const parts = Array.from(fr.counts.entries())
        .sort((a, b) => b[1] - a[1] || (PY_KEYS[a[0]] < PY_KEYS[b[0]] ? -1 : PY_KEYS[a[0]] > PY_KEYS[b[0]] ? 1 : 0))
        .map((kv) => kv[1] + ' \u00D7 ' + NBT_EN.StyleNames[kv[0]]);
      usual = 'No usual style: ' + he(parts.join(', '));
    }
    const style = he(NBT_EN.StyleNames[i.style]);
    console.log(
      `<tr><td class="bk">${he(i.titles.code)}</td><td>${he(NBT_EN.FieldNames[i.field])}</td><td>&quot;${he(i.text)}&quot;</td>` +
        `<td>${style} (&quot;${he(i.token)}&quot;)</td><td>${usual}</td></tr>`,
    );
  });
}

function show(s) {
  return s.replace(/\u00A0/g, '~');
}

function nbtSuggest(r) {
  r.issues.forEach((i) => {
    const target = i.target ? i.target.value : i.text;
    const sug = i.suggestion === null ? '(none)' : i.suggestion;
    console.log([i.titles.code, NBTCore.FIELDS[i.field], i.target ? i.target.marker : '-', show(target), show(sug)].join('\t'));
  });
}

/** FixRunner.Run with every row that can change, rights ALL. */
function nbtFix(src) {
  const r = nbtScan(src);
  const chosen = r.issues.filter(NBTCore.canFix);
  console.log(`CHOSEN ${chosen.length}`);
  const byBook = new Map();
  chosen.forEach((i) => {
    if (!byBook.has(i.titles.num)) byBook.set(i.titles.num, []);
    byBook.get(i.titles.num).push(i);
  });
  let total = 0;
  let booksChanged = 0;
  const changed = [];
  Array.from(byBook.keys())
    .sort((a, b) => a - b)
    .forEach((num) => {
      const issues = byBook.get(num);
      const t = issues[0].titles;
      const file = src.books.find((b) => b.num === num).file;
      const bookText = src.read(file);
      const old = NBTCore.readChapter1(bookText);
      if (old === null || old !== t.chapterText) {
        changed.push(t.code);
        return;
      }
      const text = NBTCore.apply(old, issues);
      if (text === old) return;
      src.write(file, NBTCore.replaceChapter1(bookText, text));
      console.log(`FIXED ${t.code} ${issues.length}`);
      total += issues.length;
      booksChanged++;
    });
  console.log(`TOTAL ${total} BOOKS ${booksChanged}`);
  console.log('CHANGED ' + changed.join(', '));
  console.log('AFTER');
  nbtPrintRows(nbtScan(src));
}

// ------------------------------------------------------------ Project Settings Report

const PS_PLUGIN = path.join(__dirname, '..', '..', '..', 'Project_Settings', 'ProjectSettingsPlugin');

function psStrings(lang) {
  const all = JSON.parse(fs.readFileSync(path.join(SRC, 'tools', 'project-settings', 'strings.json'), 'utf8'));
  const S = Object.assign({}, all.en, all[lang] || {});
  S.lang = lang === 'es' ? 1 : lang === 'fr' ? 2 : 0;
  S.langCode = lang === 'es' || lang === 'fr' ? lang : 'en';
  return { S, version: all.version };
}

/** StyleSheets.Decode: UTF-8 (BOM or not), falling back to the ANSI code page. */
function readStyFile(file) {
  if (!fs.existsSync(file)) return new Map();
  let b = fs.readFileSync(file);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) {
    text = new TextDecoder('windows-1252').decode(b);
  }
  return PSCore.parseStyText(text);
}

/** StyleSheets.Load: <StyleSheet> in the project or projects folder, else usfm.sty above, else built in; then custom.sty. */
function psStyles(dir, styleSheetName) {
  const parent = path.dirname(path.resolve(dir));
  let base = new Map();
  if (styleSheetName && !/[\\/:<>|"?*]/.test(styleSheetName)) {
    base = readStyFile(path.join(dir, styleSheetName));
    if (base.size === 0) base = readStyFile(path.join(parent, styleSheetName));
  }
  if (base.size === 0) base = readStyFile(path.join(parent, 'usfm.sty'));
  if (base.size === 0) base = PSCore.builtInSty();
  return PSCore.mergeSty(base, readStyFile(path.join(dir, 'custom.sty')));
}

function psReport(dir, lang, out) {
  PSCore.init({
    settingsTxt: fs.readFileSync(path.join(PS_PLUGIN, 'Resources', 'settings.txt'), 'utf8'),
    usfmSty: fs.readFileSync(path.join(PS_PLUGIN, 'Resources', 'usfm.sty'), 'utf8'),
  });
  const settingsPath = path.join(dir, 'Settings.xml');
  const settingsXml = fs.readFileSync(settingsPath, 'utf8');
  const ldmlFiles = {};
  fs.readdirSync(dir)
    .filter((n) => /\.ldml$/i.test(n))
    .forEach((n) => (ldmlFiles[n] = fs.readFileSync(path.join(dir, n), 'utf8')));
  const items = PSCore.readSettings(settingsXml);
  const src = nbtSource(dir);
  const books = process.env.PS_NOTEXT === '1' ? null : src.books.map((b) => src.read(b.file));
  const { S, version } = psStrings(lang);
  const html = PSCore.report({
    settingsXml,
    ldmlFiles,
    books,
    sty: psStyles(dir, PSCore.valueOf(items, 'StyleSheet')),
    S,
    now: new Date(),
    fileInfo: (name) => {
      const f = path.join(dir, name);
      if (!fs.existsSync(f)) return { exists: false };
      const st = fs.statSync(f);
      return { exists: true, length: st.size, mtime: st.mtime };
    },
    settingsPath,
    projectName: path.basename(path.resolve(dir)),
    version,
    note: null,
    fontInstalled: null,
  });
  fs.writeFileSync(out, html, 'utf8');
}

// ------------------------------------------------------------ main

const [tool, mode, folder, arg] = process.argv.slice(2);
const books = tool === 'nm' ? findBooks(folder) : null;
if (tool === 'nm' && mode === 'scan') nmPrintScan(nmScan(books));
else if (tool === 'nm' && mode === 'convert') nmConvert(books, arg || 'All');
else if (tool === 'nbt' && mode === 'scan') nbtPrintRows(nbtScan(nbtSource(folder)));
else if (tool === 'nbt' && mode === 'suggest') nbtSuggest(nbtScan(nbtSource(folder)));
else if (tool === 'nbt' && mode === 'fix') nbtFix(nbtSource(folder));
else if (tool === 'ps' && mode === 'report') psReport(folder, arg || 'en', process.argv[6]);
else {
  console.error('usage: run_tool.js nm scan|convert FOLDER [FAMILIES] | nbt scan|suggest|fix FOLDER [ROWS] | ps report FOLDER LANG OUT');
  process.exit(2);
}

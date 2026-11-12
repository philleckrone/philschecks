// Runs the BUILT extension (dist/philsChecks/src/main.js) against a fake @papi/backend whose project
// is a Paratext project folder (read only). Checks activation, the commands, the check
// registrations, the window's run/list/options/go-to, and that the Checks panel gives the same
// results as a direct run of the same check.
//   ELECTRON_RUN_AS_NODE=1 "Paratext 10.exe" tests/mock_host.js PROJECTDIR
// PC_LANG=es|fr runs it in another interface language. Exits 1 on a failed check.
'use strict';
const path = require('path');
const Module = require('module');
const { loadProject, loadSty } = require('./run_ext.js');
const fsx = require('fs');
const vmx = require('vm');
// The built-in tools' cores, for direct runs to compare with (run_ext.js loaded PC already).
['numbered-markers', 'numbered-book-titles', 'project-settings'].forEach((t) =>
  vmx.runInThisContext(fsx.readFileSync(path.join(__dirname, '..', 'src', 'tools', t, 'core.js'), 'utf8'), { filename: t }),
);
/* global NMCore, NBTCore, PSCore */
const PS_PLUGIN = path.join(__dirname, '..', '..', '..', 'Project_Settings', 'ProjectSettingsPlugin');
PSCore.init({
  settingsTxt: fsx.readFileSync(path.join(PS_PLUGIN, 'Resources', 'settings.txt'), 'utf8'),
  usfmSty: fsx.readFileSync(path.join(PS_PLUGIN, 'Resources', 'usfm.sty'), 'utf8'),
});
// Paratext 10's own settings, as the project's Settings.xml would give them through P10.
const SETTINGS_XML = fsx.readFileSync(path.join(path.resolve(process.argv[2]), 'Settings.xml'), 'utf8').replace(/^\uFEFF/, '');
const settingsItems = PSCore.readSettings(SETTINGS_XML);
const p10Settings = {};
PSCore.P10_KEYS.forEach((k, i) => {
  const v = PSCore.valueOf(settingsItems, PSCore.P10_NAMES[i]);
  if (v === null) return;
  if (k === 'platformScripture.versification') p10Settings[k] = parseInt(v, 10);
  else if (k === 'platform.textDirection') p10Settings[k] = v === 'F' ? 'rtl' : 'ltr';
  else if (k === 'platformScripture.allowInvisibleCharacters') p10Settings[k] = v === 'T' || v === 'True';
  else if (k === 'platform.languageTag') p10Settings[k] = v.split(':').filter((x) => x).join('-');
  else if (k === 'platformScripture.copyrightNotice') p10Settings[k] = v ? { kind: 'custom', text: v } : { kind: 'none' };
  else p10Settings[k] = v;
});
let writesAllowed = false;
let canEdit = true;
const writes = [];
/* global PC */

const DIST = path.join(__dirname, '..', 'dist', 'philsChecks', 'src', 'main.js');
const folder = path.resolve(process.argv[2]);
const PROJECT = 'TESTPROJECTID';
const LANG = process.env.PC_LANG || 'en';
let failures = 0;
function check(ok, what) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------- the fake project
const books = loadProject(folder);
const sty = loadSty(folder);
const byCode = new Map(books.map((b) => [b.code, b]));
const present = PC.usfm.BOOKS.map((c) => (byCode.has(c) ? '1' : '0')).join('');

/** The merged stylesheet as Paratext 10's StyleInfo gives it. */
function styleInfo() {
  const markers = {};
  sty.forEach((f, key) => {
    const m = { marker: key, styleType: PC.text.lower(f.get('styletype') || 'paragraph') };
    if (f.get('endmarker')) m.endMarker = f.get('endmarker');
    ['bold', 'italic', 'superscript', 'underline'].forEach((n) => {
      if (PC.sty.flagOn(f, n)) m[n] = true;
    });
    if (PC.sty.flagOn(f, 'smallcaps')) m.smallCaps = true;
    if (f.get('textproperties')) m.textProperties = f.get('textproperties').split(/\s+/).filter((x) => x);
    markers[key] = m;
  });
  return { markers };
}

const providers = {
  'platform.base': {
    async getSetting(key) {
      if (key === 'platformScripture.booksPresent') return present;
      if (key === 'platform.name') return path.basename(folder);
      if (Object.prototype.hasOwnProperty.call(p10Settings, key)) return p10Settings[key];
      return undefined;
    },
  },
  'platformScripture.USFM_Book': {
    async getBookUSFM(ref) {
      // In Paratext 10 this is a call to the .NET data provider: let other requests in meanwhile.
      await new Promise((r) => setImmediate(r));
      const b = byCode.get(ref.book);
      return b ? b.text : undefined;
    },
    // Writes go to memory only (never to the folder), and only the built-in tools may write.
    async setBookUSFM(ref, usfm) {
      if (!writesAllowed) throw new Error('the checks must not write');
      writes.push(ref.book);
      byCode.get(ref.book).text = usfm;
      return true;
    },
  },
  'platformScripture.scriptureEditPermissions': {
    async canUserEditScripture() {
      return canEdit;
    },
  },
  'platformScripture.StyleInfo': {
    async getStyleInfo() {
      return styleInfo();
    },
  },
};

// ---------------------------------------------------------------- the fake papi
const commands = new Map();
const storage = new Map();
const logs = [];
const webViewProviders = new Map();
let scrRef;
const events = [];
const papi = {
  logger: {
    debug: (m) => logs.push(m),
    info: (m) => logs.push(m),
    warn: (m) => logs.push('WARN ' + m),
    error: (m) => logs.push('ERROR ' + m),
  },
  commands: {
    async registerCommand(name, handler) {
      commands.set(name, handler);
      return async () => commands.delete(name);
    },
    async sendCommand(name, ...args) {
      const h = commands.get(name);
      if (!h) throw new Error('no command ' + name);
      return h(...args);
    },
  },
  webViewProviders: {
    async registerWebViewProvider(type, provider) {
      webViewProviders.set(type, provider);
      return async () => true;
    },
  },
  network: {
    async createNetworkEventEmitterAsync(name) {
      return { emit: (data) => events.push({ name, data }), dispose: () => true };
    },
  },
  webViews: {
    async getOpenWebViewDefinition(id) {
      return id === 'EDITOR' ? { projectId: PROJECT } : undefined;
    },
    async openWebView(type, layout, options) {
      const def = await webViewProviders.get(type).getWebView({ webViewType: type, id: 'W1' }, options);
      papi.lastWebView = def;
      return def ? 'W1' : undefined;
    },
  },
  dialogs: {
    async selectProject() {
      return undefined;
    },
  },
  projectDataProviders: {
    async get(name, projectId) {
      if (projectId !== PROJECT) throw new Error('unknown project ' + projectId);
      if (!providers[name]) throw new Error('no provider ' + name);
      return providers[name];
    },
  },
  settings: {
    async get(key) {
      return key === 'platform.interfaceLanguage' ? [LANG] : undefined;
    },
  },
  storage: {
    async readUserData(token, key) {
      if (!storage.has(key)) throw new Error('not found');
      return storage.get(key);
    },
    async writeUserData(token, key, data) {
      storage.set(key, data);
    },
  },
  scrollGroups: {
    async setScrRef(group, ref, projectId) {
      scrRef = { group, ref, projectId };
      return true;
    },
  },
};

const registered = [];
commands.set('platformScripture.registerCheck', async (details, create) => {
  registered.push({ details, create });
  return async () => true;
});

const originalRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  if (name === '@papi/backend') return papi;
  return originalRequire.apply(this, arguments);
};

async function main() {
  const ext = require(DIST);
  const registrations = [];
  await ext.activate({ executionToken: {}, registrations: { add: (r) => registrations.push(r) } });
  ['open', 'list', 'run', 'loadOptions', 'saveOptions', 'goTo', 'progress', 'projectName'].forEach((c) =>
    check(commands.has('philsChecks.' + c), 'command philsChecks.' + c + ' registered'),
  );
  await new Promise((r) => setTimeout(r, 50));
  check(registered.length === PC.checks.size + 1, `${registered.length} checks registered in the Checks panel (with Marker Spaces)`);
  check(registered.some((r) => r.details.checkName === '%markerSpaces_checkName%'), 'the Marker Spaces check is registered');
  ['open', 'scan', 'fix', 'saveOptions', 'goTo'].forEach((c) =>
    check(commands.has('markerSpaces.' + c), 'command markerSpaces.' + c + ' registered'),
  );
  check(
    registered.every((r) => /^%philsChecks_check_\w+_name%$/.test(r.details.checkName) || r.details.checkName === '%markerSpaces_checkName%'),
    'check names are localize keys',
  );

  const id = await papi.commands.sendCommand('philsChecks.open', 'EDITOR');
  check(id === 'W1', 'window opened for the editor project');
  const html = papi.lastWebView && papi.lastWebView.content;
  check(!!html && html.indexOf('"projectId":"TESTPROJECTID"') >= 0 && html.indexOf('__PCX_BOOT__') < 0, 'window HTML has the project');

  const list = await papi.commands.sendCommand('philsChecks.list', LANG);
  check(list.length === PC.checks.size + 5, `list gives ${list.length} entries: ${list.map((c) => c.name).join(' | ')}`);
  const msItem = list.find((c) => c.id === 'markerSpaces');
  check(!!msItem && msItem.opens === 'markerSpaces.open' && msItem.kind === 'changes', 'Marker Spaces is in the list and opens its window');
  // As the window's "Open" button does: no editor id, the window's project.
  const msId = await papi.commands.sendCommand('markerSpaces.open', undefined, PROJECT);
  check(msId === 'W1' && papi.lastWebView.content.indexOf('"projectId":"TESTPROJECTID"') >= 0, 'Marker Spaces window opened for the project');
  const ms = await papi.commands.sendCommand('markerSpaces.scan', PROJECT);
  check(ms && Array.isArray(ms.rows) && ms.booksRead > 0, `Marker Spaces scan: ${ms.rows.length} problems in ${ms.booksRead} books`);
  const names = list.map((c) => c.name);
  check(names.join('\n') === names.slice().sort((a, b) => a.localeCompare(b, LANG, { sensitivity: 'base' })).join('\n'), 'list sorted by name');

  for (const c of list) {
    if (c.opens) continue;
    const def = PC.checks.get(c.id);
    const direct = PC.runCheck(def, { books, options: {}, sty });
    events.length = 0;
    const res = await papi.commands.sendCommand('philsChecks.run', PROJECT, c.id, {}, LANG, { otherBooks: true, withRows: true, runId: 'R-' + c.id });
    const ev = events.filter((e) => e.name === 'philsChecks.onProgress' && e.data.runId === 'R-' + c.id).map((e) => e.data);
    check(
      ev.length === books.length + 3 && ev[0].phase === 'open' && ev[ev.length - 1].phase === 'report' && ev.filter((e) => e.phase === 'read').every((e, i) => e.done === i && e.book === books[i].code),
      `${c.id}: ${ev.length} progress events (open, one per book, check, report)`,
    );
    const polled = await papi.commands.sendCommand('philsChecks.progress', PROJECT, 'R-' + c.id);
    check(polled && polled.phase === 'report' && polled.total === books.length, `${c.id}: philsChecks.progress gives the last step`);
    check(res.count === direct.findings.length, `${c.id}: window run gives ${res.count} findings, direct run ${direct.findings.length}`);
    const msgs = PC.findingRows(direct, LANG).map((r) => r.reference + ' ' + r.message).join('\n');
    check(res.rows.map((r) => r.reference + ' ' + r.message).join('\n') === msgs, `${c.id}: same rows and messages`);
    check(res.html.indexOf('<section') === 0 && res.css.indexOf('.pc-report') >= 0, `${c.id}: report section and scoped CSS`);
    if (res.count > 0) check(res.html.indexOf('class="pc-go"') >= 0, `${c.id}: report has go-to links`);
    check(res.booksRead.length === books.length && res.failed.length === 0, `${c.id}: ${res.booksRead.length} books read`);

    // The Checks panel: book by book, the findings that are in the results list.
    const panel = await registered.find((r) => r.details.checkName === `%philsChecks_check_${c.id}_name%`).create();
    check((await panel.initialize(PROJECT)).length === 0, `${c.id}: panel check initialized`);
    let n = 0;
    let bad = 0;
    for (const b of books) {
      const results = await panel.getCheckResults({
        start: { book: b.code, chapterNum: 1, verseNum: 0 },
        end: { book: b.code, chapterNum: 999, verseNum: 999 },
      });
      n += results.length;
      results.forEach((r) => {
        if (!(r.start.offset >= 0 && r.end.offset >= r.start.offset && r.verseRef.book === b.code && r.formatStringArguments.message))
          bad += 1;
      });
    }
    const inList = direct.findings.filter((f) => f.inList).length;
    check(n === inList && bad === 0, `${c.id}: Checks panel gives ${n} results (expected ${inList}), ${bad} malformed`);
  }

  // Options: saved per project and check, used by the next run.
  await papi.commands.sendCommand('philsChecks.saveOptions', PROJECT, 'shortv1', { MinChars: '100000' });
  const o = await papi.commands.sendCommand('philsChecks.loadOptions', PROJECT, 'shortv1');
  check(o.MinChars === '100000' && o.CheckOtherMarkers === 'No', 'options saved and read back');
  // While a run reads the books, the window's polling sees each book.
  const seen = new Set();
  const running = papi.commands.sendCommand('philsChecks.run', PROJECT, 'shortv1', {}, LANG, { otherBooks: true, runId: 'POLL' });
  for (let i = 0; i < 400; i++) {
    const p = await papi.commands.sendCommand('philsChecks.progress', PROJECT, 'POLL');
    if (p) seen.add(p.phase + (p.book || ''));
    if (p && p.phase === 'report') break;
    await new Promise((r) => setImmediate(r));
  }
  await running;
  check(seen.size > 3, `polling during a run saw ${seen.size} different steps`);
  const bible = await papi.commands.sendCommand('philsChecks.run', PROJECT, 'refnomark', {}, LANG, {});
  const otherCodes = new Set('FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' '));
  check(
    bible.booksRead.every((c) => !otherCodes.has(c)) && bible.booksRead.length === books.filter((b) => !otherCodes.has(b.code)).length && bible.rows === undefined,
    `without the tick box: ${bible.booksRead.length} Bible books read, no rows sent`,
  );
  const reopened = await webViewProviders.get('philsChecks.window').getWebView({ webViewType: 'philsChecks.window', id: 'W1' }, { projectId: PROJECT });
  check(reopened.content.indexOf('"otherBooks":false') >= 0, 'the tick box choice is remembered');
  const big = await papi.commands.sendCommand('philsChecks.run', PROJECT, 'shortv1', o, LANG, { otherBooks: true });
  const def = PC.checks.get('shortv1');
  const expect = PC.runCheck(def, { books, options: { MinChars: '100000' }, sty }).findings.length;
  check(big.count === expect, `shortv1 with MinChars 100000: ${big.count} findings (expected ${expect})`);
  let threw = false;
  try {
    await papi.commands.sendCommand('philsChecks.run', PROJECT, 'shortv1', { MinChars: 'abc' }, LANG);
  } catch (e) {
    threw = true;
  }
  check(threw, 'a bad MinChars fails the run');

  await papi.commands.sendCommand('philsChecks.goTo', PROJECT, 'MAT 5:3');
  check(scrRef && scrRef.ref.book === 'MAT' && scrRef.ref.chapterNum === 5 && scrRef.ref.verseNum === 3 && scrRef.projectId === PROJECT, 'go to MAT 5:3');
  await papi.commands.sendCommand('philsChecks.goTo', PROJECT, 'GEN 1:0');
  check(scrRef.ref.book === 'GEN' && scrRef.ref.chapterNum === 1 && scrRef.ref.verseNum === 0, 'go to GEN 1:0 (a book start)');

  check(writes.length === 0, 'the checks and Marker Spaces scan wrote nothing');
  await testTools(list);
  await testProjectSettings(list);
  await testFolderTools(list);

  const errors = logs.filter((l) => l.startsWith('ERROR'));
  check(errors.length === 0, 'no errors logged' + (errors.length ? ': ' + errors.join('; ') : ''));
  console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Numbered Markers and Numbered Book Titles: commands, window, scan, change, permission, changed since scan. */
async function testTools(list) {
  const tools = [
    ['numberedMarkers', 'philsChecks.numberedMarkers'],
    ['numberedBookTitles', 'philsChecks.numberedBookTitles'],
  ];
  for (const [id, type] of tools) {
    ['open', 'scan', 'apply', 'progress', 'books', 'saveBooks', 'goTo'].forEach((c) =>
      check(commands.has(`${id}.${c}`), `command ${id}.${c} registered`),
    );
    const item = list.find((c) => c.id === id);
    check(!!item && item.opens === `${id}.open` && item.kind === 'changes' && !!item.name, `${id} is in the list (${item && item.name})`);
    const w = await papi.commands.sendCommand(`${id}.open`, undefined, PROJECT);
    const html = papi.lastWebView && papi.lastWebView.content;
    check(
      w === 'W1' && papi.lastWebView.webViewType === type && html.indexOf('__BOOT__') < 0 && html.indexOf('/*COMMON_') < 0 && html.indexOf('"projectId":"TESTPROJECTID"') >= 0,
      `${id} window opened with its strings and the shared parts`,
    );
    const bk = await papi.commands.sendCommand(`${id}.books`, PROJECT);
    check(bk.length === books.length && bk.every((b) => b.chosen), `${id}: every book chosen when nothing is saved`);
  }
  const texts = () => new Map(books.map((b) => [b.code, b.text]));
  const original = texts();

  // ---- Numbered Markers
  writesAllowed = true;
  let st = await papi.commands.sendCommand('numberedMarkers.scan', PROJECT, 'NM1');
  if (process.env.PC_DUMP) fsx.writeFileSync(path.join(process.env.PC_DUMP, 'nm_scan.json'), JSON.stringify(st));
  const direct = NMCore.newResult();
  books.forEach((b) => NMCore.scanBook(direct, b.code, b.text, 'intro'));
  check(
    st.mixed.map((r) => r.family + r.bare).join() === NMCore.mixed(direct).map((f) => f.name + f.bare).join() && st.booksRead === books.length,
    `numberedMarkers scan: mixed ${st.mixed.map((r) => '\\' + r.family).join(' ')}, one form ${st.oneForm.length}`,
  );
  const choices = {};
  st.mixed.forEach((r) => (choices[r.family] = r.defaultDirection));
  // Expected: each book converted directly.
  let expectTotal = 0;
  const expectText = new Map();
  books.forEach((b) => {
    const ch = NMCore.chaptersFor(direct, choices, b.code);
    const r = NMCore.convertBook(b.text, ch, choices);
    Object.values(r.counts).forEach((n) => (expectTotal += n));
    expectText.set(b.code, r.text);
  });
  canEdit = false;
  let rep = await papi.commands.sendCommand('numberedMarkers.apply', PROJECT, { choices }, 'NM2');
  check(rep.total === 0 && rep.noPermission.length > 0 && writes.length === 0, `numberedMarkers: no permission, nothing written (${rep.noPermission.length} books listed)`);
  canEdit = true;
  st = await papi.commands.sendCommand('numberedMarkers.scan', PROJECT, 'NM3');
  // A book edited after the scan is left alone.
  const touched = st.mixed.length > 0 ? Array.from(direct.byName.get(st.mixed[0].family).placesFor(choices[st.mixed[0].family]).chapters.keys())[0] : null;
  if (touched) byCode.get(touched).text += ' ';
  rep = await papi.commands.sendCommand('numberedMarkers.apply', PROJECT, { choices }, 'NM4');
  check(!touched || (rep.changed.indexOf(touched) >= 0 && byCode.get(touched).text === original.get(touched) + ' '), `numberedMarkers: ${touched} changed since the scan, so left alone (the other books were converted)`);
  books.forEach((b) => (b.text = original.get(b.code)));
  st = await papi.commands.sendCommand('numberedMarkers.scan', PROJECT, 'NM5');
  rep = await papi.commands.sendCommand('numberedMarkers.apply', PROJECT, { choices }, 'NM6');
  const same = books.every((b) => b.text === expectText.get(b.code));
  check(rep.total === expectTotal && same && rep.failed.length === 0, `numberedMarkers: ${rep.total} changes in ${rep.booksChanged} books (expected ${expectTotal}), texts as converted directly`);
  const backups = Array.from(storage.keys()).filter((k) => k.startsWith('backup:' + PROJECT));
  check(backups.length >= rep.booksChanged && rep.backups === rep.booksChanged, `numberedMarkers: ${backups.length} backups kept in storage`);
  const kept = storage.get(backups.find((k) => k.indexOf(':' + rep.changes[0].book + ':') > 0));
  check(kept === original.get(rep.changes[0].book), 'numberedMarkers: a backup holds the book as it was');
  const again = await papi.commands.sendCommand('numberedMarkers.scan', PROJECT, 'NM7');
  check(again.mixed.length === 0 || Object.keys(choices).every((f) => !again.mixed.some((r) => r.family === f)), 'numberedMarkers: after converting, those markers are no longer mixed');
  books.forEach((b) => (b.text = original.get(b.code)));

  // ---- Numbered Book Titles
  const nbtDirect = NBTCore.scan(books.map((b) => ({ num: b.num, code: b.code, text: b.text })), null);
  st = await papi.commands.sendCommand('numberedBookTitles.scan', PROJECT, 'T1');
  if (process.env.PC_DUMP) fsx.writeFileSync(path.join(process.env.PC_DUMP, 'nbt_scan.json'), JSON.stringify(st));
  check(
    st.rows.length === nbtDirect.issues.length && st.numberedBooks === nbtDirect.books.length && st.matrix.rows.length === nbtDirect.books.length,
    `numberedBookTitles scan: ${st.rows.length} differences in ${st.numberedBooks} numbered books; ${st.matrix.fields.length} matrix columns`,
  );
  check(st.matrix.fields.every((f) => f.indexOf('BookNames') < 0), 'numberedBookTitles: no BookNames.xml column (not available in P10)');
  const fixable = st.rows.filter((r) => r.canFix);
  const before = writes.length;
  rep = await papi.commands.sendCommand('numberedBookTitles.apply', PROJECT, { rows: fixable.map((r) => ({ key: r.key, newValue: r.changeTo })) }, 'T2');
  const expectBooks = new Set(fixable.map((r) => r.book)).size;
  check(rep.total === fixable.length && rep.booksChanged === expectBooks && writes.length - before === expectBooks && rep.failed.length === 0,
    `numberedBookTitles: ${rep.total} lines changed in ${rep.booksChanged} books (expected ${fixable.length} in ${expectBooks})`);
  const after = await papi.commands.sendCommand('numberedBookTitles.scan', PROJECT, 'T3');
  check(after.rows.filter((r) => r.canFix).length < Math.max(1, fixable.length), `numberedBookTitles: ${after.rows.length} differences left after the change`);
  // Only chapter 1 changed in each book.
  const onlyHeader = books.every((b) => {
    const o = original.get(b.code);
    if (o === b.text) return true;
    const c1o = NBTCore.readChapter1(o);
    const c1n = NBTCore.readChapter1(b.text);
    return o.substring(c1o.length) === b.text.substring(c1n.length);
  });
  check(onlyHeader, 'numberedBookTitles: only the header (chapter 1) of a book changed');
  // Typing a new text: that text is written.
  books.forEach((b) => (b.text = original.get(b.code)));
  st = await papi.commands.sendCommand('numberedBookTitles.scan', PROJECT, 'T4');
  const one = st.rows.find((r) => r.fixable);
  if (one) {
    rep = await papi.commands.sendCommand('numberedBookTitles.apply', PROJECT, { rows: [{ key: one.key, newValue: 'Test Title' }] }, 'T5');
    const t = NBTCore.readTitles(0, one.book, NBTCore.readChapter1(byCode.get(one.book).text));
    const lines = Array.from(t.lines.values()).concat(t.mtLines);
    check(rep.total === 1 && lines.some((l) => l.value === 'Test Title'), `numberedBookTitles: a typed "Change to" is written (${one.book} ${one.line})`);
  }
  books.forEach((b) => (b.text = original.get(b.code)));

  // The book choice is saved and used.
  await papi.commands.sendCommand('numberedBookTitles.saveBooks', PROJECT, books.filter((b) => b.num > 39).map((b) => b.code));
  st = await papi.commands.sendCommand('numberedBookTitles.scan', PROJECT, 'T6');
  check(st.booksRead === books.filter((b) => b.num <= 39).length, `numberedBookTitles: only the ${st.booksRead} chosen books read`);
  writesAllowed = false;
}

/** The Project Settings Report: Paratext 10's settings only, then the chosen files; never writes. */
async function testProjectSettings(list) {
  ['open', 'scan', 'apply', 'progress'].forEach((c) => check(commands.has('projectSettings.' + c), 'command projectSettings.' + c + ' registered'));
  const it = list.find((c) => c.id === 'projectSettings');
  check(!!it && it.kind === 'report' && it.opens === 'projectSettings.open', `projectSettings is in the list (${it && it.name})`);
  const w = await papi.commands.sendCommand('projectSettings.open', undefined, PROJECT);
  check(w === 'W1' && papi.lastWebView.webViewType === 'philsChecks.projectSettings' && papi.lastWebView.content.indexOf('__BOOT__') < 0, 'projectSettings window opened');
  const before = writes.length;
  const p10 = await papi.commands.sendCommand('projectSettings.scan', PROJECT, 'PS1');
  const expectP10 = PSCore.itemsFromP10(p10Settings);
  const missingRows = expectP10.filter((i) => p10.html.indexOf('id="s-' + i.name + '"') < 0 && i.name !== 'RepeatableWords' && i.name !== 'NonRepeatableWords' && i.name !== 'CallerSequence');
  check(p10.source === 'p10' && p10.p10Count === expectP10.length && missingRows.length === 0,
    `projectSettings scan: ${p10.p10Count} settings from Paratext 10, all with their rows${missingRows.length ? ' (missing: ' + missingRows.map((i) => i.name).join(' ') + ')' : ''}`);
  check(p10.booksRead === books.length && p10.html.indexOf('x-ValidCharacters-unused') >= 0, `projectSettings scan: ${p10.booksRead} books counted, usage rows shown`);
  check(p10.html.indexOf('id="l-') < 0, 'projectSettings scan: no language section without the .ldml file');
  // The chosen files: Settings.xml and the .ldml, as the window sends them.
  const files = { 'Settings.xml': SETTINGS_XML };
  fsx.readdirSync(folder).filter((n) => /\.ldml$/i.test(n)).forEach((n) => (files[n] = fsx.readFileSync(path.join(folder, n), 'utf8').replace(/^\uFEFF/, '')));
  const full = await papi.commands.sendCommand('projectSettings.apply', PROJECT, { files, meta: {} }, 'PS2');
  if (process.env.PC_DUMP) {
    fsx.writeFileSync(path.join(process.env.PC_DUMP, 'ps_p10.json'), JSON.stringify(p10));
    fsx.writeFileSync(path.join(process.env.PC_DUMP, 'ps_full.json'), JSON.stringify(full));
  }
  const rows = (full.html.match(/<tr id=/g) || []).length;
  const direct = PSCore.report({
    settingsXml: SETTINGS_XML, ldmlFiles: Object.fromEntries(Object.entries(files).filter(([n]) => /\.ldml$/i.test(n))), books: books.map((b) => b.text),
    sty: PSCore.styFromStyleInfo(styleInfo()), S: Object.assign({ lang: 0, langCode: 'en' }, JSON.parse(fsx.readFileSync(path.join(__dirname, '..', 'src', 'tools', 'project-settings', 'strings.json'), 'utf8')).en),
    now: new Date(), fileInfo: () => null, settingsPath: 'x', projectName: 'x', version: 'x', note: null,
  });
  const counts = (h) => (h.match(/<sup class="n">[^<]*/g) || []).join('|');
  check(full.source === 'files' && rows === (direct.match(/<tr id=/g) || []).length && rows > 100, `projectSettings with Settings.xml + .ldml: ${rows} rows, as a direct build`);
  check(counts(full.html) === counts(direct) && counts(direct).length > 0, 'projectSettings: the character and punctuation counts match a direct build');
  check(full.html.indexOf('id="l-sil:simple"') >= 0 || Object.keys(files).length === 1, 'projectSettings: the language section from the chosen .ldml');
  let refused = false;
  try {
    await papi.commands.sendCommand('projectSettings.apply', PROJECT, { files: { 'Settings.xml': '<notsettings/>' } }, 'PS3');
  } catch (e) {
    refused = true;
  }
  check(refused, 'projectSettings: a file that is not a Settings.xml is refused');
  const back = await papi.commands.sendCommand('projectSettings.apply', PROJECT, { files: {} }, 'PS4');
  check(back.source === 'p10' && back.html === back.html && writes.length === before, 'projectSettings: back to the Paratext 10 settings; nothing written');
}

/** What the window sends after the user chooses the project folder; and the AutoCorrect Editor. */
async function testFolderTools(list) {
  // Numbered Book Titles with the folder's BookNames.xml.
  const bn = path.join(folder, 'BookNames.xml');
  if (fsx.existsSync(bn)) {
    await papi.commands.sendCommand('numberedBookTitles.saveBooks', PROJECT, []); // every book again
    const xml = fsx.readFileSync(bn, 'utf8').replace(/^\uFEFF/, '');
    const st = await papi.commands.sendCommand('numberedBookTitles.scanWith', PROJECT, { bookNamesXml: xml }, 'B1');
    const direct = NBTCore.scan(books.map((b) => ({ num: b.num, code: b.code, text: b.text })), NBTCore.parseBookNames(xml));
    const bnRows = st.rows.filter((r) => !r.fixable).length;
    check(st.bookNames && st.rows.length === direct.issues.length && bnRows > 0, `numberedBookTitles.scanWith BookNames.xml: ${st.rows.length} differences, ${bnRows} report-only BookNames rows`);
    check(st.matrix.fields.some((f) => f.indexOf('BookNames') >= 0), 'numberedBookTitles: the BookNames columns are back in the matrix');
  }
  // Project Settings with a chosen folder: a file not in the folder is reported as absent.
  const allS = JSON.parse(fsx.readFileSync(path.join(__dirname, '..', 'src', 'tools', 'project-settings', 'strings.json'), 'utf8'));
  const S = Object.assign({}, allS.en, allS[LANG] || {});
  const res = await papi.commands.sendCommand('projectSettings.apply', PROJECT, { files: { 'Settings.xml': SETTINGS_XML }, meta: { __folder: true } }, 'F1');
  const absent = PC.report.format(S.FileAbsent, ['autocorrect.txt']);
  check(res.html.indexOf(PSCore.enc(absent)) >= 0 && res.html.indexOf(PSCore.enc(PC.report.format(S.FileUnknown, ['autocorrect.txt']))) < 0,
    'projectSettings with a chosen folder: a file not in it is "No", not "not known"');
  // The AutoCorrect Editor: listed, opens, carries its core and blocks; the backend writes nothing.
  ['open', 'scan', 'apply', 'scanWith'].forEach((c) => check(commands.has('autoCorrect.' + c), 'command autoCorrect.' + c + ' registered'));
  const it = list.find((c) => c.id === 'autoCorrect');
  check(!!it && it.kind === 'changes' && it.opens === 'autoCorrect.open', `autoCorrect is in the list (${it && it.name})`);
  const before = writes.length;
  const w = await papi.commands.sendCommand('autoCorrect.open', undefined, PROJECT);
  const html = papi.lastWebView.content;
  check(w === 'W1' && papi.lastWebView.webViewType === 'philsChecks.autoCorrect' && html.indexOf('ACCore.init(') >= 0 && html.indexOf('Combining Diacritical Marks') >= 0 && html.indexOf('/*TOOL_CORE*/') < 0,
    'autoCorrect window opened with its core and the Unicode blocks');
  check(writes.length === before, 'autoCorrect: the backend wrote nothing');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

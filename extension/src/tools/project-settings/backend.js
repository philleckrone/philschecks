// Project Settings Report backend (built into Phils Checks; tools/build.py wraps it in its own scope).
// The report of Project_Settings\ProjectSettingsPlugin, built by PSCore. Paratext 10 gives
// extensions only some settings and no files, so the report is made from:
//  - scan: Paratext 10's own settings (PSCore.P10_KEYS) and the book text;
//  - apply: the files the user chose in the window (Settings.xml, *.ldml, custom.sty...), sent
//    as text, with the book text read by the scan. Nothing is written anywhere.
/* global PCTools, PSCore, PS_WINDOW_HTML, PS_STRINGS, PS_SETTINGS_TXT, PS_USFM_STY */
const sessions = new Map(); // projectId -> { books: [usfm], p10: {key: value}, sty, name, failed }
let initialized = false;

function strings(lang) {
  const S = Object.assign({}, PS_STRINGS.en, PS_STRINGS[lang] || {});
  S.lang = lang === 'es' ? 1 : lang === 'fr' ? 2 : 0;
  S.langCode = lang === 'es' || lang === 'fr' ? lang : 'en';
  return S;
}

function init() {
  if (initialized) return;
  PSCore.init({ settingsTxt: PS_SETTINGS_TXT, usfmSty: PS_USFM_STY });
  initialized = true;
}

/** Resolves to fallback when p has not settled after ms (and logs which call was slow). */
function within(p, ms, fallback, what, ctx) {
  let timer;
  return Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise((res) => {
      timer = setTimeout(() => {
        ctx.logger.warn(`projectSettings: ${what} gave no answer within ${ms} ms; going on without it`);
        res(fallback);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Reads the book text and Paratext 10's settings; keeps them for apply. */
async function readProjectOnce(ctx) {
  const t0 = Date.now();
  const log = (what) => ctx.logger.info(`projectSettings: ${what} (${Date.now() - t0} ms)`);
  const p10 = {};
  const values = await Promise.all(PSCore.P10_KEYS.map((key) => within(ctx.setting(key), 5000, undefined, `setting ${key}`, ctx)));
  PSCore.P10_KEYS.forEach((key, i) => {
    if (values[i] !== undefined && values[i] !== null) p10[key] = values[i];
  });
  log(`${Object.keys(p10).length} settings read`);
  const read = await ctx.readChosen();
  log(`${read.books.length} books read, ${read.failed.length} failed`);
  const info = await within(ctx.styleInfo(read.books.length > 0 ? read.books[0].num : 1), 10000, undefined, 'StyleInfo', ctx);
  const sty = info && info.markers && Object.keys(info.markers).length > 0 ? PSCore.styFromStyleInfo(info) : PSCore.builtInSty();
  const name = p10['platform.name'] || (await within(ctx.projectName(), 3000, '', 'project name', ctx));
  log('stylesheet ' + (info ? 'from Paratext 10' : 'built in'));
  const session = { books: read.books.map((b) => b.text), p10, sty, name, failed: read.failed };
  sessions.set(ctx.projectId, session);
  return session;
}

/** One read at a time per project: a second request while one is reading waits for it. */
const reading = new Map();
function readProject(ctx) {
  if (reading.has(ctx.projectId)) return reading.get(ctx.projectId);
  const p = readProjectOnce(ctx).finally(() => reading.delete(ctx.projectId));
  reading.set(ctx.projectId, p);
  return p;
}

/** The report, with its time in the log. */
function timedBuild(ctx, session, files, meta, lang) {
  const t0 = Date.now();
  const r = build(session, files, meta, lang);
  ctx.logger.info(`projectSettings: report built (${Date.now() - t0} ms, ${r.html.length} characters)`);
  return r;
}

/** files = {name: text}; meta = {name: {length, mtime (ms)}}. Empty files = Paratext 10's settings only. */
function build(session, files, meta, lang) {
  init();
  const S = strings(lang);
  const names = Object.keys(files || {});
  const find = (wanted) => names.find((n) => n.toLowerCase() === wanted.toLowerCase());
  const settingsName = find('Settings.xml');
  const ldmlFiles = {};
  names.filter((n) => /\.ldml$/i.test(n)).forEach((n) => (ldmlFiles[n] = files[n]));
  // A project file is known only when chosen (or when the whole folder was read, where a file not
  // there is absent); otherwise the report says it is not known.
  const fileInfo = (name) => {
    const n = find(name);
    if (!n) return meta && meta.__folder ? { exists: false } : null;
    const m = (meta && meta[n]) || {};
    return { exists: true, length: m.length !== undefined ? m.length : files[n].length, mtime: new Date(m.mtime || Date.now()) };
  };
  const shown = settingsName
    ? fmt(S.NoteFiles, [names.join(', ')])
    : fmt(S.NoteP10, [PSCore.itemsFromP10(session.p10).length, session.name || '']);
  const html = PSCore.report({
    settingsXml: settingsName ? files[settingsName] : null,
    ldmlFiles: names.some((n) => /\.ldml$/i.test(n)) ? ldmlFiles : settingsName ? {} : null,
    p10: session.p10,
    books: session.books,
    sty: session.sty,
    S,
    now: new Date(),
    fileInfo,
    settingsPath: settingsName || 'Paratext 10: ' + (session.name || ''),
    projectName: session.name,
    version: PS_STRINGS.version,
    note: shown,
    fontInstalled: null,
  });
  return {
    html,
    source: settingsName ? 'files' : 'p10',
    files: names,
    booksRead: session.books.length,
    failed: session.failed,
    p10Count: PSCore.itemsFromP10(session.p10).length,
  };
}

function fmt(s, args) {
  return PC.report.format(s, args);
}

async function scan(ctx, lang) {
  const session = await readProject(ctx);
  ctx.progress({ phase: 'write', done: 0, total: 1, book: '' });
  await new Promise((r) => setTimeout(r, 0)); // let the window see that phase
  return timedBuild(ctx, session, {}, {}, lang);
}

/** payload = {files: {name: text}, meta: {name: {length, mtime}}}: the report from the chosen files. */
async function apply(ctx, payload, lang) {
  let session = sessions.get(ctx.projectId);
  if (!session) session = await readProject(ctx);
  ctx.progress({ phase: 'write', done: 0, total: 1, book: '' });
  await new Promise((r) => setTimeout(r, 0));
  const files = (payload && payload.files) || {};
  const settingsName = Object.keys(files).find((n) => n.toLowerCase() === 'settings.xml');
  if (settingsName) {
    // Check it is a Settings.xml before building on it.
    let root;
    try {
      root = PSCore.parseXml(files[settingsName]);
    } catch (e) {
      throw new Error(fmt(strings(lang).NotSettings, [String(e && e.message ? e.message : e)]));
    }
    if (!root || root.name !== 'ScriptureText') throw new Error(fmt(strings(lang).NotSettings, [root ? '<' + root.name + '>' : '']));
  }
  return timedBuild(ctx, session, files, (payload && payload.meta) || {}, lang);
}

const ProjectSettingsTool = PCTools.backend({
  id: 'projectSettings',
  webViewType: 'philsChecks.projectSettings',
  version: PS_STRINGS.version,
  strings: PS_STRINGS,
  html: PS_WINDOW_HTML,
  size: { width: 1200, height: 800 },
  scan,
  apply,
});

return ProjectSettingsTool;

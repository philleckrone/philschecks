// Phils Custom (cms) Checks for Paratext 10: the backend (runs in the extension host).
//
// tools/build.py makes dist/philsChecks/src/main.js from the files in src/order.json (the checks,
// global PC), then the web view HTML, the built-in usfm.sty and the version as string constants,
// then this file. Extensions may only require papi modules (no relative files, no fs), hence the
// single file. Read-only: nothing is written to the project.
//
// It adds:
//  - each check to Paratext 10's Checks panel (platformScripture.registerCheck), with the options
//    last used in the window;
//  - Tools > Phils Custom (cms) Checks... in the Scripture editor: a window that lists the checks,
//    sets their options, runs one and shows its report, whose references go to the verse;
//  - Marker Spaces (built in from Marker_Spaces/extension, see tools/build.py): its check, and its
//    fix window, opened from the list.
/* global PC, PCX_WEB_VIEW_HTML, PCX_USFM_STY, PCX_VERSION, MarkerSpaces, NumberedMarkers, NumberedBookTitles, NM_STRINGS, NBT_STRINGS, ProjectSettings, PS_STRINGS, AutoCorrect, AC_STRINGS */
const papi = require('@papi/backend');

const { logger } = papi;
const WEB_VIEW_TYPE = 'philsChecks.window';

let executionToken;
let builtInSty;
/**
 * Progress of the runs in progress, {projectId, runId, phase, done, total, book}: the window asks
 * for it with philsChecks.progress while it waits (HTML web views get commands reliably; network
 * events are also sent, for anyone listening).
 */
const runs = new Map();
let progressEmitter;
const PROGRESS_EVENT = 'philsChecks.onProgress';

function progress(data) {
  if (data.runId) runs.set(`${data.projectId}|${data.runId}`, data);
  try {
    if (progressEmitter) progressEmitter.emit(data);
  } catch (e) {
    // the window asks for it anyway
  }
}

async function getProgress(projectId, runId) {
  return runs.get(`${projectId}|${runId}`) || null;
}

/** Marker Spaces in the window's list: it opens its own window. */
const MARKER_SPACES_ITEM = {
  en: {
    name: 'Marker Spaces',
    description:
      'Finds spacing problems around character markers, footnotes and cross-references (for example "\nd Dios \nd*" or "word\nd") and fixes the ones you tick. It opens its own window.',
  },
  es: {
    name: 'Espacios de marcadores',
    description:
      'Encuentra problemas de espaciado alrededor de los marcadores de caracteres, las notas al pie y las referencias cruzadas (por ejemplo "\nd Dios \nd*" o "palabra\nd") y corrige los que usted marque. Se abre en su propia ventana.',
  },
  fr: {
    name: 'Espaces autour des marqueurs',
    description:
      'Trouve les probl\u00E8mes d\u2019espacement autour des marqueurs de caract\u00E8res, des notes et des r\u00E9f\u00E9rences crois\u00E9es (par exemple \u00AB \nd Dios \nd* \u00BB ou \u00AB mot\nd \u00BB) et corrige ceux que vous cochez. Il s\u2019ouvre dans sa propre fen\u00EAtre.',
  },
};

// ------------------------------------------------------------ helpers

function docs(summary) {
  return { method: { summary, params: [], result: { name: 'return value', schema: {} } } };
}

function verseRef(code, chapter, verse) {
  return { book: code, chapterNum: chapter, verseNum: verse };
}

async function interfaceLanguage() {
  try {
    const langs = await papi.settings.get('platform.interfaceLanguage');
    const first = Array.isArray(langs) && langs.length > 0 ? String(langs[0]).toLowerCase() : 'en';
    if (first.startsWith('es')) return 'es';
    if (first.startsWith('fr')) return 'fr';
  } catch (e) {
    logger.warn(`Phils Checks: could not read the interface language: ${e}`);
  }
  return 'en';
}

async function projectName(projectId) {
  try {
    const base = await papi.projectDataProviders.get('platform.base', projectId);
    return (await base.getSetting('platform.name')) || projectId;
  } catch (e) {
    return projectId;
  }
}

/** Books in the project (setting platformScripture.booksPresent, "0101..."), in book order. */
async function booksPresent(projectId) {
  const base = await papi.projectDataProviders.get('platform.base', projectId);
  const present = String((await base.getSetting('platformScripture.booksPresent')) || '');
  const books = [];
  for (let i = 0; i < present.length && i < PC.usfm.BOOKS.length; i++)
    if (present[i] === '1') books.push({ num: i + 1, code: PC.usfm.bookCode(i + 1) });
  return books;
}

/** The project's stylesheet from Paratext's StyleInfo; the built-in usfm.sty if it gives none. */
async function styleTable(projectId, bookNum) {
  try {
    const pdp = await papi.projectDataProviders.get('platformScripture.StyleInfo', projectId);
    const info = await pdp.getStyleInfo(bookNum || 1);
    if (info && info.markers && Object.keys(info.markers).length > 0) return PC.sty.fromStyleInfo(info);
  } catch (e) {
    logger.warn(`Phils Checks: StyleInfo not available (${e}); using the built-in usfm.sty`);
  }
  if (!builtInSty) builtInSty = PC.sty.parse(PCX_USFM_STY);
  return builtInSty;
}

function definition(checkId) {
  const def = PC.checks.get(checkId);
  if (!def) throw new Error(`Unknown check: ${checkId}`);
  return def;
}

// ------------------------------------------------------------ options (per project and check)

async function loadOptions(projectId, checkId) {
  const def = definition(checkId);
  const o = {};
  let saved = {};
  try {
    saved = JSON.parse(await papi.storage.readUserData(executionToken, `options:${projectId}:${checkId}`)) || {};
  } catch (e) {
    // nothing saved yet
  }
  def.options.forEach((d) => {
    o[d.name] = saved[d.name] !== undefined && saved[d.name] !== null ? String(saved[d.name]) : d.def;
  });
  return o;
}

async function saveOptions(projectId, checkId, options) {
  const def = definition(checkId);
  const o = {};
  def.options.forEach((d) => {
    o[d.name] = options && options[d.name] !== undefined ? String(options[d.name]) : d.def;
  });
  await papi.storage.writeUserData(executionToken, `options:${projectId}:${checkId}`, JSON.stringify(o));
  return o;
}

/** Books that are not Bible text: read only when the window's tick box says so. */
const OTHER_BOOKS = new Set('FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' '));

async function loadOtherBooks(projectId) {
  try {
    return JSON.parse(await papi.storage.readUserData(executionToken, `otherBooks:${projectId}`)) === true;
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------ the window's commands

/** The checks, in the window's language, sorted by name. */
async function listChecks(lang) {
  const L = PC.report.lang(lang || (await interfaceLanguage()));
  const list = Array.from(PC.checks.values()).map((def) => ({
    id: def.id,
    name: L.str(`Check_${def.id}_Name`),
    description: L.str(`Check_${def.id}_Desc`),
    kind: def.kind,
    options: def.options.map((d) => ({
      name: d.name,
      type: d.type,
      def: d.def,
      label: L.str(`Opt_${def.id}_${d.name}_Label`).startsWith('Opt_') ? d.name : L.str(`Opt_${def.id}_${d.name}_Label`),
      tip: L.str(`Opt_${def.id}_${d.name}_Tip`).startsWith('Opt_') ? '' : L.str(`Opt_${def.id}_${d.name}_Tip`),
    })),
  }));
  const ms = MARKER_SPACES_ITEM[L.code] || MARKER_SPACES_ITEM.en;
  list.push({ id: 'markerSpaces', name: ms.name, description: ms.description, kind: 'changes', opens: 'markerSpaces.open', options: [] });
  // The other built-in tools (src/tools/): each opens its own window.
  [
    ['numberedMarkers', NM_STRINGS, 'changes'],
    ['numberedBookTitles', NBT_STRINGS, 'changes'],
    ['projectSettings', PS_STRINGS, 'report'],
    ['autoCorrect', AC_STRINGS, 'changes'],
  ].forEach(([id, strings, kind]) => {
    const s = Object.assign({}, strings.en, strings[L.code] || {});
    list.push({ id, name: s.Title, description: s.Description, kind, opens: `${id}.open`, options: [] });
  });
  const collator = new Intl.Collator(L.code, { sensitivity: 'base' });
  list.sort((a, b) => collator.compare(a.name, b.name));
  return list;
}

/**
 * Runs a check on the project's books (non-Bible books only when run.otherBooks, which is
 * remembered); returns its report section, and its rows when run.withRows (for the tests).
 */
async function runFromWindow(projectId, checkId, options, lang, run) {
  const def = definition(checkId);
  const used = await saveOptions(projectId, checkId, options);
  const otherBooks = !!(run && run.otherBooks);
  await papi.storage.writeUserData(executionToken, `otherBooks:${projectId}`, JSON.stringify(otherBooks));
  const present = (await booksPresent(projectId)).filter((b) => otherBooks || !OTHER_BOOKS.has(b.code));
  const runId = run && run.runId;
  progress({ projectId, runId, phase: 'open', done: 0, total: present.length });
  const pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
  const books = [];
  const failed = [];
  for (let i = 0; i < present.length; i++) {
    const b = present[i];
    progress({ projectId, runId, phase: 'read', done: i, total: present.length, book: b.code });
    try {
      const text = await pdp.getBookUSFM(verseRef(b.code, 1, 1));
      if (text !== undefined && text !== null) books.push({ num: b.num, code: b.code, text });
    } catch (e) {
      failed.push(`${b.code}: ${e}`);
    }
  }
  const sty = await styleTable(projectId, books.length > 0 ? books[0].num : 1);
  progress({ projectId, runId, phase: 'check', done: present.length, total: present.length });
  const result = PC.runCheck(def, { books, options: used, sty });
  progress({ projectId, runId, phase: 'report', done: present.length, total: present.length });
  if (runId) setTimeout(() => runs.delete(`${projectId}|${runId}`), 5000);
  const language = lang || (await interfaceLanguage());
  return {
    checkId,
    options: used,
    booksRead: result.booksRead,
    failed,
    count: result.findings.length,
    css: PC.report.css(def),
    html: PC.report.section(def, result, language),
    rows: run && run.withRows ? PC.findingRows(result, language) : undefined,
  };
}

/** Goes to "BOOK C:V" (a bare "BOOK" goes to its start) in the project's scroll group. */
async function goTo(projectId, ref) {
  const m = /^(\S+)(?:\s+(\d+)(?::(\S+))?)?$/.exec(String(ref || '').trim());
  if (!m) return false;
  const chapter = m[2] ? parseInt(m[2], 10) : 1;
  const verse = m[3] ? PC.usfm.verseNumber(m[3]) : 1;
  await papi.scrollGroups.setScrRef(undefined, verseRef(m[1], Math.max(1, chapter), verse), projectId);
  return true;
}

// ------------------------------------------------------------ the checks in the Checks panel

const VERSE_START_RE = /\\v\s+\S+\s?/g;

/** Offset of pos within its verse's text (after "\v N "); 0 at the \v itself. */
function verseOffset(chapterText, pos) {
  let last = null;
  VERSE_START_RE.lastIndex = 0;
  let m;
  while ((m = VERSE_START_RE.exec(chapterText)) !== null && m.index <= pos) last = m;
  VERSE_START_RE.lastIndex = 0;
  if (!last) return 0;
  return Math.max(0, pos - (last.index + last[0].length));
}

function refNumber(book, chapter, verse) {
  return book * 1000000 + chapter * 1000 + verse;
}

function inRange(range, bookNum, chapter, verse) {
  const s = range.start;
  const e = range.end || range.start;
  const n = refNumber(bookNum, chapter, verse);
  const lo = refNumber(PC.usfm.bookNumber(s.book), s.chapterNum, s.verseNum);
  const hi = refNumber(PC.usfm.bookNumber(e.book), e.chapterNum, range.end ? e.verseNum : s.verseNum);
  return n >= lo && n <= hi;
}

function checkDetailsOf(def) {
  return Object.freeze({
    checkName: `%philsChecks_check_${def.id}_name%`,
    checkDescription: `%philsChecks_check_${def.id}_description%`,
  });
}

/** One P10 check object for one of our checks; each book is checked on its own and cached. */
class PanelCheck {
  constructor(def) {
    this.def = def;
    this.details = checkDetailsOf(def);
    this.projectId = undefined;
    this.cache = new Map(); // bookNum -> { text, findings }
  }

  async initialize(projectId) {
    this.projectId = projectId;
    this.cache.clear();
    try {
      this.pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
      this.options = await loadOptions(projectId, this.def.id);
      this.lang = await interfaceLanguage();
      this.sty = undefined;
    } catch (e) {
      return [String(e)];
    }
    return [];
  }

  async dispose() {
    this.projectId = undefined;
    this.pdp = undefined;
    this.cache.clear();
    return true;
  }

  getCheckDetails() {
    return this.details;
  }

  async getCheckResults(range) {
    if (!this.pdp) throw new Error('Check not initialized');
    const first = PC.usfm.bookNumber(range.start.book);
    const last = range.end ? PC.usfm.bookNumber(range.end.book) : first;
    const L = PC.report.lang(this.lang);
    const results = [];
    for (let bookNum = first; bookNum <= last && bookNum > 0; bookNum++) {
      const code = PC.usfm.bookCode(bookNum);
      let text;
      try {
        text = await this.pdp.getBookUSFM(verseRef(code, 1, 1));
      } catch (e) {
        continue;
      }
      if (!text) continue;
      let cached = this.cache.get(bookNum);
      if (!cached || cached.text !== text) {
        if (!this.sty) this.sty = await styleTable(this.projectId, bookNum);
        const result = PC.runCheck(this.def, { books: [{ num: bookNum, code, text }], options: this.options, sty: this.sty });
        cached = { text, findings: result.findings.filter((f) => f.inList) };
        this.cache.set(bookNum, cached);
      }
      const seen = new Map();
      for (const f of cached.findings) {
        const v = PC.usfm.verseNumber(f.verse);
        if (!inRange(range, bookNum, f.chapter, v)) continue;
        const ref = verseRef(code, f.chapter, v);
        const key = `${f.chapter}:${v}:${f.category}`;
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        const offStart = verseOffset(f.chapterText, f.begin);
        const offEnd = verseOffset(f.chapterText, f.end);
        const message = f.localize ? f.localize(L) : f.message;
        results.push({
          checkResultType: `${this.def.id}.${f.category}`,
          checkResultUniqueId: `${f.category}#${n}`,
          projectId: this.projectId,
          verseText: f.context || '',
          itemText: f.context || message,
          messageFormatString: '%philsChecks_message%',
          formatStringArguments: { message },
          isDenied: false,
          verseRef: ref,
          start: { verseRef: ref, offset: offStart },
          end: { verseRef: ref, offset: Math.max(offStart, offEnd) },
        });
      }
    }
    return results;
  }
}

/** platform-scripture may activate after us: try for a while, in the background. */
function registerChecksWhenReady(context) {
  PC.checks.forEach((def) => {
    let tries = 0;
    const attempt = async () => {
      tries += 1;
      try {
        const unsubscribe = await papi.commands.sendCommand(
          'platformScripture.registerCheck',
          checkDetailsOf(def),
          async () => new PanelCheck(def),
        );
        context.registrations.add(unsubscribe);
        logger.info(`Phils Checks: check ${def.id} registered`);
      } catch (e) {
        if (tries < 30) setTimeout(attempt, 2000);
        else logger.error(`Phils Checks: could not register the check ${def.id}: ${e}`);
      }
    };
    attempt();
  });
}

// ------------------------------------------------------------ the window

const TITLES = {
  en: 'Phils Custom (cms) Checks',
  es: 'Verificaciones personalizadas (cms) de Phil',
  fr: 'V\u00E9rifications personnalis\u00E9es (cms) de Phil',
};

const projectNames = new Map();

/** The project's name, waiting at most 0.3 s (opening a project can take long); cached. */
async function quickProjectName(projectId) {
  if (projectNames.has(projectId)) return projectNames.get(projectId);
  const name = projectName(projectId).then((n) => {
    projectNames.set(projectId, n);
    return n;
  });
  return Promise.race([name, new Promise((resolve) => setTimeout(() => resolve(''), 300))]);
}

async function webViewHtml(projectId) {
  const lang = await interfaceLanguage();
  const boot = { projectId, lang, version: PCX_VERSION, projectName: await quickProjectName(projectId), otherBooks: await loadOtherBooks(projectId) };
  // JSON inside a <script>: keep "</script>" and U+2028/9 from ending or breaking it.
  const json = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return PCX_WEB_VIEW_HTML.replace('__PCX_BOOT__', json);
}

const webViewProvider = {
  async getWebView(savedWebView, options) {
    if (savedWebView.webViewType !== WEB_VIEW_TYPE)
      throw new Error(`${WEB_VIEW_TYPE} provider received a request for ${savedWebView.webViewType}`);
    const projectId = (options && options.projectId) || savedWebView.projectId;
    if (!projectId) return undefined;
    const lang = await interfaceLanguage();
    const name = await quickProjectName(projectId);
    return {
      ...savedWebView,
      title: name ? `${TITLES[lang]} - ${name}` : TITLES[lang],
      projectId,
      contentType: 'html',
      content: await webViewHtml(projectId),
    };
  },
};

async function openWindow(editorWebViewId) {
  let projectId;
  if (typeof editorWebViewId === 'string' && editorWebViewId) {
    try {
      const def = await papi.webViews.getOpenWebViewDefinition(editorWebViewId);
      projectId = def && def.projectId;
    } catch (e) {
      logger.warn(`Phils Checks: could not read the editor's project: ${e}`);
    }
  }
  if (!projectId) {
    try {
      projectId = await papi.dialogs.selectProject({
        title: TITLES.en,
        prompt: 'Choose the project to check',
        includeProjectInterfaces: ['platformScripture.USFM_Book'],
      });
    } catch (e) {
      logger.warn(`Phils Checks: project chooser failed: ${e}`);
    }
  }
  if (!projectId) return undefined;
  return papi.webViews.openWebView(
    WEB_VIEW_TYPE,
    { type: 'float', floatSize: { width: 1100, height: 720 } },
    { existingId: '?', existingProjectId: projectId, projectId },
  );
}

// ------------------------------------------------------------ activation

async function activate(context) {
  logger.info(`Phils Checks ${PCX_VERSION} is activating`);
  executionToken = context.executionToken;

  const register = papi.webViewProviders.registerWebViewProvider || papi.webViewProviders.register;
  const registrations = await Promise.all([
    register.call(papi.webViewProviders, WEB_VIEW_TYPE, webViewProvider),
    papi.commands.registerCommand('philsChecks.open', openWindow, docs('Open the Phils Custom (cms) Checks window')),
    papi.commands.registerCommand('philsChecks.list', listChecks, docs('List the checks')),
    papi.commands.registerCommand('philsChecks.run', runFromWindow, docs('Run a check on a project')),
    papi.commands.registerCommand('philsChecks.loadOptions', loadOptions, docs('Read the options of a check for a project')),
    papi.commands.registerCommand('philsChecks.saveOptions', saveOptions, docs('Save the options of a check for a project')),
    papi.commands.registerCommand('philsChecks.goTo', goTo, docs('Go to a verse')),
    papi.commands.registerCommand('philsChecks.progress', getProgress, docs('Progress of a run started from the window')),
    papi.commands.registerCommand('philsChecks.projectName', projectName, docs("A project's name")),
  ]);
  registrations.forEach((r) => context.registrations.add(r));
  try {
    const create = papi.network.createNetworkEventEmitterAsync || papi.network.createNetworkEventEmitter;
    progressEmitter = await create.call(papi.network, PROGRESS_EVENT, {
      notification: { summary: 'Progress of a Phils Checks run, for its window', params: [] },
    });
    if (progressEmitter && progressEmitter.dispose) context.registrations.add(() => progressEmitter.dispose());
  } catch (e) {
    logger.warn(`Phils Checks: no progress events (${e})`);
  }
  registerChecksWhenReady(context);
  await MarkerSpaces.activate(context);
  await NumberedMarkers.activate(context);
  await NumberedBookTitles.activate(context);
  await ProjectSettings.activate(context);
  await AutoCorrect.activate(context);
  logger.info(`Phils Checks is finished activating (${PC.checks.size} checks + Marker Spaces)`);
}

async function deactivate() {
  await MarkerSpaces.deactivate();
  return true;
}

exports.activate = activate;
exports.deactivate = deactivate;

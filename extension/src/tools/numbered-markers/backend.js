// Numbered Markers backend (built into Phils Checks; tools/build.py wraps it in its own scope).
// The scan and the conversion of Numbered_Markers\NumberedMarkersPlugin, on Paratext 10's text:
// each book is read and written whole; a book that changed since the scan is left alone.
/* global PCTools, NMCore, NM_WINDOW_HTML, NM_STRINGS */
const sessions = new Map(); // projectId -> { scan, texts: Map(code -> text) }

function fmt(s, ...args) {
  return PC.report.format(s, args);
}

function directionText(S, family, direction) {
  return fmt(direction === NMCore.REMOVE ? S.DirRemove : S.DirAdd, family);
}

/** One window row for a family, with what each possible direction would change. */
function row(f, kind, S, canEdit) {
  const directions = kind === 'mixed' ? [NMCore.ADD].concat(f.canRemoveNumber() ? [NMCore.REMOVE] : []) : [f.oneFormDirection()];
  const byDirection = {};
  directions.forEach((d) => {
    const books = Array.from(f.placesFor(d).chapters.keys());
    byDirection[d] = {
      label: directionText(S, f.name, d),
      canConvert: canEdit ? books.join(', ') : '',
      cannotEdit: canEdit ? '' : books.join(', '),
      where: f.placesFor(d).whereText(S.More),
      books: books.length,
    };
  });
  return {
    family: f.name,
    kind,
    bare: f.bare,
    levels: f.levelList(true),
    other: f.levelList(false),
    directions,
    defaultDirection: kind === 'mixed' ? f.defaultDirection() : f.oneFormDirection(),
    byDirection,
  };
}

async function scan(ctx, lang) {
  const S = Object.assign({}, NM_STRINGS.en, NM_STRINGS[lang] || {});
  const read = await ctx.readChosen();
  const result = NMCore.newResult();
  const texts = new Map();
  read.books.forEach((b) => {
    texts.set(b.code, b.text);
    NMCore.scanBook(result, b.code, b.text, S.IntroLabel);
  });
  sessions.set(ctx.projectId, { scan: result, texts });
  const canEdit = await ctx.canEdit();
  const consistent = NMCore.consistent(result)
    .map((f) => (f.bare > 0 ? '\\' + f.name + ' (' + f.bare + ')' : f.levelList(true)))
    .join(', ');
  return {
    booksRead: read.books.length,
    failed: read.failed,
    mixed: NMCore.mixed(result).map((f) => row(f, 'mixed', S, canEdit)),
    oneForm: NMCore.oneForm(result).map((f) => row(f, 'oneForm', S, canEdit)),
    consistent,
    showOther: result.families.some((f) => f.isUsed() && f.levelList(false).length > 0),
  };
}

/** payload = {choices: {family: 'AddNumber'|'RemoveNumber'}}. Returns the report for the window. */
async function apply(ctx, payload, lang) {
  const S = Object.assign({}, NM_STRINGS.en, NM_STRINGS[lang] || {});
  const report = { changes: [], total: 0, booksChanged: 0, noPermission: [], changed: [], failed: [], backups: 0 };
  const session = sessions.get(ctx.projectId);
  if (!session) throw new Error('Scan the project first.');
  const choices = (payload && payload.choices) || {};
  const plan = [];
  session.texts.forEach((text, code) => {
    const chapters = NMCore.chaptersFor(session.scan, choices, code);
    if (chapters.length > 0) plan.push({ code, num: PC.usfm.bookNumber(code), chapters, text });
  });
  plan.sort((a, b) => a.num - b.num);
  if (plan.length === 0) return report;
  if (!(await ctx.canEdit())) {
    report.noPermission = plan.map((p) => p.code);
    return report;
  }
  const stamp = ctx.stamp();
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    ctx.progress({ phase: 'write', done: i, total: plan.length, book: p.code });
    let current;
    try {
      current = await ctx.readBook(p.code);
    } catch (e) {
      report.failed.push(`${p.code}: ${e}`);
      continue;
    }
    if (current !== p.text) {
      report.changed.push(p.code);
      continue;
    }
    const r = NMCore.convertBook(current, p.chapters, choices);
    if (r.changedChapters.length === 0) continue;
    const w = await ctx.writeBook(p.code, current, r.text, stamp);
    if (!w.ok) {
      report.failed.push(`${p.code}: ${w.error === 'notSaved' ? S.NotSaved : w.error}`);
      continue;
    }
    // Paratext may normalize what it stores: the markers must really have changed.
    if (w.after !== undefined && w.after !== null && NMCore.leftAfter(w.after, r.changedChapters, choices) > 0) {
      report.failed.push(`${p.code}: ${S.NotSaved}`);
      report.backups++;
      continue;
    }
    report.booksChanged++;
    report.backups++;
    NMCore.NAMES.forEach((name) => {
      const n = r.counts[name] || 0;
      if (n > 0) {
        report.changes.push({ book: p.code, family: name, direction: choices[name], count: n });
        report.total += n;
      }
    });
  }
  sessions.delete(ctx.projectId);
  return report;
}

const NumberedMarkersTool = PCTools.backend({
  id: 'numberedMarkers',
  webViewType: 'philsChecks.numberedMarkers',
  version: NM_STRINGS.version,
  strings: NM_STRINGS,
  html: NM_WINDOW_HTML,
  size: { width: 1150, height: 720 },
  scan,
  apply,
});

return NumberedMarkersTool;

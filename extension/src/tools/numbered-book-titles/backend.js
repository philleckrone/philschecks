// Numbered Book Titles backend (built into Phils Checks; tools/build.py wraps it in its own scope).
// The scan and the fix of Numbered_Book_Titles\NumberedBookTitlesPlugin on Paratext 10's text.
// BookNames.xml is not available to extensions, so its fields are never compared (the window
// says so). A fix changes only chapter 1 (the header); a book whose chapter 1 changed since the
// scan is left alone.
/* global PCTools, NBTCore, NBT_WINDOW_HTML, NBT_STRINGS */
const sessions = new Map(); // projectId -> { scan, texts: Map(code -> text) }

function fmt(s, ...args) {
  return PC.report.format(s, args);
}

function key(issue) {
  return issue.titles.num + ':' + issue.field;
}

/** UsualText: the usual style with its count, or the tie's counts. */
function usualText(S, r) {
  let total = 0;
  r.counts.forEach((v) => (total += v));
  if (r.usual === null) {
    const counts = Array.from(r.counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map((kv) => kv[1] + ' \u00D7 ' + S.StyleNames[kv[0]])
      .join(', ');
    return fmt(S.NoUsual, counts);
  }
  return fmt(S.UsualCount, S.StyleNames[r.usual], r.counts.get(r.usual), total);
}

function matrix(S, result) {
  const fields = NBTCore.FIELDS.map((_, f) => f).filter((f) => result.books.some((b) => !!b.values.get(f)));
  const resultFor = (f) => result.results.find((r) => r.field === f) || null;
  const usual = fields.map((f) => {
    const r = resultFor(f);
    if (r) return { text: r.usual !== null ? S.StyleNames[r.usual] : S.NoUsualShort, tip: usualText(S, r) };
    const any = result.books.find((b) => !!b.values.get(f));
    const text = any ? S.StyleNames[NBTCore.styleOf(any.values.get(f)).style] : '';
    return { text, tip: text };
  });
  const rows = result.books.map((b) => ({
    book: b.code,
    cells: fields.map((f) => {
      const v = b.values.get(f);
      if (!v) return { missing: true, text: S.Missing };
      const r = resultFor(f);
      return {
        text: v.replace(/\u00A0/g, '\u00B7'),
        tip: S.StyleNames[NBTCore.styleOf(v).style],
        odd: !!(r && r.outliers.has(b.num)),
      };
    }),
  }));
  return { fields: fields.map((f) => S.FieldNames[f]), usual, rows };
}

/** extra = {bookNamesXml} when the window read the project folder: the book names are compared too. */
async function scan(ctx, lang, extra) {
  const S = Object.assign({}, NBT_STRINGS.en, NBT_STRINGS[lang] || {});
  const read = await ctx.readChosen();
  const bookNames = extra && extra.bookNamesXml ? NBTCore.parseBookNames(extra.bookNamesXml) : null;
  const result = NBTCore.scan(read.books, bookNames);
  const texts = new Map(read.books.map((b) => [b.code, b.text]));
  sessions.set(ctx.projectId, { scan: result, texts });
  const canEdit = await ctx.canEdit();
  return {
    booksRead: read.books.length,
    failed: read.failed,
    summary: fmt(S.Summary, result.books.length, result.issueCount),
    numberedBooks: result.books.length,
    bookNames: !!bookNames,
    rows: result.issues.map((i) => ({
      key: key(i),
      book: i.titles.code,
      field: S.FieldNames[i.field],
      line: i.target ? '\\' + i.target.marker : '',
      now: i.target ? i.target.value : i.text,
      style: S.StyleNames[i.style],
      usual: usualText(S, i.result),
      changeTo: i.newValue || '',
      fixable: !!i.target,
      canFix: NBTCore.canFix(i),
      permission: i.target && !canEdit ? S.CannotEdit : '',
    })),
    matrix: matrix(S, result),
  };
}

/** payload = {rows: [{key, newValue}]}: the ticked rows with their "Change to" text. */
async function apply(ctx, payload, lang) {
  const S = Object.assign({}, NBT_STRINGS.en, NBT_STRINGS[lang] || {});
  const report = { fixed: [], total: 0, booksChanged: 0, noPermission: [], changed: [], failed: [], backups: 0 };
  const session = sessions.get(ctx.projectId);
  if (!session) throw new Error('Scan the project first.');
  const wanted = new Map(((payload && payload.rows) || []).map((r) => [r.key, r.newValue]));
  const chosen = session.scan.issues.filter((i) => wanted.has(key(i)));
  chosen.forEach((i) => (i.newValue = wanted.get(key(i))));
  const byBook = new Map();
  chosen.filter(NBTCore.canFix).forEach((i) => {
    if (!byBook.has(i.titles.num)) byBook.set(i.titles.num, []);
    byBook.get(i.titles.num).push(i);
  });
  const nums = Array.from(byBook.keys()).sort((a, b) => a - b);
  if (nums.length === 0) return report;
  if (!(await ctx.canEdit())) {
    report.noPermission = nums.map((n) => PC.usfm.bookCode(n));
    return report;
  }
  const stamp = ctx.stamp();
  for (let k = 0; k < nums.length; k++) {
    const issues = byBook.get(nums[k]);
    const t = issues[0].titles;
    ctx.progress({ phase: 'write', done: k, total: nums.length, book: t.code });
    let current;
    try {
      current = await ctx.readBook(t.code);
    } catch (e) {
      report.failed.push(`${t.code}: ${e}`);
      continue;
    }
    const old = NBTCore.readChapter1(current);
    if (old === null || old !== t.chapterText) {
      report.changed.push(t.code);
      continue;
    }
    const text = NBTCore.apply(old, issues);
    if (text === old) continue;
    const newBook = NBTCore.replaceChapter1(current, text);
    if (newBook === null) {
      report.failed.push(`${t.code}: no chapter 1`);
      continue;
    }
    const w = await ctx.writeBook(t.code, current, newBook, stamp);
    if (!w.ok) {
      report.failed.push(`${t.code}: ${w.error === 'notSaved' ? S.NotSaved : w.error}`);
      continue;
    }
    report.backups++;
    // Paratext normalizes what it stores: every changed line must hold its new text.
    const now = NBTCore.readChapter1(w.after);
    if (now === null || (now !== text && !NBTCore.allStored(t.num, t.code, now, issues))) {
      report.failed.push(`${t.code}: ${S.NotSaved}`);
      continue;
    }
    report.fixed.push({ book: t.code, count: issues.length });
    report.total += issues.length;
    report.booksChanged++;
  }
  sessions.delete(ctx.projectId);
  return report;
}

const NumberedBookTitlesTool = PCTools.backend({
  id: 'numberedBookTitles',
  webViewType: 'philsChecks.numberedBookTitles',
  version: NBT_STRINGS.version,
  strings: NBT_STRINGS,
  html: NBT_WINDOW_HTML,
  size: { width: 1250, height: 720 },
  scan,
  apply,
});

return NumberedBookTitlesTool;

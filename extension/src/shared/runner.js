// Phils Checks core, part 5: running a check.
// A port of Project_Checker\ProjectChecker\Checks\CheckBase.cs: the checkAllChapters loop and the
// outputError-style findings.
//
// A check is defined with PC.define({...}):
//   id, cssPrefix, original     as in Project Checker (id is also the key of its strings)
//   kind                        'report' (read-only) for now
//   options: [{name, type: 'bool'|'int'|'text', def}]
//   beginRun(run), beginBook(run, book), checkChapter(run, ch), endBook(run, book), endRun(run)
//   reportCss                   CSS of its report section (classes start with cssPrefix + '-')
//   renderReport(w, result, L)  its report section body; without it, the default grouped table
//   diffData(result)            the original-format report data the tests compare
// The run object gives state (run.state), options (run.opt), the stylesheet (run.sty) and emit.
PC.checks = new Map();

PC.define = function (def) {
  PC.checks.set(def.id, def);
  return def;
};

PC.runCheck = (function () {
  'use strict';

  function Run(def, ctx) {
    this.def = def;
    this.ctx = ctx;
    this.sty = ctx.sty || new Map();
    this.state = {};
    this.result = { checkId: def.id, findings: [], optionsUsed: {}, notes: [], reportData: null, booksRead: [] };
  }

  /** The option's value as a string (the default when not set), as CheckBase.Opt. */
  Run.prototype.opt = function (name) {
    var o = this.ctx.options || {};
    for (var i = 0; i < this.def.options.length; i++) {
      var d = this.def.options[i];
      if (d.name === name) return o[name] !== undefined && o[name] !== null ? String(o[name]) : d.def;
    }
    return o[name] !== undefined && o[name] !== null ? String(o[name]) : '';
  };

  /** A note shown above the report: a string key (of PC.strings) and its {0} {1} arguments. */
  Run.prototype.addNote = function (key) {
    this.result.notes.push({ key: key, args: Array.prototype.slice.call(arguments, 1) });
  };

  /** checking.outputError(begin, end, msg): a finding in the results list. */
  Run.prototype.emit = function (ch, begin, end, message, category) {
    var b = Math.max(0, Math.min(begin, ch.text.length));
    var e = Math.max(b, Math.min(end, ch.text.length));
    var text = ch.text.substring(b, e);
    var f = {
      checkId: this.def.id,
      category: category,
      bookNum: ch.bookNum,
      bookCode: ch.bookCode,
      chapter: ch.chapter,
      verse: PC.usfm.verseAt(ch.text, begin),
      begin: begin,
      end: end,
      text: text,
      message: message,
      context: PC.usfm.collapseWhitespace(text),
      inList: true,
      extra: {},
      localize: null,
      chapterText: ch.text,
    };
    this.result.findings.push(f);
    return f;
  };

  /** A row that exists only in the original's HTML report (no outputError call). */
  Run.prototype.emitReportOnly = function (bookNum, message, category) {
    var f = {
      checkId: this.def.id,
      category: category,
      bookNum: bookNum,
      bookCode: PC.usfm.bookCode(bookNum),
      chapter: 0,
      verse: '0',
      begin: -1,
      end: -1,
      text: null,
      message: message,
      context: null,
      inList: false,
      extra: {},
      localize: null,
      chapterText: null,
    };
    this.result.findings.push(f);
    return f;
  };

  /**
   * Runs one check. ctx = {books: [{num, code, text}], options: {name: value}, sty: Map}.
   * Books are taken in the order given (book number order).
   */
  function runCheck(def, ctx) {
    var run = new Run(def, ctx);
    def.options.forEach(function (d) {
      run.result.optionsUsed[d.name] = run.opt(d.name);
    });
    if (def.beginRun) def.beginRun(run);
    (ctx.books || []).forEach(function (book) {
      if (book.text === undefined || book.text === null) return;
      run.result.booksRead.push(book.code);
      var chapters = PC.usfm.splitChapters(book.num, book.code, book.text);
      if (def.beginBook) def.beginBook(run, book);
      chapters.forEach(function (ch) {
        def.checkChapter(run, ch);
      });
      if (def.endBook) def.endBook(run, book);
    });
    if (def.endRun) def.endRun(run);
    return run.result;
  }

  return runCheck;
})();

/** Findings as plain rows (no functions, no chapter text) in language lang, for the window. */
PC.findingRows = function (result, lang) {
  var L = PC.report.lang(lang);
  return result.findings.map(function (f, i) {
    var cat = L.str('Cat_' + f.checkId + '_' + f.category);
    return {
      id: i,
      category: f.category,
      categoryText: cat.indexOf('Cat_') === 0 ? f.category : cat,
      book: f.bookCode,
      chapter: f.chapter,
      verse: f.verse,
      inList: f.inList,
      reference: f.inList ? f.bookCode + ' ' + f.chapter + ':' + f.verse : f.bookCode,
      text: f.context,
      message: f.localize ? f.localize(L) : f.message,
    };
  });
};

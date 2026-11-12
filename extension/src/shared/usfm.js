// Phils Checks core, part 2: books and USFM plumbing.
// A port of Project_Checker\ProjectChecker\Services\BookCatalog.cs, ChapterSplitter.cs and Usfm.cs.
PC.usfm = (function () {
  'use strict';

  /** Paratext's canonical book list: the 1-based index is the book number. */
  var BOOKS = (
    'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM ' +
    'EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP ' +
    'COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV TOB JDT ESG WIS SIR BAR LJE S3Y SUS ' +
    'BEL 1MA 2MA 3MA 4MA 1ES 2ES MAN PS2 ODA PSS JSA JDB TBS SST DNT BLT XXA XXB XXC XXD XXE XXF XXG FRT ' +
    'BAK OTH 3ES EZA 5EZ 6EZ INT CNC GLO TDX NDX DAG PS3 2BA LBA JUB ENO 1MQ 2MQ 3MQ REP 4BA LAO'
  ).split(' ');

  function bookCode(num) {
    return num >= 1 && num <= BOOKS.length ? BOOKS[num - 1] : null;
  }

  function bookNumber(code) {
    return BOOKS.indexOf(String(code || '').toUpperCase()) + 1;
  }

  // ChapterSplitter: a chapter starts at a line whose first marker is \c N (ASCII digits).
  var CHAPTER_RE = /(?:^|(?<=\n))[ \t]*\\c[ \t]+([0-9]+)/g;

  /**
   * checking.checkAllChapters' cut of one book (ChapterSplitter.Split, IntroInChapter1): the text
   * before the first \c goes with chapter 1. Each chapter: {bookNum, bookCode, chapter, text, start,
   * lastChapter}; start = the chapter text's offset in the book.
   */
  function splitChapters(bookNum, code, usfm) {
    var result = [];
    var starts = [];
    var nums = [];
    CHAPTER_RE.lastIndex = 0;
    var m;
    while ((m = CHAPTER_RE.exec(usfm)) !== null) {
      var n = parseInt(m[1], 10);
      if (n > 2147483647) continue; // int.TryParse fails
      starts.push(m.index);
      nums.push(n);
    }
    CHAPTER_RE.lastIndex = 0;
    if (starts.length === 0) {
      result.push(make(bookNum, code, 1, usfm, 0));
    } else {
      for (var i = 0; i < starts.length; i++) {
        var end = i + 1 < starts.length ? starts[i + 1] : usfm.length;
        if (i === 0) result.push(make(bookNum, code, nums[i], usfm.substring(0, end), 0));
        else result.push(make(bookNum, code, nums[i], usfm.substring(starts[i], end), starts[i]));
      }
    }
    if (result.length > 0) result[result.length - 1].lastChapter = true;
    return result;
  }

  function make(bookNum, code, chapter, text, start) {
    return { bookNum: bookNum, bookCode: code, chapter: chapter, text: text, start: start, lastChapter: false };
  }

  var VERSE_RE = /\\v[ \t\r\n]+([^ \t\r\n\\]+)/g;
  var verseCache = { text: null, starts: [], labels: [] };

  /** Usfm.VerseAt: the label after the last \v starting at or before offset, or "0". */
  function verseAt(text, offset) {
    if (verseCache.text !== text) {
      var starts = [];
      var labels = [];
      VERSE_RE.lastIndex = 0;
      var m;
      while ((m = VERSE_RE.exec(text)) !== null) {
        starts.push(m.index);
        labels.push(m[1]);
      }
      VERSE_RE.lastIndex = 0;
      verseCache = { text: text, starts: starts, labels: labels };
    }
    var verse = '0';
    for (var i = 0; i < verseCache.starts.length; i++) {
      if (verseCache.starts[i] > offset) break;
      verse = verseCache.labels[i];
    }
    return verse;
  }

  /** Usfm.Blank: every match replaced by spaces of the same length (offsets unchanged). */
  function blank(re, text) {
    return PC.re.sub(re, text, function (m) {
      return PC.text.repeat(' ', m[0].length);
    });
  }

  /** Usfm.CollapseWhitespace: CR dropped, LF = space, runs of space/tab = one space. */
  function collapseWhitespace(s) {
    var t = s.replace(/\r/g, '').replace(/\n/g, ' ');
    var out = '';
    var prev = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      var sp = c === ' ' || c === '\t';
      if (sp) {
        if (!prev) out += ' ';
      } else out += c;
      prev = sp;
    }
    return out;
  }

  /** The leading number of a verse label ("5-7" -> 5, "12a" -> 12), 0 when none. */
  function verseNumber(label) {
    var m = /^\d+/.exec(String(label || ''));
    return m ? parseInt(m[0], 10) : 0;
  }

  return {
    BOOKS: BOOKS,
    bookCode: bookCode,
    bookNumber: bookNumber,
    splitChapters: splitChapters,
    verseAt: verseAt,
    blank: blank,
    collapseWhitespace: collapseWhitespace,
    verseNumber: verseNumber,
  };
})();

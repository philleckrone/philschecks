// Numbered Markers core: a port of Numbered_Markers\NumberedMarkersPlugin\MarkerScanner.cs and the
// text part of ConversionRunner.cs, with the chapter cutting of tests\TestHost\FolderBookSource.cs.
// For each marker family (\q, \mt, \s ...) it counts the unnumbered form and each numbered level,
// and changes the unnumbered form to the "1" form (or \X1 to \X). No papi here.
var NMCore = (function () {
  'use strict';
  var R = PC.re;

  /** Families whose unnumbered form is level 1, with the highest level usfm.sty 3.0.11 defines. */
  var FAMILIES = [
    ['imt', 4], ['imte', 2], ['is', 2], ['io', 4], ['ili', 2], ['iq', 3],
    ['mt', 4], ['mte', 2], ['ms', 3], ['s', 4], ['sd', 4], ['pi', 3],
    ['q', 4], ['qm', 3], ['li', 4], ['lim', 4], ['liv', 5], ['ph', 3],
  ];
  var NAMES = FAMILIES.map(function (f) {
    return f[0];
  });
  var MAX_WHERE = 50;
  var ADD = 'AddNumber';
  var REMOVE = 'RemoveNumber';

  /** Longest names first, so \imte is not read as \imt + "e" (a stable sort, as LINQ's). */
  function alternation(names) {
    return names
      .map(function (n, i) {
        return [n, i];
      })
      .sort(function (a, b) {
        return b[0].length - a[0].length || a[1] - b[1];
      })
      .map(function (x) {
        return R.escape(x[0]);
      })
      .join('|');
  }

  // The lookahead after the digits keeps \q from matching \qs, \qc, \li from matching \lit, etc.
  var TOKEN_RE = R.compile('\\\\(?:(c|v)[ \\t]+(\\d+)|(' + alternation(NAMES) + ')(\\d*)(?=[ \\t\\r\\n]|$))');

  var regexCache = new Map();
  function cached(key, make) {
    if (!regexCache.has(key)) regexCache.set(key, make());
    return regexCache.get(key);
  }
  function bareRegex(names) {
    return cached('b' + names.join(','), function () {
      return R.compile('\\\\(' + alternation(names) + ')(?=[ \\t\\r\\n]|$)');
    });
  }
  function level1Regex(names) {
    return cached('1' + names.join(','), function () {
      return R.compile('\\\\(' + alternation(names) + ')1(?=[ \\t\\r\\n]|$)');
    });
  }

  function asciiInt(s) {
    return /^[0-9]+$/.test(s) && s.length < 10 ? parseInt(s, 10) : NaN;
  }

  // ------------------------------------------------------------ places and family statistics

  function Places() {
    this.chapters = new Map(); // book -> sorted array of chapters
    this.where = [];
    this.whereCount = new Map();
    this.whereMore = 0;
  }
  Places.prototype.add = function (book, chapter, loc) {
    var list = this.chapters.get(book);
    if (!list) {
      list = [];
      this.chapters.set(book, list);
    }
    if (list.indexOf(chapter) < 0) {
      list.push(chapter);
      list.sort(function (a, b) {
        return a - b;
      });
    }
    if (this.whereCount.has(loc)) this.whereCount.set(loc, this.whereCount.get(loc) + 1);
    else if (this.where.length < MAX_WHERE) {
      this.where.push(loc);
      this.whereCount.set(loc, 1);
    } else this.whereMore++;
  };
  Places.prototype.whereText = function (moreFormat) {
    var self = this;
    var s = this.where
      .map(function (loc) {
        var n = self.whereCount.get(loc);
        return n === 1 ? loc : loc + ' [' + n + ']';
      })
      .join(', ');
    if (this.whereMore > 0) s += ' ' + PC.report.format(moreFormat, [this.whereMore]);
    return s;
  };

  function Family(name, maxLevel) {
    this.name = name;
    this.maxLevel = maxLevel;
    this.bare = 0;
    this.levels = new Map(); // level -> count
    this.bareBooks = new Map();
    this.barePlaces = new Places();
    this.level1Places = new Places();
  }
  Family.prototype.sortedLevels = function () {
    return Array.from(this.levels.entries()).sort(function (a, b) {
      return a[0] - b[0];
    });
  };
  Family.prototype.level1 = function () {
    return this.levels.get(1) || 0;
  };
  /** A level from 2 to the family's maximum is used (\s5 does not count). */
  Family.prototype.hasHigherLevels = function () {
    var self = this;
    return this.sortedLevels().some(function (l) {
      return l[0] >= 2 && l[0] <= self.maxLevel && l[1] > 0;
    });
  };
  Family.prototype.numbered = function () {
    var self = this;
    return this.sortedLevels().reduce(function (sum, l) {
      return l[0] <= self.maxLevel ? sum + l[1] : sum;
    }, 0);
  };
  Family.prototype.isMixed = function () {
    return this.bare > 0 && this.numbered() > 0;
  };
  Family.prototype.isUsed = function () {
    return this.bare > 0 || this.levels.size > 0;
  };
  Family.prototype.canRemoveNumber = function () {
    return this.isMixed() && !this.hasHigherLevels();
  };
  /** The direction with fewer changes (adding the number on a tie). */
  Family.prototype.defaultDirection = function () {
    return this.canRemoveNumber() && this.level1() < this.bare ? REMOVE : ADD;
  };
  /** For a family that is not mixed: the one change that could be made, or null. */
  Family.prototype.oneFormDirection = function () {
    if (this.isMixed()) return null;
    if (this.bare > 0 && this.numbered() === 0) return ADD;
    if (this.bare === 0 && this.level1() > 0 && !this.hasHigherLevels()) return REMOVE;
    return null;
  };
  Family.prototype.placesFor = function (direction) {
    return direction === REMOVE ? this.level1Places : this.barePlaces;
  };
  /** e.g. "\mt1 (91), \mt2 (30)"; standard = false lists the levels usfm.sty lacks. */
  Family.prototype.levelList = function (standard) {
    var self = this;
    return this.sortedLevels()
      .filter(function (l) {
        return (l[0] <= self.maxLevel) === standard;
      })
      .map(function (l) {
        return '\\' + self.name + l[0] + ' (' + l[1] + ')';
      })
      .join(', ');
  };

  function newResult() {
    var r = { families: [], byName: new Map(), booksScanned: [] };
    FAMILIES.forEach(function (f) {
      var fam = new Family(f[0], f[1]);
      r.families.push(fam);
      r.byName.set(f[0], fam);
    });
    return r;
  }

  /**
   * Adds one book to the counts. Text before \c 1 belongs to chapter 1; a book without \c is all
   * chapter 1.
   */
  function scanBook(result, book, usfm, introLabel) {
    if (!usfm) return;
    result.booksScanned.push(book);
    var chap = '0';
    var verse = '0';
    R.findAll(TOKEN_RE, usfm).forEach(function (m) {
      if (m[1] === 'c') {
        chap = m[2];
        verse = '0';
        return;
      }
      if (m[1] === 'v') {
        verse = m[2];
        return;
      }
      var fam = result.byName.get(m[3]);
      var num = m[4];
      var chapter = chap === '0' ? 1 : asciiInt(chap);
      var loc;
      if (chap === '0') loc = book + ' (' + introLabel + ')';
      else if (verse === '0') loc = book + ' ' + chap;
      else loc = book + ' ' + chap + ':' + verse;
      if (num.length > 0) {
        var level = asciiInt(num);
        if (isNaN(level)) return;
        fam.levels.set(level, (fam.levels.get(level) || 0) + 1);
        if (level === 1) fam.level1Places.add(book, chapter, loc);
        return;
      }
      fam.bare++;
      fam.bareBooks.set(book, (fam.bareBooks.get(book) || 0) + 1);
      fam.barePlaces.add(book, chapter, loc);
    });
  }

  function mixed(result) {
    return result.families.filter(function (f) {
      return f.isMixed();
    });
  }
  function consistent(result) {
    return result.families.filter(function (f) {
      return f.isUsed() && !f.isMixed();
    });
  }
  function oneForm(result) {
    return result.families.filter(function (f) {
      return f.oneFormDirection() !== null;
    });
  }

  // ------------------------------------------------------------ converting

  function replaceCounting(re, usfm, counts, repl) {
    return R.sub(re, usfm, function (m) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
      return repl(m[1]);
    });
  }

  /** \X to \X1 for the given families; counts receives the changes per family. */
  function convertBare(usfm, families, counts) {
    if (!usfm || families.length === 0) return usfm;
    return replaceCounting(bareRegex(families), usfm, counts, function (n) {
      return '\\' + n + '1';
    });
  }

  /** \X1 to \X for the given families. */
  function convertLevel1ToBare(usfm, families, counts) {
    if (!usfm || families.length === 0) return usfm;
    return replaceCounting(level1Regex(families), usfm, counts, function (n) {
      return '\\' + n;
    });
  }

  function countBare(usfm, families) {
    return !usfm || families.length === 0 ? 0 : R.findAll(bareRegex(families), usfm).length;
  }
  function countLevel1(usfm, families) {
    return !usfm || families.length === 0 ? 0 : R.findAll(level1Regex(families), usfm).length;
  }

  // The test host's chapter cutting (Paratext's chapters: chapter 1 includes the header).
  var CHAPTER_RE = R.compile('\\\\c[ \\t]+(\\d+)');

  /** Map chapter -> [start, end]; the first \c of a number wins; no \c = all chapter 1. */
  function chapterSpans(text) {
    var starts = [];
    R.findAll(CHAPTER_RE, text).forEach(function (m) {
      var c = asciiInt(m[1]);
      if (!isNaN(c)) starts.push([c, m.index]);
    });
    var spans = new Map();
    if (starts.length === 0) {
      spans.set(1, [0, text.length]);
      return spans;
    }
    for (var i = 0; i < starts.length; i++) {
      var start = i === 0 ? 0 : starts[i][1];
      var end = i + 1 < starts.length ? starts[i + 1][1] : text.length;
      if (!spans.has(starts[i][0])) spans.set(starts[i][0], [start, end]);
    }
    return spans;
  }

  /** The chapters of book that the chosen families ({family: direction}) would change. */
  function chaptersFor(scan, choices, book) {
    var set = [];
    Object.keys(choices).forEach(function (name) {
      var list = scan.byName.get(name).placesFor(choices[name]).chapters.get(book);
      (list || []).forEach(function (c) {
        if (set.indexOf(c) < 0) set.push(c);
      });
    });
    return set.sort(function (a, b) {
      return a - b;
    });
  }

  function split(choices) {
    var add = [];
    var remove = [];
    Object.keys(choices).forEach(function (n) {
      (choices[n] === REMOVE ? remove : add).push(n);
    });
    return { add: add, remove: remove };
  }

  /**
   * Converts the given chapters of one book, chapter by chapter as the plugin writes them.
   * Returns {text, counts: {family: n}, changedChapters: [..]}; text === the input when nothing
   * changed.
   */
  function convertBook(text, chapters, choices) {
    var sides = split(choices);
    var spans = chapterSpans(text);
    var counts = {};
    var changed = [];
    var pieces = [];
    chapters
      .filter(function (c) {
        return spans.has(c);
      })
      .map(function (c) {
        return [c, spans.get(c)];
      })
      .sort(function (a, b) {
        return a[1][0] - b[1][0];
      })
      .forEach(function (cs) {
        var old = text.substring(cs[1][0], cs[1][1]);
        var chapterCounts = {};
        var t = convertBare(old, sides.add, chapterCounts);
        t = convertLevel1ToBare(t, sides.remove, chapterCounts);
        if (t === old) return;
        pieces.push([cs[1][0], cs[1][1], t]);
        changed.push(cs[0]);
        Object.keys(chapterCounts).forEach(function (k) {
          counts[k] = (counts[k] || 0) + chapterCounts[k];
        });
      });
    if (pieces.length === 0) return { text: text, counts: counts, changedChapters: [] };
    var out = [];
    var pos = 0;
    pieces.forEach(function (p) {
      out.push(text.substring(pos, p[0]), p[2]);
      pos = p[1];
    });
    out.push(text.substring(pos));
    return { text: out.join(''), counts: counts, changedChapters: changed.sort(function (a, b) {
      return a - b;
    }) };
  }

  /** Markers of the chosen families still left in the changed chapters (after a write). */
  function leftAfter(text, chapters, choices) {
    var sides = split(choices);
    var spans = chapterSpans(text);
    return chapters.reduce(function (n, c) {
      var s = spans.get(c);
      if (!s) return n;
      var t = text.substring(s[0], s[1]);
      return n + countBare(t, sides.add) + countLevel1(t, sides.remove);
    }, 0);
  }

  return {
    FAMILIES: FAMILIES,
    NAMES: NAMES,
    ADD: ADD,
    REMOVE: REMOVE,
    newResult: newResult,
    scanBook: scanBook,
    mixed: mixed,
    consistent: consistent,
    oneForm: oneForm,
    convertBare: convertBare,
    convertLevel1ToBare: convertLevel1ToBare,
    countBare: countBare,
    countLevel1: countLevel1,
    chapterSpans: chapterSpans,
    chaptersFor: chaptersFor,
    convertBook: convertBook,
    leftAfter: leftAfter,
  };
})();

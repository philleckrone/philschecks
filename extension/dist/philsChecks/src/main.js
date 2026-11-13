// Phils Custom (cms) Checks 0.8.0 for Paratext 10. Built by tools/build.py from src/ - do not edit.
'use strict';
// Phils Checks core, part 1: Python regexes and string functions as Paratext's IronPython runs them.
// A port of Project_Checker\ProjectChecker\Services\PyRegex.cs, PyText.cs and Fixes.cs.
//
// IronPython's `re` is .NET Regex underneath, so \w \s \d \b have their .NET (Unicode) meaning
// whether or not re.UNICODE is given. JavaScript's do not, so translate() spells them out:
//   \s = [\f\n\r\t\v\x85\p{Z}]   \d = \p{Nd}   \w = [\p{L}\p{Mn}\p{Nd}\p{Pc}]
// and turns . ^ $ \b \A \Z (?P<..>) into their .NET meaning. Offsets are UTF-16 code units in both.
// No papi here: the build puts these files in front of main.js, and the tests load them with
// vm.runInThisContext (see src/order.json).
var PC = {};

PC.re = (function () {
  'use strict';

  var IGNORECASE = 1;
  var MULTILINE = 2;
  var DOTALL = 4;
  var UNICODE = 8;
  var VERBOSE = 16;

  var S_IN = '\\f\\n\\r\\t\\v\\x85\\p{Z}';
  var W_IN = '\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}';
  var W = '[' + W_IN + ']';
  var SYNTAX = '^$\\.*+?()[]{}|/';
  var QUANT_RE = /^\{\d+(,\d*)?\}/;

  function fail(p, why) {
    throw new Error('Python regex not supported (' + why + '): ' + p);
  }

  function isAlnum(c) {
    return /[A-Za-z0-9]/.test(c);
  }

  /** Copies the argument of \x, \u, \p after the escape letter; returns the new index. */
  function copyEscapeArg(p, i, e, out) {
    if (e === 'x') {
      out.push(p.substr(i, 2));
      return i + 2;
    }
    if (e === 'u') {
      out.push(p.substr(i, 4));
      return i + 4;
    }
    if (e === 'p' || e === 'P') {
      var close = p.indexOf('}', i);
      if (p[i] !== '{' || close < 0) fail(p, '\\' + e + ' without {}');
      out.push(p.substring(i, close + 1));
      return close + 1;
    }
    return i;
  }

  /** The pattern of a Python (IronPython) regex as a JavaScript 'u' regex source. */
  function translate(p, flags) {
    flags = flags || 0;
    var out = [];
    var i = 0;
    // Inline flags at the start, e.g. (?u) or (?im).
    var lead = /^\(\?([iLmsux]+)\)/.exec(p);
    if (lead) {
      if (lead[1].indexOf('i') >= 0) flags |= IGNORECASE;
      if (lead[1].indexOf('m') >= 0) flags |= MULTILINE;
      if (lead[1].indexOf('s') >= 0) flags |= DOTALL;
      if (lead[1].indexOf('x') >= 0) flags |= VERBOSE;
      i = lead[0].length;
    }
    var verbose = (flags & VERBOSE) !== 0;
    var inClass = false;
    var classStart = false;
    while (i < p.length) {
      var c = p[i];
      if (c === '\\') {
        if (i + 1 >= p.length) fail(p, 'trailing backslash');
        var e = p[i + 1];
        i += 2;
        if (inClass) {
          classStart = false;
          if (e === 's') out.push(S_IN);
          else if (e === 'w') out.push(W_IN);
          else if (e === 'd') out.push('\\p{Nd}');
          else if (e === 'D') out.push('\\P{Nd}');
          else if (e === 'S' || e === 'W') fail(p, '\\' + e + ' inside []');
          else if (e === 'b') out.push('\\x08');
          else if (e === 'a') out.push('\\x07');
          else if ('tnrfv'.indexOf(e) >= 0) out.push('\\' + e);
          else if ('xupP'.indexOf(e) >= 0) {
            out.push('\\' + e);
            i = copyEscapeArg(p, i, e, out);
          } else if (isAlnum(e)) fail(p, '\\' + e + ' inside []');
          else if (SYNTAX.indexOf(e) >= 0 || e === '-') out.push('\\' + e);
          else out.push(e);
          continue;
        }
        if (e === 's') out.push('[' + S_IN + ']');
        else if (e === 'S') out.push('[^' + S_IN + ']');
        else if (e === 'w') out.push(W);
        else if (e === 'W') out.push('[^' + W_IN + ']');
        else if (e === 'd') out.push('\\p{Nd}');
        else if (e === 'D') out.push('\\P{Nd}');
        else if (e === 'b') out.push('(?:(?<=' + W + ')(?!' + W + ')|(?<!' + W + ')(?=' + W + '))');
        else if (e === 'B') out.push('(?:(?<=' + W + ')(?=' + W + ')|(?<!' + W + ')(?!' + W + '))');
        else if (e === 'A') out.push('(?<![\\s\\S])');
        else if (e === 'Z' || e === 'z') out.push('(?![\\s\\S])');
        else if (e === 'a') out.push('\\x07');
        else if (e === 'e') out.push('\\x1B');
        else if ('tnrfv'.indexOf(e) >= 0) out.push('\\' + e);
        else if ('xupP'.indexOf(e) >= 0) {
          out.push('\\' + e);
          i = copyEscapeArg(p, i, e, out);
        } else if (/[1-9]/.test(e)) out.push('\\' + e);
        else if (isAlnum(e)) fail(p, '\\' + e);
        else if (SYNTAX.indexOf(e) >= 0) out.push('\\' + e);
        else out.push(e);
        continue;
      }
      if (inClass) {
        if (c === ']' && !classStart) inClass = false;
        out.push(c === ']' && classStart ? '\\]' : c);
        classStart = false;
        i++;
        continue;
      }
      if (verbose && /\s/.test(c)) {
        i++;
        continue;
      }
      if (verbose && c === '#') {
        while (i < p.length && p[i] !== '\n') i++;
        continue;
      }
      if (c === '[') {
        inClass = true;
        out.push('[');
        i++;
        if (p[i] === '^') {
          out.push('^');
          i++;
        }
        classStart = true; // a ']' right after '[' or '[^' is a literal
        continue;
      }
      if (c === '(' && p[i + 1] === '?') {
        if (p[i + 2] === 'P' && p[i + 3] === '<') {
          out.push('(?<');
          i += 4;
          continue;
        }
        if (p[i + 2] === 'P' && p[i + 3] === '=') {
          var close = p.indexOf(')', i);
          out.push('\\k<' + p.substring(i + 4, close) + '>');
          i = close + 1;
          continue;
        }
        if (p[i + 2] === '#') {
          i = p.indexOf(')', i) + 1;
          continue;
        }
        if (/[iLmsux]/.test(p[i + 2] || '')) fail(p, 'inline flags inside the pattern');
        out.push('(?');
        i += 2;
        continue;
      }
      if (c === '.') {
        out.push((flags & DOTALL) !== 0 ? '[\\s\\S]' : '[^\\n]');
        i++;
        continue;
      }
      if (c === '^') {
        out.push((flags & MULTILINE) !== 0 ? '(?:^|(?<=\\n))' : '^');
        i++;
        continue;
      }
      if (c === '$') {
        out.push((flags & MULTILINE) !== 0 ? '(?=\\n|$)' : '(?=\\n?$)');
        i++;
        continue;
      }
      if (c === '{') {
        var q = QUANT_RE.exec(p.substring(i));
        if (q) {
          out.push(q[0]);
          i += q[0].length;
        } else {
          out.push('\\{');
          i++;
        }
        continue;
      }
      if (c === '}') {
        out.push('\\}');
        i++;
        continue;
      }
      out.push(c);
      i++;
    }
    if (inClass) fail(p, 'unclosed [');
    return out.join('');
  }

  /** PyRegex.Compile: a global JavaScript regex with .NET/IronPython meaning. */
  function compile(p, flags) {
    var re = new RegExp(translate(p, flags), 'gu' + ((flags || 0) & IGNORECASE ? 'i' : ''));
    re.pySource = p;
    return re;
  }

  function sticky(re) {
    if (!re.pySticky) re.pySticky = new RegExp(re.source, re.flags.replace('g', '') + 'y');
    return re.pySticky;
  }

  /**
   * Python pattern.finditer(text, pos, endpos) / .NET Regex.Matches: every match, an empty match
   * moving on by one UTF-16 unit (as .NET does). endpos makes the string end there.
   */
  function findAll(re, text, pos, endpos) {
    var list = [];
    if (endpos === undefined || endpos > text.length) endpos = text.length;
    pos = pos || 0;
    if (pos > endpos) return list;
    var s = endpos === text.length ? text : text.substring(0, endpos);
    re.lastIndex = pos;
    var m;
    while ((m = re.exec(s)) !== null) {
      list.push(m);
      if (m[0].length === 0) re.lastIndex = m.index + 1;
      if (re.lastIndex > s.length) break;
    }
    re.lastIndex = 0;
    return list;
  }

  /** Python pattern.search(text, pos, endpos): the first match or null. */
  function search(re, text, pos, endpos) {
    if (endpos === undefined || endpos > text.length) endpos = text.length;
    pos = pos || 0;
    if (pos > endpos) return null;
    var s = endpos === text.length ? text : text.substring(0, endpos);
    re.lastIndex = pos;
    var m = re.exec(s);
    re.lastIndex = 0;
    return m;
  }

  /** Python pattern.match(text, pos): anchored at pos; lookbehinds still see the text before it. */
  function matchAt(re, text, pos) {
    if (pos > text.length) return null;
    var y = sticky(re);
    y.lastIndex = pos;
    var m = y.exec(text);
    y.lastIndex = 0;
    return m;
  }

  /** re.sub with a function (or a literal string, used as is). */
  function sub(re, text, repl) {
    var parts = [];
    var pos = 0;
    findAll(re, text).forEach(function (m) {
      parts.push(text.substring(pos, m.index));
      parts.push(typeof repl === 'function' ? repl(m) : repl);
      pos = m.index + m[0].length;
    });
    parts.push(text.substring(pos));
    return parts.join('');
  }

  /** Python re.escape: a backslash before every non-alphanumeric ASCII character except _. */
  function escape(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (!isAlnum(c) && c !== '_' && c.charCodeAt(0) < 128) out += '\\';
      out += c;
    }
    return out;
  }

  return {
    IGNORECASE: IGNORECASE,
    MULTILINE: MULTILINE,
    DOTALL: DOTALL,
    UNICODE: UNICODE,
    VERBOSE: VERBOSE,
    translate: translate,
    compile: compile,
    findAll: findAll,
    search: search,
    matchAt: matchAt,
    sub: sub,
    escape: escape,
  };
})();

/** Python string functions as IronPython has them (PyText.cs). */
PC.text = (function () {
  'use strict';

  // .NET char.IsWhiteSpace (IronPython's isspace, strip and split use it).
  var SPACE_RE = /[\t-\r\x85\p{Z}]/u;
  var MARK_RE = /\p{M}/gu;

  function isSpace(c) {
    return SPACE_RE.test(c);
  }

  function strip(s) {
    if (s === null || s === undefined) return s;
    var a = 0;
    var b = s.length;
    while (a < b && isSpace(s[a])) a++;
    while (b > a && isSpace(s[b - 1])) b--;
    return s.substring(a, b);
  }

  function rstrip(s) {
    var b = s.length;
    while (b > 0 && isSpace(s[b - 1])) b--;
    return s.substring(0, b);
  }

  function lstrip(s) {
    var a = 0;
    while (a < s.length && isSpace(s[a])) a++;
    return s.substring(a);
  }

  /** unicode.strip(chars) */
  function stripChars(s, chars) {
    var a = 0;
    var b = s.length;
    while (a < b && chars.indexOf(s[a]) >= 0) a++;
    while (b > a && chars.indexOf(s[b - 1]) >= 0) b--;
    return s.substring(a, b);
  }

  /** unicode.split() with no separator; maxsplit as in Python when given. */
  function split(s, maxsplit) {
    var parts = [];
    if (s === null || s === undefined) return parts;
    var i = 0;
    while (i < s.length) {
      while (i < s.length && isSpace(s[i])) i++;
      if (i >= s.length) break;
      if (maxsplit !== undefined && parts.length === maxsplit) {
        parts.push(rstrip(s.substring(i)));
        return parts;
      }
      var j = i;
      while (j < s.length && !isSpace(s[j])) j++;
      parts.push(s.substring(i, j));
      i = j;
    }
    return parts;
  }

  /** unicode.splitlines(): IronPython breaks only on CR, LF, CRLF, U+2028 and U+2029. */
  function splitLines(s) {
    var lines = [];
    var start = 0;
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029') {
        lines.push(s.substring(start, i));
        if (c === '\r' && s[i + 1] === '\n') i++;
        start = i + 1;
      }
      i++;
    }
    if (start < s.length) lines.push(s.substring(start));
    return lines;
  }

  function lower(s) {
    return s.toLowerCase();
  }

  /** The accent-insensitive sort key (_sort_fold): NFD, without marks, lower case. */
  function sortFold(s) {
    if (s === null || s === undefined) return '';
    return s.normalize('NFD').replace(MARK_RE, '').toLowerCase();
  }

  /** string.CompareOrdinal: UTF-16 code units, as JavaScript's < compares. */
  function compare(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** Python's == "Yes", case-insensitive (the approved fix, Fixes.IsYes). */
  function isYes(v) {
    return v !== null && v !== undefined && lower(strip(String(v))) === 'yes';
  }

  /** Python u' ' * n */
  function repeat(c, n) {
    return n <= 0 ? '' : new Array(n + 1).join(c);
  }

  return {
    isSpace: isSpace,
    strip: strip,
    rstrip: rstrip,
    lstrip: lstrip,
    stripChars: stripChars,
    split: split,
    splitLines: splitLines,
    lower: lower,
    sortFold: sortFold,
    compare: compare,
    isYes: isYes,
    repeat: repeat,
  };
})();

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

// Phils Checks core, part 3: the stylesheet.
// A port of Project_Checker\ProjectChecker\Services\StylesheetService.cs (the _parse_sty /
// _merge_sty / _flag_on / _color_css / _marker_css shared by the report checks).
// A stylesheet is a Map: marker -> Map(lowercased field name -> value).
// In Paratext 10 it comes from platformScripture.StyleInfo (fromStyleInfo); the built-in usfm.sty
// and the tests use parse + merge.
PC.sty = (function () {
  'use strict';

  var T = PC.text;

  /** ParseStyText: a \Marker line opens an entry; other \Field lines set a field on it. */
  function parse(text) {
    var entries = new Map();
    var current = null;
    T.splitLines(text || '').forEach(function (raw) {
      var stripped = T.strip(raw);
      if (stripped.length === 0 || stripped[0] === '#' || stripped[0] !== '\\') return;
      var parts = T.split(stripped.substring(1), 1);
      if (parts.length === 0) return;
      var field = parts[0];
      var value = parts.length > 1 ? T.strip(parts[1]) : '';
      if (field === 'Marker') {
        current = entries.get(value);
        if (!current) {
          current = new Map();
          entries.set(value, current);
        }
      } else if (current) current.set(T.lower(field), value);
    });
    return entries;
  }

  /** usfm.sty with custom.sty laid over it, field by field. */
  function merge(base, custom) {
    var markers = new Map();
    base.forEach(function (fields, key) {
      markers.set(key, new Map(fields));
    });
    custom.forEach(function (fields, key) {
      var target = markers.get(key);
      if (!target) {
        target = new Map();
        markers.set(key, target);
      }
      fields.forEach(function (v, f) {
        target.set(f, v);
      });
    });
    return markers;
  }

  /**
   * The same table from Paratext 10's StyleInfo (merged usfm.sty + custom.sty, already resolved:
   * \Regular, \Color/\ColorName...). Its color is "#RRGGBB", kept as field "colorcss".
   */
  function fromStyleInfo(info) {
    var markers = new Map();
    var all = (info && info.markers) || {};
    Object.keys(all).forEach(function (key) {
      var s = all[key] || {};
      var f = new Map();
      if (s.styleType) f.set('styletype', String(s.styleType));
      if (s.endMarker) f.set('endmarker', String(s.endMarker));
      if (s.bold) f.set('bold', '');
      if (s.italic) f.set('italic', '');
      if (s.superscript) f.set('superscript', '');
      if (s.smallCaps) f.set('smallcaps', '');
      if (s.underline) f.set('underline', '');
      if (s.color && /^#[0-9a-fA-F]{6}$/.test(s.color)) f.set('colorcss', s.color);
      markers.set(s.marker || key, f);
    });
    return markers;
  }

  /** _flag_on: the field is present and not no/off/false/0. */
  function flagOn(fields, name) {
    if (!fields || !fields.has(name)) return false;
    var v = T.lower(T.strip(fields.get(name) || ''));
    return v !== 'no' && v !== 'off' && v !== 'false' && v !== '0';
  }

  /** _color_css: \Color is a Windows COLORREF decimal (R = low byte, B = high byte). */
  function colorCss(value) {
    if (value === null || value === undefined) return null;
    var v = T.strip(value);
    if (!/^[+-]?\d+$/.test(v)) return null;
    var n = parseInt(v, 10);
    if (!isFinite(n)) return null;
    // long arithmetic: & on a 64-bit value; JavaScript's & works on 32 bits, enough for 3 bytes.
    var r = n & 0xff;
    var g = (n >> 8) & 0xff;
    var b = (n >> 16) & 0xff;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /** _marker_css */
  function markerCss(fields) {
    if (!fields || fields.size === 0) return '';
    var parts = [];
    if (flagOn(fields, 'bold')) parts.push('font-weight:bold');
    if (flagOn(fields, 'italic')) parts.push('font-style:italic');
    if (flagOn(fields, 'superscript')) parts.push('vertical-align:super;font-size:smaller');
    if (flagOn(fields, 'smallcaps')) parts.push('font-variant:small-caps');
    if (flagOn(fields, 'underline')) parts.push('text-decoration:underline');
    if (fields.has('colorcss')) parts.push('color:' + fields.get('colorcss'));
    else if (fields.get('color')) {
      var css = colorCss(fields.get('color'));
      if (css) parts.push('color:' + css);
    }
    return parts.join(';');
  }

  /** Markers whose \StyleType is "character" (case-insensitive). */
  function characterStyles(sty) {
    var set = new Set();
    sty.forEach(function (fields, key) {
      var t = fields.get('styletype');
      if (t !== undefined && T.lower(T.strip(t)) === 'character') set.add(key);
    });
    return set;
  }

  return {
    parse: parse,
    merge: merge,
    fromStyleInfo: fromStyleInfo,
    flagOn: flagOn,
    colorCss: colorCss,
    markerCss: markerCss,
    characterStyles: characterStyles,
  };
})();

// Phils Checks core, part 4: footnote sub-markers.
// A port of Project_Checker\ProjectChecker\Services\FootnoteTokenizer.cs (report_nested_styles.py's
// _tokenize_footnote and SUBMARKER_RE, shared with find_footnotes.py).
PC.footnotes = (function () {
  'use strict';

  var R = PC.re;
  var FOOTNOTE_RE = R.compile('\\\\f\\s(.*?)\\\\f\\*', R.UNICODE | R.DOTALL);
  var SUBMARKER_RE = R.compile('\\\\\\+?[a-zA-Z][a-zA-Z0-9]*\\*?', R.UNICODE);

  /** _FOOTNOTE_LEVEL_MARKERS: the footnote's own structure, never a nested character style. */
  var LEVEL_MARKERS = new Set(['fr', 'fq', 'fqa', 'fk', 'fl', 'fp', 'ft', 'fv', 'fdc', 'fm']);

  /** _style_key: without the USFM 3 nesting '+' and the closing '*'. */
  function styleKey(marker) {
    var k = marker[0] === '+' ? marker.substring(1) : marker;
    return k[k.length - 1] === '*' ? k.substring(0, k.length - 1) : k;
  }

  /**
   * _tokenize_footnote: the inner content as segments {kind: 'text'|'close', marker, text}; the
   * leading text (the caller) has marker null. Every closing token gets its own "close" segment.
   */
  function tokenizeWithCloses(content) {
    var segments = [];
    var outer = null;
    var inner = null;
    var innerDisplay = null;
    var pos = 0;
    R.findAll(SUBMARKER_RE, content).forEach(function (m) {
      flush(segments, content, pos, m.index, inner !== null ? innerDisplay : outer);
      var raw = m[0].substring(1);
      var isClose = raw[raw.length - 1] === '*';
      var bare = raw[0] === '+' ? raw.substring(1) : raw;
      if (isClose) {
        bare = bare.substring(0, bare.length - 1);
        segments.push({ kind: 'close', marker: raw, text: '' });
        if (inner !== null && inner === bare) {
          inner = null;
          innerDisplay = null;
        } else if (outer !== null && outer === bare) outer = null;
      } else if (LEVEL_MARKERS.has(bare)) {
        inner = null;
        innerDisplay = null;
        outer = bare;
      } else {
        inner = bare;
        innerDisplay = raw;
      }
      pos = m.index + m[0].length;
    });
    flush(segments, content, pos, content.length, inner !== null ? innerDisplay : outer);
    return segments;
  }

  function flush(segs, content, start, end, marker) {
    if (end <= start) return;
    segs.push({ kind: 'text', marker: marker, text: content.substring(start, end) });
  }

  return {
    FOOTNOTE_RE: FOOTNOTE_RE,
    SUBMARKER_RE: SUBMARKER_RE,
    LEVEL_MARKERS: LEVEL_MARKERS,
    styleKey: styleKey,
    tokenizeWithCloses: tokenizeWithCloses,
  };
})();

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

// Phils Checks core, part 6: the report.
// A port of Project_Checker\ProjectChecker\Services\ReportRenderer.cs (ReportWriter and one check's
// section). The section is an HTML fragment shown inside the extension's window, so its CSS is
// scoped to .pc-report. References are links (a.pc-go with data-ref "BOOK C:V") that the window
// turns into "go to this verse".
PC.report = (function () {
  'use strict';

  var BASE_CSS =
    '{font-family:"Segoe UI",Arial,sans-serif;color:#222;background:#fff}' +
    ' h2{font-size:1.25em;margin:4px 0 8px;border-bottom:2px solid #446;padding-bottom:3px}' +
    ' h3{font-size:1.05em;margin:14px 0 6px}' +
    ' details.pc-opts{margin:6px 0 10px;font-size:.9em}' +
    ' details.pc-opts table{margin-top:4px}' +
    ' .pc-mod{font-weight:bold;color:#7a3c00}' +
    ' .pc-note{background:#fff7d6;border:1px solid #e5cf7a;padding:4px 8px;margin:6px 0}' +
    ' .pc-fail{background:#fde2e2;border:1px solid #d99;padding:4px 8px;margin:6px 0}' +
    ' details.pc-group{margin:6px 0}' +
    ' details.pc-group>summary{cursor:pointer;font-weight:bold;padding:2px 0}' +
    ' table{border-collapse:collapse;margin:4px 0}' +
    ' th,td{border:1px solid #bbb;padding:3px 8px;vertical-align:top;text-align:left}' +
    ' th{background:#eef}' +
    ' a.pc-go{color:#0b5cad;text-decoration:none;cursor:pointer}' +
    ' a.pc-go:hover{text-decoration:underline}';

  /** Prefixes every selector of a CSS text with ".pc-report ". */
  function scope(css) {
    return css
      .split('}')
      .filter(function (rule) {
        return rule.trim().length > 0;
      })
      .map(function (rule) {
        var brace = rule.indexOf('{');
        var selectors = rule.substring(0, brace).split(',');
        return (
          selectors
            .map(function (s) {
              return '.pc-report ' + s.trim();
            })
            .join(',') +
          rule.substring(brace) +
          '}'
        );
      })
      .join('\n');
  }

  /** The CSS for a check's report section. */
  function css(def) {
    return '.pc-report' + BASE_CSS.split('}')[0] + '}\n' + scope(BASE_CSS.substring(BASE_CSS.indexOf('}') + 1)) + '\n' + scope(def.reportCss || defaultCss(def.cssPrefix));
  }

  function defaultCss(p) {
    return '.' + p + '-hl{color:#c00;font-weight:bold}.' + p + '-ref{white-space:nowrap}';
  }

  /** PyText.HtmlEscape: & < > only. */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Escaped for an attribute value. */
  function attr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  /** string.Format with {0} {1}... */
  function format(template, args) {
    return String(template).replace(/\{(\d+)\}/g, function (m, n) {
      var v = args[parseInt(n, 10)];
      return v === undefined ? m : String(v);
    });
  }

  /** The strings of one language: str(key) falls back to English, then to the key itself. */
  function lang(code) {
    var table = PC.strings[code] || PC.strings.en;
    function str(key) {
      if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
      if (Object.prototype.hasOwnProperty.call(PC.strings.en, key)) return PC.strings.en[key];
      return key;
    }
    return {
      code: PC.strings[code] ? code : 'en',
      str: str,
      fmt: function (key) {
        return format(str(key), Array.prototype.slice.call(arguments, 1));
      },
    };
  }

  /** A link that goes to a verse ("MAT 5:3"; a bare book code goes to its start). */
  function refLink(ref, html) {
    return '<a class="pc-go" data-ref="' + attr(ref) + '">' + (html === undefined ? esc(ref) : html) + '</a>';
  }

  function Writer() {
    this.parts = [];
  }
  Writer.prototype.line = function (html) {
    this.parts.push(html + '\n');
    return this;
  };
  Writer.prototype.toString = function () {
    return this.parts.join('');
  };

  /** CheckBase.RenderReport: one collapsible group per category, Reference | Text | Message. */
  function defaultReport(def, w, result, L) {
    if (result.findings.length === 0) {
      w.line('<p>' + esc(L.str('Rpt_NoFindings')) + '</p>');
      return;
    }
    var order = [];
    var groups = new Map();
    result.findings.forEach(function (f) {
      var cat = f.category || '';
      if (!groups.has(cat)) {
        groups.set(cat, []);
        order.push(cat);
      }
      groups.get(cat).push(f);
    });
    order.forEach(function (cat) {
      var title = L.str('Cat_' + def.id + '_' + cat);
      if (title.indexOf('Cat_') === 0) title = cat;
      var list = groups.get(cat);
      w.line('<details class="pc-group" open><summary>' + esc(title) + ' (' + list.length + ')</summary>');
      w.line(
        '<table><tr><th>' + esc(L.str('Rpt_Reference')) + '</th><th>' + esc(L.str('Rpt_Text')) + '</th><th>' +
          esc(L.str('Rpt_Message')) + '</th></tr>',
      );
      list.forEach(function (f) {
        var ref = f.inList ? f.bookCode + ' ' + f.chapter + ':' + f.verse : f.bookCode;
        w.line(
          '<tr><td class="' + def.cssPrefix + '-ref">' + refLink(ref) + '</td><td>' + esc(f.context || '') + '</td><td>' +
            esc(f.localize ? f.localize(L) : f.message || '') + '</td></tr>',
        );
      });
      w.line('</table></details>');
    });
  }

  /** ReportRenderer.AppendOptions */
  function options(def, result, L) {
    if (def.options.length === 0) return '';
    var html =
      '<details class="pc-opts"><summary>' + esc(L.str('Rpt_OptionsUsed')) + '</summary><table><tr><th>' +
      esc(L.str('Rpt_Option')) + '</th><th>' + esc(L.str('Rpt_Value')) + '</th></tr>';
    def.options.forEach(function (d) {
      var v = result.optionsUsed[d.name];
      if (v === undefined) v = d.def;
      var label = L.str('Opt_' + def.id + '_' + d.name + '_Label');
      if (label.indexOf('Opt_') === 0) label = d.name;
      html +=
        '<tr><td>' + esc(label) + ' <code>' + esc(d.name) + '</code></td><td' + (v !== d.def ? ' class="pc-mod"' : '') + '>' +
        esc(v.length === 0 ? '(' + L.str('Rpt_Empty') + ')' : v) + '</td></tr>';
    });
    return html + '</table></details>\n';
  }

  /** One check's section: heading, options used, notes, then the check's own report. */
  function section(def, result, langCode) {
    var L = lang(langCode);
    var parts = [];
    parts.push('<section class="' + def.cssPrefix + '-section">\n');
    parts.push('<h2>' + esc(L.str('Check_' + def.id + '_Name')) + '</h2>\n');
    parts.push(options(def, result, L));
    result.notes.forEach(function (n) {
      parts.push('<p class="pc-note">' + esc(L.fmt.apply(null, [n.key].concat(n.args))) + '</p>\n');
    });
    var w = new Writer();
    if (def.renderReport) def.renderReport(w, result, L);
    else defaultReport(def, w, result, L);
    parts.push(w.toString());
    parts.push('</section>\n');
    return parts.join('');
  }

  return {
    css: css,
    esc: esc,
    attr: attr,
    format: format,
    lang: lang,
    refLink: refLink,
    Writer: Writer,
    section: section,
  };
})();

// Generated by tools/make_strings.py from Project Checker's Strings.*.xaml - do not edit.
PC.strings = {
 "en": {
  "Cat_footnotes_footnote": "Footnote",
  "Cat_nested_missingplus": "Character style missing +",
  "Cat_qerrors_final": "Final punctuation in q",
  "Cat_qerrors_hanging": "Single word after punctuation",
  "Cat_qerrors_multi": "Poetry line spans multiple verses",
  "Cat_qerrors_verse": "Verse in q",
  "Cat_refnomark_ref": "Unmarked reference",
  "Cat_shortv1_short": "Short verse 1",
  "Cat_titles_missing": "Missing \\mt",
  "Cat_titles_title": "Title",
  "Check_footnotes_Desc": "Lists every footnote with its reference, caller, \\fr reference and text, formatted as in the stylesheet, plus a summary of the markers used. The results list can be searched by reference or by the markers a footnote contains, for example \"fr fq ft\".",
  "Check_footnotes_Name": "Footnotes (\\f)",
  "Check_nested_Desc": "Flags character styles inside footnotes that lack the USFM 3 '+' prefix, for example \\xt instead of \\+xt. Footnote markers such as \\fr, \\fq and \\ft are never flagged. Opening and closing markers are checked separately, so a mismatched pair is caught.",
  "Check_nested_Name": "Report of Nested Styles",
  "Check_qerrors_Desc": "Finds poetry lines (\\q, \\q1, \u2026) with structural problems: text after final punctuation, two verse numbers on one line, or text before a verse number. Optionally flags a single word left after non-final punctuation. Footnotes, cross-references and \\qs are ignored.",
  "Check_qerrors_Name": "Report of Poetry Errors",
  "Check_refnomark_Desc": "Find scripture references in text not enclosed in \\xt, \\rq, \\ior, \\fig, \\r, \\mr, or \\sr markers. Option lets you set the chapter-verse separator character.",
  "Check_refnomark_Name": "Reference without markers",
  "Check_shortv1_Desc": "Flags short verse 1 text between a paragraph marker (\\p or \\m) and the next \\p marker. Options let you set the minimum character count and add other paragraph markers to check.",
  "Check_shortv1_Name": "Short Verse 1",
  "Check_titles_Desc": "Lists the main title (\\mt\u2013\\mt3) of each book, formatted as in the stylesheet, and reports books with no \\mt. Options sort the list by title or by running header (\\h) and add an \\h column.",
  "Check_titles_Name": "Report of Titles",
  "Msg_footnotes_Footnote": "Footnote",
  "Msg_nested_MissingPlus": "Missing +: ",
  "Msg_qerrors_final": "Final punctuation in q",
  "Msg_qerrors_hanging": "Single word after punctuation",
  "Msg_qerrors_multi": "Poetry line spans multiple verses",
  "Msg_qerrors_verse": "Verse in q",
  "Msg_refnomark_Found": "Reference without markers",
  "Msg_shortv1_Chars": "{0} chars (set = {1})",
  "Opt_footnotes_HideMarkers_Label": "Hide markers in HTML report",
  "Opt_footnotes_HideMarkers_Tip": "Yes hides the marker labels (e.g. \\fq, \\+it, \\+it*) shown before each piece of footnote text in the HTML report -- the text keeps its resolved Bold/Italic/Superscript/SmallCaps/Underline/Color styling, only the marker labels themselves are hidden, for a cleaner reading view. No (default) shows the markers alongside the styled text, as today. Does not affect the Section 1 marker/style summary table or the Paratext results list.",
  "Opt_footnotes_SortAlphabetically_Label": "Sort footnotes alphabetically",
  "Opt_footnotes_SortAlphabetically_Tip": "Yes sorts the footnotes listed in the HTML report alphabetically by the footnote's own text (everything except the \\fr reference), so identical or near-identical footnotes end up next to each other for easy comparison. No (default) lists them in canonical book/chapter/verse scan order. Accented/diacritic characters are ignored when determining sort order (but are still displayed normally).",
  "Opt_qerrors_CheckDoubleVerse_Label": "Flag multiple verse markers in one poetry line?",
  "Opt_qerrors_CheckDoubleVerse_Tip": "Choose No to disable checking for two \\v markers within a single \\q/\\q1/\\q2 line (same line or continuing to the next line).",
  "Opt_qerrors_CheckFinalPunct_Label": "Flag final punctuation followed by text?",
  "Opt_qerrors_CheckFinalPunct_Tip": "Choose No to disable checking for final punctuation followed by a word character on the same poetry line.",
  "Opt_qerrors_CheckHangingWord_Label": "Flag line ending with punctuation + single word?",
  "Opt_qerrors_CheckHangingWord_Tip": "Choose Yes to flag any poetry line that ends with non-final punctuation followed by exactly one word (nothing else before end of line). May indicate the final word belongs on the following line.",
  "Opt_qerrors_CheckTextBeforeVerse_Label": "Flag text before verse marker?",
  "Opt_qerrors_CheckTextBeforeVerse_Tip": "Choose No to disable checking for text content appearing before a \\v marker in a poetry line. Normal form is \\q1 \\v N text; bad form is \\q1 text \\v N.",
  "Opt_qerrors_FinalPunctuation_Label": "Final punctuation characters",
  "Opt_qerrors_FinalPunctuation_Tip": "Characters that should end a poetry line. Flags any \\q/\\q1/\\q2 line where one of these is followed by a word character. Default is period, exclamation mark, and question mark.",
  "Opt_qerrors_MinCharsBeforePunct_Label": "Minimum characters before final punctuation",
  "Opt_qerrors_MinCharsBeforePunct_Tip": "Ignore final punctuation that appears fewer than this many characters into the poetry line text. Use this to suppress false positives on very short lines. Set to 0 to check all lines regardless of length.",
  "Opt_qerrors_NonFinalPunctuation_Label": "Non-final punctuation characters",
  "Opt_qerrors_NonFinalPunctuation_Tip": "Used only when \"Flag hanging word\" is Yes. Characters considered mid-line (non-final) punctuation.",
  "Opt_refnomark_ChapterVerseSep_Label": "Chapter-verse separator",
  "Opt_refnomark_ChapterVerseSep_Tip": "Character separating chapter from verse numbers (from Settings.xml ChapterVerseSeparator: normally : or .).",
  "Opt_shortv1_CheckOtherMarkers_Label": "Check Other Markers",
  "Opt_shortv1_CheckOtherMarkers_Tip": "Choose Yes to also check additional paragraph markers (listed below) before and after verse 1, in addition to the defaults (\\p and \\m before, \\p after).",
  "Opt_shortv1_MinChars_Label": "Minimum Characters",
  "Opt_shortv1_MinChars_Tip": "Minimum number of characters expected in verse 1 before the next paragraph marker. Shorter verse 1s will be flagged.",
  "Opt_shortv1_OtherMarkers_Label": "Other Markers",
  "Opt_shortv1_OtherMarkers_Tip": "Space-separated list of additional paragraph markers to check (without backslash), e.g.: q q1 q2 q3 q4. Only used when Check Other Markers is Yes.",
  "Opt_titles_DisplayHeader_Label": "Display Header",
  "Opt_titles_DisplayHeader_Tip": "Yes (default) adds a column to the report showing the \\h (running header) text for each book, or \"missing\" if absent. No shows only the \\mt title. Automatically turned on if Sort by Header below is Yes.",
  "Opt_titles_SortByHeader_Label": "Sort by Header",
  "Opt_titles_SortByHeader_Tip": "No (default). Yes sorts the report alphabetically by \\h text instead, overriding Sort by Title above, and automatically displays the Header column even if Display Header above is No (accented/diacritic characters are ignored when determining sort order, but are still displayed normally; books missing \\h text sort to the end).",
  "Opt_titles_SortByTitle_Label": "Sort by Title",
  "Opt_titles_SortByTitle_Tip": "No (default) lists books in canonical scan order. Yes sorts the report alphabetically by \\mt title text instead (accented/diacritic characters are ignored when determining sort order, but are still displayed normally; books with a missing title sort to the end). Overridden by Sort by Header below if that is set to Yes.",
  "Rpt_Book": "Book",
  "Rpt_Empty": "empty",
  "Rpt_Failed": "This check failed: {0}",
  "Rpt_Message": "Message",
  "Rpt_NoFindings": "No findings.",
  "Rpt_Option": "Option",
  "Rpt_OptionsUsed": "Options used",
  "Rpt_Reference": "Reference",
  "Rpt_Text": "Text",
  "Rpt_Value": "Value",
  "Rpt_footnotes_Bold": "Bold",
  "Rpt_footnotes_Caller": "Caller",
  "Rpt_footnotes_Color": "Color",
  "Rpt_footnotes_Count": "Count",
  "Rpt_footnotes_Flags": "Flags",
  "Rpt_footnotes_H1": "1. Footnote marker & style summary",
  "Rpt_footnotes_H2": "2. Footnotes found",
  "Rpt_footnotes_Hidden": "Markers are hidden.",
  "Rpt_footnotes_InSty": "In stylesheet?",
  "Rpt_footnotes_Italic": "Italic",
  "Rpt_footnotes_None": "No footnotes were found in the scanned text.",
  "Rpt_footnotes_NotInSty": "not in stylesheet",
  "Rpt_footnotes_Sample": "Sample text",
  "Rpt_footnotes_SampleCol": "Sample",
  "Rpt_footnotes_SmallCaps": "SmallCaps",
  "Rpt_footnotes_SortRef": "canonical reference",
  "Rpt_footnotes_SortText": "footnote text (alphabetically)",
  "Rpt_footnotes_StyleType": "StyleType",
  "Rpt_footnotes_Summary": "{0} footnote(s) found, sorted by {1}.",
  "Rpt_footnotes_Superscript": "Superscript",
  "Rpt_footnotes_Underline": "Underline",
  "Rpt_footnotes_Yes": "yes",
  "Rpt_nested_FootnoteText": "Footnote text",
  "Rpt_nested_H1": "1. Summary",
  "Rpt_nested_H2": "2. Footnotes with issues",
  "Rpt_nested_Marker": "Marker",
  "Rpt_nested_NoFootnotes": "No footnotes with issues were found.",
  "Rpt_nested_NoIssues": "No issues found.",
  "Rpt_nested_Occurrences": "Occurrences",
  "Rpt_nested_Summary": "{0} footnote(s) scanned, {1} flagged with a character style missing its required '+'.",
  "Rpt_qerrors_EmptyFinal": "FinalPunctuation option cannot be empty when CheckFinalPunct is Yes; the check did not run.",
  "Rpt_qerrors_EmptyNonFinal": "NonFinalPunctuation option cannot be empty when CheckHangingWord is Yes; the check did not run.",
  "Rpt_qerrors_QLine": "\\q line",
  "Rpt_shortv1_Chars": "Characters",
  "Rpt_titles_Missing": "missing",
  "Rpt_titles_NoBooks": "No books were scanned.",
  "Rpt_titles_SortH": "\\h text (alphabetically)",
  "Rpt_titles_SortMt": "\\mt title (alphabetically)",
  "Rpt_titles_SortRef": "canonical scan order",
  "Rpt_titles_SortedBy": "Sorted by {0}.",
  "Rpt_titles_Summary": "{0} book(s) scanned, {1} title(s) found, {2} missing."
 },
 "es": {
  "Cat_footnotes_footnote": "Nota al pie",
  "Cat_nested_missingplus": "Estilo de car\u00e1cter sin +",
  "Cat_qerrors_final": "Puntuaci\u00f3n final en q",
  "Cat_qerrors_hanging": "Una sola palabra despu\u00e9s de la puntuaci\u00f3n",
  "Cat_qerrors_multi": "La l\u00ednea po\u00e9tica abarca varios vers\u00edculos",
  "Cat_qerrors_verse": "Vers\u00edculo en q",
  "Cat_refnomark_ref": "Referencia sin marcar",
  "Cat_shortv1_short": "Vers\u00edculo 1 corto",
  "Cat_titles_missing": "\\mt ausente",
  "Cat_titles_title": "T\u00edtulo",
  "Check_footnotes_Desc": "Lista cada nota al pie con su referencia, llamada, referencia \\fr y texto, con el formato de la hoja de estilos, y un resumen de los marcadores usados. La lista de resultados se puede buscar por referencia o por los marcadores de la nota, por ejemplo \"fr fq ft\".",
  "Check_footnotes_Name": "Informe de las notas al pie",
  "Check_nested_Desc": "Marca los estilos de car\u00e1cter en notas al pie sin el prefijo '+' de USFM 3, por ejemplo \\xt en lugar de \\+xt. Nunca marca los marcadores propios de la nota (\\fr, \\fq, \\ft). Aperturas y cierres se revisan por separado, as\u00ed que se detecta un par desigual.",
  "Check_nested_Name": "Informe de estilos anidados",
  "Check_qerrors_Desc": "Busca l\u00edneas de poes\u00eda (\\q, \\q1, \u2026) con problemas de estructura: texto despu\u00e9s de la puntuaci\u00f3n final, dos n\u00fameros de vers\u00edculo en una l\u00ednea o texto antes de un n\u00famero de vers\u00edculo. Opcionalmente marca una sola palabra que queda tras puntuaci\u00f3n no final. Se ignoran notas, referencias cruzadas y \\qs.",
  "Check_qerrors_Name": "Informe de errores en q",
  "Check_refnomark_Desc": "Busca referencias b\u00edblicas en el texto que no est\u00e9n encerradas en marcadores \\xt, \\rq, \\ior, \\fig, \\r, \\mr o \\sr. La opci\u00f3n permite definir el car\u00e1cter separador de cap\u00edtulo y vers\u00edculo.",
  "Check_refnomark_Name": "Referencia sin marcadores",
  "Check_shortv1_Desc": "Marca el texto breve del vers\u00edculo 1 entre un marcador de p\u00e1rrafo (\\p o \\m) y el siguiente marcador \\p. Las opciones permiten definir la cantidad m\u00ednima de caracteres y agregar otros marcadores de p\u00e1rrafo a verificar.",
  "Check_shortv1_Name": "Vers\u00edculo 1 corto",
  "Check_titles_Desc": "Lista el t\u00edtulo principal (\\mt\u2013\\mt3) de cada libro, con el formato de la hoja de estilos, e informa de los libros sin \\mt. Las opciones ordenan la lista por t\u00edtulo o por encabezado (\\h) y a\u00f1aden una columna con \\h.",
  "Check_titles_Name": "Informe de los t\u00edtulos",
  "Msg_footnotes_Footnote": "Nota al pie",
  "Msg_nested_MissingPlus": "Falta +: ",
  "Msg_qerrors_final": "Puntuaci\u00f3n final en q",
  "Msg_qerrors_hanging": "Una sola palabra despu\u00e9s de la puntuaci\u00f3n",
  "Msg_qerrors_multi": "La l\u00ednea po\u00e9tica abarca varios vers\u00edculos",
  "Msg_qerrors_verse": "Vers\u00edculo en q",
  "Msg_refnomark_Found": "Referencia sin marcadores",
  "Msg_shortv1_Chars": "{0} caracteres (m\u00ednimo = {1})",
  "Opt_footnotes_HideMarkers_Label": "\u00bfOcultar los marcadores en el informe HTML?",
  "Opt_footnotes_HideMarkers_Tip": "S\u00ed oculta las etiquetas de marcador (p. ej. \\fq, \\+it, \\+it*) que aparecen antes de cada fragmento de texto de la nota en el informe HTML -- el texto conserva su formato de Negrita/Cursiva/Super\u00edndice/Versalitas/Subrayado/Color, solo se ocultan las etiquetas de marcador, para una vista de lectura m\u00e1s limpia. No (predeterminado) muestra los marcadores junto al texto con estilo, como hasta ahora. No afecta la tabla resumen de marcadores y estilos de la Secci\u00f3n 1 ni la lista de resultados de Paratext.",
  "Opt_footnotes_SortAlphabetically_Label": "\u00bfOrdenar las notas al pie alfab\u00e9ticamente?",
  "Opt_footnotes_SortAlphabetically_Tip": "S\u00ed ordena las notas al pie del informe HTML alfab\u00e9ticamente seg\u00fan el propio texto de la nota (todo excepto la referencia \\fr), de modo que las notas id\u00e9nticas o casi id\u00e9nticas queden juntas para facilitar su comparaci\u00f3n. No (predeterminado) las lista en el orden de escaneo can\u00f3nico de libro/cap\u00edtulo/vers\u00edculo. Los caracteres acentuados o con diacr\u00edticos se ignoran al determinar el orden (pero se siguen mostrando normalmente).",
  "Opt_qerrors_CheckDoubleVerse_Label": "\u00bfMarcar m\u00faltiples marcadores de vers\u00edculo en una l\u00ednea po\u00e9tica?",
  "Opt_qerrors_CheckDoubleVerse_Tip": "Elija No para deshabilitar la verificaci\u00f3n de dos marcadores \\v dentro de una sola l\u00ednea \\q/\\q1/\\q2 (en la misma l\u00ednea o continuando a la siguiente).",
  "Opt_qerrors_CheckFinalPunct_Label": "\u00bfMarcar puntuaci\u00f3n final seguida de texto?",
  "Opt_qerrors_CheckFinalPunct_Tip": "Elija No para deshabilitar la verificaci\u00f3n de puntuaci\u00f3n final seguida de un car\u00e1cter de palabra en la misma l\u00ednea po\u00e9tica.",
  "Opt_qerrors_CheckHangingWord_Label": "\u00bfMarcar l\u00ednea que termina con puntuaci\u00f3n + una sola palabra?",
  "Opt_qerrors_CheckHangingWord_Tip": "Elija S\u00ed para marcar cualquier l\u00ednea po\u00e9tica que termina con puntuaci\u00f3n no final seguida de exactamente una palabra (nada m\u00e1s antes del fin de l\u00ednea). Puede indicar que la \u00faltima palabra pertenece a la l\u00ednea siguiente.",
  "Opt_qerrors_CheckTextBeforeVerse_Label": "\u00bfMarcar texto antes del marcador de vers\u00edculo?",
  "Opt_qerrors_CheckTextBeforeVerse_Tip": "Elija No para deshabilitar la verificaci\u00f3n de contenido de texto que aparece antes de un marcador \\v en una l\u00ednea po\u00e9tica. La forma normal es \\q1 \\v N texto; la forma incorrecta es \\q1 texto \\v N.",
  "Opt_qerrors_FinalPunctuation_Label": "Caracteres de puntuaci\u00f3n final",
  "Opt_qerrors_FinalPunctuation_Tip": "Caracteres que deben terminar una l\u00ednea po\u00e9tica. Marca cualquier l\u00ednea \\q/\\q1/\\q2 donde alguno de estos es seguido por un car\u00e1cter de palabra. El valor predeterminado es punto, signo de exclamaci\u00f3n y signo de interrogaci\u00f3n.",
  "Opt_qerrors_MinCharsBeforePunct_Label": "Caracteres m\u00ednimos antes de la puntuaci\u00f3n final",
  "Opt_qerrors_MinCharsBeforePunct_Tip": "Ignore la puntuaci\u00f3n final que aparece con menos de esta cantidad de caracteres en el texto de la l\u00ednea po\u00e9tica. Use esto para suprimir falsos positivos en l\u00edneas muy cortas. Establezca en 0 para verificar todas las l\u00edneas sin importar su longitud.",
  "Opt_qerrors_NonFinalPunctuation_Label": "Caracteres de puntuaci\u00f3n no final",
  "Opt_qerrors_NonFinalPunctuation_Tip": "Se usa solo cuando \"Marcar palabra suelta\" es S\u00ed. Caracteres considerados puntuaci\u00f3n de mitad de l\u00ednea (no final).",
  "Opt_refnomark_ChapterVerseSep_Label": "Separador de cap\u00edtulo y vers\u00edculo",
  "Opt_refnomark_ChapterVerseSep_Tip": "Car\u00e1cter que separa el cap\u00edtulo del n\u00famero de vers\u00edculo (del atributo ChapterVerseSeparator en Settings.xml: normalmente : o .).",
  "Opt_shortv1_CheckOtherMarkers_Label": "Verificar otros marcadores",
  "Opt_shortv1_CheckOtherMarkers_Tip": "Elija S\u00ed para tambi\u00e9n verificar marcadores de p\u00e1rrafo adicionales (listados abajo) antes y despu\u00e9s del vers\u00edculo 1, adem\u00e1s de los predeterminados (\\p y \\m antes, \\p despu\u00e9s).",
  "Opt_shortv1_MinChars_Label": "Caracteres m\u00ednimos",
  "Opt_shortv1_MinChars_Tip": "N\u00famero m\u00ednimo de caracteres esperados en el vers\u00edculo 1 antes del siguiente marcador de p\u00e1rrafo. Se marcar\u00e1n los vers\u00edculos 1 m\u00e1s cortos que esto.",
  "Opt_shortv1_OtherMarkers_Label": "Otros marcadores",
  "Opt_shortv1_OtherMarkers_Tip": "Lista separada por espacios de marcadores de p\u00e1rrafo adicionales a verificar (sin barra invertida), p. ej.: q q1 q2 q3 q4. Solo se usa cuando Verificar otros marcadores es S\u00ed.",
  "Opt_titles_DisplayHeader_Label": "Mostrar encabezado",
  "Opt_titles_DisplayHeader_Tip": "S\u00ed (predeterminado) agrega una columna al informe que muestra el texto \\h (encabezado de p\u00e1gina) de cada libro, o \"ausente\" si no est\u00e1 presente. No muestra solo el t\u00edtulo \\mt. Se activa autom\u00e1ticamente si Ordenar por encabezado est\u00e1 en S\u00ed.",
  "Opt_titles_SortByHeader_Label": "Ordenar por encabezado",
  "Opt_titles_SortByHeader_Tip": "No (predeterminado). S\u00ed ordena el informe alfab\u00e9ticamente por el texto \\h en su lugar, anulando Ordenar por t\u00edtulo, y muestra autom\u00e1ticamente la columna de encabezado aunque Mostrar encabezado est\u00e9 en No (los caracteres acentuados/diacr\u00edticos se ignoran al determinar el orden, pero se siguen mostrando normalmente; los libros sin texto \\h se ordenan al final).",
  "Opt_titles_SortByTitle_Label": "Ordenar por t\u00edtulo",
  "Opt_titles_SortByTitle_Tip": "No (predeterminado) lista los libros en el orden can\u00f3nico de escaneo. S\u00ed ordena el informe alfab\u00e9ticamente por el texto del t\u00edtulo \\mt en su lugar (los caracteres acentuados/diacr\u00edticos se ignoran al determinar el orden, pero se siguen mostrando normalmente; los libros con t\u00edtulo ausente se ordenan al final). Anulado por Ordenar por encabezado si este est\u00e1 en S\u00ed.",
  "Rpt_Book": "Libro",
  "Rpt_Empty": "vac\u00edo",
  "Rpt_Failed": "Esta verificaci\u00f3n fall\u00f3: {0}",
  "Rpt_Message": "Mensaje",
  "Rpt_NoFindings": "No se encontr\u00f3 nada.",
  "Rpt_Option": "Opci\u00f3n",
  "Rpt_OptionsUsed": "Opciones usadas",
  "Rpt_Reference": "Referencia",
  "Rpt_Text": "Texto",
  "Rpt_Value": "Valor",
  "Rpt_footnotes_Bold": "Negrita",
  "Rpt_footnotes_Caller": "Llamada",
  "Rpt_footnotes_Color": "Color",
  "Rpt_footnotes_Count": "Cantidad",
  "Rpt_footnotes_Flags": "Indicadores",
  "Rpt_footnotes_H1": "1. Resumen de marcadores y estilos de notas al pie",
  "Rpt_footnotes_H2": "2. Notas al pie encontradas",
  "Rpt_footnotes_Hidden": "Los marcadores est\u00e1n ocultos.",
  "Rpt_footnotes_InSty": "\u00bfEn la hoja de estilo?",
  "Rpt_footnotes_Italic": "Cursiva",
  "Rpt_footnotes_None": "No se encontraron notas al pie en el texto escaneado.",
  "Rpt_footnotes_NotInSty": "no est\u00e1 en la hoja de estilo",
  "Rpt_footnotes_Sample": "Texto de muestra",
  "Rpt_footnotes_SampleCol": "Muestra",
  "Rpt_footnotes_SmallCaps": "Versalitas",
  "Rpt_footnotes_SortRef": "la referencia can\u00f3nica",
  "Rpt_footnotes_SortText": "el texto de la nota (alfab\u00e9ticamente)",
  "Rpt_footnotes_StyleType": "Tipo de estilo",
  "Rpt_footnotes_Summary": "Se encontraron {0} nota(s) al pie, ordenadas por {1}.",
  "Rpt_footnotes_Superscript": "Super\u00edndice",
  "Rpt_footnotes_Underline": "Subrayado",
  "Rpt_footnotes_Yes": "s\u00ed",
  "Rpt_nested_FootnoteText": "Texto de la nota",
  "Rpt_nested_H1": "1. Resumen",
  "Rpt_nested_H2": "2. Notas al pie con problemas",
  "Rpt_nested_Marker": "Marcador",
  "Rpt_nested_NoFootnotes": "No se encontraron notas al pie con problemas.",
  "Rpt_nested_NoIssues": "No se encontraron problemas.",
  "Rpt_nested_Occurrences": "Ocurrencias",
  "Rpt_nested_Summary": "Se escanearon {0} nota(s) al pie; se marcaron {1} con un estilo de car\u00e1cter al que le falta el '+' requerido.",
  "Rpt_qerrors_EmptyFinal": "La opci\u00f3n FinalPunctuation no puede estar vac\u00eda cuando CheckFinalPunct es S\u00ed; la verificaci\u00f3n no se ejecut\u00f3.",
  "Rpt_qerrors_EmptyNonFinal": "La opci\u00f3n NonFinalPunctuation no puede estar vac\u00eda cuando CheckHangingWord es S\u00ed; la verificaci\u00f3n no se ejecut\u00f3.",
  "Rpt_qerrors_QLine": "L\u00ednea \\q",
  "Rpt_shortv1_Chars": "Caracteres",
  "Rpt_titles_Missing": "ausente",
  "Rpt_titles_NoBooks": "No se escane\u00f3 ning\u00fan libro.",
  "Rpt_titles_SortH": "el texto \\h (alfab\u00e9ticamente)",
  "Rpt_titles_SortMt": "el t\u00edtulo \\mt (alfab\u00e9ticamente)",
  "Rpt_titles_SortRef": "el orden can\u00f3nico de escaneo",
  "Rpt_titles_SortedBy": "Ordenado por {0}.",
  "Rpt_titles_Summary": "{0} libro(s) escaneado(s), {1} t\u00edtulo(s) encontrado(s), {2} ausente(s)."
 },
 "fr": {
  "Cat_footnotes_footnote": "Note de bas de page",
  "Cat_nested_missingplus": "Style de caract\u00e8re sans +",
  "Cat_qerrors_final": "Ponctuation finale dans q",
  "Cat_qerrors_hanging": "Un seul mot apr\u00e8s la ponctuation",
  "Cat_qerrors_multi": "La ligne po\u00e9tique couvre plusieurs versets",
  "Cat_qerrors_verse": "Verset dans q",
  "Cat_refnomark_ref": "R\u00e9f\u00e9rence non balis\u00e9e",
  "Cat_shortv1_short": "Verset 1 court",
  "Cat_titles_missing": "\\mt absent",
  "Cat_titles_title": "Titre",
  "Check_footnotes_Desc": "Liste chaque note de bas de page avec sa r\u00e9f\u00e9rence, son appel, sa r\u00e9f\u00e9rence \\fr et son texte, mis en forme selon la feuille de style, et un r\u00e9sum\u00e9 des marqueurs employ\u00e9s. Les r\u00e9sultats peuvent \u00eatre filtr\u00e9s par r\u00e9f\u00e9rence ou par marqueurs, par exemple \u00ab fr fq ft \u00bb.",
  "Check_footnotes_Name": "Notes de bas de page (\\f)",
  "Check_nested_Desc": "Signale les styles de caract\u00e8re des notes de bas de page sans le pr\u00e9fixe '+' de USFM 3, par exemple \\xt au lieu de \\+xt. Les marqueurs propres aux notes (\\fr, \\fq, \\ft) ne sont jamais signal\u00e9s. Ouvrants et fermants sont v\u00e9rifi\u00e9s s\u00e9par\u00e9ment, ce qui d\u00e9tecte une paire mal assortie.",
  "Check_nested_Name": "Rapport des styles imbriqu\u00e9s",
  "Check_qerrors_Desc": "Trouve les lignes de po\u00e9sie (\\q, \\q1, \u2026) avec un probl\u00e8me de structure : texte apr\u00e8s la ponctuation finale, deux num\u00e9ros de verset sur une ligne ou texte avant un num\u00e9ro de verset. Peut signaler un mot isol\u00e9 apr\u00e8s une ponctuation non finale. Notes, renvois et \\qs sont ignor\u00e9s.",
  "Check_qerrors_Name": "Rapport des erreurs de po\u00e9sie",
  "Check_refnomark_Desc": "Recherche dans le texte les r\u00e9f\u00e9rences bibliques qui ne sont pas encadr\u00e9es par les marqueurs \\xt, \\rq, \\ior, \\fig, \\r, \\mr ou \\sr. Une option permet de d\u00e9finir le caract\u00e8re s\u00e9parateur entre chapitre et verset.",
  "Check_refnomark_Name": "R\u00e9f\u00e9rence sans marqueurs",
  "Check_shortv1_Desc": "Signale un texte court du verset 1 entre un marqueur de paragraphe (\\p ou \\m) et le marqueur \\p suivant. Les options permettent de d\u00e9finir le nombre minimal de caract\u00e8res et d'ajouter d'autres marqueurs de paragraphe \u00e0 v\u00e9rifier.",
  "Check_shortv1_Name": "Verset 1 court",
  "Check_titles_Desc": "Liste le titre principal (\\mt\u2013\\mt3) de chaque livre, mis en forme selon la feuille de style, et signale les livres sans \\mt. Les options trient la liste par titre ou par en-t\u00eate courant (\\h) et ajoutent une colonne \\h.",
  "Check_titles_Name": "Rapport des titres",
  "Msg_footnotes_Footnote": "Note de bas de page",
  "Msg_nested_MissingPlus": "+ manquant : ",
  "Msg_qerrors_final": "Ponctuation finale dans q",
  "Msg_qerrors_hanging": "Un seul mot apr\u00e8s la ponctuation",
  "Msg_qerrors_multi": "La ligne po\u00e9tique couvre plusieurs versets",
  "Msg_qerrors_verse": "Verset dans q",
  "Msg_refnomark_Found": "R\u00e9f\u00e9rence sans marqueurs",
  "Msg_shortv1_Chars": "{0} caract\u00e8res (minimum = {1})",
  "Opt_footnotes_HideMarkers_Label": "Masquer les marqueurs dans le rapport HTML",
  "Opt_footnotes_HideMarkers_Tip": "\u00ab Oui \u00bb masque les \u00e9tiquettes de marqueur (p. ex. \\fq, \\+it, \\+it*) affich\u00e9es avant chaque segment de texte de note dans le rapport HTML -- le texte conserve sa mise en forme Gras/Italique/Exposant/Petites capitales/Soulign\u00e9/Couleur r\u00e9solue ; seules les \u00e9tiquettes de marqueur elles-m\u00eames sont masqu\u00e9es, pour une lecture plus claire. \u00ab Non \u00bb (par d\u00e9faut) affiche les marqueurs \u00e0 c\u00f4t\u00e9 du texte mis en forme, comme actuellement. N'affecte pas le tableau r\u00e9capitulatif des marqueurs/styles de la section 1 ni la liste des r\u00e9sultats de Paratext.",
  "Opt_footnotes_SortAlphabetically_Label": "Trier les notes de bas de page par ordre alphab\u00e9tique",
  "Opt_footnotes_SortAlphabetically_Tip": "\u00ab Oui \u00bb trie les notes de bas de page du rapport HTML par ordre alphab\u00e9tique de leur propre texte (tout sauf la r\u00e9f\u00e9rence \\fr), de sorte que les notes identiques ou presque identiques se retrouvent c\u00f4te \u00e0 c\u00f4te pour faciliter la comparaison. \u00ab Non \u00bb (par d\u00e9faut) les r\u00e9pertorie dans l'ordre canonique d'analyse livre/chapitre/verset. Les caract\u00e8res accentu\u00e9s/diacritiques sont ignor\u00e9s pour d\u00e9terminer l'ordre de tri (mais restent affich\u00e9s normalement).",
  "Opt_qerrors_CheckDoubleVerse_Label": "Signaler plusieurs marqueurs de verset dans une ligne de po\u00e9sie ?",
  "Opt_qerrors_CheckDoubleVerse_Tip": "Choisissez \u00ab Non \u00bb pour d\u00e9sactiver la v\u00e9rification de deux marqueurs \\v dans une m\u00eame ligne \\q/\\q1/\\q2 (sur la m\u00eame ligne ou en continuant sur la ligne suivante).",
  "Opt_qerrors_CheckFinalPunct_Label": "Signaler une ponctuation finale suivie de texte ?",
  "Opt_qerrors_CheckFinalPunct_Tip": "Choisissez \u00ab Non \u00bb pour d\u00e9sactiver la v\u00e9rification d'une ponctuation finale suivie d'un caract\u00e8re de mot sur la m\u00eame ligne de po\u00e9sie.",
  "Opt_qerrors_CheckHangingWord_Label": "Signaler une ligne se terminant par une ponctuation + un seul mot ?",
  "Opt_qerrors_CheckHangingWord_Tip": "Choisissez \u00ab Oui \u00bb pour signaler toute ligne de po\u00e9sie se terminant par une ponctuation non finale suivie d'exactement un mot (rien d'autre avant la fin de la ligne). Cela peut indiquer que le dernier mot appartient \u00e0 la ligne suivante.",
  "Opt_qerrors_CheckTextBeforeVerse_Label": "Signaler du texte avant le marqueur de verset ?",
  "Opt_qerrors_CheckTextBeforeVerse_Tip": "Choisissez \u00ab Non \u00bb pour d\u00e9sactiver la v\u00e9rification du contenu textuel apparaissant avant un marqueur \\v dans une ligne de po\u00e9sie. La forme normale est \\q1 \\v N texte ; la forme incorrecte est \\q1 texte \\v N.",
  "Opt_qerrors_FinalPunctuation_Label": "Caract\u00e8res de ponctuation finale",
  "Opt_qerrors_FinalPunctuation_Tip": "Caract\u00e8res qui doivent terminer une ligne de po\u00e9sie. Signale toute ligne \\q/\\q1/\\q2 o\u00f9 l'un d'eux est suivi d'un caract\u00e8re de mot. Par d\u00e9faut : point, point d'exclamation et point d'interrogation.",
  "Opt_qerrors_MinCharsBeforePunct_Label": "Nombre minimal de caract\u00e8res avant la ponctuation finale",
  "Opt_qerrors_MinCharsBeforePunct_Tip": "Ignore la ponctuation finale qui appara\u00eet \u00e0 moins de ce nombre de caract\u00e8res du d\u00e9but du texte de la ligne de po\u00e9sie. Utilisez ce r\u00e9glage pour supprimer les faux positifs sur les lignes tr\u00e8s courtes. R\u00e9glez sur 0 pour v\u00e9rifier toutes les lignes, quelle que soit leur longueur.",
  "Opt_qerrors_NonFinalPunctuation_Label": "Caract\u00e8res de ponctuation non finale",
  "Opt_qerrors_NonFinalPunctuation_Tip": "Utilis\u00e9 uniquement lorsque \u00ab Signaler une ligne se terminant par une ponctuation + un seul mot ? \u00bb est r\u00e9gl\u00e9 sur \u00ab Oui \u00bb. Caract\u00e8res consid\u00e9r\u00e9s comme de la ponctuation de milieu de ligne (non finale).",
  "Opt_refnomark_ChapterVerseSep_Label": "S\u00e9parateur chapitre-verset",
  "Opt_refnomark_ChapterVerseSep_Tip": "Caract\u00e8re s\u00e9parant le num\u00e9ro de chapitre du num\u00e9ro de verset (d'apr\u00e8s ChapterVerseSeparator dans Settings.xml : normalement : ou .).",
  "Opt_shortv1_CheckOtherMarkers_Label": "V\u00e9rifier d'autres marqueurs",
  "Opt_shortv1_CheckOtherMarkers_Tip": "Choisissez \u00ab Oui \u00bb pour v\u00e9rifier aussi d'autres marqueurs de paragraphe (list\u00e9s ci-dessous) avant et apr\u00e8s le verset 1, en plus de ceux par d\u00e9faut (\\p et \\m avant, \\p apr\u00e8s).",
  "Opt_shortv1_MinChars_Label": "Nombre minimal de caract\u00e8res",
  "Opt_shortv1_MinChars_Tip": "Nombre minimal de caract\u00e8res attendus dans le verset 1 avant le marqueur de paragraphe suivant. Les versets 1 plus courts seront signal\u00e9s.",
  "Opt_shortv1_OtherMarkers_Label": "Autres marqueurs",
  "Opt_shortv1_OtherMarkers_Tip": "Liste, s\u00e9par\u00e9e par des espaces, de marqueurs de paragraphe suppl\u00e9mentaires \u00e0 v\u00e9rifier (sans barre oblique inverse), p. ex. : q q1 q2 q3 q4. Utilis\u00e9 uniquement lorsque \u00ab V\u00e9rifier d'autres marqueurs \u00bb est r\u00e9gl\u00e9 sur \u00ab Oui \u00bb.",
  "Opt_titles_DisplayHeader_Label": "Afficher l'en-t\u00eate",
  "Opt_titles_DisplayHeader_Tip": "\u00ab Oui \u00bb (par d\u00e9faut) ajoute au rapport une colonne affichant le texte de \\h (titre courant) de chaque livre, ou \u00ab manquant \u00bb s'il est absent. \u00ab Non \u00bb affiche uniquement le titre \\mt. Activ\u00e9 automatiquement si \u00ab Trier par en-t\u00eate \u00bb ci-dessous est r\u00e9gl\u00e9 sur \u00ab Oui \u00bb.",
  "Opt_titles_SortByHeader_Label": "Trier par en-t\u00eate",
  "Opt_titles_SortByHeader_Tip": "\u00ab Non \u00bb (par d\u00e9faut). \u00ab Oui \u00bb trie plut\u00f4t le rapport par ordre alphab\u00e9tique du texte de \\h, en rempla\u00e7ant \u00ab Trier par titre \u00bb ci-dessus, et affiche automatiquement la colonne \u00ab En-t\u00eate \u00bb m\u00eame si \u00ab Afficher l'en-t\u00eate \u00bb ci-dessus est r\u00e9gl\u00e9 sur \u00ab Non \u00bb (les caract\u00e8res accentu\u00e9s/diacritiques sont ignor\u00e9s pour d\u00e9terminer l'ordre de tri, mais restent affich\u00e9s normalement ; les livres sans texte \\h sont plac\u00e9s \u00e0 la fin).",
  "Opt_titles_SortByTitle_Label": "Trier par titre",
  "Opt_titles_SortByTitle_Tip": "\u00ab Non \u00bb (par d\u00e9faut) r\u00e9pertorie les livres dans l'ordre canonique d'analyse. \u00ab Oui \u00bb trie plut\u00f4t le rapport par ordre alphab\u00e9tique du texte du titre \\mt (les caract\u00e8res accentu\u00e9s/diacritiques sont ignor\u00e9s pour d\u00e9terminer l'ordre de tri, mais restent affich\u00e9s normalement ; les livres sans titre sont plac\u00e9s \u00e0 la fin). Remplac\u00e9 par \u00ab Trier par en-t\u00eate \u00bb ci-dessous si cette option est r\u00e9gl\u00e9e sur \u00ab Oui \u00bb.",
  "Rpt_Book": "Livre",
  "Rpt_Empty": "vide",
  "Rpt_Failed": "Cette v\u00e9rification a \u00e9chou\u00e9 : {0}",
  "Rpt_Message": "Message",
  "Rpt_NoFindings": "Aucun r\u00e9sultat.",
  "Rpt_Option": "Option",
  "Rpt_OptionsUsed": "Options utilis\u00e9es",
  "Rpt_Reference": "R\u00e9f\u00e9rence",
  "Rpt_Text": "Texte",
  "Rpt_Value": "Valeur",
  "Rpt_footnotes_Bold": "Gras",
  "Rpt_footnotes_Caller": "Appel",
  "Rpt_footnotes_Color": "Couleur",
  "Rpt_footnotes_Count": "Nombre",
  "Rpt_footnotes_Flags": "Attributs",
  "Rpt_footnotes_H1": "1. R\u00e9sum\u00e9 des marqueurs et styles des notes",
  "Rpt_footnotes_H2": "2. Notes trouv\u00e9es",
  "Rpt_footnotes_Hidden": "Les marqueurs sont masqu\u00e9s.",
  "Rpt_footnotes_InSty": "Dans la feuille de style ?",
  "Rpt_footnotes_Italic": "Italique",
  "Rpt_footnotes_None": "Aucune note n'a \u00e9t\u00e9 trouv\u00e9e dans le texte analys\u00e9.",
  "Rpt_footnotes_NotInSty": "absent de la feuille de style",
  "Rpt_footnotes_Sample": "Texte d'exemple",
  "Rpt_footnotes_SampleCol": "Exemple",
  "Rpt_footnotes_SmallCaps": "Petites capitales",
  "Rpt_footnotes_SortRef": "r\u00e9f\u00e9rence canonique",
  "Rpt_footnotes_SortText": "texte de la note (ordre alphab\u00e9tique)",
  "Rpt_footnotes_StyleType": "Type de style",
  "Rpt_footnotes_Summary": "{0} note(s) trouv\u00e9e(s), tri\u00e9e(s) par {1}.",
  "Rpt_footnotes_Superscript": "Exposant",
  "Rpt_footnotes_Underline": "Soulign\u00e9",
  "Rpt_footnotes_Yes": "oui",
  "Rpt_nested_FootnoteText": "Texte de la note",
  "Rpt_nested_H1": "1. R\u00e9sum\u00e9",
  "Rpt_nested_H2": "2. Notes de bas de page avec probl\u00e8mes",
  "Rpt_nested_Marker": "Marqueur",
  "Rpt_nested_NoFootnotes": "Aucune note avec probl\u00e8me n'a \u00e9t\u00e9 trouv\u00e9e.",
  "Rpt_nested_NoIssues": "Aucun probl\u00e8me trouv\u00e9.",
  "Rpt_nested_Occurrences": "Occurrences",
  "Rpt_nested_Summary": "{0} note(s) analys\u00e9e(s), {1} signal\u00e9e(s) avec un style de caract\u00e8re sans le '+' requis.",
  "Rpt_qerrors_EmptyFinal": "L'option FinalPunctuation ne peut pas \u00eatre vide quand CheckFinalPunct vaut Oui ; la v\u00e9rification n'a pas \u00e9t\u00e9 ex\u00e9cut\u00e9e.",
  "Rpt_qerrors_EmptyNonFinal": "L'option NonFinalPunctuation ne peut pas \u00eatre vide quand CheckHangingWord vaut Oui ; la v\u00e9rification n'a pas \u00e9t\u00e9 ex\u00e9cut\u00e9e.",
  "Rpt_qerrors_QLine": "Ligne \\q",
  "Rpt_shortv1_Chars": "Caract\u00e8res",
  "Rpt_titles_Missing": "absent",
  "Rpt_titles_NoBooks": "Aucun livre n'a \u00e9t\u00e9 analys\u00e9.",
  "Rpt_titles_SortH": "texte \\h (ordre alphab\u00e9tique)",
  "Rpt_titles_SortMt": "titre \\mt (ordre alphab\u00e9tique)",
  "Rpt_titles_SortRef": "ordre canonique d'analyse",
  "Rpt_titles_SortedBy": "Tri\u00e9 par {0}.",
  "Rpt_titles_Summary": "{0} livre(s) analys\u00e9(s), {1} titre(s) trouv\u00e9(s), {2} absent(s)."
 }
};

// Short Verse 1: a port of Project_Checker\ProjectChecker\Checks\ShortVerse1Check.cs
// (CMS/Short_V_1/short_v_1.py). Flags a short verse-1 text between a paragraph marker (\p or \m,
// plus OtherMarkers when CheckOtherMarkers is Yes) and the next \p (plus OtherMarkers).
(function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;

  // short_v_1.py INLINE_RE: footnotes / cross-references on one line only.
  var INLINE_RE = R.compile('\\\\f\\s[^\\r\\n]*?\\\\f\\*|\\\\x\\s[^\\r\\n]*?\\\\x\\*', R.UNICODE);
  var VERSE1_RE = R.compile('\\\\v\\s+1(?!\\d)(?:-\\d+)?[ \\t\\r\\n]+', R.UNICODE);
  // All paragraph-type markers: used to find the marker just before \v 1.
  var ALL_PARA_RE = R.compile('\\\\(p(?:[crhi]\\d?)?|q[a-z]?\\d?|mi?|nb|b|li\\d?)(?=[\\s\\\\]|$)', R.UNICODE | R.MULTILINE);
  var CHAR_MARKER_RE = R.compile('\\\\[a-zA-Z]+\\d*\\*?\\s*', R.UNICODE);

  PC.define({
    id: 'shortv1',
    cssPrefix: 'sv',
    original: 'Short_V_1/short_v_1.py',
    kind: 'report',
    options: [
      { name: 'MinChars', type: 'int', def: '40' },
      { name: 'CheckOtherMarkers', type: 'bool', def: 'No' },
      { name: 'OtherMarkers', type: 'text', def: 'q q1 q2 q3 q4' },
    ],

    beginRun: function (run) {
      var before = new Set(['p', 'm']);
      var after = ['p'];
      if (T.isYes(run.opt('CheckOtherMarkers'))) {
        T.split(run.opt('OtherMarkers')).forEach(function (m) {
          var t = T.strip(m);
          if (t.length === 0) return;
          before.add(t);
          if (after.indexOf(t) < 0) after.push(t);
        });
      }
      // Longest first, so \q1 is tried before \q. (The C# sort is not stable; equal lengths
      // cannot change what matches here, because the lookahead needs a space or backslash.)
      after.sort(function (a, b) {
        return b.length - a.length;
      });
      var minChars = T.strip(run.opt('MinChars'));
      if (!/^[+-]?\d+$/.test(minChars)) throw new Error('MinChars is not a whole number: ' + run.opt('MinChars'));
      run.state = {
        before: before,
        afterRe: R.compile('\\\\(' + after.map(R.escape).join('|') + ')(?=[\\s\\\\]|$)', R.UNICODE | R.MULTILINE),
        minChars: parseInt(minChars, 10),
      };
    },

    checkChapter: function (run, ch) {
      var s = run.state;
      var clean = PC.usfm.blank(INLINE_RE, ch.text);
      var v1 = R.search(VERSE1_RE, clean, 0);
      if (!v1) return;

      // The paragraph marker just before \v 1 must be in the "before" set.
      var prev = R.findAll(ALL_PARA_RE, clean, 0, v1.index);
      if (prev.length === 0 || !s.before.has(prev[prev.length - 1][1])) return;

      // The next paragraph marker after verse 1's content must be in the "after" set.
      var contentStart = v1.index + v1[0].length;
      var next = R.search(s.afterRe, clean, contentStart);
      if (!next) return;

      var contentEnd = next.index;
      var verse1Text = clean.substring(contentStart, contentEnd);
      var count = T.strip(R.sub(CHAR_MARKER_RE, verse1Text, '')).length;
      if (count < s.minChars) {
        var displayEnd = contentEnd;
        while (displayEnd > contentStart && '\r\n\t '.indexOf(clean[displayEnd - 1]) >= 0) displayEnd--;
        var f = run.emit(ch, v1.index, displayEnd, count + ' chars (set = ' + s.minChars + ')', 'short');
        f.extra.chars = String(count);
        var min = s.minChars;
        f.localize = function (L) {
          return L.fmt('Msg_shortv1_Chars', count, min);
        };
      }
    },
  });
})();

// Report of Titles: a port of Project_Checker\ProjectChecker\Checks\TitlesCheck.cs
// (CMS/find_titles/Find_Titles.py). Lists the \mt / \mt1-9 title of each canonical book (1-66),
// optionally with \h, styled from the stylesheet; books with no \mt are reported as missing.
(function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;
  var esc = PC.report.esc;

  // Only bare \h and \mt with zero or one digit (Find_Titles.py HEADER_MARKER_RE).
  var HEADER_RE = R.compile('^\\\\(mt[0-9]?|h)[ \\t]+([^\\r\\n]*)', R.UNICODE | R.MULTILINE);
  var WS_RUN_RE = R.compile('[ \\t]+', R.UNICODE);

  function yes(v) {
    return T.lower(T.strip(v || '')) === 'yes';
  }

  function inScope(n) {
    return n >= 1 && n <= 66;
  }

  function collapseWs(s) {
    return R.sub(WS_RUN_RE, s.replace(/\r/g, '').replace(/\n/g, ' '), ' ');
  }

  // A literal // in \mt text forces a soft line break; it is not part of the wording.
  function stripMtSoftBreaks(s) {
    return T.strip(collapseWs(s.split('//').join(' ')));
  }

  function mtLabel(segs, missing) {
    if (!segs) return missing;
    return segs
      .map(function (kv) {
        return '\\' + kv[0] + ' ' + kv[1];
      })
      .join(' ');
  }

  // _flush_book: only for a book with NO \mt or \h anywhere; the row is report-only.
  function flushBook(run, bookNum) {
    var s = run.state;
    if (bookNum === null || !inScope(bookNum)) return;
    if (s.resolved) return;
    s.missingCount++;
    s.rows.push({ bookNum: bookNum, bookLabel: PC.usfm.bookCode(bookNum), mtCombined: null, mtSegments: null, hText: null });
    var f = run.emitReportOnly(bookNum, 'missing', 'missing');
    f.localize = function (L) {
      return L.str('Rpt_titles_Missing');
    };
  }

  /** Python sorted(key=(missing, _sort_fold(value), book_num)); missing last. */
  function stableSort(rows, value) {
    return rows
      .map(function (r, i) {
        return { i: i, r: r };
      })
      .sort(function (a, b) {
        var va = value(a.r);
        var vb = value(b.r);
        var ma = va === null ? 1 : 0;
        var mb = vb === null ? 1 : 0;
        if (ma !== mb) return ma - mb;
        var c = T.compare(va === null ? '' : T.sortFold(va), vb === null ? '' : T.sortFold(vb));
        if (c !== 0) return c;
        if (a.r.bookNum !== b.r.bookNum) return a.r.bookNum - b.r.bookNum;
        return a.i - b.i;
      })
      .map(function (x) {
        return x.r;
      });
  }

  function orderedRows(d) {
    if (d.sortMode === 'mt')
      return stableSort(d.rows, function (r) {
        return r.mtCombined;
      });
    if (d.sortMode === 'h')
      return stableSort(d.rows, function (r) {
        return r.hText ? r.hText : null;
      });
    return d.rows.slice();
  }

  function mtCell(d, r, missingHtml) {
    if (r.mtCombined === null) return missingHtml;
    if (!r.mtSegments || r.mtSegments.length === 0) return esc(r.mtCombined);
    var parts = [];
    r.mtSegments.forEach(function (kv) {
      if (kv[1].length === 0) return;
      var css = PC.sty.markerCss(d.sty.get(kv[0]));
      var style = css.length > 0 ? ' style="' + css + '"' : '';
      parts.push('<span' + style + '>' + esc(kv[1]) + '</span>');
    });
    return parts.length > 0 ? parts.join(' ') : esc(r.mtCombined);
  }

  function hCell(r, missingHtml) {
    return r.hText ? esc(r.hText) : missingHtml;
  }

  PC.define({
    id: 'titles',
    cssPrefix: 'ti',
    original: 'find_titles/Find_Titles.py',
    kind: 'report',
    options: [
      { name: 'SortByTitle', type: 'bool', def: 'No' },
      { name: 'DisplayHeader', type: 'bool', def: 'Yes' },
      { name: 'SortByHeader', type: 'bool', def: 'No' },
    ],
    reportCss: '.ti-missing{color:#999;font-style:italic}.ti-table td:first-child{font-weight:bold}',

    beginRun: function (run) {
      var byTitle = yes(run.opt('SortByTitle'));
      var byHeader = yes(run.opt('SortByHeader'));
      run.state = {
        displayH: yes(run.opt('DisplayHeader')) || byHeader,
        sortMode: byHeader ? 'h' : byTitle ? 'mt' : 'reference',
        prevBook: null,
        resolved: false,
        hText: null,
        seenBooks: new Set(),
        rows: [],
        titleCount: 0,
        missingCount: 0,
        sty: run.sty,
      };
    },

    checkChapter: function (run, ch) {
      var s = run.state;
      var bookNum = ch.bookNum;
      if (s.prevBook === null || bookNum !== s.prevBook) {
        flushBook(run, s.prevBook);
        s.prevBook = bookNum;
        s.resolved = false;
        s.hText = null;
      }
      if (!inScope(bookNum)) return;
      s.seenBooks.add(bookNum);
      if (s.resolved) return;

      var matches = R.findAll(HEADER_RE, ch.text);
      if (matches.length === 0) return;

      var h = null;
      var mtParts = [];
      matches.forEach(function (m) {
        var kind = m[1];
        var val = T.strip(collapseWs(m[2]));
        if (kind === 'h' && h === null) h = val;
        else if (kind.indexOf('mt') === 0) mtParts.push([kind, val]);
      });
      if (h === null && mtParts.length === 0) return;

      s.resolved = true;
      s.hText = h;
      var mtCombined = null;
      var mtSegments = null;
      var anchor = 0;
      var label;
      var i;
      if (mtParts.length > 0) {
        s.titleCount++;
        for (i = 0; i < matches.length; i++)
          if (matches[i][1].indexOf('mt') === 0) {
            anchor = matches[i].index;
            break;
          }
        // In document order: some books put \mt2 before \mt1.
        var vals = [];
        mtSegments = [];
        mtParts.forEach(function (kv) {
          if (kv[1].length === 0) return;
          vals.push(kv[1]);
          mtSegments.push([kv[0], stripMtSoftBreaks(kv[1])]);
        });
        mtCombined = stripMtSoftBreaks(vals.join(' '));
        label = mtLabel(mtSegments);
      } else {
        s.missingCount++;
        for (i = 0; i < matches.length; i++)
          if (matches[i][1] === 'h') {
            anchor = matches[i].index;
            break;
          }
        label = 'missing';
      }
      var message = label;
      if (s.displayH) message = label + '  \\h ' + (h ? h : 'missing');

      // Zero-width anchor: go-to works, Paratext's TEXT column stays empty.
      var f = run.emit(ch, anchor, anchor, message, mtCombined !== null ? 'title' : 'missing');
      var segs = mtSegments;
      var hCopy = h;
      var displayH = s.displayH;
      f.localize = function (L) {
        var miss = L.str('Rpt_titles_Missing');
        var lbl = mtLabel(segs, miss);
        return displayH ? lbl + '  \\h ' + (hCopy ? hCopy : miss) : lbl;
      };
      f.context = mtCombined !== null ? mtCombined : '';
      if (h !== null) f.extra.h = h;
      if (mtCombined !== null) f.extra.mt = mtCombined;
      s.rows.push({ bookNum: bookNum, bookLabel: PC.usfm.bookCode(bookNum), mtCombined: mtCombined, mtSegments: mtSegments, hText: s.hText });
    },

    endRun: function (run) {
      flushBook(run, run.state.prevBook);
      run.result.reportData = run.state;
    },

    renderReport: function (w, result, L) {
      var d = result.reportData;
      if (!d) return;
      var missing = '<span class="ti-missing">' + esc(L.str('Rpt_titles_Missing')) + '</span>';
      w.line('<p>' + esc(L.fmt('Rpt_titles_Summary', d.seenBooks.size, d.titleCount, d.missingCount)) + '</p>');
      if (d.rows.length === 0) {
        w.line('<p><i>' + esc(L.str('Rpt_titles_NoBooks')) + '</i></p>');
        return;
      }
      var sortKey = d.sortMode === 'mt' ? 'Rpt_titles_SortMt' : d.sortMode === 'h' ? 'Rpt_titles_SortH' : 'Rpt_titles_SortRef';
      w.line('<p>' + esc(L.fmt('Rpt_titles_SortedBy', L.str(sortKey))) + '</p>');
      w.line('<table class="ti-table"><tr><th>' + esc(L.str('Rpt_Book')) + '</th><th>\\mt</th>' + (d.displayH ? '<th>\\h</th>' : '') + '</tr>');
      orderedRows(d).forEach(function (r) {
        w.line(
          '<tr><td>' + PC.report.refLink(r.bookLabel + ' 1:0', esc(r.bookLabel)) + '</td><td>' + mtCell(d, r, missing) + '</td>' +
            (d.displayH ? '<td>' + hCell(r, missing) + '</td>' : '') + '</tr>',
        );
      });
      w.line('</table>');
    },

    diffData: function (result) {
      var d = result.reportData;
      if (!d) return null;
      var missing = '<span class="missing">missing</span>';
      var rows = orderedRows(d).map(function (r) {
        var cells = [r.bookLabel, mtCell(d, r, missing)];
        if (d.displayH) cells.push(hCell(r, missing));
        return cells;
      });
      var sortLabel = d.sortMode === 'mt' ? '\\mt title (alphabetically)' : d.sortMode === 'h' ? '\\h text (alphabetically)' : 'canonical scan order';
      return {
        summary: d.seenBooks.size + ' book(s) scanned, ' + d.titleCount + ' title(s) found, ' + d.missingCount + ' missing.',
        sort: 'Sorted by ' + sortLabel + '.',
        rows: rows,
      };
    },
  });
})();

// Report of Nested Styles: a port of Project_Checker\ProjectChecker\Checks\NestedStylesCheck.cs
// (CMS/report_nested_styles/report_nested_styles.py). Flags character styles inside \f...\f* that
// lack the USFM 3 '+' (\xt instead of \+xt). Footnote-level markers are never flagged; markers the
// stylesheet does not declare as StyleType Character are out of scope.
(function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;
  var FN = PC.footnotes;
  var esc = PC.report.esc;

  var CHAPTER_RE = R.compile('\\\\c\\s+(\\d+)', R.UNICODE);
  var VERSE_RE = R.compile('\\\\v\\s+(\\d+(?:[,-]\\d+)*)\\s*', R.UNICODE);
  var WS_RUN_RE = R.compile('[ \\t]+', R.UNICODE);

  /** _is_issue: a known character style token missing its '+'. */
  function isIssue(d, raw) {
    var hasPlus = raw[0] === '+';
    var bare = hasPlus ? raw.substring(1) : raw;
    var key = bare[bare.length - 1] === '*' ? bare.substring(0, bare.length - 1) : bare;
    if (FN.LEVEL_MARKERS.has(key)) return false;
    if (!d.characterStyles.has(key)) return false;
    return !hasPlus;
  }

  function collapseWs(s) {
    return R.sub(WS_RUN_RE, s.replace(/\r/g, '').replace(/\n/g, ' '), ' ');
  }

  /** _render_segments, with CSS class names supplied by the caller. */
  function renderSegments(d, segments, tag, tagErr, indent) {
    var out = '';
    segments.forEach(function (seg) {
      var marker = seg.marker;
      if (seg.kind === 'close') {
        out += '<span class="' + (isIssue(d, marker) ? tag + ' ' + tagErr : tag) + '">' + esc(marker) + '</span>';
        return;
      }
      if (marker === 'fp') out += '<br><span class="' + indent + '"></span>';
      var text = esc(collapseWs(seg.text));
      if (T.strip(text).length === 0) return;
      if (marker === null) {
        out += '<span>' + text + '</span>';
        return;
      }
      var css = PC.sty.markerCss(d.sty.get(FN.styleKey(marker)));
      var style = css.length > 0 ? ' style="' + css + '"' : '';
      var cls = isIssue(d, marker) ? tag + ' ' + tagErr : tag;
      out += '<span class="' + cls + '">' + esc(marker) + '</span><span' + style + '>' + text + '</span>';
    });
    return out;
  }

  function sortedCounts(d) {
    var list = Array.from(d.issueCounts.entries());
    list.sort(function (a, b) {
      if (a[1] !== b[1]) return b[1] - a[1];
      return T.compare(a[0], b[0]);
    });
    return list;
  }

  PC.define({
    id: 'nested',
    cssPrefix: 'ns',
    original: 'report_nested_styles/report_nested_styles.py',
    kind: 'report',
    options: [],
    reportCss:
      '.ns-tag{display:inline-block;font-size:10px;font-family:monospace;color:#666;background:#eee;' +
      'border:1px solid #ccc;border-radius:3px;padding:0 3px;margin:0 3px 0 8px;vertical-align:middle}' +
      '.ns-tag-err{color:#c00;background:#fee;border-color:#c00;font-weight:bold}' +
      '.ns-indent{display:inline-block;width:2ch}',

    beginRun: function (run) {
      run.state = {
        sty: run.sty,
        characterStyles: PC.sty.characterStyles(run.sty),
        issueCounts: new Map(),
        occurrences: [],
        total: 0,
        flagged: 0,
      };
    },

    checkChapter: function (run, ch) {
      var d = run.state;
      var bookLabel = ch.bookNum >= 1 && ch.bookNum <= 66 ? ch.bookCode : 'Book ' + ch.bookNum;
      var cm = R.search(CHAPTER_RE, ch.text, 0);
      var chapterLabel = cm ? cm[1] : '?';
      var verses = R.findAll(VERSE_RE, ch.text).map(function (vm) {
        return [vm.index + vm[0].length, vm[1]];
      });

      R.findAll(FN.FOOTNOTE_RE, ch.text).forEach(function (m) {
        d.total++;
        var content = m[1];
        var issues = [];
        R.findAll(FN.SUBMARKER_RE, content).forEach(function (t) {
          var display = t[0].substring(1);
          if (isIssue(d, display)) issues.push(display);
        });
        if (issues.length === 0) return;

        d.flagged++;
        issues.forEach(function (code) {
          d.issueCounts.set(code, (d.issueCounts.get(code) || 0) + 1);
        });
        var list = Array.from(new Set(issues)).sort(T.compare).join(', ');
        var f = run.emit(ch, m.index, m.index + m[0].length, 'Missing +: ' + list, 'missingplus');
        f.localize = function (L) {
          return L.str('Msg_nested_MissingPlus') + list;
        };

        // _verse_at: the last \v whose end (after trailing spaces) is <= the offset, else "-".
        var v = null;
        for (var i = 0; i < verses.length; i++) {
          if (verses[i][0] <= m.index) v = verses[i][1];
          else break;
        }
        d.occurrences.push({
          ref: bookLabel + ' ' + chapterLabel + ':' + (v === null ? '-' : v),
          linkRef: ch.bookCode + ' ' + ch.chapter + ':' + PC.usfm.verseAt(ch.text, m.index),
          segments: FN.tokenizeWithCloses(content),
        });
      });
    },

    endRun: function (run) {
      run.result.reportData = run.state;
    },

    renderReport: function (w, result, L) {
      var d = result.reportData;
      if (!d) return;
      w.line('<h3>' + esc(L.str('Rpt_nested_H1')) + '</h3>');
      w.line('<p>' + esc(L.fmt('Rpt_nested_Summary', d.total, d.flagged)) + '</p>');
      if (d.issueCounts.size === 0) w.line('<p><i>' + esc(L.str('Rpt_nested_NoIssues')) + '</i></p>');
      else {
        w.line('<table><tr><th>' + esc(L.str('Rpt_nested_Marker')) + '</th><th>' + esc(L.str('Rpt_nested_Occurrences')) + '</th></tr>');
        sortedCounts(d).forEach(function (kv) {
          w.line('<tr><td>\\' + esc(kv[0]) + '</td><td>' + kv[1] + '</td></tr>');
        });
        w.line('</table>');
      }
      w.line('<h3>' + esc(L.str('Rpt_nested_H2')) + '</h3>');
      if (d.occurrences.length === 0) {
        w.line('<p><i>' + esc(L.str('Rpt_nested_NoFootnotes')) + '</i></p>');
        return;
      }
      w.line('<details class="pc-group" open><summary>' + esc(L.str('Rpt_nested_H2')) + ' (' + d.occurrences.length + ')</summary>');
      w.line('<table><tr><th>' + esc(L.str('Rpt_Reference')) + '</th><th>' + esc(L.str('Rpt_nested_FootnoteText')) + '</th></tr>');
      d.occurrences.forEach(function (o) {
        w.line(
          '<tr><td><b>' + PC.report.refLink(o.linkRef, esc(o.ref)) + '</b></td><td>' +
            renderSegments(d, o.segments, 'ns-tag', 'ns-tag-err', 'ns-indent') + '</td></tr>',
        );
      });
      w.line('</table></details>');
    },

    diffData: function (result) {
      var d = result.reportData;
      if (!d) return null;
      return {
        summary: d.total + ' footnote(s) scanned, ' + d.flagged + ' flagged with a character style missing its required &#39;+&#39;.',
        counts: sortedCounts(d).map(function (kv) {
          return ['\\' + esc(kv[0]), String(kv[1])];
        }),
        rows: d.occurrences.map(function (o) {
          return [esc(o.ref), renderSegments(d, o.segments, 'tag', 'tag-err', 'indent')];
        }),
      };
    },
  });
})();

// Reference Without Markers: a port of Project_Checker\ProjectChecker\Checks\RefWithoutMarkersCheck.cs
// (CMS/reference_without_markers/reference_without_markers.py). Flags scripture references in the
// text that are not inside \xt, \rq, \ior, \fig, \r, \mr, \sr (or \x, \fr, \xo, \rem). Footnote
// \ft text is still scanned.
(function () {
  'use strict';
  var R = PC.re;

  // Whole \x...\x* spans (inside them \xt needs no closing marker), then \xt / \+xt spans outside.
  var MARKED_SPAN_RE = R.compile(
    '\\\\x\\s.*?\\\\x\\*' +
      '|\\\\[+]?xt\\b.*?\\\\[+]?xt\\*' +
      '|\\\\[+]?xt\\b[^\\\\]*' +
      '|\\\\rq\\b.*?\\\\rq\\*' +
      '|\\\\ior\\b.*?\\\\ior\\*' +
      '|\\\\fig\\b.*?\\\\fig\\*',
    R.UNICODE | R.DOTALL,
  );
  // Line-level reference markers (\r, \mr, \sr): blanked to the end of the line.
  var LINE_REF_RE = R.compile('\\\\(?:r|mr|sr)\\b[^\\r\\n]*', R.UNICODE);
  // \fr and \xo: blanked to the next marker.
  var ORIG_MARKER_RE = R.compile('\\\\(?:fr|xo)\\b[^\\\\]*', R.UNICODE);
  // \rem: free-text remarks, blanked to the next marker.
  var REM_MARKER_RE = R.compile('\\\\rem\\b[^\\\\]*', R.UNICODE);

  // _L: any letter, [^\W\d_] (.NET: a word character that is not a digit or _).
  var L = '(?:(?![\\d_])\\w)';
  // _COMB: U+0300-036F, U+0610-065F, U+1DC0-1DFF, U+FE20-FE2F.
  var COMB = '[\\u0300-\\u036f\\u0610-\\u065f\\u1dc0-\\u1dff\\ufe20-\\ufe2f]';
  var BC = '(?:' + L + COMB + '*)';

  PC.define({
    id: 'refnomark',
    cssPrefix: 'rw',
    original: 'reference_without_markers/reference_without_markers.py',
    kind: 'report',
    options: [{ name: 'ChapterVerseSep', type: 'text', def: ':', required: true }],

    beginRun: function (run) {
      var sep = run.opt('ChapterVerseSep');
      if (sep.length === 0) throw new Error('ChapterVerseSep must not be empty');
      var cvs = R.escape(sep);
      var pat =
        '(?<!\\w)' +
        // The book name is optional: "Mat 5:12" or a bare "5:12".
        '(?:' +
        // Numbered books: "1 S", "2 Cr", "3 Jn", "1 Corintios" (NBSP allowed).
        '(?:[123][ \\u00a0]' + BC + '{1,}' +
        // Abbreviation or spelled name, at least 2 letters.
        '|' + BC + '{2,})' +
        '[ \\t]+' +
        ')?' +
        '\\d{1,3}' + cvs +
        // Not an all-zero verse ("50.00").
        '(?!0{2,3}(?!\\d))' +
        '\\d{1,3}[a-z]?' +
        // Range end: hyphen or en dash; verse range or across chapters.
        '(?:[-\\u2013]\\d{1,3}(?:' + cvs + '\\d{1,3})?[a-z]?)?' +
        // Verse lists: ", 63-71" or ",24".
        '(?:,[ ]?\\d{1,3}[a-z]?(?:-\\d{1,3}[a-z]?)?)*';
      run.state.bareRefRe = R.compile(pat, R.UNICODE);
    },

    checkChapter: function (run, ch) {
      var b = PC.usfm.blank(MARKED_SPAN_RE, ch.text);
      b = PC.usfm.blank(LINE_REF_RE, b);
      b = PC.usfm.blank(ORIG_MARKER_RE, b);
      b = PC.usfm.blank(REM_MARKER_RE, b);
      R.findAll(run.state.bareRefRe, b).forEach(function (m) {
        var f = run.emit(ch, m.index, m.index + m[0].length, '', 'ref');
        f.localize = function (L2) {
          return L2.str('Msg_refnomark_Found');
        };
      });
    },
  });
})();

// q Errors: a port of Project_Checker\ProjectChecker\Checks\QErrorsCheck.cs (CMS/q_errors/q_error.py).
// Flags poetry lines (\q, \q1, \q2..., with Project Checker's approved fixes) with final punctuation
// followed by more text (p1a/p1b), two verses on one line (p2a/p2b), text before the verse marker
// (p3) and, optionally, a line ending in non-final punctuation plus one hanging word (p4). One
// finding per match start: the first pattern (p1a..p4) to match there wins.
(function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;
  var U = PC.usfm;
  var esc = PC.report.esc;

  // Notes, cross-references, \qs...\qs* and \fig on one line, plus any closing marker.
  var INLINE_RE = R.compile(
    '\\\\f\\s[^\\r\\n]*?\\\\f\\*|\\\\x\\s[^\\r\\n]*?\\\\x\\*|\\\\qs\\s[^\\r\\n]*?\\\\qs\\*|\\\\fig\\s[^\\r\\n]*?\\\\fig\\*|\\\\[a-z]+\\*',
    R.UNICODE,
  );
  var Q_VERSE_RE = R.compile('\\\\q\\d?[ \\t]+\\\\v[ \\t]+(\\d+)');
  var DIGITS_RE = R.compile('\\d+', R.UNICODE);
  var Q_MARK_RE = R.compile('\\\\q\\d?[ \\t\\r\\n]+', R.UNICODE);
  var NEWLINE_RE = R.compile('\\r?\\n', R.UNICODE);
  var H_WS_RE = R.compile('[ \\t]*', R.UNICODE);
  var VERSE_START_RE = R.compile('\\\\v\\s', R.UNICODE);
  var WS_RUN_RE = R.compile('[ \\t]+', R.UNICODE);
  // _display_parts: the line without note/xref/\qs/\fig spans and without character markers that
  // open and close on it; a closing marker also takes a |attribute part before it.
  var DISPLAY_DROP_RE = R.compile(
    '\\\\f\\s[^\\r\\n]*?\\\\f\\*|\\\\x\\s[^\\r\\n]*?\\\\x\\*|\\\\qs\\s[^\\r\\n]*?\\\\qs\\*|\\\\fig\\s[^\\r\\n]*?\\\\fig\\*' +
      '|(?:\\|[^\\\\\\r\\n]*)?\\\\\\+?([A-Za-z]+\\d*)\\*',
    R.UNICODE,
  );
  var DISPLAY_OPEN_RE = R.compile('\\\\\\+?([A-Za-z]+\\d*)[ ]', R.UNICODE);

  var MSG_FINAL = 'Final punctuation in q';
  var MSG_VERSE = 'Verse in q';
  var MSG_MULTI = 'Poetry line spans multiple verses';
  var MSG_HANGING = 'Single word after punctuation';
  var MSG_ORDER = [MSG_FINAL, MSG_VERSE, MSG_MULTI, MSG_HANGING];

  /** make_char_class: \ ] ^ - escaped inside [...]. */
  function makeCharClass(chars) {
    var s = '[';
    for (var i = 0; i < chars.length; i++) {
      if ('\\]^-'.indexOf(chars[i]) >= 0) s += '\\';
      s += chars[i];
    }
    return s + ']';
  }

  function collapseWs(s) {
    return R.sub(WS_RUN_RE, s.replace(/\r/g, '').replace(/\n/g, ' '), ' ');
  }

  /** _line_end: one line at a time from the \q, going on only when the next line opens with \v. */
  function lineEnd(processed, lineStart) {
    var n = processed.length;
    var qm = R.matchAt(Q_MARK_RE, processed, lineStart);
    var pos = lineStart + (qm ? qm[0].length : 0);
    for (;;) {
      var nl = R.search(NEWLINE_RE, processed, pos);
      if (!nl) return n;
      var after = nl.index + nl[0].length;
      var ws = R.matchAt(H_WS_RE, processed, after);
      var afterWs = after + (ws ? ws[0].length : 0);
      if (R.matchAt(VERSE_START_RE, processed, afterWs)) {
        pos = afterWs;
        continue;
      }
      return nl.index;
    }
  }

  function keepUndropped(text, drop, origin, a, b) {
    var out = '';
    for (var i = a; i < b; i++) {
      var k = i - origin;
      if (k >= 0 && k < drop.length && drop[k]) continue;
      out += text[i];
    }
    return out;
  }

  /** _display_parts: before the trigger, the trigger, and after it (to lineEnd). */
  function displayParts(text, start, trigStart, trigEnd, end) {
    var seg = text.substring(start, start + Math.max(0, end - start));
    var drop = new Array(seg.length);
    R.findAll(DISPLAY_DROP_RE, seg).forEach(function (m) {
      for (var i = m.index; i < m.index + m[0].length; i++) drop[i] = true;
      if (m[1] === undefined) return;
      var name = m[1].toLowerCase();
      var opener = null;
      R.findAll(DISPLAY_OPEN_RE, seg.substring(0, m.index)).forEach(function (o) {
        if (o[1].toLowerCase() === name) opener = o;
      });
      if (opener) for (var j = opener.index; j < opener.index + opener[0].length; j++) drop[j] = true;
    });
    return [
      keepUndropped(text, drop, start, start, trigStart),
      keepUndropped(text, drop, start, trigStart, trigEnd),
      keepUndropped(text, drop, start, trigEnd, Math.max(trigEnd, end)),
    ];
  }

  function catOf(msg) {
    return msg === MSG_FINAL ? 'final' : msg === MSG_MULTI ? 'multi' : msg === MSG_HANGING ? 'hanging' : 'verse';
  }

  function report(run, ch, text, processed, reported, m, msg, cat) {
    var start = m.index;
    var end = m.index + m[0].length;
    if (reported.has(start)) return;
    reported.add(start);
    // Patterns end on the space after \v: take in the verse number.
    var take = Math.min(6, text.length - end);
    var vm = R.matchAt(DIGITS_RE, text.substring(end, end + take), 0);
    var ext = vm ? vm[0].length : 0;
    var f = run.emit(ch, start, end + ext, msg, cat);
    f.localize = function (L) {
      return L.str('Msg_qerrors_' + cat);
    };

    // _ReorderOutput: text beginning "\q \v N" was reported at the previous verse; use N.
    var shown = f.text.replace(/\r/g, '').replace(/\n/g, ' ');
    var qv = R.matchAt(Q_VERSE_RE, shown, 0);
    if (qv && /^[0-9]+$/.test(f.verse)) f.verse = qv[1];
    var ref = f.bookCode + ' ' + f.chapter + ':' + f.verse;

    var trigStart = m.indices[1][0];
    var trigEnd = m.indices[1][1];
    var te = trigEnd === end ? trigEnd + ext : trigEnd;
    var parts = displayParts(text, start, trigStart, te, lineEnd(processed, start));
    var trig = parts[1];
    run.state.rows.push({
      ref: ref,
      linkRef: f.bookCode + ' ' + f.chapter + ':' + f.verse,
      msg: msg,
      before: esc(collapseWs(parts[0])),
      period: msg === MSG_FINAL && trig === '.',
      trigger: esc(collapseWs(trig)),
      after: esc(collapseWs(parts[2])),
    });
    f.context = collapseWs(parts[0] + parts[1] + parts[2]);
  }

  function lineHtml(r, err, errPeriod) {
    return r.before + '<span class="' + (r.period ? err + ' ' + errPeriod : err) + '">' + r.trigger + '</span>' + r.after;
  }

  function grouped(d) {
    var byMsg = new Map();
    d.rows.forEach(function (r) {
      if (!byMsg.has(r.msg)) byMsg.set(r.msg, []);
      byMsg.get(r.msg).push(r);
    });
    return MSG_ORDER.filter(function (m) {
      return byMsg.has(m);
    }).map(function (m) {
      return [m, byMsg.get(m)];
    });
  }

  /** Compiled with the 'd' flag, so match.indices gives group 1's place. */
  function compileD(p, flags) {
    var re = R.compile(p, flags);
    var d = new RegExp(re.source, re.flags + 'd');
    d.pySource = p;
    return d;
  }

  PC.define({
    id: 'qerrors',
    cssPrefix: 'qe',
    original: 'q_errors/q_error.py',
    kind: 'report',
    options: [
      { name: 'FinalPunctuation', type: 'text', def: '.!?' },
      { name: 'MinCharsBeforePunct', type: 'int', def: '0' },
      { name: 'NonFinalPunctuation', type: 'text', def: ',;:' },
      { name: 'CheckFinalPunct', type: 'bool', def: 'Yes' },
      { name: 'CheckDoubleVerse', type: 'bool', def: 'Yes' },
      { name: 'CheckTextBeforeVerse', type: 'bool', def: 'Yes' },
      { name: 'CheckHangingWord', type: 'bool', def: 'No' },
    ],
    reportCss: '.qe-err{color:#c00;font-weight:bold}.qe-err-period{font-size:calc(1em + 2pt)}',

    beginRun: function (run) {
      var s = (run.state = { rows: [], compiled: false });
      var final = run.opt('FinalPunctuation');
      var nonFinal = run.opt('NonFinalPunctuation');
      var checkFinal = T.isYes(run.opt('CheckFinalPunct'));
      var checkDouble = T.isYes(run.opt('CheckDoubleVerse'));
      var checkBefore = T.isYes(run.opt('CheckTextBeforeVerse'));
      var checkHanging = T.isYes(run.opt('CheckHangingWord'));
      if (checkFinal && final.length === 0) {
        run.addNote('Rpt_qerrors_EmptyFinal');
        return;
      }
      if (checkHanging && nonFinal.length === 0) {
        run.addNote('Rpt_qerrors_EmptyNonFinal');
        return;
      }
      var mc = T.strip(run.opt('MinCharsBeforePunct'));
      var minChars = /^[+-]?\d+$/.test(mc) ? parseInt(mc, 10) : 0;
      if (minChars < 0) minChars = 0;

      // [ \t\r\n]+: the poetry marker may stand on its own line (\q3 and deeper count too).
      var q = '\\\\q\\d?[ \\t\\r\\n]+';
      var eol = '[ \\t]*\\r?\\n[ \\t]*';
      var beforePunct = '[^\\r\\n]{' + minChars + ',}?';
      var f = R.UNICODE | R.MULTILINE;
      if (checkFinal) {
        var punct = makeCharClass(final);
        s.p1a = compileD(q + beforePunct + '(' + punct + ')' + '(?=[^\\r\\n]*\\w)', f);
        s.p1b = compileD(q + beforePunct + punct + eol + '(' + '\\\\v\\s' + ')', f);
      }
      if (checkDouble) {
        s.p2a = compileD(q + '[^\\r\\n]*\\\\v\\s+\\d+[^\\r\\n]*(' + '\\\\v\\s' + ')', f);
        s.p2b = compileD(q + '[^\\r\\n]*\\\\v\\s+\\d+[^\\r\\n]*' + eol + '(' + '\\\\v\\s' + ')', f);
      }
      if (checkBefore) s.p3 = compileD(q + '(' + '[ \\t]*[^ \\t\\r\\n\\\\][^\\r\\n]*(?:\\r?\\n[ \\t]*)?' + ')' + '\\\\v\\s', f);
      if (checkHanging)
        s.p4 = compileD(q + '[^\\r\\n]*(' + makeCharClass(nonFinal) + '[ \\t]+\\w+' + ')' + '[ \\t]*(?=\\r?$|\\\\q)', f);
      s.compiled = true;
    },

    checkChapter: function (run, ch) {
      var s = run.state;
      if (!s.compiled) return;
      var text = ch.text;
      var processed = U.blank(INLINE_RE, text);
      var reported = new Set();
      function each(re, src, msg, cat) {
        if (!re) return;
        R.findAll(re, src).forEach(function (m) {
          report(run, ch, text, processed, reported, m, msg, cat);
        });
      }
      each(s.p1a, processed, MSG_FINAL, 'final');
      each(s.p1b, processed, MSG_VERSE, 'verse');
      // Approved fix: the later patterns also run on the blanked text (offsets are the same).
      each(s.p2a, processed, MSG_MULTI, 'multi');
      each(s.p2b, processed, MSG_VERSE, 'verse');
      each(s.p3, processed, MSG_VERSE, 'verse');
      each(s.p4, processed, MSG_HANGING, 'hanging');
    },

    endRun: function (run) {
      run.result.reportData = run.state;
    },

    renderReport: function (w, result, L) {
      var d = result.reportData;
      if (!d || !d.compiled) return;
      if (d.rows.length === 0) {
        w.line('<p><i>' + esc(L.str('Rpt_nested_NoIssues')) + '</i></p>');
        return;
      }
      grouped(d).forEach(function (g) {
        w.line('<details class="pc-group" open><summary>' + esc(L.str('Msg_qerrors_' + catOf(g[0]))) + ' (' + g[1].length + ')</summary>');
        w.line('<table><tr><th>' + esc(L.str('Rpt_Reference')) + '</th><th>' + esc(L.str('Rpt_qerrors_QLine')) + '</th></tr>');
        g[1].forEach(function (r) {
          w.line('<tr><td><b>' + PC.report.refLink(r.linkRef, esc(r.ref)) + '</b></td><td>' + lineHtml(r, 'qe-err', 'qe-err-period') + '</td></tr>');
        });
        w.line('</table></details>');
      });
    },

    diffData: function (result) {
      var d = result.reportData;
      if (!d || !d.compiled) return null;
      var rows = [];
      grouped(d).forEach(function (g) {
        g[1].forEach(function (r) {
          rows.push([g[0] + ' (' + g[1].length + ')', esc(r.ref), lineHtml(r, 'err', 'err-period')]);
        });
      });
      return { rows: rows };
    },
  });

})();

// Find Footnotes: a port of Project_Checker\ProjectChecker\Checks\FootnotesCheck.cs
// (CMS/find_footnotes/find_footnotes.py). Lists every footnote with its reference, caller, \fr and
// text in the stylesheet's formatting, plus every sub-marker token seen and its style.
(function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;
  var FN = PC.footnotes;
  var esc = PC.report.esc;
  var EM_DASH = '\u2014';

  var CHAPTER_RE = R.compile('\\\\c\\s+(\\d+)', R.UNICODE);
  var VERSE_RE = R.compile('\\\\v\\s+(\\d+(?:[,-]\\d+)*)\\s*', R.UNICODE);
  var WS_RUN_RE = R.compile('[ \\t]+', R.UNICODE);

  function yes(v) {
    return T.lower(T.strip(v || '')) === 'yes';
  }

  function collapseWs(s) {
    return R.sub(WS_RUN_RE, s.replace(/\r/g, '').replace(/\n/g, ' '), ' ');
  }

  var ORIGINAL = {
    yes: 'yes',
    notInSty: 'not in stylesheet',
    bold: 'Bold',
    italic: 'Italic',
    superscript: 'Superscript',
    smallCaps: 'SmallCaps',
    underline: 'Underline',
    sample: 'Sample text',
    tag: 'tag',
    swatch: 'swatch',
    indent: 'indent',
  };

  function localized(L) {
    return {
      yes: L.str('Rpt_footnotes_Yes'),
      notInSty: L.str('Rpt_footnotes_NotInSty'),
      bold: L.str('Rpt_footnotes_Bold'),
      italic: L.str('Rpt_footnotes_Italic'),
      superscript: L.str('Rpt_footnotes_Superscript'),
      smallCaps: L.str('Rpt_footnotes_SmallCaps'),
      underline: L.str('Rpt_footnotes_Underline'),
      sample: L.str('Rpt_footnotes_Sample'),
      tag: 'fn-tag',
      swatch: 'fn-swatch',
      indent: 'fn-indent',
    };
  }

  function sortedMarkers(d) {
    return Array.from(d.markerCounts.keys()).sort(T.compare);
  }

  /** _marker_row_html */
  function markerRow(d, marker, l) {
    var fields = d.sty.get(FN.styleKey(marker)) || new Map();
    var css = PC.sty.markerCss(fields);
    var flags = [];
    if (PC.sty.flagOn(fields, 'bold')) flags.push(l.bold);
    if (PC.sty.flagOn(fields, 'italic')) flags.push(l.italic);
    if (PC.sty.flagOn(fields, 'superscript')) flags.push(l.superscript);
    if (PC.sty.flagOn(fields, 'smallcaps')) flags.push(l.smallCaps);
    if (PC.sty.flagOn(fields, 'underline')) flags.push(l.underline);
    var flagsStr = flags.length > 0 ? flags.join(', ') : EM_DASH;
    var cssColor = fields.get('colorcss') || (fields.get('color') ? PC.sty.colorCss(fields.get('color')) : null);
    var swatch = cssColor ? '<span class="' + l.swatch + '" style="background:' + cssColor + '"></span>' : '';
    var styletype = fields.get('styletype') || EM_DASH;
    var sample = '<span' + (css.length > 0 ? ' style="' + css + '"' : '') + '>' + l.sample + '</span>';
    var found = fields.size > 0 ? l.yes : l.notInSty;
    return (
      '<tr><td>\\' + esc(marker) + '</td><td>' + (d.markerCounts.get(marker) || 0) + '</td><td>' + esc(found) + '</td><td>' + swatch +
      '</td><td>' + esc(styletype) + '</td><td>' + esc(flagsStr) + '</td><td>' + sample + '</td></tr>'
    );
  }

  /** _render_segments */
  function renderSegments(d, segments, l) {
    var out = '';
    segments.forEach(function (seg) {
      var marker = seg.marker;
      if (seg.kind === 'close') {
        if (!d.hideMarkers) out += '<span class="' + l.tag + '">' + esc(marker) + '</span>';
        return;
      }
      // \fp starts a new paragraph in the note: shown even when markers are hidden.
      if (marker === 'fp') out += '<br><span class="' + l.indent + '"></span>';
      var text = esc(collapseWs(seg.text));
      if (T.strip(text).length === 0) return;
      var css = PC.sty.markerCss(d.sty.get(FN.styleKey(marker)));
      var style = css.length > 0 ? ' style="' + css + '"' : '';
      var tag = d.hideMarkers ? '' : '<span class="' + l.tag + '">' + esc(marker) + '</span>';
      out += tag + '<span' + style + '>' + text + '</span>';
    });
    return out;
  }

  function ordered(d) {
    if (!d.sortAlpha) return d.occurrences.slice();
    return d.occurrences
      .map(function (o, i) {
        return { o: o, i: i };
      })
      .sort(function (a, b) {
        var c = T.compare(a.o.sortKey, b.o.sortKey);
        if (c !== 0) return c;
        c = T.compare(a.o.ref, b.o.ref);
        return c !== 0 ? c : a.i - b.i;
      })
      .map(function (x) {
        return x.o;
      });
  }

  function occurrenceRow(d, o, l, callerClass, link) {
    var frCss = PC.sty.markerCss(d.sty.get('fr'));
    var frStyle = frCss.length > 0 ? ' style="' + frCss + '"' : '';
    var callerCell = o.caller.length > 0 ? esc(o.caller) : '';
    var frCell = o.frText.length > 0 ? '<span' + frStyle + '>' + esc(o.frText) + '</span>' : '';
    var ref = link ? PC.report.refLink(o.linkRef, esc(o.ref)) : esc(o.ref);
    return (
      '<tr><td><b>' + ref + '</b></td><td class="' + callerClass + '">' + callerCell + '</td><td>' + frCell + '</td><td>' +
      renderSegments(d, o.rest, l) + '</td></tr>'
    );
  }

  PC.define({
    id: 'footnotes',
    cssPrefix: 'fn',
    original: 'find_footnotes/find_footnotes.py',
    kind: 'report',
    options: [
      { name: 'SortAlphabetically', type: 'bool', def: 'No' },
      { name: 'HideMarkers', type: 'bool', def: 'No' },
    ],
    reportCss:
      '.fn-tag{display:inline-block;font-size:10px;font-family:monospace;color:#666;background:#eee;' +
      'border:1px solid #ccc;border-radius:3px;padding:0 3px;margin:0 3px 0 8px;vertical-align:middle}' +
      '.fn-swatch{display:inline-block;width:12px;height:12px;border:1px solid #888;vertical-align:middle;margin-right:4px}' +
      '.fn-caller{color:#888;font-family:monospace}.fn-indent{display:inline-block;width:2ch}',

    beginRun: function (run) {
      run.state = {
        sortAlpha: yes(run.opt('SortAlphabetically')),
        hideMarkers: yes(run.opt('HideMarkers')),
        sty: run.sty,
        markerCounts: new Map(),
        occurrences: [],
        total: 0,
      };
    },

    checkChapter: function (run, ch) {
      var d = run.state;
      var bookLabel = ch.bookNum >= 1 && ch.bookNum <= 66 ? ch.bookCode : 'Book ' + ch.bookNum;
      var cm = R.search(CHAPTER_RE, ch.text, 0);
      var chapterLabel = cm ? cm[1] : '?';
      var verses = R.findAll(VERSE_RE, ch.text).map(function (vm) {
        return [vm.index + vm[0].length, vm[1]];
      });

      R.findAll(FN.FOOTNOTE_RE, ch.text).forEach(function (m) {
        d.total++;
        var content = m[1];
        var segments = FN.tokenizeWithCloses(content);
        // Every marker token as written: \w, \w*, \+w and \+w* are separate rows.
        R.findAll(FN.SUBMARKER_RE, content).forEach(function (t) {
          var display = t[0].substring(1);
          d.markerCounts.set(display, (d.markerCounts.get(display) || 0) + 1);
        });

        var caller = '';
        var fr = '';
        var rest = [];
        segments.forEach(function (seg) {
          if (seg.marker === null) caller += seg.text;
          else if (seg.marker === 'fr') fr += seg.text;
          else rest.push(seg);
        });
        var restText = T.strip(
          collapseWs(
            rest
              .filter(function (s) {
                return T.strip(s.text).length > 0;
              })
              .map(function (s) {
                return s.text;
              })
              .join(' '),
          ),
        );

        var distinct = new Set();
        segments.forEach(function (seg) {
          if (seg.marker !== null && seg.kind !== 'close') distinct.add(seg.marker);
        });
        var markers = Array.from(distinct).sort(T.compare).join(' ');
        var f = run.emit(ch, m.index, m.index + m[0].length, distinct.size > 0 ? 'Footnote: ' + markers : 'Footnote', 'footnote');
        f.localize = function (L) {
          return markers.length > 0 ? L.str('Msg_footnotes_Footnote') + ': ' + markers : L.str('Msg_footnotes_Footnote');
        };

        var v = null;
        for (var i = 0; i < verses.length; i++) {
          if (verses[i][0] <= m.index) v = verses[i][1];
          else break;
        }
        d.occurrences.push({
          ref: bookLabel + ' ' + chapterLabel + ':' + (v === null ? '-' : v),
          linkRef: ch.bookCode + ' ' + ch.chapter + ':' + PC.usfm.verseAt(ch.text, m.index),
          caller: T.strip(collapseWs(caller)),
          frText: T.strip(collapseWs(fr)),
          rest: rest,
          sortKey: T.sortFold(restText),
        });
      });
    },

    endRun: function (run) {
      run.result.reportData = run.state;
    },

    renderReport: function (w, result, L) {
      var d = result.reportData;
      if (!d) return;
      var l = localized(L);
      w.line('<h3>' + esc(L.str('Rpt_footnotes_H1')) + '</h3>');
      if (d.markerCounts.size === 0) w.line('<p><i>' + esc(L.str('Rpt_footnotes_None')) + '</i></p>');
      else {
        w.line(
          '<table><tr><th>' + esc(L.str('Rpt_nested_Marker')) + '</th><th>' + esc(L.str('Rpt_footnotes_Count')) + '</th><th>' +
            esc(L.str('Rpt_footnotes_InSty')) + '</th><th>' + esc(L.str('Rpt_footnotes_Color')) + '</th><th>' +
            esc(L.str('Rpt_footnotes_StyleType')) + '</th><th>' + esc(L.str('Rpt_footnotes_Flags')) + '</th><th>' +
            esc(L.str('Rpt_footnotes_SampleCol')) + '</th></tr>',
        );
        sortedMarkers(d).forEach(function (mk) {
          w.line(markerRow(d, mk, l));
        });
        w.line('</table>');
      }
      w.line('<h3>' + esc(L.str('Rpt_footnotes_H2')) + '</h3>');
      if (d.total === 0) {
        w.line('<p><i>' + esc(L.str('Rpt_footnotes_None')) + '</i></p>');
        return;
      }
      var sortLabel = L.str(d.sortAlpha ? 'Rpt_footnotes_SortText' : 'Rpt_footnotes_SortRef');
      var mode = d.hideMarkers ? ' ' + L.str('Rpt_footnotes_Hidden') : '';
      w.line('<p>' + esc(L.fmt('Rpt_footnotes_Summary', d.total, sortLabel) + mode) + '</p>');
      w.line('<details class="pc-group" open><summary>' + esc(L.str('Rpt_footnotes_H2')) + ' (' + d.total + ')</summary>');
      w.line(
        '<table><tr><th>' + esc(L.str('Rpt_Reference')) + '</th><th>' + esc(L.str('Rpt_footnotes_Caller')) + '</th><th>\\fr</th><th>' +
          esc(L.str('Rpt_nested_FootnoteText')) + '</th></tr>',
      );
      ordered(d).forEach(function (o) {
        w.line(occurrenceRow(d, o, l, 'fn-caller', true));
      });
      w.line('</table></details>');
    },

    diffData: function (result) {
      var d = result.reportData;
      if (!d) return null;
      var r = {
        markers: sortedMarkers(d).map(function (mk) {
          return markerRow(d, mk, ORIGINAL);
        }),
        rows: ordered(d).map(function (o) {
          return occurrenceRow(d, o, ORIGINAL, 'caller', false);
        }),
      };
      if (d.total > 0)
        r.summary =
          d.total + ' footnote(s) found, sorted by ' + (d.sortAlpha ? 'footnote text (alphabetically)' : 'canonical reference') + '.' +
          (d.hideMarkers ? ' Markers are hidden.' : '');
      return r;
    },
  });
})();

const PCX_VERSION = "0.8.0";
const PCX_WEB_VIEW_HTML = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      :root {\n        --pc-bg: #ffffff;\n        --pc-fg: #1f2328;\n        --pc-muted: #59636e;\n        --pc-line: #d0d7de;\n        --pc-head: #f3f5f7;\n        --pc-sel: #dbeafe;\n        --pc-accent: #0b6bcb;\n        --pc-warn: #9a3412;\n      }\n      @media (prefers-color-scheme: dark) {\n        :root {\n          --pc-bg: #1e1f22;\n          --pc-fg: #e6e6e6;\n          --pc-muted: #a0a6ad;\n          --pc-line: #3a3d42;\n          --pc-head: #2a2c30;\n          --pc-sel: #1e3a5f;\n          --pc-accent: #6cb6ff;\n          --pc-warn: #fdba74;\n        }\n      }\n      html,\n      body {\n        margin: 0;\n        height: 100%;\n        background: var(--pc-bg);\n        color: var(--pc-fg);\n        font: 13px/1.4 'Segoe UI', system-ui, sans-serif;\n      }\n      body {\n        display: flex;\n        gap: 10px;\n        padding: 8px 12px;\n        box-sizing: border-box;\n      }\n      #left {\n        width: 260px;\n        flex: none;\n        display: flex;\n        flex-direction: column;\n        gap: 6px;\n      }\n      #right {\n        flex: 1;\n        min-width: 0;\n        display: flex;\n        flex-direction: column;\n        gap: 6px;\n      }\n      #list {\n        flex: 1;\n        overflow: auto;\n        border: 1px solid var(--pc-line);\n        border-radius: 4px;\n      }\n      .item {\n        padding: 5px 8px;\n        cursor: pointer;\n        border-bottom: 1px solid var(--pc-line);\n      }\n      .item.sel {\n        background: var(--pc-sel);\n      }\n      .item .kind {\n        color: var(--pc-muted);\n        font-size: 11px;\n      }\n      h1 {\n        font-size: 15px;\n        margin: 0;\n      }\n      #desc {\n        color: var(--pc-muted);\n      }\n      #opts {\n        display: grid;\n        grid-template-columns: max-content 1fr;\n        gap: 4px 10px;\n        align-items: center;\n      }\n      #opts label {\n        font-weight: 600;\n      }\n      select,\n      input[type='text'],\n      input[type='number'] {\n        font: inherit;\n        background: var(--pc-bg);\n        color: var(--pc-fg);\n        border: 1px solid var(--pc-line);\n        border-radius: 3px;\n        padding: 2px 4px;\n      }\n      input[type='text'] {\n        width: 100%;\n        box-sizing: border-box;\n      }\n      button {\n        font: inherit;\n        padding: 3px 12px;\n        border: 1px solid var(--pc-line);\n        background: var(--pc-head);\n        color: var(--pc-fg);\n        border-radius: 4px;\n        cursor: pointer;\n      }\n      button.primary {\n        background: var(--pc-accent);\n        border-color: var(--pc-accent);\n        color: #fff;\n        font-weight: 600;\n      }\n      button:disabled {\n        opacity: 0.5;\n        cursor: default;\n      }\n      .row {\n        display: flex;\n        gap: 8px;\n        align-items: center;\n        flex-wrap: wrap;\n      }\n      .spinner {\n        display: inline-block;\n        width: 12px;\n        height: 12px;\n        border: 2px solid var(--pc-line);\n        border-top-color: var(--pc-accent);\n        border-radius: 50%;\n        animation: spin 0.8s linear infinite;\n        vertical-align: -2px;\n        margin-right: 6px;\n      }\n      @keyframes spin {\n        to {\n          transform: rotate(360deg);\n        }\n      }\n      #busy {\n        display: none;\n        flex-direction: column;\n        align-items: center;\n        justify-content: center;\n        gap: 12px;\n        padding: 40px 20px;\n        color: #333;\n        font-size: 14px;\n      }\n      #busy .spinner {\n        width: 32px;\n        height: 32px;\n        border-width: 4px;\n        margin: 0;\n      }\n      #busy .track {\n        width: 60%;\n        max-width: 420px;\n        height: 8px;\n        background: #e5e7eb;\n        border-radius: 4px;\n        overflow: hidden;\n      }\n      #busy .track > div {\n        height: 100%;\n        width: 0;\n        background: #0b6bcb;\n        transition: width 0.2s;\n      }\n      #bar {\n        height: 4px;\n        background: var(--pc-head);\n        border-radius: 2px;\n        overflow: hidden;\n        display: none;\n      }\n      #bar > div {\n        height: 100%;\n        width: 0;\n        background: var(--pc-accent);\n        transition: width 0.2s;\n      }\n      #status {\n        color: var(--pc-muted);\n      }\n      #status.err {\n        color: var(--pc-warn);\n        font-weight: 600;\n      }\n      #out {\n        flex: 1;\n        overflow: auto;\n        border: 1px solid var(--pc-line);\n        border-radius: 4px;\n        background: #fff;\n      }\n      .pc-report {\n        padding: 8px 12px;\n      }\n      .muted {\n        color: var(--pc-muted);\n        font-size: 11px;\n      }\n    </style>\n  </head>\n  <body>\n    <div id=\"left\">\n      <div id=\"checksLabel\" style=\"font-weight: 600\"></div>\n      <div id=\"list\"><div class=\"item\" id=\"loading\"><span class=\"spinner\"></span><span>Loading...</span></div></div>\n      <div class=\"muted\" id=\"version\"></div>\n    </div>\n    <div id=\"right\">\n      <h1 id=\"name\"></h1>\n      <div id=\"desc\"></div>\n      <div id=\"opts\"></div>\n      <div class=\"row\">\n        <button class=\"primary\" id=\"run\"></button>\n        <button class=\"primary\" id=\"open\" style=\"display: none\"></button>\n        <button id=\"defaults\"></button>\n        <label><input type=\"checkbox\" id=\"otherBooks\" /> <span id=\"otherBooksLabel\"></span></label>\n        <span id=\"status\"></span>\n      </div>\n      <div id=\"bar\"><div></div></div>\n      <div id=\"out\">\n        <div id=\"busy\"><span class=\"spinner\"></span><div id=\"busyText\"></div><div class=\"track\"><div id=\"busyBar\"></div></div></div>\n        <div id=\"report\"></div>\n      </div>\n    </div>\n    <script>\n      const BOOT = __PCX_BOOT__;\n      const papi = require('@papi/frontend');\n\n      const STR = {\n        en: {\n          checks: 'Checks',\n          loading: 'Loading the list of checks...',\n          opening: 'Opening the project...',\n          reading: 'Reading {0} ({1} of {2})...',\n          checking: 'Running {0}...',\n          building: 'Preparing the report...',\n          showing: 'Showing the report...',\n          open: 'Open {0}...',\n          opensWindow: '{0} opens in its own window, where it scans the project.',\n          otherBooks: 'Include non-Bible books (FRT, BAK, OTH, XXA...)',\n          report: 'Report',\n          run: 'Run',\n          defaults: 'Restore defaults',\n          yes: 'Yes',\n          no: 'No',\n          running: 'Running {0}...',\n          done: '{0} result(s) in {1} book(s).',\n          failed: 'The check failed: {0}',\n          notRead: 'Not read: {0}',\n          noOptions: 'This check has no options.',\n          notWhole: '{0} must be a whole number.',\n        },\n        es: {\n          checks: 'Verificaciones',\n          loading: 'Cargando la lista de verificaciones...',\n          opening: 'Abriendo el proyecto...',\n          reading: 'Leyendo {0} ({1} de {2})...',\n          checking: 'Ejecutando {0}...',\n          building: 'Preparando el informe...',\n          showing: 'Mostrando el informe...',\n          open: 'Abrir {0}...',\n          opensWindow: '{0} se abre en su propia ventana, donde examina el proyecto.',\n          otherBooks: 'Incluir los libros que no son de la Biblia (FRT, BAK, OTH, XXA...)',\n          report: 'Informe',\n          run: 'Ejecutar',\n          defaults: 'Restaurar valores predeterminados',\n          yes: 'S\u00ed',\n          no: 'No',\n          running: 'Ejecutando {0}...',\n          done: '{0} resultado(s) en {1} libro(s).',\n          failed: 'La verificaci\u00f3n fall\u00f3: {0}',\n          notRead: 'No se ley\u00f3: {0}',\n          noOptions: 'Esta verificaci\u00f3n no tiene opciones.',\n          notWhole: '{0} debe ser un n\u00famero entero.',\n        },\n        fr: {\n          checks: 'V\u00e9rifications',\n          loading: 'Chargement de la liste des v\u00e9rifications...',\n          opening: 'Ouverture du projet...',\n          reading: 'Lecture de {0} ({1} sur {2})...',\n          checking: 'Ex\u00e9cution de {0}...',\n          building: 'Pr\u00e9paration du rapport...',\n          showing: 'Affichage du rapport...',\n          open: 'Ouvrir {0}...',\n          opensWindow: '{0} s\u2019ouvre dans sa propre fen\u00eatre, o\u00f9 il examine le projet.',\n          otherBooks: 'Inclure les livres hors Bible (FRT, BAK, OTH, XXA...)',\n          report: 'Rapport',\n          run: 'Lancer',\n          defaults: 'R\u00e9tablir les valeurs par d\u00e9faut',\n          yes: 'Oui',\n          no: 'Non',\n          running: 'Ex\u00e9cution de {0}...',\n          done: '{0} r\u00e9sultat(s) dans {1} livre(s).',\n          failed: 'La v\u00e9rification a \u00e9chou\u00e9 : {0}',\n          notRead: 'Non lu : {0}',\n          noOptions: 'Cette v\u00e9rification n\u2019a pas d\u2019options.',\n          notWhole: '{0} doit \u00eatre un nombre entier.',\n        },\n      };\n      const S = STR[BOOT.lang] || STR.en;\n      const KIND = {\n        en: { report: 'Report', changes: 'Changes text' },\n        es: { report: 'Informe', changes: 'Cambia el texto' },\n        fr: { report: 'Rapport', changes: 'Modifie le texte' },\n      }[BOOT.lang] || { report: 'Report', changes: 'Changes text' };\n\n      let checks = [];\n      let current = null;\n      let busy = false;\n      const $ = (id) => document.getElementById(id);\n\n      function fmt(s, ...args) {\n        return s.replace(/\\{(\\d+)\\}/g, (m, n) => (args[n] === undefined ? m : String(args[n])));\n      }\n\n      /** The status line; working = with the spinner. */\n      function status(text, isError, working) {\n        const el = $('status');\n        el.textContent = '';\n        if (working) {\n          const sp = document.createElement('span');\n          sp.className = 'spinner';\n          el.appendChild(sp);\n        }\n        el.appendChild(document.createTextNode(text || ''));\n        el.className = isError ? 'err' : '';\n        $('busy').style.display = working ? 'flex' : 'none';\n        $('report').style.display = working ? 'none' : '';\n        if (working) $('busyText').textContent = text || '';\n      }\n\n      /** The progress bar: fraction 0..1, or null to hide it. */\n      function bar(fraction) {\n        $('bar').style.display = fraction === null ? 'none' : 'block';\n        const w = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100) + '%';\n        $('bar').firstElementChild.style.width = w;\n        $('busyBar').style.width = w;\n        $('busyBar').parentElement.style.visibility = fraction === null ? 'hidden' : 'visible';\n      }\n\n      function showProgress(p) {\n        if (!p || p.runId !== runId || !busy) return;\n        if (p.phase === 'open') status(S.opening, false, true);\n        else if (p.phase === 'read') status(fmt(S.reading, p.book, p.done + 1, p.total), false, true);\n        else if (p.phase === 'check') status(fmt(S.checking, current ? current.name : ''), false, true);\n        else if (p.phase === 'report') status(S.building, false, true);\n        if (p.total > 0) bar(p.phase === 'read' ? (p.done / p.total) * 0.9 : p.phase === 'open' ? 0 : 0.95);\n      }\n\n      // Progress sent by the backend while a check runs (book by book).\n      let runId = null;\n      try {\n        const onProgress = papi.network.getNetworkEvent('philsChecks.onProgress');\n        onProgress(showProgress);\n      } catch (e) {\n        // no progress events: the spinner alone shows that it is working\n      }\n\n      function drawList() {\n        const list = $('list');\n        list.textContent = '';\n        checks.forEach((c) => {\n          const div = document.createElement('div');\n          div.className = 'item' + (current && current.id === c.id ? ' sel' : '');\n          const name = document.createElement('div');\n          name.textContent = c.name;\n          const kind = document.createElement('div');\n          kind.className = 'kind';\n          kind.textContent = KIND[c.kind] || c.kind;\n          div.append(name, kind);\n          div.addEventListener('click', () => select(c.id));\n          div.addEventListener('dblclick', () => run());\n          list.appendChild(div);\n        });\n      }\n\n      function drawOptions(values) {\n        const box = $('opts');\n        box.textContent = '';\n        if (current.options.length === 0) {\n          const p = document.createElement('div');\n          p.className = 'muted';\n          p.textContent = S.noOptions;\n          box.appendChild(p);\n          return;\n        }\n        current.options.forEach((o) => {\n          const label = document.createElement('label');\n          label.textContent = o.label;\n          label.title = o.tip;\n          label.htmlFor = 'opt_' + o.name;\n          let input;\n          if (o.type === 'bool') {\n            input = document.createElement('select');\n            [\n              ['Yes', S.yes],\n              ['No', S.no],\n            ].forEach(([v, t]) => {\n              const op = document.createElement('option');\n              op.value = v;\n              op.textContent = t;\n              input.appendChild(op);\n            });\n            input.value = String(values[o.name]).trim().toLowerCase() === 'yes' ? 'Yes' : 'No';\n          } else {\n            input = document.createElement('input');\n            input.type = o.type === 'int' ? 'number' : 'text';\n            input.value = values[o.name];\n          }\n          input.id = 'opt_' + o.name;\n          input.title = o.tip;\n          box.append(label, input);\n        });\n      }\n\n      function readOptions() {\n        const o = {};\n        for (const d of current.options) {\n          const v = $('opt_' + d.name).value;\n          if (d.type === 'int' && !/^\\s*[+-]?\\d+\\s*$/.test(v)) throw new Error(fmt(S.notWhole, d.label));\n          o[d.name] = v;\n        }\n        return o;\n      }\n\n      async function select(id) {\n        current = checks.find((c) => c.id === id);\n        drawList();\n        $('name').textContent = current.name;\n        $('desc').textContent = current.description;\n        $('report').textContent = '';\n        status('');\n        bar(null);\n        const opens = !!current.opens;\n        $('run').style.display = opens ? 'none' : '';\n        $('defaults').style.display = opens ? 'none' : '';\n        $('otherBooks').parentElement.style.display = opens ? 'none' : '';\n        $('open').style.display = opens ? '' : 'none';\n        if (opens) {\n          $('open').textContent = fmt(S.open, current.name);\n          $('opts').textContent = '';\n          const p = document.createElement('div');\n          p.className = 'muted';\n          p.textContent = fmt(S.opensWindow, current.name);\n          $('opts').appendChild(p);\n          return;\n        }\n        let values = {};\n        try {\n          values = await papi.commands.sendCommand('philsChecks.loadOptions', BOOT.projectId, id);\n        } catch (e) {\n          current.options.forEach((o) => (values[o.name] = o.def));\n        }\n        drawOptions(values);\n      }\n\n      function showReport(res) {\n        const out = $('report');\n        out.textContent = '';\n        const style = document.createElement('style');\n        style.textContent = res.css;\n        const div = document.createElement('div');\n        div.className = 'pc-report';\n        // The report is built by the extension from escaped project text.\n        div.innerHTML = res.html;\n        out.append(style, div);\n      }\n\n      async function run() {\n        if (!current || busy) return;\n        if (current.opens) {\n          openOther();\n          return;\n        }\n        let options;\n        try {\n          options = readOptions();\n        } catch (e) {\n          status(e.message, true);\n          return;\n        }\n        busy = true;\n        $('run').disabled = true;\n        $('list').style.pointerEvents = 'none';\n        runId = String(Date.now()) + Math.random();\n        status(fmt(S.running, current.name), false, true);\n        bar(0);\n        $('report').textContent = '';\n        const myRun = runId;\n        const poll = setInterval(() => {\n          papi.commands\n            .sendCommand('philsChecks.progress', BOOT.projectId, myRun)\n            .then(showProgress)\n            .catch(() => {});\n        }, 250);\n        try {\n          const res = await papi.commands.sendCommand('philsChecks.run', BOOT.projectId, current.id, options, BOOT.lang, {\n            otherBooks: $('otherBooks').checked,\n            runId,\n          });\n          status(S.showing, false, true);\n          bar(1);\n          // Let the window paint the status before a big report is laid out.\n          await new Promise((r) => setTimeout(r, 30));\n          showReport(res);\n          let text = fmt(S.done, res.count, res.booksRead.length);\n          if (res.failed.length > 0) text += ' ' + fmt(S.notRead, res.failed.join('; '));\n          status(text, res.failed.length > 0);\n        } catch (e) {\n          status(fmt(S.failed, e && e.message ? e.message : e), true);\n        } finally {\n          clearInterval(poll);\n          busy = false;\n          runId = null;\n          bar(null);\n          $('run').disabled = false;\n          $('list').style.pointerEvents = '';\n        }\n      }\n\n      $('out').addEventListener('click', (ev) => {\n        const a = ev.target.closest ? ev.target.closest('a.pc-go') : null;\n        if (!a) return;\n        ev.preventDefault();\n        papi.commands.sendCommand('philsChecks.goTo', BOOT.projectId, a.getAttribute('data-ref')).catch((e) => status(String(e), true));\n      });\n\n      function openOther() {\n        papi.commands.sendCommand(current.opens, undefined, BOOT.projectId).catch((e) => status(String(e), true));\n      }\n\n      $('run').addEventListener('click', run);\n      $('open').addEventListener('click', openOther);\n      $('defaults').addEventListener('click', () => {\n        if (!current) return;\n        const values = {};\n        current.options.forEach((o) => (values[o.name] = o.def));\n        drawOptions(values);\n      });\n\n      async function start() {\n        $('checksLabel').textContent = S.checks;\n        $('run').textContent = S.run;\n        $('defaults').textContent = S.defaults;\n        $('otherBooksLabel').textContent = S.otherBooks;\n        $('otherBooks').checked = !!BOOT.otherBooks;\n        $('version').textContent = (BOOT.projectName ? BOOT.projectName + ' \u00b7 ' : '') + BOOT.version;\n        $('loading').lastChild.textContent = S.loading;\n        status(S.loading, false, true);\n        bar(null);\n        if (!BOOT.projectName)\n          papi.commands\n            .sendCommand('philsChecks.projectName', BOOT.projectId)\n            .then((n) => {\n              if (n) $('version').textContent = n + ' \\u00b7 ' + BOOT.version;\n            })\n            .catch(() => {});\n        try {\n          checks = await papi.commands.sendCommand('philsChecks.list', BOOT.lang);\n        } catch (e) {\n          status(String(e), true);\n          return;\n        }\n        status('');\n        drawList();\n        if (checks.length > 0) select(checks[0].id);\n      }\n      start();\n    </script>\n  </body>\n</html>\n";
const PCX_USFM_STY = "# Version=3.0.11\n# ********************************************************************\n# * usfm.sty is the default stylesheet for Paratext projects         *\n# *   using USFM markup.                                             *\n# * Latest documentation and stylesheets are maintained at:          *\n# *   http://markups.paratext.org/usfm                               *\n# ********************************************************************\n\n# File Identification\n\n\\Marker id\n\\Name id - File - Identification\n\\Description File identification information (BOOKID, FILENAME, EDITOR, MODIFICATION DATE)\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular book\n\\FontSize 12\n\n\\Marker usfm\n\\Name usfm - File - USFM Version ID\n\\Description File markup version information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n\\Marker ide\n\\Name ide - File - Encoding\n\\Description File encoding information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n# Headers\n\n\\Marker h\n\\Name h - File - Header\n\\Description Running header text for a book (basic)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h1\n\\Name DEPRECATED h1 - File - Header\n\\Description Running header text\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h2\n\\Name DEPRECATED h2 - File - Left Header\n\\Description Running header text, left side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h3\n\\Name DEPRECATED h3 - File - Right Header\n\\Description Running header text, right side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker toc1\n\\Name toc1 - File - Long Table of Contents Text\n\\Description Long table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Bold\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc2\n\\Name toc2 - File - Short Table of Contents Text\n\\Description Short table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc3\n\\Name toc3 - File - Book Abbreviation\n\\Description Book Abbreviation\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Italic\n\\Color 128\n#!\\ColorName lowcon red\n\n\\Marker toca1\n\\Name toca1 - File - Alternative Language Long Table of Contents Text\n\\Description Alternative language long table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca2\n\\Name toca2 - File - Alternative Language Short Table of Contents Text\n\\Description Alternative language short table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca3\n\\Name toca3 - File - Alternative Language Book Abbreviation\n\\Description Alternative language book Abbreviation\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n# Remarks and Comments\n\n\\Marker rem\n\\Name rem - File - Remark\n\\Description Comments and remarks\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker sts\n\\Name sts - File - Status\n\\Description Status of this file\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker restore\n\\Name restore - File - Restore Information\n\\Description Project restore information\n\\OccursUnder id\n\\Rank 99\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Introduction\n\n\\Marker imt\n\\Name imt - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt1\n\\Name imt1 - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt2\n\\Name imt2 - Introduction - Major Title Level 2\n\\Description Introduction major title, level 2\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType other\n\\StyleType Paragraph\n\\FontSize 13\n\\Italic\n\\Justification Center\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker imt3\n\\Name imt3 - Introduction - Major Title Level 3\n\\Description Introduction major title, level 3\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker imt4\n\\Name imt4 - Introduction - Major Title Level 4\n\\Description Introduction major title, level 4 (usually within parenthesis)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n \n\\Marker imte\n\\Name imte - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte1\n\\Name imte1 - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte2\n\\Name imte2 - Introduction - [Uncommon] Major Title at Introduction End Level 2\n\\Description Introduction major title at introduction end, level 2\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2 \n\n\\Marker is\n\\Name is - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is1 \n\\Name is1 - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is2\n\\Name is2 - Introduction - Section Heading Level 2\n\\Description Introduction section heading, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker iot \n\\Name iot - Introduction - Outline Title\n\\Description Introduction outline title (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker io\n\\Name io - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io1\n\\Name io1 - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io2\n\\Name io2 - Introduction - Outline Level 2\n\\Description Introduction outline text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\n\\Marker io3\n\\Name io3 - Introduction - Outline Level 3\n\\Description Introduction outline text, level 3 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\n\\Marker io4\n\\Name io4 - Introduction - Outline Level 4\n\\Description Introduction outline text, level 4 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\n\\Marker ior\n\\Endmarker ior*\n\\Name ior...ior* - Introduction - Outline References Range\n\\Description Introduction references range for outline entry; for marking references separately\n\\OccursUnder id io io1 io2 io3 io4 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ip\n\\Name ip - Introduction - Paragraph\n\\Description Introduction prose paragraph (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker im\n\\Name im - Introduction - Paragraph - no first line indent\n\\Description Introduction prose paragraph, with no first line indent (may occur after poetry)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker ipi\n\\Name ipi - Introduction - Indented Para - first line indent\n\\Description Introduction prose paragraph, indented, with first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker imi\n\\Name imi - Introduction - Indented Para - no first line indent\n\\Description Introduction prose paragraph text, indented, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker ili\n\\Name ili - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili1\n\\Name ili1 - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili2\n\\Name ili2 - Introduction - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker ipq\n\\Name ipq - Introduction - Paragraph - quote from text\n\\Description Introduction prose paragraph, quote from the body text\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\Italic\n\n\\Marker imq\n\\Name imq - Introduction - Paragraph - quote from text - no first line indent\n\\Description Introduction prose paragraph, quote from the body text, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Italic\n\n\\Marker ipr\n\\Name ipr - Introduction - Paragraph - right aligned\n\\Description Introduction prose paragraph, right aligned\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Justification Right\n\\Italic\n\n\\Marker ib\n\\Name ib - Introduction - Blank Line\n\\Description Introduction blank line\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker iq\n\\Name iq - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq1\n\\Name iq1 - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq2\n\\Name iq2 - Introduction - Poetry Level 2\n\\Description Introduction poetry text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq3\n\\Name iq3 - Introduction - Poetry Level 3\n\\Description Introduction poetry text, level 3\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iex\n\\Name iex - Introduction - Explanatory or Bridge Text\n\\Description Introduction explanatory or bridge text (e.g. explanation of missing book in Short Old Testament)\n\\OccursUnder id c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker iqt\n\\Endmarker iqt*\n\\Name iqt...iqt* - Special Text - Quoted Scripture Text in Introduction\n\\Description For quoted scripture text appearing in the introduction\n\\OccursUnder imt imt1 imt2 imt3 imt4 ib ie ili ili1 ili2 im imi imq io io1 io2 io3 io4 iot ip ipi ipq ipr iq iq1 iq2 iq3 is is1 is2 imte imte1 imte2 iex\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ie\n\\Name ie - Introduction - End Marker\n\\Description Introduction ending marker\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n# Chapters and Verses\n\n\\Marker c\n\\Name c - Chapter Number\n\\Description Chapter number (necessary for normal Paratext operation)\n\\OccursUnder id\n\\Rank 8\n\\TextType ChapterNumber\n\\TextProperties chapter\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker ca\n\\Endmarker ca*\n\\Name ca...ca* - Chapter Number - Alternate\n\\Description Second (alternate) chapter number (for coding dual versification; useful for places where different traditions of chapter breaks need to be supported in the same translation)\n\\OccursUnder c \n\\TextType Other\n\\StyleType Character\n\\Italic\n\\FontSize 16\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker cp\n\\Name cp - Chapter Number - Publishing Alternate\n\\Description Published chapter number (chapter string that should appear in the published text)\n\\OccursUnder c \n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker cl\n\\Name cl - Chapter - Publishing Label\n\\Description Chapter label used for translations that add a word such as \"Chapter\" before chapter numbers (e.g. Psalms). The subsequent text is the chapter label.\n\\OccursUnder id c ms ms1 ms2 ms3 mr\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Justification Center\n\n\\Marker cd\n\\Name cd - Chapter - Description\n\\Description Chapter Description (Publishing option D, e.g. in Russian Bibles)\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 11\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker v\n\\Name v - Verse Number\n\\Description A verse number (Necessary for normal paratext operation) (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType VerseNumber\n\\TextProperties verse\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker va\n\\Endmarker va*\n\\Name va...va* - Verse Number - Alternate\n\\Description Second (alternate) verse number (for coding dual numeration in Psalms; see also NRSV Exo 22.1-4)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker vp\n\\Endmarker vp*\n\\Name vp...vp* - Verse Number - Publishing Alternate\n\\Description Published verse marker (verse string that should appear in the published text)\n\\OccursUnder cd lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Paragraphs\n\n\\Marker p\n\\Name p - Paragraph - Normal - First Line Indent\n\\Description Paragraph text, with first line indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker m\n\\Name m - Paragraph - Margin - No First Line Indent\n\\Description Paragraph text, with no first line indent (may occur after poetry) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker po\n\\Name po - Paragraph - Letter Opening\n\\Description Letter opening\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker pr\n\\Name pr - Paragraph - Text Refrain (right aligned)\n\\Description Text refrain (paragraph text, right aligned)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\n\\Marker cls\n\\Name cls - Paragraph - Letter Closing\n\\Description Letter Closing\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker pmo\n\\Name pmo - Paragraph - Embedded Text Opening\n\\Description Embedded text opening\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pm\n\\Name pm - Paragraph - Embedded Text\n\\Description Embedded text paragraph\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po psi q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmc\n\\Name pmc - Paragraph - Embedded Text Closing\n\\Description Embedded text closing\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmr\n\\Name pmr - Paragraph - Embedded Text Refrain\n\\Description Embedded text refrain (e.g. Then all the people shall say, \"Amen!\")\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi\n\\Name pi - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if single level), with first line indent; often used for discourse (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi1\n\\Name pi1 - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if multiple levels), with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi2\n\\Name pi2 - Paragraph - Indented - Level 2 - First Line Indent\n\\Description Paragraph text, level 2 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .5\n\\RightMargin .25\n\n\\Marker pi3\n\\Name pi3 - Paragraph - Indented - Level 3 - First Line Indent\n\\Description Paragraph text, level 3 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .75\n\\RightMargin .25\n\n\\Marker pc\n\\Name pc - Paragraph - Centered (for Inscription)\n\\Description Paragraph text, centered (for Inscription)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Center\n\\FontSize 12\n\n\\Marker mi\n\\Name mi - Paragraph - Indented - No First Line Indent\n\\Description Paragraph text, indented, with no first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker nb\n\\Name nb - Paragraph - No Break with Previous Paragraph\n\\Description Paragraph text, with no break from previous paragraph text (at chapter boundary) (basic)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n# Poetry\n\n\\Marker q\n\\Name q - Poetry - Indent Level 1 - Single Level Only\n\\Description Poetry text, level 1 indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q1\n\\Name q1 - Poetry - Indent Level 1\n\\Description Poetry text, level 1 indent (if multiple levels) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q2\n\\Name q2 - Poetry - Indent Level 2\n\\Description Poetry text, level 2 indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.375  # 1/4 inch indent, 3/4 inch wrap\n\n\\Marker q3\n\\Name q3 - Poetry - Indent Level 3\n\\Description Poetry text, level 3 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.25 # 3/8 inch indent, 3/4 inch wrap\n\n\\Marker q4\n\\Name q4 - Poetry - Indent Level 4\n\\Description Poetry text, level 4 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.125 # 1/2 inch indent, 3/4 inch wrap\n\n\\Marker qc\n\\Name qc - Poetry - Centered\n\\Description Poetry text, centered\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\n\\Marker qr\n\\Name qr - Poetry - Right Aligned\n\\Description Poetry text, Right Aligned\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker qs\n\\Endmarker qs*\n\\Name qs...qs* - Poetry Text - Selah\n\\Description Poetry text, Selah\n\\OccursUnder q q1 q2 q3 q4 qc qr qd NEST\n\\Rank 4\n\\TextType VerseText\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qa\n\\Name qa - Poetry - Acrostic Heading/Marker\n\\Description Poetry text, Acrostic marker/heading\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\n\\Marker qac\n\\Endmarker qac*\n\\Name qac...qac* - Poetry Text - Acrostic Letter\n\\Description Poetry text, Acrostic markup of the first character of a line of acrostic poetry\n\\OccursUnder q q1 q2 q3 q4 qc qr  NEST\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qm\n\\Name qm - Poetry - Embedded Text - Indent Level 1 - Single Level Only\n\\Description Poetry text, embedded, level 1 indent (if single level)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm1\n\\Name qm1 - Poetry - Embedded Text - Indent Level 1\n\\Description Poetry text, embedded, level 1 indent (if multiple levels)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm2\n\\Name qm2 - Poetry - Embedded Text - Indent Level 2\n\\Description Poetry text, embedded, level 2 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\n\\Marker qm3\n\\Name qm3 - Poetry - Embedded Text - Indent Level 3\n\\Description Poetry text, embedded, level 3 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\n\\Marker qd\n\\Name qd - Poetry - Hebrew Note\n\\Description A Hebrew musical performance annotation, similar in content to Hebrew descriptive title.\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\LeftMargin .25\n\n\\Marker b\n\\Name b - Poetry - Stanza Break (Blank Line)\n\\Description Poetry text stanza break (e.g. stanza break) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n# Titles & Headings\n\n\\Marker mt\n\\Name mt - Title - Major Title Level 1\n\\Description The main title of the book (if single level)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mt1\n\\Name mt1 - Title - Major Title Level 1\n\\Description The main title of the book (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 4\n\n\\Marker mt2\n\\Name mt2 - Title - Major Title Level 2\n\\Description A secondary title usually occurring before the main title (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker mt3\n\\Name mt3 - Title - Major Title Level 3\n\\Description A secondary title occurring after the main title\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mt4\n\\Name mt4 - Title - Major Title level 4\n\\Description A small secondary title sometimes occurring within parentheses\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mte\n\\Name mte - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder c\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mte1\n\\Name mte1 - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tc1 tc2 tc3 tc4 s3 d\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n \n\\Marker mte2\n\\Name mte2 - Title - [Uncommon] Major Title Ending Level 2\n\\Description A secondary title occurring before or after the 'ending' main title\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\OccursUnder mte1\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker ms\n\\Name ms - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms1\n\\Name ms1 - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms2\n\\Name ms2 - Heading - Major Section Level 2\n\\Description A major section division heading, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms3\n\\Name ms3 - Heading - Major Section Level 3\n\\Description A major section division heading, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Italic\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker mr\n\\Name mr - Heading - Major Section Range References\n\\Description A major section division references range heading (basic)\n\\OccursUnder ms ms1 ms2 ms3\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker s\n\\Name s - Heading - Section Level 1\n\\Description A section heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s1\n\\Name s1 - Heading - Section Level 1\n\\Description A section heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s2\n\\Name s2 - Heading - Section Level 2\n\\Description A section heading, level 2 (e.g. Proverbs 22-24)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s3\n\\Name s3 - Heading - Section Level 3\n\\Description A section heading, level 3 (e.g. Genesis \"The First Day\")\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker s4\n\\Name s4 - Heading - Section Level 4\n\\Description A section heading, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker sr\n\\Name sr - Heading - Section Range References\n\\Description A section division references range heading\n\\OccursUnder s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker r\n\\Name r - Heading - Parallel References\n\\Description Parallel reference(s) (basic)\n\\OccursUnder c s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker sp\n\\Name sp - Label - Speaker\n\\Description A heading, to identify the speaker (e.g. Job)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker d\n\\Name d - Label - Descriptive Title - Hebrew Subtitle\n\\Description A Hebrew text heading, to provide description (e.g. Psalms)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker sd\n\\Name sd - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd1\n\\Name sd1 - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd2\n\\Name sd2 - Label - Semantic Division Location - Level 2\n\\Description Vertical space used to divide the text into sections, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\SpaceBefore 18\n\\SpaceAfter 18\n\n\\Marker sd3\n\\Name sd3 - Label - Semantic Division Location - Level 3\n\\Description Vertical space used to divide the text into sections, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\SpaceBefore 12\n\\SpaceAfter 12\n\n\\Marker sd4\n\\Name sd4 - Label - Semantic Division Location - Level 4\n\\Description Vertical space used to divide the text into sections, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\SpaceBefore 8\n\\SpaceAfter 8\n\n# Tables\n\n\\Marker tr\n\\Name tr - Table - Row\n\\Description A new table row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker th1 \n\\Name th1 - Table - Column 1 Heading\n\\Description A table heading, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th2\n\\Name th2 - Table - Column 2 Heading\n\\Description A table heading, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th3\n\\Name th3 - Table - Column 3 Heading\n\\Description A table heading, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th4\n\\Name th4 - Table - Column 4 Heading\n\\Description A table heading, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th5\n\\Name th5 - Table - Column 5 Heading\n\\Description A table heading, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th6\n\\Name th6 - Table - Column 6 Heading\n\\Description A table heading, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th7\n\\Name th7 - Table - Column 7 Heading\n\\Description A table heading, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th8\n\\Name th8 - Table - Column 8 Heading\n\\Description A table heading, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th9\n\\Name th9 - Table - Column 9 Heading\n\\Description A table heading, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th10\n\\Name th10 - Table - Column 10 Heading\n\\Description A table heading, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th11\n\\Name th11 - Table - Column 11 Heading\n\\Description A table heading, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th12\n\\Name th12 - Table - Column 12 Heading\n\\Description A table heading, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker tc1\n\\Name tc1 - Table - Column 1 Cell\n\\Description A table cell item, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc2\n\\Name tc2 - Table - Column 2 Cell\n\\Description A table cell item, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc3\n\\Name tc3 - Table - Column 3 Cell\n\\Description A table cell item, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc4\n\\Name tc4 - Table - Column 4 Cell\n\\Description A table cell item, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc5\n\\Name tc5 - Table - Column 5 Cell\n\\Description A table cell item, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc6\n\\Name tc6 - Table - Column 6 Cell\n\\Description A table cell item, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc7\n\\Name tc7 - Table - Column 7 Cell\n\\Description A table cell item, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc8\n\\Name tc8 - Table - Column 8 Cell\n\\Description A table cell item, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc9\n\\Name tc9 - Table - Column 9 Cell\n\\Description A table cell item, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc10\n\\Name tc10 - Table - Column 10 Cell\n\\Description A table cell item, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc11\n\\Name tc11 - Table - Column 11 Cell\n\\Description A table cell item, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc12\n\\Name tc12 - Table - Column 12 Cell\n\\Description A table cell item, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Center Aligned Table Heads and Columns\n\n\\Marker thc1 \n\\Name thc1 - Table - Column 1 Heading - Center Aligned\n\\Description A table heading, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc2\n\\Name thc2 - Table - Column 2 Heading - Center Aligned\n\\Description A table heading, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc3\n\\Name thc3 - Table - Column 3 Heading - Center Aligned\n\\Description A table heading, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc4\n\\Name thc4 - Table - Column 4 Heading - Center Aligned\n\\Description A table heading, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc5\n\\Name thc5 - Table - Column 5 Heading - Center Aligned\n\\Description A table heading, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc6\n\\Name thc6 - Table - Column 6 Heading - Center Aligned\n\\Description A table heading, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc7\n\\Name thc7 - Table - Column 7 Heading - Center Aligned\n\\Description A table heading, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc8\n\\Name thc8 - Table - Column 8 Heading - Center Aligned\n\\Description A table heading, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc9\n\\Name thc9 - Table - Column 9 Heading - Center Aligned\n\\Description A table heading, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc10\n\\Name thc10 - Table - Column 10 Heading - Center Aligned\n\\Description A table heading, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc11\n\\Name thc11 - Table - Column 11 Heading - Center Aligned\n\\Description A table heading, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc12\n\\Name thc12 - Table - Column 12 Heading - Center Aligned\n\\Description A table heading, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker tcc1\n\\Name tcc1 - Table - Column 1 Cell - Center Aligned\n\\Description A table cell item, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc2\n\\Name tcc2 - Table - Column 2 Cell - Center Aligned\n\\Description A table cell item, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc3\n\\Name tcc3 - Table - Column 3 Cell - Center Aligned\n\\Description A table cell item, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc4\n\\Name tcc4 - Table - Column 4 Cell - Center Aligned\n\\Description A table cell item, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc5\n\\Name tcc5 - Table - Column 5 Cell - Center Aligned\n\\Description A table cell item, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc6\n\\Name tcc6 - Table - Column 6 Cell - Center Aligned\n\\Description A table cell item, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc7\n\\Name tcc7 - Table - Column 7 Cell - Center Aligned\n\\Description A table cell item, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc8\n\\Name tcc8 - Table - Column 8 Cell - Center Aligned\n\\Description A table cell item, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc9\n\\Name tcc9 - Table - Column 9 Cell - Center Aligned\n\\Description A table cell item, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc10\n\\Name tcc10 - Table - Column 10 Cell - Center Aligned\n\\Description A table cell item, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc11\n\\Name tcc11 - Table - Column 11 Cell - Center Aligned\n\\Description A table cell item, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc12\n\\Name tcc12 - Table - Column 12 Cell - Center Aligned\n\\Description A table cell item, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n# Right Aligned Table Heads and Columns\n\n\\Marker thr1 \n\\Name thr1 - Table - Column 1 Heading - Right Aligned\n\\Description A table heading, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr2\n\\Name thr2 - Table - Column 2 Heading - Right Aligned\n\\Description A table heading, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr3\n\\Name thr3 - Table - Column 3 Heading - Right Aligned\n\\Description A table heading, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr4\n\\Name thr4 - Table - Column 4 Heading - Right Aligned\n\\Description A table heading, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr5\n\\Name thr5 - Table - Column 5 Heading - Right Aligned\n\\Description A table heading, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr6\n\\Name thr6 - Table - Column 6 Heading - Right Aligned\n\\Description A table heading, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr7\n\\Name thr7 - Table - Column 7 Heading - Right Aligned\n\\Description A table heading, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr8\n\\Name thr8 - Table - Column 8 Heading - Right Aligned\n\\Description A table heading, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr9\n\\Name thr9 - Table - Column 9 Heading - Right Aligned\n\\Description A table heading, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr10\n\\Name thr10 - Table - Column 10 Heading - Right Aligned\n\\Description A table heading, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr11\n\\Name thr11 - Table - Column 11 Heading - Right Aligned\n\\Description A table heading, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr12\n\\Name thr12 - Table - Column 12 Heading - Right Aligned\n\\Description A table heading, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker tcr1 \n\\Name tcr1 - Table - Column 1 Cell - Right Aligned\n\\Description A table cell item, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr2\n\\Name tcr2 - Table - Column 2 Cell - Right Aligned\n\\Description A table cell item, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr3\n\\Name tcr3 - Table - Column 3 Cell - Right Aligned\n\\Description A table cell item, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr4\n\\Name tcr4 - Table - Column 4 Cell - Right Aligned\n\\Description A table cell item, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr5\n\\Name tcr5 - Table - Column 5 Cell - Right Aligned\n\\Description A table cell item, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr6\n\\Name tcr6 - Table - Column 6 Cell - Right Aligned\n\\Description A table cell item, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr7\n\\Name tcr7 - Table - Column 7 Cell - Right Aligned\n\\Description A table cell item, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr8\n\\Name tcr8 - Table - Column 8 Cell - Right Aligned\n\\Description A table cell item, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr9\n\\Name tcr9 - Table - Column 9 Cell - Right Aligned\n\\Description A table cell item, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr10\n\\Name tcr10 - Table - Column 10 Cell - Right Aligned\n\\Description A table cell item, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr11\n\\Name tcr11 - Table - Column 11 Cell - Right Aligned\n\\Description A table cell item, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr12\n\\Name tcr12 - Table - Column 12 Cell - Right Aligned\n\\Description A table cell item, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n# Lists\n\n\\Marker lh\n\\Name lh - List Header\n\\Description List header (introductory remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker li\n\\Name li - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li1\n\\Name li1 - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li2\n\\Name li2 - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker li3\n\\Name li3 - List Entry - Level 3\n\\Description A list entry, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker li4\n\\Name li4 - List Entry - Level 4\n\\Description A list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lf\n\\Name lf - List Footer\n\\Description List footer (concluding remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker lim\n\\Name lim - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim1\n\\Name lim1 - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim2\n\\Name lim2 - Embedded List Entry - Level 2\n\\Description An embedded list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker lim3\n\\Name lim3 - Embedded List Item - Level 3\n\\Description An embedded list item, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lim4\n\\Name lim4 - Embedded List Entry - Level 4\n\\Description An embedded list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.5\n\\FirstLineIndent -.375\n\n\\Marker litl\n\\Endmarker litl*\n\\Name litl...litl* - List Entry - Total\n\\Description List entry total text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker lik\n\\Endmarker lik*\n\\Name lik...lik* - Structured List Entry - Key\n\\Description Structured list entry key text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker liv\n\\Endmarker liv*\n\\Name liv...liv* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if single value)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv1\n\\Endmarker liv1*\n\\Name liv1...liv1* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if multiple values)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv2\n\\Endmarker liv2*\n\\Name liv2...liv2* - Structured List Entry - Value 2\n\\Description Structured list entry value 2 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv3\n\\Endmarker liv3*\n\\Name liv3...liv3* - Structured List Entry - Value 3\n\\Description Structured list entry value 3 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv4\n\\Endmarker liv4*\n\\Name liv4...liv4* - Structured List Entry - Value 4\n\\Description Structured list entry value 4 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv5\n\\Endmarker liv5*\n\\Name liv5...liv5* - Structured List Entry - Value 5\n\\Description Structured list entry value 5 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Footnotes\n\n\\Marker f\n\\Endmarker f*\n\\Name f...f* - Footnote \n\\Description A Footnote text item (basic)\n\\OccursUnder c cp lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fe\n\\Endmarker fe*\n\\Name fe...fe* - Endnote\n\\Description An Endnote text item\n\\OccursUnder c lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fr\n\\Endmarker fr*\n\\Name fr - Footnote - Reference\n\\Description The origin reference for the footnote (basic)\n\\OccursUnder f fe\n\\TextType NoteText\n\\TextProperties publishable vernacular note\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker ft\n\\Endmarker ft*\n\\Name ft - Footnote - Text\n\\Description Footnote text, Protocanon (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fk\n\\Endmarker fk*\n\\Name fk - Footnote - Keyword\n\\Description A footnote keyword (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker fq\n\\Endmarker fq*\n\\Name fq - Footnote - Quotation or Alternate Rendering\n\\Description A footnote scripture quote or alternate rendering (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fqa\n\\Endmarker fqa*\n\\Name fqa - Footnote - Alternate Translation Rendering\n\\Description A footnote alternate rendering for a portion of scripture text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fl\n\\Endmarker fl*\n\\Name fl - Footnote - Label Text\n\\Description A footnote label text item, for marking or \"labelling\" the type or alternate translation being provided in the note.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker fw\n\\Endmarker fw*\n\\Name fw - Footnote - Witness List\n\\Description A footnote witness list, for distinguishing a list of sigla representing witnesses in critical editions.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fp\n\\Endmarker fp*\n\\Name fp - Footnote Paragraph Mark\n\\Description A Footnote additional paragraph marker\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fv\n\\Endmarker fv*\n\\Name fv...fv* - Footnote - Embedded Verse Number\n\\Description A verse number within the footnote text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker fdc\n\\Endmarker fdc*\n\\Name DEPRECATED fdc...fdc* - Footnote - DC text\n\\Description Footnote text, applies to Deuterocanon only\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fm\n\\Endmarker fm*\n\\Name fm - Footnote - Additional Caller to Previous Note\n\\Description An additional footnote marker location for a previous footnote \n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Cross References\n\n\\Marker x\n\\Endmarker x*\n\\Name x...x* - Cross Reference\n\\Description A list of cross references (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 s s1 s2 s3 d\n\\TextProperties publishable vernacular note crossreference\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker xo\n\\Endmarker xo*\n\\Name xo - Cross Reference - Origin Reference\n\\Description The cross reference origin reference (basic)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker xop\n\\Endmarker xop*\n\\Name xop - Cross Reference - Origin Reference Publishing Alternate\n\\Description Published cross reference origin reference (origin reference that should appear in the published text)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xt\n\\Endmarker xt*\n\\Name xt - Cross Reference - Target References\n\\Description The cross reference target reference(s), protocanon only (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x ef ex NEST\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?link-href\n\n\\Marker xta\n\\Endmarker xta*\n\\Name xta - Cross Reference - Target References Added Text\n\\Description Cross reference target references added text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xk\n\\Endmarker xk*\n\\Name xk - Cross Reference - Keyword\n\\Description A cross reference keyword\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xq\n\\Endmarker xq*\n\\Name xq - Cross Reference - Quotation\n\\Description A cross-reference quotation from the scripture text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xot\n\\Endmarker xot*\n\\Name xot...xot* - Cross Reference - OT Target Refs (optional)\n\\Description Cross-reference target reference(s), Old Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xnt\n\\Endmarker xnt*\n\\Name xnt...xnt* - Cross Reference - NT Target Refs (optional)\n\\Description Cross-reference target reference(s), New Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xdc\n\\Endmarker xdc*\n\\Name DEPRECATED xdc...xdc* - Cross Reference - DC Target Refs\n\\Description Cross-reference target reference(s), Deuterocanon only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker rq\n\\Endmarker rq*\n\\Name rq...rq* - Cross Reference - Inline Quotation References\n\\Description A cross-reference indicating the source text for the preceding quotation.\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 10\n\\Italic\n\n# Other Special Text\n\n\\Marker qt\n\\Endmarker qt*\n\\Name qt...qt* - Special Text - Quoted Text - OT in NT\n\\Description For Old Testament quoted text appearing in the New Testament (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker nd\n\\Endmarker nd*\n\\Name nd...nd* - Special Text - Name of Deity\n\\Description For name of deity (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker tl\n\\Endmarker tl*\n\\Name tl...tl* - Special Text - Transliterated Word\n\\Description For transliterated words\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable nonvernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker dc\n\\Endmarker dc*\n\\Name dc...dc* - Special Text - Deuterocanonical/LXX Additions\n\\Description Deuterocanonical/LXX additions or insertions in the Protocanonical text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\Italic\n\n\\Marker bk\n\\Endmarker bk*\n\\Name bk...bk* - Special Text - Quoted book title\n\\Description For the quoted name of a book\n\\OccursUnder imt imt1 imt2 imt3 imt4 imte imte1 imte2 is is1 is2 ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sig\n\\Endmarker sig*\n\\Name sig...sig* - Special Text - Author's Signature (Epistles)\n\\Description For the signature of the author of an Epistle\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker pn\n\\Endmarker pn*\n\\Name pn...pn* - Special Text - Proper Name\n\\Description For a proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Underline\n\n\\Marker png\n\\Endmarker png*\n\\Name png...png* - Special Text - Geographic Proper Name\n\\Description For a geographic proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker addpn\n\\Endmarker addpn*\n\\Name DEPRECATED addpn...addpn* - Special Text for Chinese\n\\Description For chinese words to be dot underline & underline\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\\Underline\n\n\\Marker wj\n\\Endmarker wj*\n\\Name wj...wj* - Special Text - Words of Jesus\n\\Description For marking the words of Jesus\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Color 255\n#!\\ColorName highcon red\n\n\\Marker k\n\\Endmarker k*\n\\Name k...k* - Special Text - Keyword\n\\Description For a keyword\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker sls\n\\Endmarker sls*\n\\Name sls...sls* - Special Text - Secondary Language or Text Source\n\\Description To represent where the original text is in a secondary language or from an alternate text source\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ord\n\\Endmarker ord*\n\\Name ord...ord* - Special Text - Ordinal number text portion\n\\Description For the text portion of an ordinal number\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker add\n\\Endmarker add*\n\\Name add...add* - Special Text - Translational Addition\n\\Description For a translational addition to the text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\n\\Marker lit\n\\Name lit - Special Text - Liturgical note\n\\Description For a comment or note inserted for liturgical use\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\\Bold\n\n# Character Styling\n\n\\Marker no\n\\Endmarker no*\n\\Name no...no* - Character - Normal Text\n\\Description A character style, use normal text\n\\OccursUnder is ip ipi im imi ili ili1 ili2 imq ipq iex iq iot io1 io2 io3 io4 s s1 s2 s3 NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker it\n\\Endmarker it*\n\\Name it...it* - Character - Italic Text\n\\Description A character style, use italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker bd\n\\Endmarker bd*\n\\Name bd...bd* - Character - Bold Text\n\\Description A character style, use bold text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker bdit\n\\Endmarker bdit*\n\\Name bdit...bdit* - Character - BoldItalic Text\n\\Description A character style, use bold + italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker em\n\\Endmarker em*\n\\Name em...em* - Character - Emphasized Text\n\\Description A character style, use emphasized text style\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sc\n\\Endmarker sc*\n\\Name sc...sc* - Character - Small Caps\n\\Description A character style, for small capitalization text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Smallcaps\n\n\\Marker sup\n\\Endmarker sup*\n\\Name sup...sup* - Character - Superscript\n\\Description A character style, for superscript text. Typically for use in critical edition footnotes.\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Breaks\n\n\\Marker pb\n\\Name pb - Break - Page Break\n\\Description Page Break used for new reader portions and children's bibles where content is controlled by the page\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable\n\\StyleType Paragraph\n\\FontSize 12\n\n# Special Features\n\n\\Marker fig\n\\Endmarker fig*\n\\Name fig...fig* - Auxiliary - Figure/Illustration/Map\n\\Description Illustration [Columns to span, height, filename, caption text]\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes src size ref ?alt ?loc ?copy\n\n\\Marker jmp\n\\Endmarker jmp*\n\\Name jmp...jmp* - Link text\n\\Description For associating linking attributes to a span of text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType Other\n\\StyleType Character\n\\Color 16711680\n#!\\ColorName highcon blue\n\\Underline\n#!\\Attributes ?link-href ?link-id ?link-title\n\n\\Marker pro\n\\Endmarker pro*\n\\Name DEPRECATED pro...pro* - Special Text - CJK Pronunciation\n\\Description For indicating pronunciation in CJK texts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType Other\n\\TextProperties Nonpublishable\n\\StyleType Character\n\\FontSize 10\n\n\\Marker rb\n\\Endmarker rb*\n\\Name rb...rb* - Special Text - Ruby Glossing\n\\Description Most often used to provide a reading / pronunciation guide in ideographic scripts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#!\\Attributes gloss\n\n# Peripheral References\n\n\\Marker w\n\\Endmarker w*\n\\Name w...w* - Peripheral Ref - Wordlist Entry\n\\Description A wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?lemma ?strong ?srcloc\n\n\\Marker wh\n\\Endmarker wh*\n\\Name wh...wh* - Peripheral Ref - Hebrew Wordlist Entry\n\\Description A Hebrew wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wg\n\\Endmarker wg*\n\\Name wg...wg* - Peripheral Ref - Greek Wordlist Entry\n\\Description A Greek Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wa\n\\Endmarker wa*\n\\Name wa...wa* - Peripheral Ref - Aramaic Wordlist Entry\n\\Description An Aramaic Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ndx\n\\Endmarker ndx*\n\\Name ndx...ndx* - Peripheral Ref - Subject Index Entry \n\\Description A subject index text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Peripheral Materials\n# Content Division Marker\n\n\\Marker periph\n\\Name periph - Peripherals - Content Division Marker\n\\Description Peripheral content division marker which should be followed by an additional division argument/title.\n\\TextType Section\n\\TextProperties paragraph nonpublishable vernacular\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\SpaceBefore 16\n\\SpaceAfter 4\n\\Color 33023\n#!\\ColorName orange\n\n# Additional peripheral material extensions to existing USFM markup.\n\n\\Marker p1\n\\Name p1 - Periph - Front/Back Matter Paragraph Level 1\n\\Description Front or back matter text paragraph, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker p2\n\\Name p2 - Periph - Front/Back Matter Paragraph Level 2\n\\Description Front or back matter text paragraph, level 2 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/4 inch first line indent\n\\LeftMargin .125\n\n\\Marker k1\n\\Name k1 - Periph - Concordance Keyword Level 1\n\\Description Concordance main entry text or keyword, level 1\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker k2\n\\Name k2 - Periph - Concordance Keyword Level 2\n\\Description Concordance main entry text or keyword, level 2\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker xtSee\n\\Endmarker xtSee*\n\\Name xtSee - Concordance and Names Index - Alternate Entry Target Reference\n\\Description Concordance and Names Index markup for an alternate entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker xtSeeAlso\n\\Endmarker xtSeeAlso*\n\\Name xtSeeAlso - Concordance and Names Index - Additional Entry Target Reference\n\\Description Concordance and Names Index markup for an additional entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Milestones - these are not compatible with USFM2, so whole entries are preceded with #!\n\n#!\\Marker qt-s\n#!\\Endmarker qt-e\n#!\\Name Quotation start/end milestone\n#!\\Description Quotation start/end milestone, level 1 (if single level)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt1-s\n#!\\Endmarker qt1-e\n#!\\Name Quotation start/end milestone - Level 1\n#!\\Description Quotation start/end milestone, level 1 (if multiple levels)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt2-s\n#!\\Endmarker qt2-e\n#!\\Name Quotation start/end milestone - Level 2\n#!\\Description Quotation start/end milestone, level 2\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt3-s\n#!\\Endmarker qt3-e\n#!\\Name Quotation start/end milestone - Level 3\n#!\\Description Quotation start/end milestone, level 3\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt4-s\n#!\\Endmarker qt4-e\n#!\\Name Quotation start/end milestone - Level 4\n#!\\Description Quotation start/end milestone, level 4\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt5-s\n#!\\Endmarker qt5-e\n#!\\Name Quotation start/end milestone - Level 5\n#!\\Description Quotation start/end milestone, level 5\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker ts-s\n#!\\Endmarker ts-e\n#!\\Name Translator's section start/end milestone\n#!\\Description Translator's section start/end milestone\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?sid ?eid\n\n# Other special text elements specified in USFM\n#   ~ = fixed (no-break) space\n#   // = discretionary line break\n\n# Obsolete, deprecated, or no longer officially part of USFM.\n# These markers may have existed in earlier resource and stylesheet revisions.\n\n\\Marker ph\n\\Name DEPRECATED ph - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph1\n\\Name DEPRECATED ph1 - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph2\n\\Name DEPRECATED ph2 - Paragraph - Hanging Indent - Level 2\n\\Description Paragraph text, with level 2 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 1/2 inch indent, 3/4 inch wrap\n\\FontSize 12\n\n\\Marker ph3\n\\Name DEPRECATED ph3 - Paragraph - Hanging Indent - Level 3\n\\Description Paragraph text, with level 3 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\\FirstLineIndent -.25  # 3/4 inch indent, 1 inch wrap\n\\FontSize 12\n\n\\Marker phi\n\\Name DEPRECATED phi - Paragraph - Indented - Hanging Indent\n\\Description Paragraph text, indented with hanging indent\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\n\\Marker tr1\n\\Name DEPRECATED tr1 - Table - Row - Level 1\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker tr2\n\\Name DEPRECATED tr2 - Table - Row - Level 2\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker ps\n\\Name DEPRECATED ps - Paragraph - No Break with Next Paragraph\n\\Description Paragraph text, no break with next paragraph text at chapter boundary\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker psi\n\\Name DEPRECATED psi - Paragraph - Indented - No Break with Next\n\\Description Paragraph text, indented, with no break with next paragraph text (at chapter boundary)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\\FontSize 12\n\n\\Marker fs\n\\Endmarker fs*\n\\Name DEPRECATED fs - Footnote - Footnote Summary\n\\Description A summary text for the concept/idea/quotation from the scripture translation for which the note is being provided.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker wr\n\\Endmarker wr*\n\\Name DEPRECATED wr...wr* - Auxiliary - Wordlist/Glossary Reference \n\\Description A Wordlist text item\n\\OccursUnder ms s lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr qd tc1 tc2 tc3 tc4 f fe NEST\n\\TextProperties publishable vernacular\n\\TextType VerseText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n# 2.0x peripheral markup (replaced with \\periph + Content Division Title/Argument)\n\n\\Marker pub\n\\Name DEPRECATED pub Peripherals - Front Matter Publication Data\n\\Description Front matter publication data\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker toc\n\\Name DEPRECATED toc Peripherals - Front Matter Table of Contents\n\\Description Front matter table of contents\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pref\n\\Name DEPRECATED pref Peripherals - Front Matter Preface\n\\Description Front matter preface\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker intro\n\\Name DEPRECATED intro Peripherals - Front Matter Introduction\n\\Description Front matter introduction\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker conc\n\\Name DEPRECATED conc Peripherals - Back Matter Concordance\n\\Description Back matter concordance\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker glo\n\\Name DEPRECATED glo Peripherals - Back Matter Glossary\n\\Description Back matter glossary\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker idx\n\\Name DEPRECATED idx Peripherals - Back Matter Index\n\\Description Back matter index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker maps\n\\Name DEPRECATED maps Peripherals - Back Matter Map Index\n\\Description Back matter map index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker cov\n\\Name DEPRECATED cov Peripherals - Other - Cover\n\\Description Other peripheral materials - cover\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker spine\n\\Name DEPRECATED spine Peripherals - Other - Spine\n\\Description Other peripheral materials - spine\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pubinfo\n\\Name DEPRECATED pubinfo - Publication - Information\n\\Description Publication information - Lang,Credit,Version,Copies,Publisher,Id,Logo\n\\OccursUnder id ide\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Concordance/Names Index Tools - special sfms for use in Publishing Assistant\n\n\\Marker zpa-xb\n\\Endmarker zpa-xb*\n\\Name zpa-xb - Periph - Book\n\\Description Book Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-xc\n\\Endmarker zpa-xc*\n\\Name zpa-xc - Periph - Chapter\n\\Description Chapter Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker zpa-xv\n\\Endmarker zpa-xv*\n\\Name zpa-xv - Periph - Verse\n\\Description Verse Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-d\n\\Endmarker zpa-d*\n\\Name zpa-d - Periph - Description\n\\Description Description\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n";
// Marker Spaces core: a port of MarkerSpacesPlugin\MarkerSpaceScanner.cs, ProjectScan.cs and the
// chapter cutting of tests\TestHost\FolderBookSource.cs. No papi here: the extension build puts this
// file in front of main.js, and the tests load it with vm.runInThisContext.
//
// .NET and JavaScript regexes differ, so the .NET classes are spelled out:
//   \s  = [\f\n\r\t\v\x85\p{Z}]      \d = \p{Nd}      \w = [\p{L}\p{Mn}\p{Nd}\p{Pc}]
//   char.IsWhiteSpace = [\t-\r\x85\p{Z}]   char.IsPunctuation = \p{P}
// String offsets are UTF-16 code units in both, so they match the C# test host exactly.
var MSCore = (function () {
  'use strict';

  var S = '[\\f\\n\\r\\t\\v\\x85\\p{Z}]';
  var SP = '[\\f\\n\\r\\t\\v\\x85\\p{Z}~]';
  var D = '\\p{Nd}';
  var W = '[\\p{L}\\p{Mn}\\p{Nd}\\p{Pc}]';
  var WHITE_RE = /[\t-\r\x85\p{Z}]/u;
  var PUNCT_RE = /\p{P}/u;

  /** The kinds of problem, in the order of the C# enum (issues with the same start sort by it). */
  var KINDS = [
    'MissingSpaceBeforeOpen', // A
    'SpaceBeforeOpen', // B
    'SpaceBeforeClose', // C
    'MissingSpaceAfterClose', // D
    'SpaceBeforePunctuation', // E
    'SpaceAfterClose', // F
    'MissingSpaceBeforeNoClose',
    'SpaceBeforePipe',
    'Unclosed',
    'UnexpectedClose',
  ];
  var CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'NoCloseSpace', 'WPipe', 'Unclosed', 'Unexpected'];
  var K = {};
  KINDS.forEach(function (name, i) {
    K[name] = i;
  });

  var BOOK_ORDER = (
    'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM ' +
    'EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP ' +
    'COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV TOB JDT ESG WIS SIR BAR LJE S3Y SUS ' +
    'BEL 1MA 2MA 3MA 4MA 1ES 2ES MAN PS2 ODA PSS JSA JDB TBS SST DNT BLT XXA XXB XXC XXD XXE XXF XXG FRT ' +
    'BAK OTH 3ES EZA 5EZ 6EZ INT CNC GLO TDX NDX DAG PS3 2BA LBA JUB ENO 1MQ 2MQ 3MQ REP 4BA LAO'
  ).split(' ');

  /** Books that are not Bible text (ScanOptions.OtherBooks): left out unless the user ticks them. */
  var OTHER_BOOKS = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');

  var DEFAULT_OPTIONS = {
    excludeMarkers: '',
    noCloseMarkers: 'v fk fp fq fqa ft fr xk xo xq',
    noCloseInNoteMarkers: 'xt',
    extraSpacingMarkers: 'f x',
    noSpaceBeforeMarkers: 'f x',
    footnotePrecedesText: false,
    crossReferencesPrecedeText: true,
    /** Codes of the books not examined, space separated; null = the default (OTHER_BOOKS). */
    excludedBooks: null,
  };

  function bookCode(num) {
    return BOOK_ORDER[num - 1];
  }

  function bookNumber(code) {
    return BOOK_ORDER.indexOf(String(code).toUpperCase()) + 1;
  }

  function isBibleBook(code) {
    return OTHER_BOOKS.indexOf(String(code).toUpperCase()) < 0;
  }

  function isExcluded(options, code) {
    if (options.excludedBooks === null || options.excludedBooks === undefined) return !isBibleBook(code);
    return splitWhite(options.excludedBooks).some(function (c) {
      return c.toUpperCase() === String(code).toUpperCase();
    });
  }

  function isWhite(c) {
    return WHITE_RE.test(c);
  }

  /** string.Split((char[])null, RemoveEmptyEntries): split on char.IsWhiteSpace. */
  function splitWhite(s) {
    var out = [];
    var cur = '';
    for (var i = 0; i < s.length; i++) {
      if (isWhite(s[i])) {
        if (cur) out.push(cur);
        cur = '';
      } else cur += s[i];
    }
    if (cur) out.push(cur);
    return out;
  }

  /** string.Trim(): char.IsWhiteSpace at both ends (JavaScript's trim also removes U+FEFF). */
  function csTrim(s) {
    var a = 0;
    var b = s.length;
    while (a < b && isWhite(s[a])) a++;
    while (b > a && isWhite(s[b - 1])) b--;
    return s.substring(a, b);
  }

  /** Regex.Escape, limited to what a 'u' regex accepts as an escape. */
  function esc(s) {
    return s.replace(/[\\^$.*+?()[\]{}|\/#]/g, function (c) {
      return c === '#' ? '#' : '\\' + c;
    });
  }

  // ------------------------------------------------------------ stylesheets

  /**
   * StyleSheets.ParseText: a \Marker line opens an entry; any other \Field line sets that field
   * (name lowercased) on it. Returns a Map in file order.
   */
  function parseSty(text) {
    var entries = new Map();
    var current = null;
    text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .forEach(function (raw) {
        var line = csTrim(raw);
        if (line.length === 0 || line[0] === '#' || line[0] !== '\\') return;
        var rest = line.substring(1);
        var ws = 0;
        while (ws < rest.length && !isWhite(rest[ws])) ws++;
        var field = rest.substring(0, ws);
        if (field.length === 0) return;
        var value = csTrim(rest.substring(ws));
        if (field === 'Marker') {
          current = entries.get(value);
          if (!current) {
            current = new Map();
            entries.set(value, current);
          }
        } else if (current) current.set(field.toLowerCase(), value);
      });
    return entries;
  }

  /** usfm.sty merged field by field with custom.sty (StyleSheets.Load). */
  function mergeSty(usfm, custom) {
    var markers = new Map();
    usfm.forEach(function (fields, key) {
      markers.set(key, new Map(fields));
    });
    custom.forEach(function (fields, key) {
      var target = markers.get(key);
      if (!target) {
        target = new Map();
        markers.set(key, target);
      }
      fields.forEach(function (v, f) {
        target.set(f, v);
      });
    });
    return markers;
  }

  /** The same table from Paratext 10's StyleInfo (merged usfm.sty + custom.sty). */
  function styFromStyleInfo(styleInfo) {
    var markers = new Map();
    var all = (styleInfo && styleInfo.markers) || {};
    Object.keys(all).forEach(function (key) {
      var info = all[key] || {};
      var fields = new Map();
      if (info.styleType) fields.set('styletype', String(info.styleType));
      if (info.endMarker) fields.set('endmarker', String(info.endMarker));
      markers.set(info.marker || key, fields);
    });
    return markers;
  }

  // ------------------------------------------------------------ scanner

  var TPREFIX_KEEP = ['tl', 'ts-s', 'ts-e'];
  var VERSE_RE = new RegExp('\\\\v' + S + '+(' + D + '+(?:[,-]' + D + '+)*)' + S + '*', 'gu');
  var NEXT_CLOSE_RE = /\\\+?[a-zA-Z][a-zA-Z0-9]*\*/y;
  var NOTE_SPAN_RE = new RegExp('\\\\f' + S + '[\\s\\S]*?\\\\f\\*|\\\\x' + S + '[\\s\\S]*?\\\\x\\*', 'gu');
  var MARKER_SPACE_RE = new RegExp(
    '\\\\\\+?[a-zA-Z][a-zA-Z0-9]*\\*?(?:' + SP + '+' + D + '+(?:[,-]' + D + '+)*)?' + SP + '+',
    'gu',
  );
  var CLOSING_PUNCT = ',.;:!?)]}\u2026\u00BB\u201D\u2019\u203A';

  function names(raw) {
    var list = [];
    splitWhite(raw || '').forEach(function (m) {
      var n = m.replace(/^\\+/, '');
      if (n.length > 0 && list.indexOf(n) < 0) list.push(n);
    });
    return list;
  }

  function isIgnoredTMarker(marker) {
    return marker.toLowerCase().indexOf('t') === 0 && TPREFIX_KEEP.indexOf(marker) < 0;
  }

  function resolveEndmarker(marker, fields) {
    var end = splitWhite((fields && fields.get('endmarker')) || '');
    return end.length > 0 ? end[0] : marker + '*';
  }

  function markerPattern(bare, allNames) {
    var lookahead = '';
    if (allNames) {
      var ext = [];
      allNames.forEach(function (m) {
        if (m !== bare && m.indexOf(bare) === 0) ext.push(esc(m.substring(bare.length)));
      });
      if (ext.length > 0) lookahead = '(?!' + ext.join('|') + ')';
    }
    return '\\\\\\+?' + esc(bare) + lookahead;
  }

  function openMarkerRegex(marker, allNames) {
    return new RegExp(markerPattern(marker, allNames) + '(?!\\*)', 'gu');
  }

  function isPunct(c) {
    return c !== '\\' && PUNCT_RE.test(c);
  }

  function isSpace(c) {
    return isWhite(c) || c === '~';
  }

  function isInlineSpace(c) {
    return c === ' ' || c === '\t' || c === '~';
  }

  function isClosingPunct(c) {
    return CLOSING_PUNCT.indexOf(c) >= 0;
  }

  function contentStartsWithClosingPunct(text, contentStart) {
    var n = text.length;
    var k = contentStart;
    while (k < n && isSpace(text[k])) k++;
    return k < n && isClosingPunct(text[k]);
  }

  function spaceRunStart(text, pos, limit) {
    var k = pos;
    while (k > limit && k > 0 && isSpace(text[k - 1])) k--;
    return k;
  }

  function allMatches(re, text) {
    re.lastIndex = 0;
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      out.push(m);
      if (m[0].length === 0) re.lastIndex++;
    }
    return out;
  }

  /** First match at or after start (Regex.Match(text, start)). */
  function matchFrom(re, text, start) {
    re.lastIndex = start;
    return re.exec(text);
  }

  /** Match exactly at pos (\G). re must be sticky. */
  function matchAt(re, text, pos) {
    re.lastIndex = pos;
    return re.test(text);
  }

  /**
   * new MarkerSpaceScanner(options, sty). sty is a Map marker -> Map(field -> value), in
   * stylesheet order.
   */
  function Scanner(options, sty) {
    var o = Object.assign({}, DEFAULT_OPTIONS, options || {});
    this.exclude = names(o.excludeMarkers);
    this.noClose = names(o.noCloseMarkers);
    this.noteContext = names(o.noCloseInNoteMarkers);
    this.extraSpacing = names(o.extraSpacingMarkers);
    this.noSpaceBefore = names(o.noSpaceBeforeMarkers);
    this.footnotePrecedes = !!o.footnotePrecedesText;
    if (this.footnotePrecedes) remove(this.noSpaceBefore, 'f');
    this.xrefPrecedes = !!o.crossReferencesPrecedeText;
    if (this.xrefPrecedes) remove(this.noSpaceBefore, 'x');

    var self = this;
    var chars = new Map();
    this.charMarkers = []; // [marker, endmarker] in the CMS check's order
    this.noCloseEnd = [];
    function add(marker, endmarker) {
      chars.set(marker, endmarker);
      self.charMarkers.push([marker, endmarker]);
    }
    sty.forEach(function (fields, key) {
      var st = fields.get('styletype');
      if (st === undefined || csTrim(st).toLowerCase() !== 'character') return;
      if (self.exclude.indexOf(key) >= 0 || self.noClose.indexOf(key) >= 0 || isIgnoredTMarker(key)) return;
      add(key, resolveEndmarker(key, fields));
    });
    this.noteContext.forEach(function (m) {
      if (self.exclude.indexOf(m) >= 0 || isIgnoredTMarker(m)) return;
      if (!chars.has(m)) add(m, resolveEndmarker(m, sty.get(m)));
    });
    this.extraSpacing.forEach(function (m) {
      if (self.exclude.indexOf(m) >= 0 || self.noClose.indexOf(m) >= 0 || self.noteContext.indexOf(m) >= 0) return;
      if (isIgnoredTMarker(m)) return;
      if (!chars.has(m)) add(m, resolveEndmarker(m, sty.get(m)));
    });
    this.noClose.forEach(function (m) {
      if (isIgnoredTMarker(m)) return;
      self.noCloseEnd.push([m, resolveEndmarker(m, sty.get(m))]);
    });

    var all = new Set(sty.keys());
    chars.forEach(function (v, k) {
      all.add(k);
    });
    this.noCloseEnd.forEach(function (kv) {
      all.add(kv[0]);
    });
    [this.exclude, this.noClose, this.noteContext, this.extraSpacing, this.noSpaceBefore].forEach(function (list) {
      list.forEach(function (m) {
        all.add(m);
      });
    });

    this.openRes = new Map();
    this.closeRes = new Map();
    this.charMarkers.forEach(function (kv) {
      self.openRes.set(kv[0], openMarkerRegex(kv[0], all));
      self.closeRes.set(kv[0], new RegExp(markerPattern(kv[1], null), 'gu'));
    });
    this.noCloseRes = new Map();
    this.noCloseOpenRes = new Map();
    this.noCloseEnd.forEach(function (kv) {
      self.noCloseRes.set(kv[0], new RegExp(markerPattern(kv[1], null), 'gu'));
      if (self.exclude.indexOf(kv[0]) < 0) self.noCloseOpenRes.set(kv[0], openMarkerRegex(kv[0], all));
    });
    // \b after each name: the next character is not a word character when the name ends in one.
    this.noSpaceBeforeRe =
      this.noSpaceBefore.length > 0
        ? new RegExp(
            '\\\\\\+?(?:' +
              this.noSpaceBefore
                .map(function (m) {
                  var endsWord = new RegExp(W + '$', 'u').test(m);
                  return esc(m) + (endsWord ? '(?!' + W + ')' : '(?=' + W + ')');
                })
                .join('|') +
              ')',
            'yu',
          )
        : null;
  }

  function remove(list, item) {
    var i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }

  /** The problems in one chapter, in text order. book = {num, code}. */
  Scanner.prototype.scanChapter = function (book, chapter, text) {
    var self = this;
    var issues = [];
    if (!text) return issues;
    var n = text.length;

    var versePos = allMatches(VERSE_RE, text).map(function (vm) {
      return [vm.index + vm[0].length, vm[1]];
    });
    function verseAt(offset) {
      var label = null;
      for (var i = 0; i < versePos.length; i++) {
        if (versePos[i][0] <= offset) label = versePos[i][1];
        else break;
      }
      return label === null ? '-' : label;
    }
    function make(kind, marker, shown, refPos, start, end) {
      var issue = {
        book: book.code,
        bookNum: book.num,
        chapter: chapter,
        verse: verseAt(refPos),
        kind: kind,
        code: CODES[kind],
        marker: marker,
        shown: shown,
        start: start,
        end: end,
        edits: [],
      };
      issues.push(issue);
      return issue;
    }

    var noteSpans = [];
    if (this.noteContext.length > 0)
      allMatches(NOTE_SPAN_RE, text).forEach(function (m) {
        noteSpans.push([m.index, m.index + m[0].length]);
      });
    var markerSpaceEnds = new Set();
    if (this.noSpaceBefore.length > 0)
      allMatches(MARKER_SPACE_RE, text).forEach(function (m) {
        markerSpaceEnds.add(m.index + m[0].length);
      });

    this.charMarkers.forEach(function (kv) {
      var marker = kv[0];
      var endmarker = kv[1];
      var openRe = self.openRes.get(marker);
      var closeRe = self.closeRes.get(marker);
      var skipInNotes = self.noteContext.indexOf(marker) >= 0;

      var opens = allMatches(openRe, text);
      if (opens.length === 0) return;
      var closes = endmarker.indexOf('\\') < 0 ? allMatches(closeRe, text) : null;
      var ci = 0;
      for (var idx = 0; idx < opens.length; idx++) {
        var m = opens[idx];
        var mEnd = m.index + m[0].length;
        var nextOpen = idx + 1 < opens.length ? opens[idx + 1].index : n;
        var close;
        if (closes) {
          while (ci < closes.length && closes[ci].index < mEnd) ci++;
          close = ci < closes.length ? closes[ci] : null;
        } else close = matchFrom(closeRe, text, mEnd);

        if (!close || close.index >= nextOpen) {
          // \xt inside a footnote or cross-reference needs no closing marker.
          var skip = false;
          if (skipInNotes)
            for (var s = 0; s < noteSpans.length; s++)
              if (noteSpans[s][0] <= m.index && m.index < noteSpans[s][1]) {
                skip = true;
                break;
              }
          if (!skip) make(K.Unclosed, marker, marker, m.index, m.index, mEnd);
          continue;
        }

        var os = m.index;
        var oe = mEnd;
        var cs = close.index;
        var ce = close.index + close[0].length;
        var invertOpen = self.noSpaceBefore.indexOf(marker) >= 0;
        var invertClose = (self.footnotePrecedes && marker === 'f') || (self.xrefPrecedes && marker === 'x');
        self.checkPair(text, marker, endmarker, os, oe, cs, ce, invertOpen, invertClose, markerSpaceEnds, make);

        if (marker === 'w') {
          var pipe = cs > oe ? text.substring(0, cs).indexOf('|', oe) : -1;
          if (pipe > oe && isSpace(text[pipe - 1])) {
            var issue = make(K.SpaceBeforePipe, marker, marker, os, pipe - 1, pipe + 1);
            var k = spaceRunStart(text, pipe, oe + 1);
            if (k < pipe) issue.edits.push(edit(k, pipe - k, ''));
          }
        }
      }
    });

    this.noCloseEnd.forEach(function (kv) {
      allMatches(self.noCloseRes.get(kv[0]), text).forEach(function (m) {
        make(K.UnexpectedClose, kv[0], kv[1], m.index, m.index, m.index + m[0].length);
      });
    });

    this.noCloseOpenRes.forEach(function (re, marker) {
      allMatches(re, text).forEach(function (m) {
        var hs = m.index;
        var he = m.index + m[0].length;
        if (hs === 0) return;
        var before = text[hs - 1];
        if (isSpace(before) || isPunct(before) || contentStartsWithClosingPunct(text, he)) return;
        var issue = make(K.MissingSpaceBeforeNoClose, marker, marker, hs, hs, he);
        issue.edits.push(edit(hs, 0, ' '));
      });
    });

    issues.sort(function (a, b) {
      return a.start !== b.start ? a.start - b.start : a.kind - b.kind;
    });
    return issues;
  };

  /** _check_pair: the spacing around one \marker ... \marker* pair, each problem with its fix. */
  Scanner.prototype.checkPair = function (text, marker, endmarker, os, oe, cs, ce, invertOpen, invertClose, markerSpaceEnds, make) {
    var n = text.length;
    var issue;
    var k;

    if (os > 0) {
      var beforeOpen = text[os - 1];
      if (invertOpen) {
        // B: \f or \x attaches to the word before it, except right after another marker's space.
        if (isSpace(beforeOpen) && !markerSpaceEnds.has(os)) {
          issue = make(K.SpaceBeforeOpen, marker, marker, os, os, oe);
          k = spaceRunStart(text, os, 0);
          issue.edits.push(edit(k, os - k, ''));
        }
      } else if (!isSpace(beforeOpen) && !isPunct(beforeOpen) && !contentStartsWithClosingPunct(text, oe)) {
        issue = make(K.MissingSpaceBeforeOpen, marker, marker, os, os, oe); // A
        issue.edits.push(edit(os, 0, ' '));
      }
    }

    if (cs > 0 && isSpace(text[cs - 1])) {
      // C: the space moves outside the closing marker.
      issue = make(K.SpaceBeforeClose, marker, endmarker, os, cs, ce);
      k = spaceRunStart(text, cs, oe + 1);
      if (k < cs) {
        issue.edits.push(edit(k, cs - k, ''));
        if (!invertClose && this.needsSpaceAfter(text, ce)) issue.edits.push(edit(ce, 0, ' '));
      }
    }

    if (ce < n) {
      var afterClose = text[ce];
      if (isInlineSpace(afterClose)) {
        k = ce;
        while (k < n && isInlineSpace(text[k])) k++;
        if (k < n && isClosingPunct(text[k])) {
          issue = make(K.SpaceBeforePunctuation, marker, endmarker, os, cs, ce); // E
          issue.edits.push(edit(ce, k - ce, ''));
        } else if (invertClose && k < n && !isPunct(text[k])) {
          issue = make(K.SpaceAfterClose, marker, endmarker, os, cs, ce); // F
          issue.edits.push(edit(ce, k - ce, ''));
        }
      } else if (!invertClose && this.needsSpaceAfter(text, ce)) {
        issue = make(K.MissingSpaceAfterClose, marker, endmarker, os, cs, ce); // D
        issue.edits.push(edit(ce, 0, ' '));
      }
    }
  };

  /** Check D's test: the closing marker ending at ce is glued to a word or marker. */
  Scanner.prototype.needsSpaceAfter = function (text, ce) {
    if (ce >= text.length) return false;
    var c = text[ce];
    if (isSpace(c) || isPunct(c)) return false;
    if (c === '\\' && ((this.noSpaceBeforeRe && matchAt(this.noSpaceBeforeRe, text, ce)) || matchAt(NEXT_CLOSE_RE, text, ce)))
      return false;
    return true;
  };

  function edit(start, length, insert) {
    return { start: start, length: length, insert: insert || '' };
  }

  // ------------------------------------------------------------ applying fixes

  /**
   * MarkerSpaceScanner.Apply: the same insertion at the same place is made once, overlapping
   * deletions are joined, and an insertion inside a deleted stretch is dropped.
   */
  function apply(text, edits) {
    var deletes = [];
    var inserts = new Map();
    edits.forEach(function (e) {
      if (e.length > 0) deletes.push([e.start, e.start + e.length]);
      if (e.insert.length > 0) {
        var existing = inserts.get(e.start);
        if (existing === undefined || existing !== e.insert)
          inserts.set(e.start, existing === undefined ? e.insert : existing + e.insert);
      }
    });
    deletes.sort(function (a, b) {
      return a[0] - b[0];
    });
    var merged = [];
    deletes.forEach(function (d) {
      var last = merged[merged.length - 1];
      if (last && d[0] <= last[1]) last[1] = Math.max(last[1], d[1]);
      else merged.push([d[0], d[1]]);
    });

    var out = [];
    var pos = 0;
    var di = 0;
    var points = Array.from(inserts.keys()).sort(function (a, b) {
      return a - b;
    });
    points.push(Infinity);
    for (var p = 0; p < points.length; p++) {
      var at = points[p];
      var stop = Math.min(at, text.length);
      while (pos < stop) {
        while (di < merged.length && merged[di][1] <= pos) di++;
        if (di < merged.length && merged[di][0] <= pos) {
          pos = Math.min(merged[di][1], text.length);
          continue;
        }
        var next = di < merged.length ? Math.min(merged[di][0], stop) : stop;
        out.push(text.substring(pos, next));
        pos = next;
      }
      if (at === Infinity) break;
      var insideDelete = merged.some(function (d) {
        return d[0] < at && at < d[1];
      });
      if (!insideDelete && at <= text.length) out.push(inserts.get(at));
    }
    return out.join('');
  }

  // ------------------------------------------------------------ books and chapters

  var CHAPTER_RE = /\\c[ \t]+(\p{Nd}+)/gu;

  function asciiInt(s) {
    return /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN;
  }

  /**
   * Chapters as Paratext cuts them (FolderBookSource.ChapterSpans): chapter 1 runs from the start
   * of the book (\id) to the second \c; a book without \c is all chapter 1. Map chapter -> [start, end].
   */
  function chapterSpans(text) {
    var starts = [];
    allMatches(CHAPTER_RE, text).forEach(function (m) {
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

  /**
   * ProjectScan.Scan for one book: [{chapter, start, text}] in the order the chapters are scanned
   * (\c order, chapter 1 first when the book has no \c 1; then it is the whole book).
   */
  function bookChapters(bookText) {
    var chapters = [];
    allMatches(CHAPTER_RE, bookText).forEach(function (m) {
      var c = asciiInt(m[1]);
      if (!isNaN(c) && chapters.indexOf(c) < 0) chapters.push(c);
    });
    if (chapters.indexOf(1) < 0) chapters.unshift(1);
    var spans = chapterSpans(bookText);
    var out = [];
    chapters.forEach(function (c) {
      var span = spans.get(c);
      if (span) out.push({ chapter: c, start: span[0], text: bookText.substring(span[0], span[1]) });
      else if (c === 1) out.push({ chapter: 1, start: 0, text: bookText, wholeBook: true });
    });
    return out;
  }

  /** Every problem in one book, each with chapterText set (the text its offsets refer to). */
  function scanBook(scanner, book, bookText) {
    var issues = [];
    if (!bookText) return issues;
    bookChapters(bookText).forEach(function (ch) {
      scanner.scanChapter(book, ch.chapter, ch.text).forEach(function (issue) {
        issue.chapterText = ch.text;
        issue.chapterStart = ch.start;
        issue.wholeBook = !!ch.wholeBook;
        issues.push(issue);
      });
    });
    return issues;
  }

  /** The first verse number of a label ("3-4" -> 3, "-" -> 0). */
  function verseNumber(label) {
    var m = /^[0-9]+/.exec(label || '');
    return m ? parseInt(m[0], 10) : 0;
  }

  // ------------------------------------------------------------ preview

  var DOT = '\u00B7';
  var PILCROW = '\u00B6';
  var ELLIPSIS = '\u2026';
  var PLACEHOLDER = '\u0001';
  var CONTEXT = 25;

  function render(c, removed) {
    if (removed) {
      if (c === '\n') return PILCROW;
      if (c === '\r') return '';
      if (c === ' ' || c === '\t') return DOT;
      return c;
    }
    if (c === '\r') return '';
    return c === '\n' || c === '\t' ? ' ' : c;
  }

  /** ProjectScan.Preview: {now, after}; after is '' for a problem fixed by hand. */
  function preview(issue) {
    var text = issue.chapterText;
    var canFix = issue.edits.length > 0;
    var a = issue.start;
    var b = issue.end;
    if (canFix) {
      a = Math.min.apply(null, issue.edits.map(function (e) { return e.start; }));
      b = Math.max.apply(null, issue.edits.map(function (e) { return e.start + e.length; }));
    }
    var ws = Math.max(0, a - CONTEXT);
    var we = Math.min(text.length, b + CONTEXT);
    var slice = text.substring(ws, we);
    var prefix = ws > 0 ? ELLIPSIS : '';
    var suffix = we < text.length ? ELLIPSIS : '';
    var removed = new Array(slice.length).fill(false);
    issue.edits.forEach(function (e) {
      for (var i = Math.max(e.start, ws); i < Math.min(e.start + e.length, we); i++) removed[i - ws] = true;
    });
    var now = '';
    for (var i = 0; i < slice.length; i++) now += render(slice[i], removed[i]);
    now = prefix + csTrim(now) + suffix;
    if (!canFix) return { now: now, after: '' };
    var fixedSlice = apply(
      slice,
      issue.edits.map(function (e) {
        return edit(e.start - ws, e.length, e.insert.length > 0 ? PLACEHOLDER.repeat(e.insert.length) : '');
      }),
    );
    var after = '';
    for (var j = 0; j < fixedSlice.length; j++)
      after += fixedSlice[j] === PLACEHOLDER ? DOT : render(fixedSlice[j], false);
    return { now: now, after: prefix + csTrim(after) + suffix };
  }

  return {
    KINDS: KINDS,
    CODES: CODES,
    BOOK_ORDER: BOOK_ORDER,
    OTHER_BOOKS: OTHER_BOOKS,
    DEFAULT_OPTIONS: DEFAULT_OPTIONS,
    bookCode: bookCode,
    bookNumber: bookNumber,
    isBibleBook: isBibleBook,
    isExcluded: isExcluded,
    parseSty: parseSty,
    mergeSty: mergeSty,
    styFromStyleInfo: styFromStyleInfo,
    Scanner: Scanner,
    apply: apply,
    chapterSpans: chapterSpans,
    bookChapters: bookChapters,
    scanBook: scanBook,
    verseNumber: verseNumber,
    preview: preview,
  };
})();

const MS_VERSION = "0.1.0";
const MS_WEB_VIEW_HTML = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      :root {\n        --ms-bg: #ffffff;\n        --ms-fg: #1f2328;\n        --ms-muted: #59636e;\n        --ms-line: #d0d7de;\n        --ms-head: #f3f5f7;\n        --ms-sel: #dbeafe;\n        --ms-accent: #0b6bcb;\n        --ms-warn: #9a3412;\n        --ms-ok: #166534;\n        --ms-mono: Consolas, 'Cascadia Mono', monospace;\n      }\n      @media (prefers-color-scheme: dark) {\n        :root {\n          --ms-bg: #1e1f22;\n          --ms-fg: #e6e6e6;\n          --ms-muted: #a0a6ad;\n          --ms-line: #3a3d42;\n          --ms-head: #2a2c30;\n          --ms-sel: #1e3a5f;\n          --ms-accent: #6cb6ff;\n          --ms-warn: #fdba74;\n          --ms-ok: #86efac;\n        }\n      }\n      html,\n      body {\n        margin: 0;\n        height: 100%;\n        background: var(--ms-bg);\n        color: var(--ms-fg);\n        font: 13px/1.4 'Segoe UI', system-ui, sans-serif;\n      }\n      body {\n        display: flex;\n        flex-direction: column;\n        padding: 8px 12px;\n        box-sizing: border-box;\n        gap: 6px;\n      }\n      .row {\n        display: flex;\n        flex-wrap: wrap;\n        align-items: center;\n        gap: 8px;\n      }\n      .grow {\n        flex: 1;\n      }\n      button {\n        font: inherit;\n        padding: 3px 10px;\n        border: 1px solid var(--ms-line);\n        background: var(--ms-head);\n        color: var(--ms-fg);\n        border-radius: 4px;\n        cursor: pointer;\n      }\n      button.primary {\n        background: var(--ms-accent);\n        border-color: var(--ms-accent);\n        color: #fff;\n        font-weight: 600;\n      }\n      button:disabled {\n        opacity: 0.5;\n        cursor: default;\n      }\n      select,\n      input[type='text'] {\n        font: inherit;\n        background: var(--ms-bg);\n        color: var(--ms-fg);\n        border: 1px solid var(--ms-line);\n        border-radius: 3px;\n        padding: 2px 4px;\n      }\n      #intro,\n      #status,\n      .hint {\n        color: var(--ms-muted);\n      }\n      #status.busy {\n        color: var(--ms-warn);\n        font-weight: 600;\n      }\n      #tableWrap {\n        flex: 1;\n        overflow: auto;\n        border: 1px solid var(--ms-line);\n        min-height: 120px;\n      }\n      table {\n        border-collapse: collapse;\n        width: 100%;\n      }\n      th,\n      td {\n        border-bottom: 1px solid var(--ms-line);\n        padding: 3px 6px;\n        text-align: left;\n        vertical-align: top;\n      }\n      th {\n        position: sticky;\n        top: 0;\n        background: var(--ms-head);\n        font-weight: 600;\n        z-index: 1;\n      }\n      td.text {\n        font-family: var(--ms-mono);\n        white-space: pre-wrap;\n        word-break: break-word;\n      }\n      td.ref {\n        white-space: nowrap;\n      }\n      tr:hover td {\n        background: var(--ms-sel);\n      }\n      .byhand {\n        color: var(--ms-muted);\n        font-style: italic;\n      }\n      #results {\n        max-height: 110px;\n        overflow: auto;\n        white-space: pre-wrap;\n        border: 1px solid var(--ms-line);\n        padding: 4px 6px;\n        font-size: 12px;\n      }\n      #results.ok {\n        color: var(--ms-ok);\n      }\n      .panel {\n        border: 1px solid var(--ms-line);\n        background: var(--ms-head);\n        padding: 8px;\n        border-radius: 4px;\n      }\n      .panel label.field {\n        display: grid;\n        grid-template-columns: minmax(200px, 45%) 1fr;\n        gap: 8px;\n        align-items: center;\n        margin: 3px 0;\n      }\n      .overlay {\n        position: fixed;\n        inset: 0;\n        background: rgba(0, 0, 0, 0.35);\n        display: none;\n        align-items: center;\n        justify-content: center;\n        z-index: 10;\n      }\n      .overlay.show {\n        display: flex;\n      }\n      .dialog {\n        background: var(--ms-bg);\n        border: 1px solid var(--ms-line);\n        border-radius: 6px;\n        padding: 14px;\n        max-width: 640px;\n        width: calc(100% - 40px);\n        max-height: calc(100% - 40px);\n        overflow: auto;\n        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);\n      }\n      .dialog h3 {\n        margin: 0 0 8px;\n      }\n      #bookGrid {\n        display: grid;\n        grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));\n        gap: 2px 8px;\n        margin: 8px 0;\n        font-family: var(--ms-mono);\n      }\n      .hidden {\n        display: none !important;\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"row\">\n      <strong id=\"project\"></strong>\n      <span class=\"grow\"></span>\n      <button id=\"booksBtn\" type=\"button\"></button>\n      <button id=\"optionsBtn\" type=\"button\"></button>\n      <button id=\"rescanBtn\" type=\"button\"></button>\n    </div>\n    <div id=\"intro\"></div>\n\n    <div id=\"optionsPanel\" class=\"panel hidden\">\n      <label class=\"field\"><span id=\"lExclude\"></span><input type=\"text\" id=\"oExclude\" /></label>\n      <label class=\"field\"><span id=\"lNoClose\"></span><input type=\"text\" id=\"oNoClose\" /></label>\n      <label class=\"field\"><span id=\"lNoCloseInNote\"></span><input type=\"text\" id=\"oNoCloseInNote\" /></label>\n      <label class=\"field\"><span id=\"lExtra\"></span><input type=\"text\" id=\"oExtra\" /></label>\n      <label class=\"field\"><span id=\"lNoSpaceBefore\"></span><input type=\"text\" id=\"oNoSpaceBefore\" /></label>\n      <div class=\"row\">\n        <label><input type=\"checkbox\" id=\"oFootnote\" /> <span id=\"lFootnote\"></span></label>\n        <label><input type=\"checkbox\" id=\"oXref\" /> <span id=\"lXref\"></span></label>\n      </div>\n      <div class=\"hint\" id=\"optionsHint\"></div>\n      <div class=\"row\" style=\"margin-top: 6px\">\n        <button id=\"saveOptionsBtn\" type=\"button\" class=\"primary\"></button>\n        <button id=\"defaultsBtn\" type=\"button\"></button>\n      </div>\n    </div>\n\n    <div class=\"row\">\n      <label><span id=\"lKind\"></span> <select id=\"kindFilter\"></select></label>\n      <label><span id=\"lMarker\"></span> <select id=\"markerFilter\"></select></label>\n      <label><input type=\"checkbox\" id=\"showByHand\" /> <span id=\"lShowByHand\"></span></label>\n    </div>\n    <div id=\"status\"></div>\n    <div id=\"tableWrap\">\n      <table>\n        <thead>\n          <tr>\n            <th style=\"width: 3em\" id=\"hFix\"></th>\n            <th id=\"hRef\"></th>\n            <th id=\"hProblem\"></th>\n            <th id=\"hNow\"></th>\n            <th id=\"hAfter\"></th>\n          </tr>\n        </thead>\n        <tbody id=\"rows\"></tbody>\n      </table>\n    </div>\n    <div class=\"row\">\n      <button id=\"tickBtn\" type=\"button\"></button>\n      <button id=\"untickBtn\" type=\"button\"></button>\n      <span class=\"grow hint\" id=\"goToHint\"></span>\n      <button id=\"fixBtn\" type=\"button\" class=\"primary\"></button>\n    </div>\n    <div id=\"results\"></div>\n\n    <div class=\"overlay\" id=\"confirmOverlay\">\n      <div class=\"dialog\">\n        <h3 id=\"confirmTitle\"></h3>\n        <div id=\"confirmText\" style=\"white-space: pre-wrap\"></div>\n        <div class=\"row\" style=\"margin-top: 12px; justify-content: flex-end\">\n          <button id=\"confirmYes\" type=\"button\" class=\"primary\"></button>\n          <button id=\"confirmNo\" type=\"button\"></button>\n        </div>\n      </div>\n    </div>\n\n    <div class=\"overlay\" id=\"booksOverlay\">\n      <div class=\"dialog\">\n        <h3 id=\"booksTitle\"></h3>\n        <div class=\"hint\" id=\"booksIntro\"></div>\n        <div class=\"row\" style=\"margin-top: 6px\" id=\"bookQuick\"></div>\n        <div id=\"bookGrid\"></div>\n        <div class=\"hint\" id=\"booksError\"></div>\n        <div class=\"row\" style=\"justify-content: flex-end\">\n          <button id=\"booksOk\" type=\"button\" class=\"primary\"></button>\n          <button id=\"booksCancel\" type=\"button\"></button>\n        </div>\n      </div>\n    </div>\n\n    <script>\n      const BOOT = __MS_BOOT__;\n      const papi = require('@papi/frontend');\n      const { logger } = require('@papi/frontend');\n\n      const DOT = '\u00b7';\n      const MAX_ROWS = 3000;\n\n      const T = {\n        en: {\n          intro:\n            'These are the spacing problems found around markers. Tick the ones to fix, then click Fix. The \"After fix\" column shows the change; a dot (' +\n            DOT +\n            ') marks a space that is removed or added. Double-click a row to go to the verse.',\n          project: 'Project: {0}',\n          scanning: 'Scanning...',\n          fixing: 'Fixing...',\n          optionsShow: 'Options...',\n          optionsHide: 'Hide options',\n          optExclude: 'Marker codes to exclude',\n          optNoClose: 'Markers that do not require a closing marker',\n          optNoCloseInNote: 'Markers that do not require a closing marker only inside a footnote/cross-reference',\n          optExtra: 'Extra markers to check for spacing',\n          optNoSpaceBefore: 'Markers that should have NO space before them',\n          optFootnote: 'Footnote precedes text',\n          optXref: 'Cross-references occur before word',\n          optionsHint:\n            'Marker codes are separated by spaces, without backslashes (for example: w rq). The options are saved for this project.',\n          saveRescan: 'Save options and scan again',\n          defaults: 'Restore defaults',\n          kind: 'Problem:',\n          marker: 'Marker:',\n          all: '(all)',\n          showByHand: 'Also show problems that must be fixed by hand (unclosed or unexpected closing markers)',\n          counts: '{0} problem(s) shown, {1} can be fixed, {2} ticked in all.',\n          tooMany: 'Only the first {0} are listed; use the filters to see the others.',\n          noProblems: 'No marker spacing problems were found.',\n          colFix: 'Fix',\n          colRef: 'Reference',\n          colProblem: 'Problem',\n          colNow: 'Now',\n          colAfter: 'After fix',\n          byHand: '(fix by hand)',\n          goToHint: 'Double-click a row to go to the verse.',\n          tickShown: 'Tick all shown',\n          untickShown: 'Untick all shown',\n          fix: 'Fix ticked problems ({0})',\n          rescan: 'Scan again',\n          nothingTicked: 'Tick at least one problem to fix.',\n          confirmTitle: 'Fix marker spaces',\n          confirm:\n            'Fix {0} problem(s) in {1} book(s)?\\n\\nA copy of each book is kept before it is changed (in the extension\\'s own storage).',\n          yes: 'Fix',\n          cancel: 'Cancel',\n          ok: 'OK',\n          resFixed: '{0}: {1} problem(s) fixed',\n          resTotal: 'Fixed: {0} problem(s) in {1} book(s).',\n          resNothing: 'Nothing was changed.',\n          resNoPermission: 'Not changed, because you do not have permission to edit this project.',\n          resChanged: 'Not changed, because the text changed after the scan (scan again, then try again): {0}',\n          resFailed: 'Could not change: {0}',\n          resBackups: '{0} backup(s) kept.',\n          noPermissionProject: 'You do not have permission to edit this project, so these problems cannot be fixed here.',\n          readFailed: 'Could not read: {0}',\n          error: 'Marker Spaces could not finish: {0}',\n          booksButton: 'Books: {0} of {1}...',\n          booksTitle: 'Books to examine',\n          booksIntro: 'Tick the books to examine. Unticked books are not read at all. The choice is saved for this project.',\n          booksAll: 'All',\n          booksNone: 'None',\n          booksBible: 'Bible books',\n          booksOT: 'Old Testament',\n          booksNT: 'New Testament',\n          booksDC: 'Deuterocanon',\n          booksOther: 'Other books',\n          booksNoneChosen: 'Tick at least one book.',\n          kinds: [\n            'Missing space before an opening marker',\n            'Space before \\\\f or \\\\x',\n            'Space before a closing marker',\n            'Missing space after a closing marker',\n            'Space before punctuation after a closing marker',\n            'Space after a closing marker (note precedes text)',\n            'Missing space before \\\\v, \\\\ft, \\\\fr, ...',\n            'Space before | in \\\\w',\n            'Unclosed marker',\n            'Unexpected closing marker',\n          ],\n          messages: [\n            'Missing space before \\\\{0}',\n            'Unwanted space before \\\\{0}',\n            'Unwanted space before \\\\{0}',\n            'Missing space after \\\\{0}',\n            'Unwanted space before punctuation after \\\\{0}',\n            'Unwanted space after \\\\{0} (precedes text)',\n            'Missing space before \\\\{0}',\n            'Unwanted space before | in \\\\w...\\\\w* (produces a double space)',\n            'Unclosed \\\\{0} (no matching \\\\{0}* found)',\n            'Unexpected \\\\{0} (\\\\{1} is not normally closed)',\n          ],\n        },\n        es: {\n          intro:\n            'Estos son los problemas de espaciado encontrados alrededor de los marcadores. Marque los que desea corregir y haga clic en Corregir. La columna \"Despu\u00e9s\" muestra el cambio; un punto (' +\n            DOT +\n            ') indica un espacio que se quita o se agrega. Haga doble clic en una fila para ir al vers\u00edculo.',\n          project: 'Proyecto: {0}',\n          scanning: 'Revisando...',\n          fixing: 'Corrigiendo...',\n          optionsShow: 'Opciones...',\n          optionsHide: 'Ocultar opciones',\n          optExclude: 'C\u00f3digos de marcador a excluir',\n          optNoClose: 'Marcadores que no requieren un marcador de cierre',\n          optNoCloseInNote:\n            'Marcadores que no requieren un marcador de cierre solo dentro de una nota al pie/referencia cruzada',\n          optExtra: 'Marcadores adicionales para verificar el espaciado',\n          optNoSpaceBefore: 'Marcadores que NO deben tener espacio antes',\n          optFootnote: 'La nota precede al texto',\n          optXref: 'Las referencias cruzadas ocurren antes de la palabra',\n          optionsHint:\n            'Los c\u00f3digos de marcador se separan con espacios, sin barra invertida (por ejemplo: w rq). Las opciones se guardan para este proyecto.',\n          saveRescan: 'Guardar opciones y revisar de nuevo',\n          defaults: 'Restaurar valores predeterminados',\n          kind: 'Problema:',\n          marker: 'Marcador:',\n          all: '(todos)',\n          showByHand:\n            'Mostrar tambi\u00e9n los problemas que hay que corregir a mano (marcadores sin cerrar o cierres inesperados)',\n          counts: '{0} problema(s) mostrado(s), {1} se pueden corregir, {2} marcado(s) en total.',\n          tooMany: 'Solo se muestran los primeros {0}; use los filtros para ver los dem\u00e1s.',\n          noProblems: 'No se encontraron problemas de espaciado en los marcadores.',\n          colFix: 'Corregir',\n          colRef: 'Referencia',\n          colProblem: 'Problema',\n          colNow: 'Ahora',\n          colAfter: 'Despu\u00e9s',\n          byHand: '(corregir a mano)',\n          goToHint: 'Haga doble clic en una fila para ir al vers\u00edculo.',\n          tickShown: 'Marcar todos los mostrados',\n          untickShown: 'Desmarcar todos los mostrados',\n          fix: 'Corregir los problemas marcados ({0})',\n          rescan: 'Revisar de nuevo',\n          nothingTicked: 'Marque al menos un problema para corregir.',\n          confirmTitle: 'Corregir espacios de marcadores',\n          confirm:\n            '\u00bfCorregir {0} problema(s) en {1} libro(s)?\\n\\nAntes de cambiar cada libro se guarda una copia (en el almacenamiento propio de la extensi\u00f3n).',\n          yes: 'Corregir',\n          cancel: 'Cancelar',\n          ok: 'Aceptar',\n          resFixed: '{0}: {1} problema(s) corregido(s)',\n          resTotal: 'Corregido: {0} problema(s) en {1} libro(s).',\n          resNothing: 'No se cambi\u00f3 nada.',\n          resNoPermission: 'No se cambiaron, porque usted no tiene permiso para editar este proyecto.',\n          resChanged:\n            'No se cambiaron, porque el texto cambi\u00f3 despu\u00e9s de la revisi\u00f3n (revise de nuevo y vuelva a intentarlo): {0}',\n          resFailed: 'No se pudo cambiar: {0}',\n          resBackups: 'Se guardaron {0} copia(s) de seguridad.',\n          noPermissionProject:\n            'Usted no tiene permiso para editar este proyecto, as\u00ed que estos problemas no se pueden corregir aqu\u00ed.',\n          readFailed: 'No se pudo leer: {0}',\n          error: 'Espacios de marcadores no pudo terminar: {0}',\n          booksButton: 'Libros: {0} de {1}...',\n          booksTitle: 'Libros a revisar',\n          booksIntro:\n            'Marque los libros que desea revisar. Los libros sin marcar no se leen. La selecci\u00f3n se guarda para este proyecto.',\n          booksAll: 'Todos',\n          booksNone: 'Ninguno',\n          booksBible: 'Libros de la Biblia',\n          booksOT: 'Antiguo Testamento',\n          booksNT: 'Nuevo Testamento',\n          booksDC: 'Deuterocan\u00f3nicos',\n          booksOther: 'Otros libros',\n          booksNoneChosen: 'Marque al menos un libro.',\n          kinds: [\n            'Falta espacio antes de un marcador de apertura',\n            'Espacio antes de \\\\f o \\\\x',\n            'Espacio antes de un marcador de cierre',\n            'Falta espacio despu\u00e9s de un marcador de cierre',\n            'Espacio antes de puntuaci\u00f3n despu\u00e9s de un marcador de cierre',\n            'Espacio despu\u00e9s de un marcador de cierre (la nota precede al texto)',\n            'Falta espacio antes de \\\\v, \\\\ft, \\\\fr, ...',\n            'Espacio antes de | en \\\\w',\n            'Marcador sin cerrar',\n            'Marcador de cierre inesperado',\n          ],\n          messages: [\n            'Falta espacio antes de \\\\{0}',\n            'Espacio no deseado antes de \\\\{0}',\n            'Espacio no deseado antes de \\\\{0}',\n            'Falta espacio despu\u00e9s de \\\\{0}',\n            'Espacio no deseado antes de la puntuaci\u00f3n despu\u00e9s de \\\\{0}',\n            'Espacio no deseado despu\u00e9s de \\\\{0} (precede al texto)',\n            'Falta espacio antes de \\\\{0}',\n            'Espacio no deseado antes de | en \\\\w...\\\\w* (produce un espacio doble)',\n            '\\\\{0} sin cerrar (no se encontr\u00f3 \\\\{0}*)',\n            '\\\\{0} inesperado (\\\\{1} normalmente no se cierra)',\n          ],\n        },\n        fr: {\n          intro:\n            'Voici les probl\u00e8mes d\u2019espacement trouv\u00e9s autour des marqueurs. Cochez ceux \u00e0 corriger, puis cliquez sur Corriger. La colonne \u00ab Apr\u00e8s correction \u00bb montre le changement ; un point (' +\n            DOT +\n            ') indique une espace supprim\u00e9e ou ajout\u00e9e. Double-cliquez sur une ligne pour aller au verset.',\n          project: 'Projet : {0}',\n          scanning: 'Analyse...',\n          fixing: 'Correction...',\n          optionsShow: 'Options...',\n          optionsHide: 'Masquer les options',\n          optExclude: 'Codes de marqueurs \u00e0 exclure',\n          optNoClose: 'Marqueurs qui n\u2019exigent pas de marqueur de fermeture',\n          optNoCloseInNote:\n            'Marqueurs qui n\u2019exigent pas de marqueur de fermeture seulement dans une note de bas de page/r\u00e9f\u00e9rence crois\u00e9e',\n          optExtra: 'Autres marqueurs dont l\u2019espacement est \u00e0 v\u00e9rifier',\n          optNoSpaceBefore: 'Marqueurs qui ne doivent PAS \u00eatre pr\u00e9c\u00e9d\u00e9s d\u2019une espace',\n          optFootnote: 'La note pr\u00e9c\u00e8de le texte',\n          optXref: 'Les r\u00e9f\u00e9rences crois\u00e9es se trouvent avant le mot',\n          optionsHint:\n            'Les codes de marqueurs sont s\u00e9par\u00e9s par des espaces, sans barre oblique inverse (par exemple : w rq). Les options sont enregistr\u00e9es pour ce projet.',\n          saveRescan: 'Enregistrer les options et analyser de nouveau',\n          defaults: 'R\u00e9tablir les valeurs par d\u00e9faut',\n          kind: 'Probl\u00e8me :',\n          marker: 'Marqueur :',\n          all: '(tous)',\n          showByHand:\n            'Afficher aussi les probl\u00e8mes \u00e0 corriger \u00e0 la main (marqueurs non ferm\u00e9s ou fermetures inattendues)',\n          counts: '{0} probl\u00e8me(s) affich\u00e9(s), {1} corrigeable(s), {2} coch\u00e9(s) au total.',\n          tooMany: 'Seuls les {0} premiers sont list\u00e9s ; utilisez les filtres pour voir les autres.',\n          noProblems: 'Aucun probl\u00e8me d\u2019espacement autour des marqueurs n\u2019a \u00e9t\u00e9 trouv\u00e9.',\n          colFix: 'Corriger',\n          colRef: 'R\u00e9f\u00e9rence',\n          colProblem: 'Probl\u00e8me',\n          colNow: 'Actuel',\n          colAfter: 'Apr\u00e8s correction',\n          byHand: '(\u00e0 corriger \u00e0 la main)',\n          goToHint: 'Double-cliquez sur une ligne pour aller au verset.',\n          tickShown: 'Cocher toutes les lignes affich\u00e9es',\n          untickShown: 'D\u00e9cocher toutes les lignes affich\u00e9es',\n          fix: 'Corriger les probl\u00e8mes coch\u00e9s ({0})',\n          rescan: 'Analyser de nouveau',\n          nothingTicked: 'Cochez au moins un probl\u00e8me \u00e0 corriger.',\n          confirmTitle: 'Corriger les espaces autour des marqueurs',\n          confirm:\n            'Corriger {0} probl\u00e8me(s) dans {1} livre(s) ?\\n\\nUne copie de chaque livre est conserv\u00e9e avant sa modification (dans le stockage propre de l\u2019extension).',\n          yes: 'Corriger',\n          cancel: 'Annuler',\n          ok: 'OK',\n          resFixed: '{0} : {1} probl\u00e8me(s) corrig\u00e9(s)',\n          resTotal: 'Corrig\u00e9 : {0} probl\u00e8me(s) dans {1} livre(s).',\n          resNothing: 'Rien n\u2019a \u00e9t\u00e9 chang\u00e9.',\n          resNoPermission: 'Non chang\u00e9, car vous n\u2019avez pas l\u2019autorisation de modifier ce projet.',\n          resChanged:\n            'Non chang\u00e9, car le texte a chang\u00e9 apr\u00e8s l\u2019analyse (analysez de nouveau, puis r\u00e9essayez) : {0}',\n          resFailed: 'Impossible de changer : {0}',\n          resBackups: '{0} copie(s) de sauvegarde conserv\u00e9e(s).',\n          noPermissionProject:\n            'Vous n\u2019avez pas l\u2019autorisation de modifier ce projet, donc ces probl\u00e8mes ne peuvent pas \u00eatre corrig\u00e9s ici.',\n          readFailed: 'Impossible de lire : {0}',\n          error: 'Espaces autour des marqueurs n\u2019a pas pu terminer : {0}',\n          booksButton: 'Livres : {0} sur {1}...',\n          booksTitle: 'Livres \u00e0 analyser',\n          booksIntro:\n            'Cochez les livres \u00e0 analyser. Les livres non coch\u00e9s ne sont pas lus du tout. Le choix est enregistr\u00e9 pour ce projet.',\n          booksAll: 'Tous',\n          booksNone: 'Aucun',\n          booksBible: 'Livres de la Bible',\n          booksOT: 'Ancien Testament',\n          booksNT: 'Nouveau Testament',\n          booksDC: 'Deut\u00e9rocanoniques',\n          booksOther: 'Autres livres',\n          booksNoneChosen: 'Cochez au moins un livre.',\n          kinds: [\n            'Espace manquante avant un marqueur d\u2019ouverture',\n            'Espace avant \\\\f ou \\\\x',\n            'Espace avant un marqueur de fermeture',\n            'Espace manquante apr\u00e8s un marqueur de fermeture',\n            'Espace avant la ponctuation apr\u00e8s un marqueur de fermeture',\n            'Espace apr\u00e8s un marqueur de fermeture (la note pr\u00e9c\u00e8de le texte)',\n            'Espace manquante avant \\\\v, \\\\ft, \\\\fr, ...',\n            'Espace avant | dans \\\\w',\n            'Marqueur non ferm\u00e9',\n            'Marqueur de fermeture inattendu',\n          ],\n          messages: [\n            'Espace manquante avant \\\\{0}',\n            'Espace superflue avant \\\\{0}',\n            'Espace superflue avant \\\\{0}',\n            'Espace manquante apr\u00e8s \\\\{0}',\n            'Espace superflue avant la ponctuation apr\u00e8s \\\\{0}',\n            'Espace superflue apr\u00e8s \\\\{0} (pr\u00e9c\u00e8de le texte)',\n            'Espace manquante avant \\\\{0}',\n            'Espace superflue avant | dans \\\\w...\\\\w* (produit une double espace)',\n            '\\\\{0} non ferm\u00e9 (aucun \\\\{0}* correspondant)',\n            '\\\\{0} inattendu (\\\\{1} n\u2019est normalement pas ferm\u00e9)',\n          ],\n        },\n      };\n      const S = T[BOOT.lang] || T.en;\n      const REPORT_ONLY = [8, 9];\n      const OT_END = 39;\n      const NT_END = 66;\n\n      function fmt(s, ...args) {\n        return s.replace(/\\{(\\d+)\\}/g, (m, i) => (args[+i] !== undefined ? String(args[+i]) : m));\n      }\n      const $ = (id) => document.getElementById(id);\n\n      let state = null; // last scan result\n      const ticked = new Set();\n      let optionsOpen = false;\n      let busy = false;\n\n      function setText() {\n        $('intro').textContent = S.intro;\n        $('lExclude').textContent = S.optExclude;\n        $('lNoClose').textContent = S.optNoClose;\n        $('lNoCloseInNote').textContent = S.optNoCloseInNote;\n        $('lExtra').textContent = S.optExtra;\n        $('lNoSpaceBefore').textContent = S.optNoSpaceBefore;\n        $('lFootnote').textContent = S.optFootnote;\n        $('lXref').textContent = S.optXref;\n        $('optionsHint').textContent = S.optionsHint;\n        $('saveOptionsBtn').textContent = S.saveRescan;\n        $('defaultsBtn').textContent = S.defaults;\n        $('lKind').textContent = S.kind;\n        $('lMarker').textContent = S.marker;\n        $('lShowByHand').textContent = S.showByHand;\n        $('hFix').textContent = S.colFix;\n        $('hRef').textContent = S.colRef;\n        $('hProblem').textContent = S.colProblem;\n        $('hNow').textContent = S.colNow;\n        $('hAfter').textContent = S.colAfter;\n        $('tickBtn').textContent = S.tickShown;\n        $('untickBtn').textContent = S.untickShown;\n        $('goToHint').textContent = S.goToHint;\n        $('rescanBtn').textContent = S.rescan;\n        $('optionsBtn').textContent = S.optionsShow;\n        $('confirmTitle').textContent = S.confirmTitle;\n        $('confirmYes').textContent = S.yes;\n        $('confirmNo').textContent = S.cancel;\n        $('booksTitle').textContent = S.booksTitle;\n        $('booksIntro').textContent = S.booksIntro;\n        $('booksOk').textContent = S.ok;\n        $('booksCancel').textContent = S.cancel;\n        $('project').textContent = fmt(S.project, BOOT.projectId);\n        updateFixButton();\n      }\n\n      function setBusy(on, text) {\n        busy = on;\n        $('status').className = on ? 'busy' : '';\n        if (text !== undefined) $('status').textContent = text;\n        ['rescanBtn', 'booksBtn', 'saveOptionsBtn', 'defaultsBtn', 'tickBtn', 'untickBtn'].forEach((id) => {\n          $(id).disabled = on;\n        });\n        updateFixButton();\n      }\n\n      function canFixRow(r) {\n        return r.canFix && state && state.canEdit;\n      }\n\n      function shownRows() {\n        if (!state) return [];\n        const kind = $('kindFilter').value;\n        const marker = $('markerFilter').value;\n        const byHand = $('showByHand').checked;\n        return state.rows.filter(\n          (r) =>\n            (byHand || REPORT_ONLY.indexOf(r.kind) < 0) &&\n            (kind === '' || String(r.kind) === kind) &&\n            (marker === '' || r.marker === marker),\n        );\n      }\n\n      function fillFilters() {\n        const kindSel = $('kindFilter');\n        const markerSel = $('markerFilter');\n        const keepKind = kindSel.value;\n        const keepMarker = markerSel.value;\n        const byHand = $('showByHand').checked;\n        const kinds = new Map();\n        const markers = new Map();\n        state.rows.forEach((r) => {\n          if (!byHand && REPORT_ONLY.indexOf(r.kind) >= 0) return;\n          kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1);\n          markers.set(r.marker, (markers.get(r.marker) || 0) + 1);\n        });\n        kindSel.innerHTML = '';\n        markerSel.innerHTML = '';\n        kindSel.add(new Option(S.all, ''));\n        markerSel.add(new Option(S.all, ''));\n        Array.from(kinds.keys())\n          .sort((a, b) => a - b)\n          .forEach((k) => kindSel.add(new Option(`${S.kinds[k]} (${kinds.get(k)})`, String(k))));\n        Array.from(markers.keys())\n          .sort()\n          .forEach((m) => markerSel.add(new Option(`\\\\${m} (${markers.get(m)})`, m)));\n        kindSel.value = Array.from(kindSel.options).some((o) => o.value === keepKind) ? keepKind : '';\n        markerSel.value = Array.from(markerSel.options).some((o) => o.value === keepMarker) ? keepMarker : '';\n      }\n\n      function message(r) {\n        return fmt(S.messages[r.kind], r.shown, r.marker);\n      }\n\n      function renderRows() {\n        const body = $('rows');\n        body.innerHTML = '';\n        if (!state) return;\n        const rows = shownRows();\n        const frag = document.createDocumentFragment();\n        rows.slice(0, MAX_ROWS).forEach((r) => {\n          const tr = document.createElement('tr');\n          tr.dataset.id = r.id;\n          const tdBox = document.createElement('td');\n          if (canFixRow(r)) {\n            const box = document.createElement('input');\n            box.type = 'checkbox';\n            box.checked = ticked.has(r.id);\n            box.addEventListener('change', () => {\n              if (box.checked) ticked.add(r.id);\n              else ticked.delete(r.id);\n              updateCounts();\n            });\n            tdBox.appendChild(box);\n          }\n          tr.appendChild(tdBox);\n          const cells = [\n            [`${r.book} ${r.chapter}:${r.verse}`, 'ref'],\n            [message(r), ''],\n            [r.now, 'text'],\n            [r.canFix ? r.after : S.byHand, r.canFix ? 'text' : 'byhand'],\n          ];\n          cells.forEach(([text, cls]) => {\n            const td = document.createElement('td');\n            if (cls) td.className = cls;\n            td.textContent = text;\n            tr.appendChild(td);\n          });\n          tr.addEventListener('dblclick', () => {\n            papi.commands\n              .sendCommand('markerSpaces.goTo', BOOT.projectId, r.book, r.chapter, r.verse)\n              .catch((e) => logger.warn(`Marker Spaces go to failed: ${e}`));\n          });\n          frag.appendChild(tr);\n        });\n        body.appendChild(frag);\n        updateCounts();\n      }\n\n      function updateCounts() {\n        if (!state) return;\n        const rows = shownRows();\n        let text;\n        if (state.rows.length === 0) text = S.noProblems;\n        else {\n          text = fmt(S.counts, rows.length, rows.filter(canFixRow).length, ticked.size);\n          if (rows.length > MAX_ROWS) text += ' ' + fmt(S.tooMany, MAX_ROWS);\n          if (!state.canEdit) text += ' ' + S.noPermissionProject;\n        }\n        if (state.failed && state.failed.length) text += ' ' + fmt(S.readFailed, state.failed.join('; '));\n        $('status').textContent = text;\n        updateFixButton();\n      }\n\n      function updateFixButton() {\n        $('fixBtn').textContent = fmt(S.fix, ticked.size);\n        $('fixBtn').disabled = busy || ticked.size === 0;\n      }\n\n      function fillOptions(o) {\n        $('oExclude').value = o.excludeMarkers || '';\n        $('oNoClose').value = o.noCloseMarkers || '';\n        $('oNoCloseInNote').value = o.noCloseInNoteMarkers || '';\n        $('oExtra').value = o.extraSpacingMarkers || '';\n        $('oNoSpaceBefore').value = o.noSpaceBeforeMarkers || '';\n        $('oFootnote').checked = !!o.footnotePrecedesText;\n        $('oXref').checked = !!o.crossReferencesPrecedeText;\n      }\n\n      function readOptions() {\n        return Object.assign({}, state.options, {\n          excludeMarkers: $('oExclude').value.trim(),\n          noCloseMarkers: $('oNoClose').value.trim(),\n          noCloseInNoteMarkers: $('oNoCloseInNote').value.trim(),\n          extraSpacingMarkers: $('oExtra').value.trim(),\n          noSpaceBeforeMarkers: $('oNoSpaceBefore').value.trim(),\n          footnotePrecedesText: $('oFootnote').checked,\n          crossReferencesPrecedeText: $('oXref').checked,\n        });\n      }\n\n      async function scan() {\n        setBusy(true, S.scanning);\n        $('rows').innerHTML = '';\n        try {\n          state = await papi.commands.sendCommand('markerSpaces.scan', BOOT.projectId);\n          ticked.clear();\n          $('project').textContent = fmt(S.project, state.projectName);\n          const chosen = state.books.filter((b) => b.chosen).length;\n          $('booksBtn').textContent = fmt(S.booksButton, chosen, state.books.length);\n          fillOptions(state.options);\n          fillFilters();\n          setBusy(false);\n          renderRows();\n        } catch (e) {\n          setBusy(false, fmt(S.error, e && e.message ? e.message : e));\n        }\n      }\n\n      async function saveOptions(options) {\n        setBusy(true, S.scanning);\n        try {\n          await papi.commands.sendCommand('markerSpaces.saveOptions', BOOT.projectId, options);\n        } catch (e) {\n          setBusy(false, fmt(S.error, e && e.message ? e.message : e));\n          return;\n        }\n        await scan();\n      }\n\n      // ---------------------------------------------------------------- fixing\n\n      function askFix() {\n        if (ticked.size === 0) {\n          $('results').textContent = S.nothingTicked;\n          return;\n        }\n        const books = new Set(state.rows.filter((r) => ticked.has(r.id)).map((r) => r.book));\n        $('confirmText').textContent = fmt(S.confirm, ticked.size, books.size);\n        $('confirmOverlay').classList.add('show');\n        $('confirmYes').focus();\n      }\n\n      async function doFix() {\n        $('confirmOverlay').classList.remove('show');\n        setBusy(true, S.fixing);\n        let report;\n        try {\n          report = await papi.commands.sendCommand('markerSpaces.fix', BOOT.projectId, Array.from(ticked));\n        } catch (e) {\n          setBusy(false);\n          $('results').className = '';\n          $('results').textContent = fmt(S.error, e && e.message ? e.message : e);\n          return;\n        }\n        const lines = [];\n        if (report.noPermission) lines.push(S.resNoPermission);\n        report.fixed.forEach((f) => lines.push(fmt(S.resFixed, f.book, f.count)));\n        if (report.total > 0) lines.push(fmt(S.resTotal, report.total, report.booksChanged));\n        else if (!report.noPermission) lines.push(S.resNothing);\n        if (report.changed.length) lines.push(fmt(S.resChanged, report.changed.join(', ')));\n        if (report.failed.length) lines.push(fmt(S.resFailed, report.failed.join('; ')));\n        if (report.backups.length) lines.push(fmt(S.resBackups, report.backups.length));\n        $('results').className = report.total > 0 && !report.failed.length ? 'ok' : '';\n        $('results').textContent = lines.join('\\n');\n        await scan();\n      }\n\n      // ---------------------------------------------------------------- books\n\n      let bookChoice = null;\n      function openBooks() {\n        bookChoice = new Map(state.books.map((b) => [b.code, b.chosen]));\n        const quick = $('bookQuick');\n        quick.innerHTML = '';\n        const groups = [\n          [S.booksAll, () => true],\n          [S.booksNone, () => false],\n          [S.booksBible, (b) => !isOther(b.code)],\n          [S.booksOT, (b) => b.num <= OT_END],\n          [S.booksNT, (b) => b.num > OT_END && b.num <= NT_END],\n          [S.booksDC, (b) => b.num > NT_END && !isOther(b.code)],\n          [S.booksOther, (b) => isOther(b.code)],\n        ];\n        groups.forEach(([label, test]) => {\n          const btn = document.createElement('button');\n          btn.type = 'button';\n          btn.textContent = label;\n          btn.addEventListener('click', () => {\n            state.books.forEach((b) => bookChoice.set(b.code, test(b)));\n            drawBooks();\n          });\n          quick.appendChild(btn);\n        });\n        drawBooks();\n        $('booksError').textContent = '';\n        $('booksOverlay').classList.add('show');\n      }\n\n      const OTHER = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');\n      function isOther(code) {\n        return OTHER.indexOf(code) >= 0;\n      }\n\n      function drawBooks() {\n        const grid = $('bookGrid');\n        grid.innerHTML = '';\n        state.books.forEach((b) => {\n          const label = document.createElement('label');\n          const box = document.createElement('input');\n          box.type = 'checkbox';\n          box.checked = !!bookChoice.get(b.code);\n          box.addEventListener('change', () => bookChoice.set(b.code, box.checked));\n          label.appendChild(box);\n          label.appendChild(document.createTextNode(' ' + b.code));\n          grid.appendChild(label);\n        });\n      }\n\n      async function booksOk() {\n        const chosen = state.books.filter((b) => bookChoice.get(b.code));\n        if (chosen.length === 0) {\n          $('booksError').textContent = S.booksNoneChosen;\n          return;\n        }\n        $('booksOverlay').classList.remove('show');\n        const excluded = state.books.filter((b) => !bookChoice.get(b.code)).map((b) => b.code);\n        await saveOptions(Object.assign({}, state.options, { excludedBooks: excluded.join(' ') }));\n      }\n\n      // ---------------------------------------------------------------- events\n\n      $('rescanBtn').addEventListener('click', scan);\n      $('optionsBtn').addEventListener('click', () => {\n        optionsOpen = !optionsOpen;\n        $('optionsPanel').classList.toggle('hidden', !optionsOpen);\n        $('optionsBtn').textContent = optionsOpen ? S.optionsHide : S.optionsShow;\n      });\n      $('saveOptionsBtn').addEventListener('click', () => saveOptions(readOptions()));\n      $('defaultsBtn').addEventListener('click', () => saveOptions({ excludedBooks: null }));\n      $('kindFilter').addEventListener('change', renderRows);\n      $('markerFilter').addEventListener('change', renderRows);\n      $('showByHand').addEventListener('change', () => {\n        fillFilters();\n        renderRows();\n      });\n      $('tickBtn').addEventListener('click', () => {\n        shownRows()\n          .slice(0, MAX_ROWS)\n          .filter(canFixRow)\n          .forEach((r) => ticked.add(r.id));\n        renderRows();\n      });\n      $('untickBtn').addEventListener('click', () => {\n        shownRows().forEach((r) => ticked.delete(r.id));\n        renderRows();\n      });\n      $('fixBtn').addEventListener('click', askFix);\n      $('confirmYes').addEventListener('click', doFix);\n      $('confirmNo').addEventListener('click', () => $('confirmOverlay').classList.remove('show'));\n      $('booksBtn').addEventListener('click', openBooks);\n      $('booksOk').addEventListener('click', booksOk);\n      $('booksCancel').addEventListener('click', () => $('booksOverlay').classList.remove('show'));\n\n      setText();\n      $('booksBtn').textContent = fmt(S.booksButton, '-', '-');\n      scan();\n    </script>\n  </body>\n</html>\n";
const MS_USFM_STY = "# Version=3.0.11\n# ********************************************************************\n# * usfm.sty is the default stylesheet for Paratext projects         *\n# *   using USFM markup.                                             *\n# * Latest documentation and stylesheets are maintained at:          *\n# *   http://markups.paratext.org/usfm                               *\n# ********************************************************************\n\n# File Identification\n\n\\Marker id\n\\Name id - File - Identification\n\\Description File identification information (BOOKID, FILENAME, EDITOR, MODIFICATION DATE)\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular book\n\\FontSize 12\n\n\\Marker usfm\n\\Name usfm - File - USFM Version ID\n\\Description File markup version information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n\\Marker ide\n\\Name ide - File - Encoding\n\\Description File encoding information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n# Headers\n\n\\Marker h\n\\Name h - File - Header\n\\Description Running header text for a book (basic)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h1\n\\Name DEPRECATED h1 - File - Header\n\\Description Running header text\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h2\n\\Name DEPRECATED h2 - File - Left Header\n\\Description Running header text, left side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h3\n\\Name DEPRECATED h3 - File - Right Header\n\\Description Running header text, right side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker toc1\n\\Name toc1 - File - Long Table of Contents Text\n\\Description Long table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Bold\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc2\n\\Name toc2 - File - Short Table of Contents Text\n\\Description Short table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc3\n\\Name toc3 - File - Book Abbreviation\n\\Description Book Abbreviation\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Italic\n\\Color 128\n#!\\ColorName lowcon red\n\n\\Marker toca1\n\\Name toca1 - File - Alternative Language Long Table of Contents Text\n\\Description Alternative language long table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca2\n\\Name toca2 - File - Alternative Language Short Table of Contents Text\n\\Description Alternative language short table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca3\n\\Name toca3 - File - Alternative Language Book Abbreviation\n\\Description Alternative language book Abbreviation\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n# Remarks and Comments\n\n\\Marker rem\n\\Name rem - File - Remark\n\\Description Comments and remarks\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker sts\n\\Name sts - File - Status\n\\Description Status of this file\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker restore\n\\Name restore - File - Restore Information\n\\Description Project restore information\n\\OccursUnder id\n\\Rank 99\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Introduction\n\n\\Marker imt\n\\Name imt - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt1\n\\Name imt1 - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt2\n\\Name imt2 - Introduction - Major Title Level 2\n\\Description Introduction major title, level 2\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType other\n\\StyleType Paragraph\n\\FontSize 13\n\\Italic\n\\Justification Center\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker imt3\n\\Name imt3 - Introduction - Major Title Level 3\n\\Description Introduction major title, level 3\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker imt4\n\\Name imt4 - Introduction - Major Title Level 4\n\\Description Introduction major title, level 4 (usually within parenthesis)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n \n\\Marker imte\n\\Name imte - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte1\n\\Name imte1 - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte2\n\\Name imte2 - Introduction - [Uncommon] Major Title at Introduction End Level 2\n\\Description Introduction major title at introduction end, level 2\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2 \n\n\\Marker is\n\\Name is - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is1 \n\\Name is1 - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is2\n\\Name is2 - Introduction - Section Heading Level 2\n\\Description Introduction section heading, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker iot \n\\Name iot - Introduction - Outline Title\n\\Description Introduction outline title (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker io\n\\Name io - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io1\n\\Name io1 - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io2\n\\Name io2 - Introduction - Outline Level 2\n\\Description Introduction outline text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\n\\Marker io3\n\\Name io3 - Introduction - Outline Level 3\n\\Description Introduction outline text, level 3 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\n\\Marker io4\n\\Name io4 - Introduction - Outline Level 4\n\\Description Introduction outline text, level 4 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\n\\Marker ior\n\\Endmarker ior*\n\\Name ior...ior* - Introduction - Outline References Range\n\\Description Introduction references range for outline entry; for marking references separately\n\\OccursUnder id io io1 io2 io3 io4 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ip\n\\Name ip - Introduction - Paragraph\n\\Description Introduction prose paragraph (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker im\n\\Name im - Introduction - Paragraph - no first line indent\n\\Description Introduction prose paragraph, with no first line indent (may occur after poetry)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker ipi\n\\Name ipi - Introduction - Indented Para - first line indent\n\\Description Introduction prose paragraph, indented, with first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker imi\n\\Name imi - Introduction - Indented Para - no first line indent\n\\Description Introduction prose paragraph text, indented, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker ili\n\\Name ili - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili1\n\\Name ili1 - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili2\n\\Name ili2 - Introduction - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker ipq\n\\Name ipq - Introduction - Paragraph - quote from text\n\\Description Introduction prose paragraph, quote from the body text\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\Italic\n\n\\Marker imq\n\\Name imq - Introduction - Paragraph - quote from text - no first line indent\n\\Description Introduction prose paragraph, quote from the body text, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Italic\n\n\\Marker ipr\n\\Name ipr - Introduction - Paragraph - right aligned\n\\Description Introduction prose paragraph, right aligned\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Justification Right\n\\Italic\n\n\\Marker ib\n\\Name ib - Introduction - Blank Line\n\\Description Introduction blank line\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker iq\n\\Name iq - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq1\n\\Name iq1 - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq2\n\\Name iq2 - Introduction - Poetry Level 2\n\\Description Introduction poetry text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq3\n\\Name iq3 - Introduction - Poetry Level 3\n\\Description Introduction poetry text, level 3\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iex\n\\Name iex - Introduction - Explanatory or Bridge Text\n\\Description Introduction explanatory or bridge text (e.g. explanation of missing book in Short Old Testament)\n\\OccursUnder id c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker iqt\n\\Endmarker iqt*\n\\Name iqt...iqt* - Special Text - Quoted Scripture Text in Introduction\n\\Description For quoted scripture text appearing in the introduction\n\\OccursUnder imt imt1 imt2 imt3 imt4 ib ie ili ili1 ili2 im imi imq io io1 io2 io3 io4 iot ip ipi ipq ipr iq iq1 iq2 iq3 is is1 is2 imte imte1 imte2 iex\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ie\n\\Name ie - Introduction - End Marker\n\\Description Introduction ending marker\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n# Chapters and Verses\n\n\\Marker c\n\\Name c - Chapter Number\n\\Description Chapter number (necessary for normal Paratext operation)\n\\OccursUnder id\n\\Rank 8\n\\TextType ChapterNumber\n\\TextProperties chapter\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker ca\n\\Endmarker ca*\n\\Name ca...ca* - Chapter Number - Alternate\n\\Description Second (alternate) chapter number (for coding dual versification; useful for places where different traditions of chapter breaks need to be supported in the same translation)\n\\OccursUnder c \n\\TextType Other\n\\StyleType Character\n\\Italic\n\\FontSize 16\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker cp\n\\Name cp - Chapter Number - Publishing Alternate\n\\Description Published chapter number (chapter string that should appear in the published text)\n\\OccursUnder c \n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker cl\n\\Name cl - Chapter - Publishing Label\n\\Description Chapter label used for translations that add a word such as \"Chapter\" before chapter numbers (e.g. Psalms). The subsequent text is the chapter label.\n\\OccursUnder id c ms ms1 ms2 ms3 mr\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Justification Center\n\n\\Marker cd\n\\Name cd - Chapter - Description\n\\Description Chapter Description (Publishing option D, e.g. in Russian Bibles)\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 11\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker v\n\\Name v - Verse Number\n\\Description A verse number (Necessary for normal paratext operation) (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType VerseNumber\n\\TextProperties verse\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker va\n\\Endmarker va*\n\\Name va...va* - Verse Number - Alternate\n\\Description Second (alternate) verse number (for coding dual numeration in Psalms; see also NRSV Exo 22.1-4)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker vp\n\\Endmarker vp*\n\\Name vp...vp* - Verse Number - Publishing Alternate\n\\Description Published verse marker (verse string that should appear in the published text)\n\\OccursUnder cd lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Paragraphs\n\n\\Marker p\n\\Name p - Paragraph - Normal - First Line Indent\n\\Description Paragraph text, with first line indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker m\n\\Name m - Paragraph - Margin - No First Line Indent\n\\Description Paragraph text, with no first line indent (may occur after poetry) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker po\n\\Name po - Paragraph - Letter Opening\n\\Description Letter opening\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker pr\n\\Name pr - Paragraph - Text Refrain (right aligned)\n\\Description Text refrain (paragraph text, right aligned)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\n\\Marker cls\n\\Name cls - Paragraph - Letter Closing\n\\Description Letter Closing\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker pmo\n\\Name pmo - Paragraph - Embedded Text Opening\n\\Description Embedded text opening\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pm\n\\Name pm - Paragraph - Embedded Text\n\\Description Embedded text paragraph\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po psi q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmc\n\\Name pmc - Paragraph - Embedded Text Closing\n\\Description Embedded text closing\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmr\n\\Name pmr - Paragraph - Embedded Text Refrain\n\\Description Embedded text refrain (e.g. Then all the people shall say, \"Amen!\")\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi\n\\Name pi - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if single level), with first line indent; often used for discourse (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi1\n\\Name pi1 - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if multiple levels), with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi2\n\\Name pi2 - Paragraph - Indented - Level 2 - First Line Indent\n\\Description Paragraph text, level 2 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .5\n\\RightMargin .25\n\n\\Marker pi3\n\\Name pi3 - Paragraph - Indented - Level 3 - First Line Indent\n\\Description Paragraph text, level 3 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .75\n\\RightMargin .25\n\n\\Marker pc\n\\Name pc - Paragraph - Centered (for Inscription)\n\\Description Paragraph text, centered (for Inscription)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Center\n\\FontSize 12\n\n\\Marker mi\n\\Name mi - Paragraph - Indented - No First Line Indent\n\\Description Paragraph text, indented, with no first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker nb\n\\Name nb - Paragraph - No Break with Previous Paragraph\n\\Description Paragraph text, with no break from previous paragraph text (at chapter boundary) (basic)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n# Poetry\n\n\\Marker q\n\\Name q - Poetry - Indent Level 1 - Single Level Only\n\\Description Poetry text, level 1 indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q1\n\\Name q1 - Poetry - Indent Level 1\n\\Description Poetry text, level 1 indent (if multiple levels) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q2\n\\Name q2 - Poetry - Indent Level 2\n\\Description Poetry text, level 2 indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.375  # 1/4 inch indent, 3/4 inch wrap\n\n\\Marker q3\n\\Name q3 - Poetry - Indent Level 3\n\\Description Poetry text, level 3 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.25 # 3/8 inch indent, 3/4 inch wrap\n\n\\Marker q4\n\\Name q4 - Poetry - Indent Level 4\n\\Description Poetry text, level 4 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.125 # 1/2 inch indent, 3/4 inch wrap\n\n\\Marker qc\n\\Name qc - Poetry - Centered\n\\Description Poetry text, centered\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\n\\Marker qr\n\\Name qr - Poetry - Right Aligned\n\\Description Poetry text, Right Aligned\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker qs\n\\Endmarker qs*\n\\Name qs...qs* - Poetry Text - Selah\n\\Description Poetry text, Selah\n\\OccursUnder q q1 q2 q3 q4 qc qr qd NEST\n\\Rank 4\n\\TextType VerseText\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qa\n\\Name qa - Poetry - Acrostic Heading/Marker\n\\Description Poetry text, Acrostic marker/heading\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\n\\Marker qac\n\\Endmarker qac*\n\\Name qac...qac* - Poetry Text - Acrostic Letter\n\\Description Poetry text, Acrostic markup of the first character of a line of acrostic poetry\n\\OccursUnder q q1 q2 q3 q4 qc qr  NEST\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qm\n\\Name qm - Poetry - Embedded Text - Indent Level 1 - Single Level Only\n\\Description Poetry text, embedded, level 1 indent (if single level)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm1\n\\Name qm1 - Poetry - Embedded Text - Indent Level 1\n\\Description Poetry text, embedded, level 1 indent (if multiple levels)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm2\n\\Name qm2 - Poetry - Embedded Text - Indent Level 2\n\\Description Poetry text, embedded, level 2 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\n\\Marker qm3\n\\Name qm3 - Poetry - Embedded Text - Indent Level 3\n\\Description Poetry text, embedded, level 3 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\n\\Marker qd\n\\Name qd - Poetry - Hebrew Note\n\\Description A Hebrew musical performance annotation, similar in content to Hebrew descriptive title.\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\LeftMargin .25\n\n\\Marker b\n\\Name b - Poetry - Stanza Break (Blank Line)\n\\Description Poetry text stanza break (e.g. stanza break) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n# Titles & Headings\n\n\\Marker mt\n\\Name mt - Title - Major Title Level 1\n\\Description The main title of the book (if single level)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mt1\n\\Name mt1 - Title - Major Title Level 1\n\\Description The main title of the book (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 4\n\n\\Marker mt2\n\\Name mt2 - Title - Major Title Level 2\n\\Description A secondary title usually occurring before the main title (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker mt3\n\\Name mt3 - Title - Major Title Level 3\n\\Description A secondary title occurring after the main title\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mt4\n\\Name mt4 - Title - Major Title level 4\n\\Description A small secondary title sometimes occurring within parentheses\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mte\n\\Name mte - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder c\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mte1\n\\Name mte1 - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tc1 tc2 tc3 tc4 s3 d\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n \n\\Marker mte2\n\\Name mte2 - Title - [Uncommon] Major Title Ending Level 2\n\\Description A secondary title occurring before or after the 'ending' main title\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\OccursUnder mte1\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker ms\n\\Name ms - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms1\n\\Name ms1 - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms2\n\\Name ms2 - Heading - Major Section Level 2\n\\Description A major section division heading, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms3\n\\Name ms3 - Heading - Major Section Level 3\n\\Description A major section division heading, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Italic\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker mr\n\\Name mr - Heading - Major Section Range References\n\\Description A major section division references range heading (basic)\n\\OccursUnder ms ms1 ms2 ms3\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker s\n\\Name s - Heading - Section Level 1\n\\Description A section heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s1\n\\Name s1 - Heading - Section Level 1\n\\Description A section heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s2\n\\Name s2 - Heading - Section Level 2\n\\Description A section heading, level 2 (e.g. Proverbs 22-24)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s3\n\\Name s3 - Heading - Section Level 3\n\\Description A section heading, level 3 (e.g. Genesis \"The First Day\")\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker s4\n\\Name s4 - Heading - Section Level 4\n\\Description A section heading, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker sr\n\\Name sr - Heading - Section Range References\n\\Description A section division references range heading\n\\OccursUnder s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker r\n\\Name r - Heading - Parallel References\n\\Description Parallel reference(s) (basic)\n\\OccursUnder c s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker sp\n\\Name sp - Label - Speaker\n\\Description A heading, to identify the speaker (e.g. Job)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker d\n\\Name d - Label - Descriptive Title - Hebrew Subtitle\n\\Description A Hebrew text heading, to provide description (e.g. Psalms)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker sd\n\\Name sd - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd1\n\\Name sd1 - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd2\n\\Name sd2 - Label - Semantic Division Location - Level 2\n\\Description Vertical space used to divide the text into sections, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\SpaceBefore 18\n\\SpaceAfter 18\n\n\\Marker sd3\n\\Name sd3 - Label - Semantic Division Location - Level 3\n\\Description Vertical space used to divide the text into sections, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\SpaceBefore 12\n\\SpaceAfter 12\n\n\\Marker sd4\n\\Name sd4 - Label - Semantic Division Location - Level 4\n\\Description Vertical space used to divide the text into sections, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\SpaceBefore 8\n\\SpaceAfter 8\n\n# Tables\n\n\\Marker tr\n\\Name tr - Table - Row\n\\Description A new table row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker th1 \n\\Name th1 - Table - Column 1 Heading\n\\Description A table heading, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th2\n\\Name th2 - Table - Column 2 Heading\n\\Description A table heading, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th3\n\\Name th3 - Table - Column 3 Heading\n\\Description A table heading, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th4\n\\Name th4 - Table - Column 4 Heading\n\\Description A table heading, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th5\n\\Name th5 - Table - Column 5 Heading\n\\Description A table heading, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th6\n\\Name th6 - Table - Column 6 Heading\n\\Description A table heading, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th7\n\\Name th7 - Table - Column 7 Heading\n\\Description A table heading, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th8\n\\Name th8 - Table - Column 8 Heading\n\\Description A table heading, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th9\n\\Name th9 - Table - Column 9 Heading\n\\Description A table heading, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th10\n\\Name th10 - Table - Column 10 Heading\n\\Description A table heading, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th11\n\\Name th11 - Table - Column 11 Heading\n\\Description A table heading, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th12\n\\Name th12 - Table - Column 12 Heading\n\\Description A table heading, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker tc1\n\\Name tc1 - Table - Column 1 Cell\n\\Description A table cell item, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc2\n\\Name tc2 - Table - Column 2 Cell\n\\Description A table cell item, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc3\n\\Name tc3 - Table - Column 3 Cell\n\\Description A table cell item, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc4\n\\Name tc4 - Table - Column 4 Cell\n\\Description A table cell item, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc5\n\\Name tc5 - Table - Column 5 Cell\n\\Description A table cell item, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc6\n\\Name tc6 - Table - Column 6 Cell\n\\Description A table cell item, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc7\n\\Name tc7 - Table - Column 7 Cell\n\\Description A table cell item, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc8\n\\Name tc8 - Table - Column 8 Cell\n\\Description A table cell item, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc9\n\\Name tc9 - Table - Column 9 Cell\n\\Description A table cell item, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc10\n\\Name tc10 - Table - Column 10 Cell\n\\Description A table cell item, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc11\n\\Name tc11 - Table - Column 11 Cell\n\\Description A table cell item, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc12\n\\Name tc12 - Table - Column 12 Cell\n\\Description A table cell item, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Center Aligned Table Heads and Columns\n\n\\Marker thc1 \n\\Name thc1 - Table - Column 1 Heading - Center Aligned\n\\Description A table heading, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc2\n\\Name thc2 - Table - Column 2 Heading - Center Aligned\n\\Description A table heading, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc3\n\\Name thc3 - Table - Column 3 Heading - Center Aligned\n\\Description A table heading, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc4\n\\Name thc4 - Table - Column 4 Heading - Center Aligned\n\\Description A table heading, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc5\n\\Name thc5 - Table - Column 5 Heading - Center Aligned\n\\Description A table heading, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc6\n\\Name thc6 - Table - Column 6 Heading - Center Aligned\n\\Description A table heading, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc7\n\\Name thc7 - Table - Column 7 Heading - Center Aligned\n\\Description A table heading, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc8\n\\Name thc8 - Table - Column 8 Heading - Center Aligned\n\\Description A table heading, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc9\n\\Name thc9 - Table - Column 9 Heading - Center Aligned\n\\Description A table heading, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc10\n\\Name thc10 - Table - Column 10 Heading - Center Aligned\n\\Description A table heading, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc11\n\\Name thc11 - Table - Column 11 Heading - Center Aligned\n\\Description A table heading, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc12\n\\Name thc12 - Table - Column 12 Heading - Center Aligned\n\\Description A table heading, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker tcc1\n\\Name tcc1 - Table - Column 1 Cell - Center Aligned\n\\Description A table cell item, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc2\n\\Name tcc2 - Table - Column 2 Cell - Center Aligned\n\\Description A table cell item, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc3\n\\Name tcc3 - Table - Column 3 Cell - Center Aligned\n\\Description A table cell item, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc4\n\\Name tcc4 - Table - Column 4 Cell - Center Aligned\n\\Description A table cell item, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc5\n\\Name tcc5 - Table - Column 5 Cell - Center Aligned\n\\Description A table cell item, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc6\n\\Name tcc6 - Table - Column 6 Cell - Center Aligned\n\\Description A table cell item, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc7\n\\Name tcc7 - Table - Column 7 Cell - Center Aligned\n\\Description A table cell item, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc8\n\\Name tcc8 - Table - Column 8 Cell - Center Aligned\n\\Description A table cell item, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc9\n\\Name tcc9 - Table - Column 9 Cell - Center Aligned\n\\Description A table cell item, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc10\n\\Name tcc10 - Table - Column 10 Cell - Center Aligned\n\\Description A table cell item, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc11\n\\Name tcc11 - Table - Column 11 Cell - Center Aligned\n\\Description A table cell item, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc12\n\\Name tcc12 - Table - Column 12 Cell - Center Aligned\n\\Description A table cell item, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n# Right Aligned Table Heads and Columns\n\n\\Marker thr1 \n\\Name thr1 - Table - Column 1 Heading - Right Aligned\n\\Description A table heading, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr2\n\\Name thr2 - Table - Column 2 Heading - Right Aligned\n\\Description A table heading, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr3\n\\Name thr3 - Table - Column 3 Heading - Right Aligned\n\\Description A table heading, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr4\n\\Name thr4 - Table - Column 4 Heading - Right Aligned\n\\Description A table heading, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr5\n\\Name thr5 - Table - Column 5 Heading - Right Aligned\n\\Description A table heading, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr6\n\\Name thr6 - Table - Column 6 Heading - Right Aligned\n\\Description A table heading, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr7\n\\Name thr7 - Table - Column 7 Heading - Right Aligned\n\\Description A table heading, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr8\n\\Name thr8 - Table - Column 8 Heading - Right Aligned\n\\Description A table heading, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr9\n\\Name thr9 - Table - Column 9 Heading - Right Aligned\n\\Description A table heading, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr10\n\\Name thr10 - Table - Column 10 Heading - Right Aligned\n\\Description A table heading, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr11\n\\Name thr11 - Table - Column 11 Heading - Right Aligned\n\\Description A table heading, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr12\n\\Name thr12 - Table - Column 12 Heading - Right Aligned\n\\Description A table heading, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker tcr1 \n\\Name tcr1 - Table - Column 1 Cell - Right Aligned\n\\Description A table cell item, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr2\n\\Name tcr2 - Table - Column 2 Cell - Right Aligned\n\\Description A table cell item, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr3\n\\Name tcr3 - Table - Column 3 Cell - Right Aligned\n\\Description A table cell item, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr4\n\\Name tcr4 - Table - Column 4 Cell - Right Aligned\n\\Description A table cell item, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr5\n\\Name tcr5 - Table - Column 5 Cell - Right Aligned\n\\Description A table cell item, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr6\n\\Name tcr6 - Table - Column 6 Cell - Right Aligned\n\\Description A table cell item, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr7\n\\Name tcr7 - Table - Column 7 Cell - Right Aligned\n\\Description A table cell item, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr8\n\\Name tcr8 - Table - Column 8 Cell - Right Aligned\n\\Description A table cell item, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr9\n\\Name tcr9 - Table - Column 9 Cell - Right Aligned\n\\Description A table cell item, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr10\n\\Name tcr10 - Table - Column 10 Cell - Right Aligned\n\\Description A table cell item, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr11\n\\Name tcr11 - Table - Column 11 Cell - Right Aligned\n\\Description A table cell item, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr12\n\\Name tcr12 - Table - Column 12 Cell - Right Aligned\n\\Description A table cell item, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n# Lists\n\n\\Marker lh\n\\Name lh - List Header\n\\Description List header (introductory remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker li\n\\Name li - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li1\n\\Name li1 - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li2\n\\Name li2 - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker li3\n\\Name li3 - List Entry - Level 3\n\\Description A list entry, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker li4\n\\Name li4 - List Entry - Level 4\n\\Description A list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lf\n\\Name lf - List Footer\n\\Description List footer (concluding remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker lim\n\\Name lim - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim1\n\\Name lim1 - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim2\n\\Name lim2 - Embedded List Entry - Level 2\n\\Description An embedded list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker lim3\n\\Name lim3 - Embedded List Item - Level 3\n\\Description An embedded list item, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lim4\n\\Name lim4 - Embedded List Entry - Level 4\n\\Description An embedded list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.5\n\\FirstLineIndent -.375\n\n\\Marker litl\n\\Endmarker litl*\n\\Name litl...litl* - List Entry - Total\n\\Description List entry total text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker lik\n\\Endmarker lik*\n\\Name lik...lik* - Structured List Entry - Key\n\\Description Structured list entry key text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker liv\n\\Endmarker liv*\n\\Name liv...liv* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if single value)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv1\n\\Endmarker liv1*\n\\Name liv1...liv1* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if multiple values)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv2\n\\Endmarker liv2*\n\\Name liv2...liv2* - Structured List Entry - Value 2\n\\Description Structured list entry value 2 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv3\n\\Endmarker liv3*\n\\Name liv3...liv3* - Structured List Entry - Value 3\n\\Description Structured list entry value 3 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv4\n\\Endmarker liv4*\n\\Name liv4...liv4* - Structured List Entry - Value 4\n\\Description Structured list entry value 4 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv5\n\\Endmarker liv5*\n\\Name liv5...liv5* - Structured List Entry - Value 5\n\\Description Structured list entry value 5 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Footnotes\n\n\\Marker f\n\\Endmarker f*\n\\Name f...f* - Footnote \n\\Description A Footnote text item (basic)\n\\OccursUnder c cp lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fe\n\\Endmarker fe*\n\\Name fe...fe* - Endnote\n\\Description An Endnote text item\n\\OccursUnder c lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fr\n\\Endmarker fr*\n\\Name fr - Footnote - Reference\n\\Description The origin reference for the footnote (basic)\n\\OccursUnder f fe\n\\TextType NoteText\n\\TextProperties publishable vernacular note\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker ft\n\\Endmarker ft*\n\\Name ft - Footnote - Text\n\\Description Footnote text, Protocanon (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fk\n\\Endmarker fk*\n\\Name fk - Footnote - Keyword\n\\Description A footnote keyword (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker fq\n\\Endmarker fq*\n\\Name fq - Footnote - Quotation or Alternate Rendering\n\\Description A footnote scripture quote or alternate rendering (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fqa\n\\Endmarker fqa*\n\\Name fqa - Footnote - Alternate Translation Rendering\n\\Description A footnote alternate rendering for a portion of scripture text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fl\n\\Endmarker fl*\n\\Name fl - Footnote - Label Text\n\\Description A footnote label text item, for marking or \"labelling\" the type or alternate translation being provided in the note.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker fw\n\\Endmarker fw*\n\\Name fw - Footnote - Witness List\n\\Description A footnote witness list, for distinguishing a list of sigla representing witnesses in critical editions.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fp\n\\Endmarker fp*\n\\Name fp - Footnote Paragraph Mark\n\\Description A Footnote additional paragraph marker\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fv\n\\Endmarker fv*\n\\Name fv...fv* - Footnote - Embedded Verse Number\n\\Description A verse number within the footnote text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker fdc\n\\Endmarker fdc*\n\\Name DEPRECATED fdc...fdc* - Footnote - DC text\n\\Description Footnote text, applies to Deuterocanon only\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fm\n\\Endmarker fm*\n\\Name fm - Footnote - Additional Caller to Previous Note\n\\Description An additional footnote marker location for a previous footnote \n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Cross References\n\n\\Marker x\n\\Endmarker x*\n\\Name x...x* - Cross Reference\n\\Description A list of cross references (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 s s1 s2 s3 d\n\\TextProperties publishable vernacular note crossreference\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker xo\n\\Endmarker xo*\n\\Name xo - Cross Reference - Origin Reference\n\\Description The cross reference origin reference (basic)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker xop\n\\Endmarker xop*\n\\Name xop - Cross Reference - Origin Reference Publishing Alternate\n\\Description Published cross reference origin reference (origin reference that should appear in the published text)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xt\n\\Endmarker xt*\n\\Name xt - Cross Reference - Target References\n\\Description The cross reference target reference(s), protocanon only (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x ef ex NEST\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?link-href\n\n\\Marker xta\n\\Endmarker xta*\n\\Name xta - Cross Reference - Target References Added Text\n\\Description Cross reference target references added text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xk\n\\Endmarker xk*\n\\Name xk - Cross Reference - Keyword\n\\Description A cross reference keyword\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xq\n\\Endmarker xq*\n\\Name xq - Cross Reference - Quotation\n\\Description A cross-reference quotation from the scripture text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xot\n\\Endmarker xot*\n\\Name xot...xot* - Cross Reference - OT Target Refs (optional)\n\\Description Cross-reference target reference(s), Old Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xnt\n\\Endmarker xnt*\n\\Name xnt...xnt* - Cross Reference - NT Target Refs (optional)\n\\Description Cross-reference target reference(s), New Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xdc\n\\Endmarker xdc*\n\\Name DEPRECATED xdc...xdc* - Cross Reference - DC Target Refs\n\\Description Cross-reference target reference(s), Deuterocanon only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker rq\n\\Endmarker rq*\n\\Name rq...rq* - Cross Reference - Inline Quotation References\n\\Description A cross-reference indicating the source text for the preceding quotation.\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 10\n\\Italic\n\n# Other Special Text\n\n\\Marker qt\n\\Endmarker qt*\n\\Name qt...qt* - Special Text - Quoted Text - OT in NT\n\\Description For Old Testament quoted text appearing in the New Testament (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker nd\n\\Endmarker nd*\n\\Name nd...nd* - Special Text - Name of Deity\n\\Description For name of deity (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker tl\n\\Endmarker tl*\n\\Name tl...tl* - Special Text - Transliterated Word\n\\Description For transliterated words\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable nonvernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker dc\n\\Endmarker dc*\n\\Name dc...dc* - Special Text - Deuterocanonical/LXX Additions\n\\Description Deuterocanonical/LXX additions or insertions in the Protocanonical text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\Italic\n\n\\Marker bk\n\\Endmarker bk*\n\\Name bk...bk* - Special Text - Quoted book title\n\\Description For the quoted name of a book\n\\OccursUnder imt imt1 imt2 imt3 imt4 imte imte1 imte2 is is1 is2 ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sig\n\\Endmarker sig*\n\\Name sig...sig* - Special Text - Author's Signature (Epistles)\n\\Description For the signature of the author of an Epistle\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker pn\n\\Endmarker pn*\n\\Name pn...pn* - Special Text - Proper Name\n\\Description For a proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Underline\n\n\\Marker png\n\\Endmarker png*\n\\Name png...png* - Special Text - Geographic Proper Name\n\\Description For a geographic proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker addpn\n\\Endmarker addpn*\n\\Name DEPRECATED addpn...addpn* - Special Text for Chinese\n\\Description For chinese words to be dot underline & underline\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\\Underline\n\n\\Marker wj\n\\Endmarker wj*\n\\Name wj...wj* - Special Text - Words of Jesus\n\\Description For marking the words of Jesus\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Color 255\n#!\\ColorName highcon red\n\n\\Marker k\n\\Endmarker k*\n\\Name k...k* - Special Text - Keyword\n\\Description For a keyword\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker sls\n\\Endmarker sls*\n\\Name sls...sls* - Special Text - Secondary Language or Text Source\n\\Description To represent where the original text is in a secondary language or from an alternate text source\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ord\n\\Endmarker ord*\n\\Name ord...ord* - Special Text - Ordinal number text portion\n\\Description For the text portion of an ordinal number\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker add\n\\Endmarker add*\n\\Name add...add* - Special Text - Translational Addition\n\\Description For a translational addition to the text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\n\\Marker lit\n\\Name lit - Special Text - Liturgical note\n\\Description For a comment or note inserted for liturgical use\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\\Bold\n\n# Character Styling\n\n\\Marker no\n\\Endmarker no*\n\\Name no...no* - Character - Normal Text\n\\Description A character style, use normal text\n\\OccursUnder is ip ipi im imi ili ili1 ili2 imq ipq iex iq iot io1 io2 io3 io4 s s1 s2 s3 NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker it\n\\Endmarker it*\n\\Name it...it* - Character - Italic Text\n\\Description A character style, use italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker bd\n\\Endmarker bd*\n\\Name bd...bd* - Character - Bold Text\n\\Description A character style, use bold text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker bdit\n\\Endmarker bdit*\n\\Name bdit...bdit* - Character - BoldItalic Text\n\\Description A character style, use bold + italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker em\n\\Endmarker em*\n\\Name em...em* - Character - Emphasized Text\n\\Description A character style, use emphasized text style\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sc\n\\Endmarker sc*\n\\Name sc...sc* - Character - Small Caps\n\\Description A character style, for small capitalization text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Smallcaps\n\n\\Marker sup\n\\Endmarker sup*\n\\Name sup...sup* - Character - Superscript\n\\Description A character style, for superscript text. Typically for use in critical edition footnotes.\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Breaks\n\n\\Marker pb\n\\Name pb - Break - Page Break\n\\Description Page Break used for new reader portions and children's bibles where content is controlled by the page\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable\n\\StyleType Paragraph\n\\FontSize 12\n\n# Special Features\n\n\\Marker fig\n\\Endmarker fig*\n\\Name fig...fig* - Auxiliary - Figure/Illustration/Map\n\\Description Illustration [Columns to span, height, filename, caption text]\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes src size ref ?alt ?loc ?copy\n\n\\Marker jmp\n\\Endmarker jmp*\n\\Name jmp...jmp* - Link text\n\\Description For associating linking attributes to a span of text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType Other\n\\StyleType Character\n\\Color 16711680\n#!\\ColorName highcon blue\n\\Underline\n#!\\Attributes ?link-href ?link-id ?link-title\n\n\\Marker pro\n\\Endmarker pro*\n\\Name DEPRECATED pro...pro* - Special Text - CJK Pronunciation\n\\Description For indicating pronunciation in CJK texts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType Other\n\\TextProperties Nonpublishable\n\\StyleType Character\n\\FontSize 10\n\n\\Marker rb\n\\Endmarker rb*\n\\Name rb...rb* - Special Text - Ruby Glossing\n\\Description Most often used to provide a reading / pronunciation guide in ideographic scripts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#!\\Attributes gloss\n\n# Peripheral References\n\n\\Marker w\n\\Endmarker w*\n\\Name w...w* - Peripheral Ref - Wordlist Entry\n\\Description A wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?lemma ?strong ?srcloc\n\n\\Marker wh\n\\Endmarker wh*\n\\Name wh...wh* - Peripheral Ref - Hebrew Wordlist Entry\n\\Description A Hebrew wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wg\n\\Endmarker wg*\n\\Name wg...wg* - Peripheral Ref - Greek Wordlist Entry\n\\Description A Greek Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wa\n\\Endmarker wa*\n\\Name wa...wa* - Peripheral Ref - Aramaic Wordlist Entry\n\\Description An Aramaic Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ndx\n\\Endmarker ndx*\n\\Name ndx...ndx* - Peripheral Ref - Subject Index Entry \n\\Description A subject index text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Peripheral Materials\n# Content Division Marker\n\n\\Marker periph\n\\Name periph - Peripherals - Content Division Marker\n\\Description Peripheral content division marker which should be followed by an additional division argument/title.\n\\TextType Section\n\\TextProperties paragraph nonpublishable vernacular\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\SpaceBefore 16\n\\SpaceAfter 4\n\\Color 33023\n#!\\ColorName orange\n\n# Additional peripheral material extensions to existing USFM markup.\n\n\\Marker p1\n\\Name p1 - Periph - Front/Back Matter Paragraph Level 1\n\\Description Front or back matter text paragraph, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker p2\n\\Name p2 - Periph - Front/Back Matter Paragraph Level 2\n\\Description Front or back matter text paragraph, level 2 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/4 inch first line indent\n\\LeftMargin .125\n\n\\Marker k1\n\\Name k1 - Periph - Concordance Keyword Level 1\n\\Description Concordance main entry text or keyword, level 1\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker k2\n\\Name k2 - Periph - Concordance Keyword Level 2\n\\Description Concordance main entry text or keyword, level 2\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker xtSee\n\\Endmarker xtSee*\n\\Name xtSee - Concordance and Names Index - Alternate Entry Target Reference\n\\Description Concordance and Names Index markup for an alternate entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker xtSeeAlso\n\\Endmarker xtSeeAlso*\n\\Name xtSeeAlso - Concordance and Names Index - Additional Entry Target Reference\n\\Description Concordance and Names Index markup for an additional entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Milestones - these are not compatible with USFM2, so whole entries are preceded with #!\n\n#!\\Marker qt-s\n#!\\Endmarker qt-e\n#!\\Name Quotation start/end milestone\n#!\\Description Quotation start/end milestone, level 1 (if single level)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt1-s\n#!\\Endmarker qt1-e\n#!\\Name Quotation start/end milestone - Level 1\n#!\\Description Quotation start/end milestone, level 1 (if multiple levels)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt2-s\n#!\\Endmarker qt2-e\n#!\\Name Quotation start/end milestone - Level 2\n#!\\Description Quotation start/end milestone, level 2\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt3-s\n#!\\Endmarker qt3-e\n#!\\Name Quotation start/end milestone - Level 3\n#!\\Description Quotation start/end milestone, level 3\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt4-s\n#!\\Endmarker qt4-e\n#!\\Name Quotation start/end milestone - Level 4\n#!\\Description Quotation start/end milestone, level 4\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt5-s\n#!\\Endmarker qt5-e\n#!\\Name Quotation start/end milestone - Level 5\n#!\\Description Quotation start/end milestone, level 5\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker ts-s\n#!\\Endmarker ts-e\n#!\\Name Translator's section start/end milestone\n#!\\Description Translator's section start/end milestone\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?sid ?eid\n\n# Other special text elements specified in USFM\n#   ~ = fixed (no-break) space\n#   // = discretionary line break\n\n# Obsolete, deprecated, or no longer officially part of USFM.\n# These markers may have existed in earlier resource and stylesheet revisions.\n\n\\Marker ph\n\\Name DEPRECATED ph - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph1\n\\Name DEPRECATED ph1 - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph2\n\\Name DEPRECATED ph2 - Paragraph - Hanging Indent - Level 2\n\\Description Paragraph text, with level 2 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 1/2 inch indent, 3/4 inch wrap\n\\FontSize 12\n\n\\Marker ph3\n\\Name DEPRECATED ph3 - Paragraph - Hanging Indent - Level 3\n\\Description Paragraph text, with level 3 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\\FirstLineIndent -.25  # 3/4 inch indent, 1 inch wrap\n\\FontSize 12\n\n\\Marker phi\n\\Name DEPRECATED phi - Paragraph - Indented - Hanging Indent\n\\Description Paragraph text, indented with hanging indent\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\n\\Marker tr1\n\\Name DEPRECATED tr1 - Table - Row - Level 1\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker tr2\n\\Name DEPRECATED tr2 - Table - Row - Level 2\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker ps\n\\Name DEPRECATED ps - Paragraph - No Break with Next Paragraph\n\\Description Paragraph text, no break with next paragraph text at chapter boundary\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker psi\n\\Name DEPRECATED psi - Paragraph - Indented - No Break with Next\n\\Description Paragraph text, indented, with no break with next paragraph text (at chapter boundary)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\\FontSize 12\n\n\\Marker fs\n\\Endmarker fs*\n\\Name DEPRECATED fs - Footnote - Footnote Summary\n\\Description A summary text for the concept/idea/quotation from the scripture translation for which the note is being provided.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker wr\n\\Endmarker wr*\n\\Name DEPRECATED wr...wr* - Auxiliary - Wordlist/Glossary Reference \n\\Description A Wordlist text item\n\\OccursUnder ms s lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr qd tc1 tc2 tc3 tc4 f fe NEST\n\\TextProperties publishable vernacular\n\\TextType VerseText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n# 2.0x peripheral markup (replaced with \\periph + Content Division Title/Argument)\n\n\\Marker pub\n\\Name DEPRECATED pub Peripherals - Front Matter Publication Data\n\\Description Front matter publication data\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker toc\n\\Name DEPRECATED toc Peripherals - Front Matter Table of Contents\n\\Description Front matter table of contents\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pref\n\\Name DEPRECATED pref Peripherals - Front Matter Preface\n\\Description Front matter preface\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker intro\n\\Name DEPRECATED intro Peripherals - Front Matter Introduction\n\\Description Front matter introduction\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker conc\n\\Name DEPRECATED conc Peripherals - Back Matter Concordance\n\\Description Back matter concordance\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker glo\n\\Name DEPRECATED glo Peripherals - Back Matter Glossary\n\\Description Back matter glossary\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker idx\n\\Name DEPRECATED idx Peripherals - Back Matter Index\n\\Description Back matter index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker maps\n\\Name DEPRECATED maps Peripherals - Back Matter Map Index\n\\Description Back matter map index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker cov\n\\Name DEPRECATED cov Peripherals - Other - Cover\n\\Description Other peripheral materials - cover\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker spine\n\\Name DEPRECATED spine Peripherals - Other - Spine\n\\Description Other peripheral materials - spine\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pubinfo\n\\Name DEPRECATED pubinfo - Publication - Information\n\\Description Publication information - Lang,Credit,Version,Copies,Publisher,Id,Logo\n\\OccursUnder id ide\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Concordance/Names Index Tools - special sfms for use in Publishing Assistant\n\n\\Marker zpa-xb\n\\Endmarker zpa-xb*\n\\Name zpa-xb - Periph - Book\n\\Description Book Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-xc\n\\Endmarker zpa-xc*\n\\Name zpa-xc - Periph - Chapter\n\\Description Chapter Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker zpa-xv\n\\Endmarker zpa-xv*\n\\Name zpa-xv - Periph - Verse\n\\Description Verse Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-d\n\\Endmarker zpa-d*\n\\Name zpa-d - Periph - Description\n\\Description Description\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n";
// Marker Spaces backend (Marker_Spaces/extension/src/main.js), in its own scope.
const MarkerSpaces = (function () {
// Marker Spaces for Paratext 10: the backend (runs in the extension host).
//
// tools/build.js makes dist/markerSpaces/src/main.js from: src/core.js (the scanner, MSCore), then
// the web view HTML and the built-in usfm.sty as string constants, then this file. Extensions may
// only require papi modules (no relative files, no fs, no eval), hence the single file.
//
// It adds:
//  - a check "Marker spaces" to Paratext 10's Checks panel (platformScripture.registerCheck);
//  - Tools > Marker Spaces... in the Scripture editor, which opens a window listing the problems,
//    where the ticked ones are fixed (book USFM read and written through platformScripture.USFM_Book).
/* global MSCore, MS_WEB_VIEW_HTML, MS_USFM_STY, MS_VERSION */
const papi = require('@papi/backend');

const { logger } = papi;
const WEB_VIEW_TYPE = 'markerSpaces.window';
const CHECK_ID_HINT = 'markerSpaces';

let executionToken;
/** The last scan of each project: issues (with their chapter text) and the book texts read. */
const sessions = new Map();
let builtInSty;

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
    logger.warn(`Marker Spaces: could not read the interface language: ${e}`);
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

/** Book numbers present in the project (setting platformScripture.booksPresent, "0101..."). */
async function booksPresent(projectId) {
  const base = await papi.projectDataProviders.get('platform.base', projectId);
  const present = String((await base.getSetting('platformScripture.booksPresent')) || '');
  const books = [];
  for (let i = 0; i < present.length && i < MSCore.BOOK_ORDER.length; i++)
    if (present[i] === '1') books.push({ num: i + 1, code: MSCore.bookCode(i + 1) });
  return books;
}

/** The stylesheet table for a book: Paratext's merged StyleInfo, or the built-in usfm.sty. */
async function styleTable(projectId, bookNum, cache) {
  if (cache && cache.has(bookNum)) return cache.get(bookNum);
  let sty;
  try {
    const pdp = await papi.projectDataProviders.get('platformScripture.StyleInfo', projectId);
    const info = await pdp.getStyleInfo(bookNum);
    if (info && info.markers && Object.keys(info.markers).length > 0) sty = MSCore.styFromStyleInfo(info);
  } catch (e) {
    logger.warn(`Marker Spaces: StyleInfo not available (${e}); using the built-in usfm.sty`);
  }
  if (!sty) {
    if (!builtInSty) builtInSty = MSCore.parseSty(MS_USFM_STY);
    sty = builtInSty;
  }
  if (cache) cache.set(bookNum, sty);
  return sty;
}

async function readBook(projectId, code) {
  const pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
  return pdp.getBookUSFM(verseRef(code, 1, 1));
}

// ------------------------------------------------------------ options (per project, user storage)

async function loadOptions(projectId) {
  const o = Object.assign({}, MSCore.DEFAULT_OPTIONS);
  try {
    const saved = JSON.parse(await papi.storage.readUserData(executionToken, `options:${projectId}`));
    Object.keys(o).forEach((k) => {
      if (saved && saved[k] !== undefined) o[k] = saved[k];
    });
  } catch (e) {
    // nothing saved yet
  }
  return o;
}

async function saveOptions(projectId, options) {
  const o = {};
  Object.keys(MSCore.DEFAULT_OPTIONS).forEach((k) => {
    o[k] = options && options[k] !== undefined ? options[k] : MSCore.DEFAULT_OPTIONS[k];
  });
  await papi.storage.writeUserData(executionToken, `options:${projectId}`, JSON.stringify(o));
  return o;
}

// ------------------------------------------------------------ scanning

/** Scans the chosen books; keeps the session for fixing; returns rows for the window. */
async function scanProject(projectId) {
  const options = await loadOptions(projectId);
  const books = await booksPresent(projectId);
  const chosen = books.filter((b) => !MSCore.isExcluded(options, b.code));
  const styCache = new Map();
  const issues = [];
  const texts = new Map();
  const failed = [];
  let scanner;
  let scannerSty;
  for (const book of chosen) {
    let text;
    try {
      text = await readBook(projectId, book.code);
    } catch (e) {
      failed.push(`${book.code}: ${e}`);
      continue;
    }
    if (!text) continue;
    texts.set(book.num, text);
    const sty = await styleTable(projectId, book.num, styCache);
    if (sty !== scannerSty) {
      scanner = new MSCore.Scanner(options, sty);
      scannerSty = sty;
    }
    issues.push(...MSCore.scanBook(scanner, book, text));
  }
  issues.forEach((issue, i) => {
    issue.id = i;
  });
  sessions.set(projectId, { issues, texts });

  let canEdit = true;
  try {
    const perm = await papi.projectDataProviders.get('platformScripture.scriptureEditPermissions', projectId);
    canEdit = await perm.canUserEditScripture();
  } catch (e) {
    logger.warn(`Marker Spaces: could not read edit permission: ${e}`);
  }

  return {
    projectId,
    projectName: await projectName(projectId),
    canEdit,
    options,
    books: books.map((b) => ({ num: b.num, code: b.code, chosen: !MSCore.isExcluded(options, b.code) })),
    booksRead: chosen.length,
    failed,
    rows: issues.map((issue) => {
      const p = MSCore.preview(issue);
      return {
        id: issue.id,
        book: issue.book,
        chapter: issue.chapter,
        verse: issue.verse,
        kind: issue.kind,
        code: issue.code,
        marker: issue.marker,
        shown: issue.shown,
        canFix: issue.edits.length > 0,
        now: p.now,
        after: p.after,
      };
    }),
  };
}

// ------------------------------------------------------------ fixing

/**
 * Fixes the issues with these ids from the last scan. Each book is read again; a chapter whose text
 * differs from the scanned one is skipped ("changed since scan"). The book's text before the fix is
 * kept in the extension's user storage, then the whole book is written once.
 */
async function fixIssues(projectId, ids) {
  const report = { fixed: [], total: 0, booksChanged: 0, changed: [], failed: [], noPermission: false, backups: [] };
  const session = sessions.get(projectId);
  if (!session) throw new Error('Scan the project first.');
  const wanted = new Set(ids || []);
  const chosen = session.issues.filter((i) => wanted.has(i.id) && i.edits.length > 0);
  if (chosen.length === 0) return report;

  try {
    const perm = await papi.projectDataProviders.get('platformScripture.scriptureEditPermissions', projectId);
    if (!(await perm.canUserEditScripture())) {
      report.noPermission = true;
      return report;
    }
  } catch (e) {
    logger.warn(`Marker Spaces: could not read edit permission, trying anyway: ${e}`);
  }

  const byBook = new Map();
  chosen.forEach((i) => {
    if (!byBook.has(i.bookNum)) byBook.set(i.bookNum, []);
    byBook.get(i.bookNum).push(i);
  });
  const pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');

  for (const [bookNum, list] of byBook) {
    const code = MSCore.bookCode(bookNum);
    let current;
    try {
      current = await pdp.getBookUSFM(verseRef(code, 1, 1));
    } catch (e) {
      report.failed.push(`${code}: ${e}`);
      continue;
    }
    if (!current) {
      report.failed.push(`${code}: no text`);
      continue;
    }
    // Chapters as scanned; keep only those whose text is still the same.
    const now = new Map(MSCore.bookChapters(current).map((ch) => [ch.chapter, ch]));
    const byChapter = new Map();
    list.forEach((i) => {
      if (!byChapter.has(i.chapter)) byChapter.set(i.chapter, []);
      byChapter.get(i.chapter).push(i);
    });
    const pieces = [];
    let pos = 0;
    let count = 0;
    const order = Array.from(byChapter.keys())
      .map((c) => ({ c, ch: now.get(c) }))
      .sort((a, b) => (a.ch ? a.ch.start : 0) - (b.ch ? b.ch.start : 0));
    for (const { c, ch } of order) {
      const issues = byChapter.get(c);
      if (!ch || ch.text !== issues[0].chapterText) {
        report.changed.push(`${code} ${c}`);
        continue;
      }
      pieces.push(current.substring(pos, ch.start));
      pieces.push(MSCore.apply(ch.text, issues.flatMap((i) => i.edits)));
      pos = ch.start + ch.text.length;
      count += issues.length;
    }
    if (count === 0) continue;
    pieces.push(current.substring(pos));
    const fixed = pieces.join('');
    if (fixed === current) continue;

    const backupKey = `backup:${projectId}:${code}:${stamp}`;
    try {
      await papi.storage.writeUserData(executionToken, backupKey, current);
    } catch (e) {
      report.failed.push(`${code}: the backup could not be written, so the book was not changed (${e})`);
      continue;
    }
    try {
      await pdp.setBookUSFM(verseRef(code, 1, 1), fixed);
    } catch (e) {
      report.failed.push(`${code}: ${e}`);
      continue;
    }
    // Read it back: Paratext may normalize or refuse silently.
    let after;
    try {
      after = await pdp.getBookUSFM(verseRef(code, 1, 1));
    } catch (e) {
      after = undefined;
    }
    if (after === current) {
      report.failed.push(`${code}: Paratext did not save the change`);
      continue;
    }
    report.fixed.push({ book: code, count });
    report.backups.push(backupKey);
    report.total += count;
    report.booksChanged += 1;
  }
  return report;
}

// ------------------------------------------------------------ the check in the Checks panel

const checkDetails = Object.freeze({
  checkName: '%markerSpaces_checkName%',
  checkDescription: '%markerSpaces_checkDescription%',
});

/** Offset of pos within its verse's text (after "\v N "), as hello-rock3's check counts it. */
function verseOffset(chapterText, pos) {
  const before = chapterText.substring(0, pos);
  const m = /\\v\s+\S+\s?/g;
  let last = null;
  let found;
  while ((found = m.exec(before)) !== null) last = found;
  if (!last) return 0;
  return Math.max(0, pos - (last.index + last[0].length));
}

function messageArgs(issue) {
  const close = issue.shown.endsWith('*') ? issue.shown : `${issue.marker}*`;
  return { marker: `\\${issue.shown}`, base: `\\${issue.marker}`, close: `\\${close}` };
}

class MarkerSpacesCheck {
  constructor() {
    this.projectId = undefined;
    this.pdp = undefined;
    this.cache = new Map(); // bookNum -> { text, issues }
  }

  async initialize(projectId) {
    this.projectId = projectId;
    this.cache.clear();
    try {
      this.pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
      this.options = await loadOptions(projectId);
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
    return checkDetails;
  }

  async getCheckResults(range) {
    if (!this.pdp) throw new Error('Check not initialized');
    const first = MSCore.bookNumber(range.start.book);
    const last = range.end ? MSCore.bookNumber(range.end.book) : first;
    const results = [];
    for (let bookNum = first; bookNum <= last && bookNum > 0; bookNum++) {
      const code = MSCore.bookCode(bookNum);
      let text;
      try {
        text = await this.pdp.getBookUSFM(verseRef(code, 1, 1));
      } catch (e) {
        continue;
      }
      if (!text) continue;
      let cached = this.cache.get(bookNum);
      if (!cached || cached.text !== text) {
        const sty = await styleTable(this.projectId, bookNum);
        const scanner = new MSCore.Scanner(this.options, sty);
        cached = { text, issues: MSCore.scanBook(scanner, { num: bookNum, code }, text) };
        this.cache.set(bookNum, cached);
      }
      const seen = new Map();
      for (const issue of cached.issues) {
        const v = MSCore.verseNumber(issue.verse);
        if (!inRange(range, bookNum, issue.chapter, v)) continue;
        const ref = verseRef(code, issue.chapter, v);
        const key = `${issue.chapter}:${v}:${issue.code}:${issue.shown}`;
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        const offStart = verseOffset(issue.chapterText, issue.start);
        const offEnd = verseOffset(issue.chapterText, issue.end);
        results.push({
          checkResultType: issue.code,
          checkResultUniqueId: `${issue.shown}#${n}`,
          projectId: this.projectId,
          verseText: MSCore.preview(issue).now,
          itemText: `\\${issue.shown}`,
          messageFormatString: `%markerSpaces_message_${issue.code}%`,
          formatStringArguments: messageArgs(issue),
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

function refNumber(book, chapter, verse) {
  return book * 1000000 + chapter * 1000 + verse;
}

function inRange(range, bookNum, chapter, verse) {
  const s = range.start;
  const e = range.end || range.start;
  const n = refNumber(bookNum, chapter, verse);
  const lo = refNumber(MSCore.bookNumber(s.book), s.chapterNum, s.verseNum);
  const hi = refNumber(MSCore.bookNumber(e.book), e.chapterNum, range.end ? e.verseNum : s.verseNum);
  // Verse 0 at the start takes in the chapter's heading and everything before verse 1.
  return n >= lo && n <= hi;
}

/** platform-scripture may activate after us: try for a while, in the background. */
function registerCheckWhenReady(context) {
  let tries = 0;
  const attempt = async () => {
    tries += 1;
    try {
      const unsubscribe = await papi.commands.sendCommand(
        'platformScripture.registerCheck',
        checkDetails,
        async () => new MarkerSpacesCheck(),
      );
      context.registrations.add(unsubscribe);
      logger.info('Marker Spaces: check registered');
    } catch (e) {
      if (tries < 30) setTimeout(attempt, 2000);
      else logger.error(`Marker Spaces: could not register the check: ${e}`);
    }
  };
  attempt();
}

// ------------------------------------------------------------ the window

async function webViewHtml(projectId) {
  const boot = { projectId, lang: await interfaceLanguage(), version: MS_VERSION };
  // JSON inside a <script>: keep "</script>" and U+2028/9 from ending or breaking it.
  const json = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return MS_WEB_VIEW_HTML.replace('__MS_BOOT__', json);
}

const webViewProvider = {
  async getWebView(savedWebView, options) {
    if (savedWebView.webViewType !== WEB_VIEW_TYPE)
      throw new Error(`${WEB_VIEW_TYPE} provider received a request for ${savedWebView.webViewType}`);
    const projectId = (options && options.projectId) || savedWebView.projectId;
    if (!projectId) return undefined;
    const lang = await interfaceLanguage();
    const title = { en: 'Marker Spaces', es: 'Espacios de marcadores', fr: 'Espaces autour des marqueurs' }[lang];
    return {
      ...savedWebView,
      title: `${title} - ${await projectName(projectId)}`,
      projectId,
      contentType: 'html',
      content: await webViewHtml(projectId),
    };
  },
};

/** Opens the window for the editor's project, or for projectId when given (from Phils Checks). */
async function openWindow(editorWebViewId, givenProjectId) {
  let projectId = typeof givenProjectId === 'string' && givenProjectId ? givenProjectId : undefined;
  if (!projectId && typeof editorWebViewId === 'string' && editorWebViewId) {
    try {
      const def = await papi.webViews.getOpenWebViewDefinition(editorWebViewId);
      projectId = def && def.projectId;
    } catch (e) {
      logger.warn(`Marker Spaces: could not read the editor's project: ${e}`);
    }
  }
  if (!projectId) {
    try {
      projectId = await papi.dialogs.selectProject({
        title: 'Marker Spaces',
        prompt: 'Choose the project to check for marker spacing problems',
        includeProjectInterfaces: ['platformScripture.USFM_Book'],
      });
    } catch (e) {
      logger.warn(`Marker Spaces: project chooser failed: ${e}`);
    }
  }
  if (!projectId) return undefined;
  return papi.webViews.openWebView(
    WEB_VIEW_TYPE,
    { type: 'float', floatSize: { width: 1000, height: 640 } },
    { existingId: '?', existingProjectId: projectId, projectId },
  );
}

async function goTo(projectId, code, chapter, verse) {
  await papi.scrollGroups.setScrRef(undefined, verseRef(code, chapter, MSCore.verseNumber(String(verse))), projectId);
  return true;
}

// ------------------------------------------------------------ activation

async function activate(context) {
  logger.info(`Marker Spaces ${MS_VERSION} is activating`);
  executionToken = context.executionToken;

  const register = papi.webViewProviders.registerWebViewProvider || papi.webViewProviders.register;
  const registrations = await Promise.all([
    register.call(papi.webViewProviders, WEB_VIEW_TYPE, webViewProvider),
    papi.commands.registerCommand('markerSpaces.open', openWindow, docs('Open the Marker Spaces window')),
    papi.commands.registerCommand('markerSpaces.scan', scanProject, docs('Scan a project for marker spacing problems')),
    papi.commands.registerCommand('markerSpaces.fix', fixIssues, docs('Fix marker spacing problems from the last scan')),
    papi.commands.registerCommand('markerSpaces.saveOptions', saveOptions, docs('Save Marker Spaces options for a project')),
    papi.commands.registerCommand('markerSpaces.goTo', goTo, docs('Go to a verse')),
  ]);
  registrations.forEach((r) => context.registrations.add(r));
  registerCheckWhenReady(context);
  logger.info(`Marker Spaces is finished activating (${CHECK_ID_HINT})`);
}

async function deactivate() {
  sessions.clear();
  return true;
}

return { activate, deactivate, openWindow };

})();
// Built-in tools: the plumbing a tool window shares (Numbered Markers, Numbered Book Titles).
// PCTools.backend(spec) registers, for spec.id = 'numberedMarkers':
//   numberedMarkers.open(editorWebViewId, projectId)   the tool's window (one per project)
//   numberedMarkers.scan(projectId, runId)              spec.scan(ctx, lang, null) on the chosen books
//   numberedMarkers.scanWith(projectId, extra, runId)   the same with extra from the window (files it read)
//   numberedMarkers.apply(projectId, payload, runId)    spec.apply(ctx, payload): writes text
//   numberedMarkers.progress(projectId, runId)          what the window shows while it waits
//   numberedMarkers.books(projectId) / saveBooks(projectId, excludedCodes)
//   numberedMarkers.goTo(projectId, book, chapter, verse)
// Writing: the whole book, after keeping its old text in the extension's storage
// (backup:<project>:<BOOK>:<time>), then read back. Paratext 10 has no history points.
// Uses papi only at run time; spec.html is the window with __BOOT__ in it.
var PCTools = (function () {
  'use strict';

  function backend(spec) {
    const papi = require('@papi/backend');
    const { logger } = papi;
    const runs = new Map();
    let token;

    function docs(summary) {
      return { method: { summary, params: [], result: { name: 'return value', schema: {} } } };
    }
    function ref(code, chapter, verse) {
      return { book: code, chapterNum: chapter || 1, verseNum: verse || 0 };
    }
    function progress(projectId, runId, data) {
      if (runId) runs.set(`${projectId}|${runId}`, Object.assign({ runId }, data));
    }
    function done(projectId, runId) {
      if (runId) setTimeout(() => runs.delete(`${projectId}|${runId}`), 5000);
    }

    async function language() {
      try {
        const langs = await papi.settings.get('platform.interfaceLanguage');
        const first = Array.isArray(langs) && langs.length > 0 ? String(langs[0]).toLowerCase() : 'en';
        if (first.startsWith('es')) return 'es';
        if (first.startsWith('fr')) return 'fr';
      } catch (e) {
        // English
      }
      return 'en';
    }

    const names = new Map();
    async function projectName(projectId, wait) {
      if (names.has(projectId)) return names.get(projectId);
      const p = (async () => {
        try {
          const base = await papi.projectDataProviders.get('platform.base', projectId);
          const n = (await base.getSetting('platform.name')) || projectId;
          names.set(projectId, n);
          return n;
        } catch (e) {
          return projectId;
        }
      })();
      return wait ? Promise.race([p, new Promise((r) => setTimeout(() => r(''), wait))]) : p;
    }

    async function booksPresent(projectId) {
      const base = await papi.projectDataProviders.get('platform.base', projectId);
      const present = String((await base.getSetting('platformScripture.booksPresent')) || '');
      const list = [];
      for (let i = 0; i < present.length && i < PC.usfm.BOOKS.length; i++)
        if (present[i] === '1') list.push({ num: i + 1, code: PC.usfm.bookCode(i + 1) });
      return list;
    }

    /** The excluded book codes (null = none saved: every book). */
    async function loadExcluded(projectId) {
      try {
        const v = JSON.parse(await papi.storage.readUserData(token, `books:${spec.id}:${projectId}`));
        return Array.isArray(v) ? v : null;
      } catch (e) {
        return null;
      }
    }

    async function books(projectId) {
      const present = await booksPresent(projectId);
      const excluded = await loadExcluded(projectId);
      return present.map((b) => ({ code: b.code, num: b.num, chosen: !excluded || excluded.indexOf(b.code) < 0 }));
    }

    async function saveBooks(projectId, excludedCodes) {
      await papi.storage.writeUserData(token, `books:${spec.id}:${projectId}`, JSON.stringify(excludedCodes || []));
      return true;
    }

    async function canEdit(projectId) {
      try {
        const perm = await papi.projectDataProviders.get('platformScripture.scriptureEditPermissions', projectId);
        return await perm.canUserEditScripture();
      } catch (e) {
        logger.warn(`${spec.id}: could not read edit permission: ${e}`);
        return true;
      }
    }

    /** What spec.scan and spec.apply get. */
    function context(projectId, runId) {
      let pdp;
      async function usfm() {
        if (!pdp) pdp = await papi.projectDataProviders.get('platformScripture.USFM_Book', projectId);
        return pdp;
      }
      return {
        projectId,
        logger,
        progress: (data) => progress(projectId, runId, data),
        /** The chosen books' text: [{num, code, text}], with "Reading X (n of m)" progress. */
        async readChosen() {
          const list = (await books(projectId)).filter((b) => b.chosen);
          const out = [];
          const failed = [];
          const p = await usfm();
          for (let i = 0; i < list.length; i++) {
            progress(projectId, runId, { phase: 'read', done: i, total: list.length, book: list[i].code });
            try {
              const text = await p.getBookUSFM(ref(list[i].code, 1, 1));
              if (text !== undefined && text !== null) out.push({ num: list[i].num, code: list[i].code, text });
            } catch (e) {
              failed.push(`${list[i].code}: ${e}`);
            }
          }
          progress(projectId, runId, { phase: 'check', done: list.length, total: list.length });
          return { books: out, failed, total: list.length };
        },
        async readBook(code) {
          return (await usfm()).getBookUSFM(ref(code, 1, 1));
        },
        canEdit: () => canEdit(projectId),
        /** A project setting from Paratext 10, or undefined when it has none (or refuses the key). */
        async setting(key) {
          try {
            const base = await papi.projectDataProviders.get('platform.base', projectId);
            return await base.getSetting(key);
          } catch (e) {
            return undefined;
          }
        },
        /** Paratext 10's merged stylesheet (StyleInfo) for a book, or undefined. */
        async styleInfo(bookNum) {
          try {
            const pdp = await papi.projectDataProviders.get('platformScripture.StyleInfo', projectId);
            return await pdp.getStyleInfo(bookNum || 1);
          } catch (e) {
            return undefined;
          }
        },
        projectName: () => projectName(projectId),
        /**
         * Keeps the old text, writes the new, reads it back. Returns {ok, error, after, backup}.
         * stamp is one time for the whole run.
         */
        async writeBook(code, oldText, newText, stamp) {
          const backup = `backup:${projectId}:${code}:${stamp}`;
          try {
            await papi.storage.writeUserData(token, backup, oldText);
          } catch (e) {
            return { ok: false, error: `the backup could not be written, so the book was not changed (${e})` };
          }
          const p = await usfm();
          try {
            await p.setBookUSFM(ref(code, 1, 1), newText);
          } catch (e) {
            return { ok: false, error: String(e && e.message ? e.message : e) };
          }
          let after;
          try {
            after = await p.getBookUSFM(ref(code, 1, 1));
          } catch (e) {
            after = undefined;
          }
          if (after === oldText) return { ok: false, error: 'notSaved', backup };
          return { ok: true, after, backup };
        },
        stamp: () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, ''),
      };
    }

    /** scanWith: the same, with what the window read from the project folder (e.g. {bookNamesXml}). */
    async function scan(projectId, runId, extra) {
      try {
        progress(projectId, runId, { phase: 'open', done: 0, total: 0 });
        logger.info(`${spec.id}: scan started for ${projectId}${extra ? ' (with the project folder)' : ''}`);
        const result = await spec.scan(context(projectId, runId), await language(), extra || null);
        result.books = await books(projectId);
        result.canEdit = await canEdit(projectId);
        return result;
      } finally {
        done(projectId, runId);
      }
    }

    async function apply(projectId, payload, runId) {
      try {
        logger.info(`${spec.id}: apply started for ${projectId}`);
        return await spec.apply(context(projectId, runId), payload, await language());
      } finally {
        done(projectId, runId);
      }
    }

    async function goTo(projectId, code, chapter, verse) {
      await papi.scrollGroups.setScrRef(undefined, ref(code, chapter || 1, verse || 0), projectId);
      return true;
    }

    async function html(projectId) {
      const lang = await language();
      const boot = {
        projectId,
        lang,
        projectName: await projectName(projectId, 300),
        version: spec.version,
        id: spec.id,
        strings: Object.assign({}, spec.strings.en, spec.strings[lang] || {}),
      };
      const json = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
      return spec.html.replace('__BOOT__', json);
    }

    const provider = {
      async getWebView(saved, options) {
        if (saved.webViewType !== spec.webViewType) throw new Error(`${spec.webViewType} provider got ${saved.webViewType}`);
        const projectId = (options && options.projectId) || saved.projectId;
        if (!projectId) return undefined;
        const lang = await language();
        const title = (spec.strings[lang] || spec.strings.en).Title || spec.id;
        const name = await projectName(projectId, 300);
        return { ...saved, title: name ? `${title} - ${name}` : title, projectId, contentType: 'html', content: await html(projectId) };
      },
    };

    async function open(editorWebViewId, givenProjectId) {
      let projectId = typeof givenProjectId === 'string' && givenProjectId ? givenProjectId : undefined;
      if (!projectId && typeof editorWebViewId === 'string' && editorWebViewId) {
        try {
          const def = await papi.webViews.getOpenWebViewDefinition(editorWebViewId);
          projectId = def && def.projectId;
        } catch (e) {
          logger.warn(`${spec.id}: could not read the editor's project: ${e}`);
        }
      }
      if (!projectId) {
        try {
          projectId = await papi.dialogs.selectProject({ title: spec.strings.en.Title, includeProjectInterfaces: ['platformScripture.USFM_Book'] });
        } catch (e) {
          logger.warn(`${spec.id}: project chooser failed: ${e}`);
        }
      }
      if (!projectId) return undefined;
      return papi.webViews.openWebView(spec.webViewType, { type: 'float', floatSize: spec.size || { width: 1100, height: 720 } }, {
        existingId: '?',
        existingProjectId: projectId,
        projectId,
      });
    }

    async function activate(context) {
      token = context.executionToken;
      const register = papi.webViewProviders.registerWebViewProvider || papi.webViewProviders.register;
      const regs = await Promise.all([
        register.call(papi.webViewProviders, spec.webViewType, provider),
        papi.commands.registerCommand(`${spec.id}.open`, open, docs(`Open the ${spec.strings.en.Title} window`)),
        papi.commands.registerCommand(`${spec.id}.scan`, (projectId, runId) => scan(projectId, runId, null), docs(`${spec.strings.en.Title}: scan a project`)),
        papi.commands.registerCommand(
          `${spec.id}.scanWith`,
          (projectId, extra, runId) => scan(projectId, runId, extra),
          docs(`${spec.strings.en.Title}: scan a project with files from its folder`),
        ),
        papi.commands.registerCommand(`${spec.id}.apply`, apply, docs(`${spec.strings.en.Title}: change the text`)),
        papi.commands.registerCommand(
          `${spec.id}.progress`,
          async (projectId, runId) => runs.get(`${projectId}|${runId}`) || null,
          docs('Progress of a scan or change'),
        ),
        papi.commands.registerCommand(`${spec.id}.books`, books, docs('The books of a project and the saved choice')),
        papi.commands.registerCommand(`${spec.id}.saveBooks`, saveBooks, docs('Save the books to examine')),
        papi.commands.registerCommand(`${spec.id}.goTo`, goTo, docs('Go to a place in the text')),
      ]);
      regs.forEach((r) => context.registrations.add(r));
    }

    return { activate, deactivate: async () => true, open };
  }

  return { backend: backend };
})();

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

const NM_STRINGS = {"en": {"BooksAll": "All", "BooksBible": "Bible books", "BooksButton": "Books: {0} of {1}...", "BooksDC": "Deuterocanon", "BooksIntro": "Tick the books to examine. Unticked books are not read at all, so they are neither counted nor converted. The choice is saved for this project.", "BooksNT": "New Testament", "BooksNone": "None", "BooksNoneChosen": "Tick at least one book.", "BooksOT": "Old Testament", "BooksOther": "Other books", "BooksTitle": "Books to examine", "Cancel": "Cancel", "Checking": "Counting the markers...", "Clear": "Clear", "Close": "Close", "ColBare": "Unnumbered", "ColCan": "Books you can convert", "ColCannot": "Books you cannot edit", "ColChangeTo": "Change to", "ColConvert": "Convert", "ColKind": "Kind", "ColLevels": "Numbered forms", "ColMarker": "Marker", "ColOther": "Not in usfm.sty", "ColWhere": "Where it will change", "Confirm": "Change {0} to the \"1\" form in {1} book(s) you can edit?\n\nA point is first added to the project history, and each changed book is saved as a .bak file in:\n{2}", "ConfirmP10": "Change {0} in {1} book(s)?\n\nThe text of each book is first kept in the Phils Checks extension's storage (Paratext 10 does not let extensions add a point to the project history).", "ConfirmTitle": "Convert markers", "ConsistentHeader": "Consistent, only one form used (no change needed): {0}", "ConsistentNone": "none", "ConvertButton": "Convert selected markers", "Description": "Finds markers used in both their unnumbered and numbered forms (\\mt beside \\mt1, \\q beside \\q1) and changes the unnumbered form to the \"1\" form in the books you may edit.", "DirAdd": "\\{0} \u2192 \\{0}1", "DirRemove": "\\{0}1 \u2192 \\{0}", "Error": "Numbered Markers could not finish:\n{0}", "FolderChooseOther": "Choose another folder...", "FolderChooseRoot": "Choose the Paratext 9 Projects folder...", "FolderChosen": "Folder: {0}", "FolderNoSettings": "This folder has no Settings.xml, so it is not a Paratext project folder: {0}", "FolderNone": "No folder chosen yet.", "FolderNotAllowed": "Paratext 10 did not allow the folder to be read: {0}", "FolderNotInRoot": "The folder {0} has no folder for the project {1}.", "FolderOpenProject": "Open the project folder ({0})", "FolderReadOnly": "The folder can be read but not written to here, so Save will download the file instead.", "FolderRootWhere": "Only once: choose the folder where Paratext 10 keeps its projects, {0}. After that each window finds its project's folder by itself.", "FolderWrongProject": "This is the folder of project {0}, not of the project open here ({1}). Choose the folder {2}.", "HistoryMessage": "Numbered Markers: before converting {0}", "HistoryNoFolder": "the project folder or its history (.hg) was not found", "HistoryNotRecorded": "Paratext did not record the history point (the project may be in use)", "HistoryStopped": "Could not add a point to the project history, so nothing was changed: {0}\n\nFinish or close any editing in this project, then try again.", "Intro": "Markers like \\q and \\q1 mean the same thing. A project that uses only one form of a marker is fine. When a project uses the unnumbered form AND a numbered form (e.g. \\mt beside \\mt1 or \\mt2), the unnumbered form should be changed to the \"1\" form.", "IntroLabel": "intro", "IntroRemove": "When a marker uses no level 2 or higher (no \\io2), you can instead change its \"1\" form to the unnumbered form (\\io1 \u2192 \\io) in the \"Change to\" column; the direction with fewer changes is chosen for you.", "KindMixed": "Mixed", "KindOneForm": "One form", "MenuText": "Numbered Markers...", "MixedHeader": "Mixed: unnumbered and numbered forms both used", "MixedNone": "No marker uses both its unnumbered and its numbered forms. Nothing needs to change.", "More": "... and {0} more", "No": "No", "NoPermissionBooks": "You cannot edit any of the books that have these markers, so they cannot be converted.", "NoPermissionP10": "You do not have permission to edit this project, so these markers cannot be converted.", "NoPermissionProject": "You do not have permission to edit the {0} project, so these markers cannot be converted.", "NotRead": "Not read: {0}", "NotSaved": "Paratext did not save the change", "NothingSelected": "Tick at least one marker to convert.", "Ok": "OK", "OpenProjectFirst": "Open a project in a Scripture window first, then choose Numbered Markers...", "Opening": "Opening the project...", "OtherNote": "Levels under \"Not in usfm.sty\" (for example \\s5 used as a chunk marker) are listed, but they do not make a marker count as mixed.", "ProjectLabel": "Project: {0}", "Reading": "Reading {0} ({1} of {2})...", "ResBackups": "Backups of the changed books are in: {0}", "ResBackupsP10": "The old text of the {0} changed book(s) is kept in the Phils Checks extension's storage.", "ResBusy": "Not changed, because the text is in use (finish editing it, then try again): {0}", "ResChange": "{0}: \\{1} -> \\{1}1, {2} change(s)", "ResChangeRemove": "{0}: \\{1}1 -> \\{1}, {2} change(s)", "ResChanged": "Not changed, because the text changed after the scan (scan again, then try again): {0}", "ResFailed": "Could not change: {0}", "ResHistoryFailed": "Could not add a point to the project history: {0}", "ResNoPermission": "Not changed, because you do not have permission to edit: {0}", "ResNothing": "Nothing was converted.", "ResTotal": "Converted: {0} change(s) in {1} book(s).", "Rescan": "Scan again", "ResultsHeader": "Results:", "ResultsLabel": "Results: after you click Convert, the changes made (and any books or chapters not changed) are listed here.", "Scanning": "Scanning {0}...", "SelectAll": "Select all", "SettingsNotSaved": "The choice of books could not be saved: {0}", "ShowOneForm": "Also show markers that use only one form (for example only \\s), to change them too", "SomeNotEditable": "Some of these markers are in books you cannot edit. Those books will be left unchanged and listed.", "Title": "Numbered Markers", "Writing": "Changing {0} ({1} of {2})...", "Yes": "Yes"}, "es": {"BooksAll": "Todos", "BooksBible": "Libros de la Biblia", "BooksButton": "Libros: {0} de {1}...", "BooksDC": "Deuterocan\u00f3nicos", "BooksIntro": "Marque los libros que desea revisar. Los libros sin marcar no se leen, as\u00ed que no se cuentan ni se convierten. La selecci\u00f3n se guarda para este proyecto.", "BooksNT": "Nuevo Testamento", "BooksNone": "Ninguno", "BooksNoneChosen": "Marque al menos un libro.", "BooksOT": "Antiguo Testamento", "BooksOther": "Otros libros", "BooksTitle": "Libros a revisar", "Cancel": "Cancelar", "Checking": "Contando los marcadores...", "Clear": "Borrar", "Close": "Cerrar", "ColBare": "Sin n\u00famero", "ColCan": "Libros que puede convertir", "ColCannot": "Libros que no puede editar", "ColChangeTo": "Cambiar a", "ColConvert": "Convertir", "ColKind": "Tipo", "ColLevels": "Formas numeradas", "ColMarker": "Marcador", "ColOther": "No est\u00e1n en usfm.sty", "ColWhere": "D\u00f3nde cambiar\u00e1", "Confirm": "\u00bfCambiar {0} a la forma \"1\" en {1} libro(s) que usted puede editar?\n\nPrimero se agrega un punto al historial del proyecto, y cada libro cambiado se guarda como archivo .bak en:\n{2}", "ConfirmP10": "\u00bfCambiar {0} en {1} libro(s)?\n\nEl texto de cada libro se guarda primero en el almacenamiento de la extensi\u00f3n Phils Checks (Paratext 10 no permite que las extensiones a\u00f1adan un punto al historial del proyecto).", "ConfirmTitle": "Convertir marcadores", "ConsistentHeader": "Coherentes, se usa una sola forma (no hace falta cambiar nada): {0}", "ConsistentNone": "ninguno", "ConvertButton": "Convertir los marcadores seleccionados", "Description": "Encuentra marcadores que se usan en su forma sin n\u00famero y en sus formas numeradas (\\mt junto a \\mt1, \\q junto a \\q1) y cambia la forma sin n\u00famero a la forma \"1\" en los libros que usted puede editar.", "DirAdd": "\\{0} \u2192 \\{0}1", "DirRemove": "\\{0}1 \u2192 \\{0}", "Error": "Marcadores numerados no pudo terminar:\n{0}", "FolderChooseOther": "Elegir otra carpeta...", "FolderChooseRoot": "Elegir la carpeta Paratext 9 Projects...", "FolderChosen": "Carpeta: {0}", "FolderNoSettings": "Esta carpeta no tiene Settings.xml, as\u00ed que no es la carpeta de un proyecto de Paratext: {0}", "FolderNone": "Todav\u00eda no se ha elegido una carpeta.", "FolderNotAllowed": "Paratext 10 no permiti\u00f3 leer la carpeta: {0}", "FolderNotInRoot": "La carpeta {0} no tiene una carpeta para el proyecto {1}.", "FolderOpenProject": "Abrir la carpeta del proyecto ({0})", "FolderReadOnly": "La carpeta se puede leer pero aqu\u00ed no se puede escribir en ella, as\u00ed que Guardar descargar\u00e1 el archivo.", "FolderRootWhere": "Solo una vez: elija la carpeta donde Paratext 10 guarda sus proyectos, {0}. Despu\u00e9s cada ventana encuentra sola la carpeta de su proyecto.", "FolderWrongProject": "Esta es la carpeta del proyecto {0}, no del proyecto abierto aqu\u00ed ({1}). Elija la carpeta {2}.", "HistoryMessage": "Marcadores numerados: antes de convertir {0}", "HistoryNoFolder": "no se encontr\u00f3 la carpeta del proyecto o su historial (.hg)", "HistoryNotRecorded": "Paratext no registr\u00f3 el punto del historial (puede que el proyecto est\u00e9 en uso)", "HistoryStopped": "No se pudo agregar un punto al historial del proyecto, as\u00ed que no se cambi\u00f3 nada: {0}\n\nTermine o cierre cualquier edici\u00f3n en este proyecto y vuelva a intentarlo.", "Intro": "Marcadores como \\q y \\q1 significan lo mismo. Un proyecto que usa una sola forma de un marcador est\u00e1 bien. Cuando un proyecto usa la forma sin n\u00famero Y una forma numerada (p. ej. \\mt junto a \\mt1 o \\mt2), la forma sin n\u00famero debe cambiarse a la forma \"1\".", "IntroLabel": "introducci\u00f3n", "IntroRemove": "Cuando un marcador no usa el nivel 2 ni superiores (no hay \\io2), puede en cambio pasar su forma \"1\" a la forma sin n\u00famero (\\io1 \u2192 \\io) en la columna \"Cambiar a\"; se elige por usted la direcci\u00f3n con menos cambios.", "KindMixed": "Mezclado", "KindOneForm": "Una forma", "MenuText": "Marcadores numerados...", "MixedHeader": "Mezclados: se usan la forma sin n\u00famero y las numeradas", "MixedNone": "Ning\u00fan marcador usa a la vez su forma sin n\u00famero y sus formas numeradas. No hay nada que cambiar.", "More": "... y {0} m\u00e1s", "No": "No", "NoPermissionBooks": "Usted no puede editar ninguno de los libros que tienen estos marcadores, as\u00ed que no se pueden convertir.", "NoPermissionP10": "No tiene permiso para editar este proyecto, as\u00ed que estos marcadores no se pueden convertir.", "NoPermissionProject": "Usted no tiene permiso para editar el proyecto {0}, as\u00ed que estos marcadores no se pueden convertir.", "NotRead": "No se ley\u00f3: {0}", "NotSaved": "Paratext no guard\u00f3 el cambio", "NothingSelected": "Marque al menos un marcador para convertir.", "Ok": "Aceptar", "OpenProjectFirst": "Abra primero un proyecto en una ventana de Escritura y luego elija Marcadores numerados...", "Opening": "Abriendo el proyecto...", "OtherNote": "Los niveles de \"No est\u00e1n en usfm.sty\" (por ejemplo \\s5 usado como marca de bloque) se muestran, pero no hacen que un marcador cuente como mezclado.", "ProjectLabel": "Proyecto: {0}", "Reading": "Leyendo {0} ({1} de {2})...", "ResBackups": "Las copias de seguridad de los libros cambiados est\u00e1n en: {0}", "ResBackupsP10": "El texto anterior de los {0} libro(s) cambiados se guarda en el almacenamiento de la extensi\u00f3n Phils Checks.", "ResBusy": "No se cambiaron, porque el texto est\u00e1 en uso (termine de editarlo y vuelva a intentarlo): {0}", "ResChange": "{0}: \\{1} -> \\{1}1, {2} cambio(s)", "ResChangeRemove": "{0}: \\{1}1 -> \\{1}, {2} cambio(s)", "ResChanged": "No se cambi\u00f3, porque el texto cambi\u00f3 despu\u00e9s del examen (examine de nuevo y vuelva a intentarlo): {0}", "ResFailed": "No se pudo cambiar: {0}", "ResHistoryFailed": "No se pudo agregar un punto al historial del proyecto: {0}", "ResNoPermission": "No se cambiaron, porque usted no tiene permiso para editar: {0}", "ResNothing": "No se convirti\u00f3 nada.", "ResTotal": "Convertido: {0} cambio(s) en {1} libro(s).", "Rescan": "Examinar de nuevo", "ResultsHeader": "Resultados:", "ResultsLabel": "Resultados: despu\u00e9s de hacer clic en Convertir, aqu\u00ed se muestran los cambios hechos (y los libros o cap\u00edtulos que no se cambiaron).", "Scanning": "Revisando {0}...", "SelectAll": "Seleccionar todo", "SettingsNotSaved": "No se pudo guardar la selecci\u00f3n de libros: {0}", "ShowOneForm": "Mostrar tambi\u00e9n los marcadores que usan una sola forma (por ejemplo solo \\s), para cambiarlos tambi\u00e9n", "SomeNotEditable": "Algunos de estos marcadores est\u00e1n en libros que usted no puede editar. Esos libros no se cambiar\u00e1n y se mostrar\u00e1n en la lista.", "Title": "Marcadores numerados", "Writing": "Cambiando {0} ({1} de {2})...", "Yes": "S\u00ed"}, "fr": {"BooksAll": "Tous", "BooksBible": "Livres de la Bible", "BooksButton": "Livres : {0} sur {1}...", "BooksDC": "Deut\u00e9rocanoniques", "BooksIntro": "Cochez les livres \u00e0 analyser. Les livres non coch\u00e9s ne sont pas lus du tout : ils ne sont ni compt\u00e9s ni convertis. Le choix est enregistr\u00e9 pour ce projet.", "BooksNT": "Nouveau Testament", "BooksNone": "Aucun", "BooksNoneChosen": "Cochez au moins un livre.", "BooksOT": "Ancien Testament", "BooksOther": "Autres livres", "BooksTitle": "Livres \u00e0 analyser", "Cancel": "Annuler", "Checking": "Comptage des marqueurs...", "Clear": "Effacer", "Close": "Fermer", "ColBare": "Sans num\u00e9ro", "ColCan": "Livres que vous pouvez convertir", "ColCannot": "Livres que vous ne pouvez pas modifier", "ColChangeTo": "Changer en", "ColConvert": "Convertir", "ColKind": "Type", "ColLevels": "Formes num\u00e9rot\u00e9es", "ColMarker": "Marqueur", "ColOther": "Absents de usfm.sty", "ColWhere": "O\u00f9 le changement sera fait", "Confirm": "Changer {0} en forme \u00ab 1 \u00bb dans {1} livre(s) que vous pouvez modifier ?\n\nUn point est d'abord ajout\u00e9 \u00e0 l'historique du projet, et chaque livre modifi\u00e9 est enregistr\u00e9 dans un fichier .bak dans :\n{2}", "ConfirmP10": "Modifier {0} dans {1} livre(s) ?\n\nLe texte de chaque livre est d\u2019abord conserv\u00e9 dans le stockage de l\u2019extension Phils Checks (Paratext 10 ne permet pas aux extensions d\u2019ajouter un point \u00e0 l\u2019historique du projet).", "ConfirmTitle": "Convertir les marqueurs", "ConsistentHeader": "Coh\u00e9rents, une seule forme utilis\u00e9e (aucun changement n\u00e9cessaire) : {0}", "ConsistentNone": "aucun", "ConvertButton": "Convertir les marqueurs s\u00e9lectionn\u00e9s", "Description": "Trouve les marqueurs utilis\u00e9s \u00e0 la fois sous leur forme sans num\u00e9ro et sous leurs formes num\u00e9rot\u00e9es (\\mt \u00e0 c\u00f4t\u00e9 de \\mt1, \\q \u00e0 c\u00f4t\u00e9 de \\q1) et change la forme sans num\u00e9ro en forme \u00ab 1 \u00bb dans les livres que vous pouvez modifier.", "DirAdd": "\\{0} \u2192 \\{0}1", "DirRemove": "\\{0}1 \u2192 \\{0}", "Error": "Marqueurs num\u00e9rot\u00e9s n'a pas pu terminer :\n{0}", "FolderChooseOther": "Choisir un autre dossier...", "FolderChooseRoot": "Choisir le dossier Paratext 9 Projects...", "FolderChosen": "Dossier : {0}", "FolderNoSettings": "Ce dossier n\u2019a pas de Settings.xml ; ce n\u2019est donc pas le dossier d\u2019un projet Paratext : {0}", "FolderNone": "Aucun dossier choisi pour l\u2019instant.", "FolderNotAllowed": "Paratext 10 n\u2019a pas permis de lire le dossier : {0}", "FolderNotInRoot": "Le dossier {0} n\u2019a pas de dossier pour le projet {1}.", "FolderOpenProject": "Ouvrir le dossier du projet ({0})", "FolderReadOnly": "Le dossier peut \u00eatre lu, mais pas modifi\u00e9 ici ; Enregistrer t\u00e9l\u00e9chargera donc le fichier.", "FolderRootWhere": "Une seule fois : choisissez le dossier o\u00f9 Paratext 10 garde ses projets, {0}. Ensuite chaque fen\u00eatre trouve seule le dossier de son projet.", "FolderWrongProject": "C\u2019est le dossier du projet {0}, pas celui du projet ouvert ici ({1}). Choisissez le dossier {2}.", "HistoryMessage": "Marqueurs num\u00e9rot\u00e9s : avant de convertir {0}", "HistoryNoFolder": "le dossier du projet ou son historique (.hg) est introuvable", "HistoryNotRecorded": "Paratext n'a pas enregistr\u00e9 le point d'historique (le projet est peut-\u00eatre en cours d'utilisation)", "HistoryStopped": "Impossible d'ajouter un point \u00e0 l'historique du projet, donc rien n'a \u00e9t\u00e9 modifi\u00e9 : {0}\n\nTerminez ou fermez toute modification en cours dans ce projet, puis r\u00e9essayez.", "Intro": "Des marqueurs comme \\q et \\q1 veulent dire la m\u00eame chose. Un projet qui n'utilise qu'une seule forme d'un marqueur ne pose pas de probl\u00e8me. Quand un projet utilise la forme sans num\u00e9ro ET une forme num\u00e9rot\u00e9e (p. ex. \\mt \u00e0 c\u00f4t\u00e9 de \\mt1 ou \\mt2), la forme sans num\u00e9ro devrait \u00eatre chang\u00e9e en forme \u00ab 1 \u00bb.", "IntroLabel": "introduction", "IntroRemove": "Quand un marqueur n'utilise ni le niveau 2 ni un niveau sup\u00e9rieur (pas de \\io2), vous pouvez \u00e0 la place changer sa forme \u00ab 1 \u00bb en forme sans num\u00e9ro (\\io1 \u2192 \\io) dans la colonne \u00ab Changer en \u00bb ; le sens qui demande le moins de changements est choisi pour vous.", "KindMixed": "M\u00e9lang\u00e9", "KindOneForm": "Une forme", "MenuText": "Marqueurs num\u00e9rot\u00e9s...", "MixedHeader": "M\u00e9lang\u00e9s : la forme sans num\u00e9ro et les formes num\u00e9rot\u00e9es sont toutes deux utilis\u00e9es", "MixedNone": "Aucun marqueur n'utilise \u00e0 la fois sa forme sans num\u00e9ro et ses formes num\u00e9rot\u00e9es. Il n'y a rien \u00e0 changer.", "More": "... et {0} de plus", "No": "Non", "NoPermissionBooks": "Vous ne pouvez modifier aucun des livres qui contiennent ces marqueurs, donc ils ne peuvent pas \u00eatre convertis.", "NoPermissionP10": "Vous n\u2019avez pas la permission de modifier ce projet, ces marqueurs ne peuvent donc pas \u00eatre convertis.", "NoPermissionProject": "Vous n'avez pas la permission de modifier le projet {0}, donc ces marqueurs ne peuvent pas \u00eatre convertis.", "NotRead": "Non lu : {0}", "NotSaved": "Paratext n'a pas enregistr\u00e9 le changement", "NothingSelected": "Cochez au moins un marqueur \u00e0 convertir.", "Ok": "OK", "OpenProjectFirst": "Ouvrez d'abord un projet dans une fen\u00eatre de texte, puis choisissez Marqueurs num\u00e9rot\u00e9s...", "Opening": "Ouverture du projet...", "OtherNote": "Les niveaux sous \u00ab Absents de usfm.sty \u00bb (par exemple \\s5 utilis\u00e9 comme marque de section de travail) sont list\u00e9s, mais ils ne font pas compter un marqueur comme m\u00e9lang\u00e9.", "ProjectLabel": "Projet : {0}", "Reading": "Lecture de {0} ({1} sur {2})...", "ResBackups": "Les sauvegardes des livres modifi\u00e9s se trouvent dans : {0}", "ResBackupsP10": "L\u2019ancien texte des {0} livre(s) modifi\u00e9(s) est conserv\u00e9 dans le stockage de l\u2019extension Phils Checks.", "ResBusy": "Non modifi\u00e9s, car le texte est en cours d'utilisation (terminez la modification, puis r\u00e9essayez) : {0}", "ResChange": "{0} : \\{1} -> \\{1}1, {2} changement(s)", "ResChangeRemove": "{0} : \\{1}1 -> \\{1}, {2} changement(s)", "ResChanged": "Non modifi\u00e9, car le texte a chang\u00e9 apr\u00e8s l\u2019analyse (analysez \u00e0 nouveau, puis r\u00e9essayez) : {0}", "ResFailed": "Impossible de modifier : {0}", "ResHistoryFailed": "Impossible d'ajouter un point \u00e0 l'historique du projet : {0}", "ResNoPermission": "Non modifi\u00e9s, car vous n'avez pas la permission de modifier : {0}", "ResNothing": "Rien n'a \u00e9t\u00e9 converti.", "ResTotal": "Converti : {0} changement(s) dans {1} livre(s).", "Rescan": "Analyser \u00e0 nouveau", "ResultsHeader": "R\u00e9sultats :", "ResultsLabel": "R\u00e9sultats : apr\u00e8s avoir cliqu\u00e9 sur Convertir, les changements faits (et les livres ou chapitres non modifi\u00e9s) sont list\u00e9s ici.", "Scanning": "Analyse de {0}...", "SelectAll": "Tout s\u00e9lectionner", "SettingsNotSaved": "Impossible d'enregistrer le choix des livres : {0}", "ShowOneForm": "Afficher aussi les marqueurs qui n'utilisent qu'une seule forme (par exemple seulement \\s), pour les changer aussi", "SomeNotEditable": "Certains de ces marqueurs se trouvent dans des livres que vous ne pouvez pas modifier. Ces livres resteront inchang\u00e9s et seront list\u00e9s.", "Title": "Marqueurs num\u00e9rot\u00e9s", "Writing": "Modification de {0} ({1} sur {2})...", "Yes": "Oui"}, "version": "1.7"};
const NM_WINDOW_HTML = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      \n  :root {\n    --t-bg: #ffffff;\n    --t-fg: #1f2328;\n    --t-muted: #59636e;\n    --t-line: #d0d7de;\n    --t-head: #f3f5f7;\n    --t-sel: #dbeafe;\n    --t-accent: #0b6bcb;\n    --t-warn: #8a1c00;\n    --t-odd: #ffe4b5;\n    --t-usual: #eef6ff;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --t-bg: #1e1f22;\n      --t-fg: #e6e6e6;\n      --t-muted: #a0a6ad;\n      --t-line: #3a3d42;\n      --t-head: #2a2c30;\n      --t-sel: #1e3a5f;\n      --t-accent: #6cb6ff;\n      --t-warn: #fdba74;\n      --t-odd: #5a4320;\n      --t-usual: #1d2b3a;\n    }\n  }\n  html,\n  body {\n    margin: 0;\n    height: 100%;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    font: 13px/1.4 'Segoe UI', system-ui, sans-serif;\n  }\n  body {\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    padding: 8px 12px;\n    box-sizing: border-box;\n  }\n  .row {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 8px;\n  }\n  .grow {\n    flex: 1;\n  }\n  .muted {\n    color: var(--t-muted);\n  }\n  .warn {\n    color: var(--t-warn);\n    font-weight: 600;\n  }\n  button {\n    font: inherit;\n    padding: 3px 12px;\n    border: 1px solid var(--t-line);\n    background: var(--t-head);\n    color: var(--t-fg);\n    border-radius: 4px;\n    cursor: pointer;\n  }\n  button.primary {\n    background: var(--t-accent);\n    border-color: var(--t-accent);\n    color: #fff;\n    font-weight: 600;\n  }\n  button:disabled {\n    opacity: 0.5;\n    cursor: default;\n  }\n  select,\n  input[type='text'] {\n    font: inherit;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 3px;\n    padding: 1px 4px;\n  }\n  .gridbox {\n    flex: 1;\n    min-height: 120px;\n    overflow: auto;\n    border: 1px solid var(--t-line);\n    border-radius: 4px;\n    position: relative;\n  }\n  table.grid {\n    border-collapse: collapse;\n    width: 100%;\n  }\n  table.grid th {\n    position: sticky;\n    top: 0;\n    background: var(--t-head);\n    text-align: left;\n    font-weight: 600;\n    z-index: 1;\n  }\n  table.grid th,\n  table.grid td {\n    border-bottom: 1px solid var(--t-line);\n    padding: 3px 6px;\n    vertical-align: top;\n  }\n  table.grid tr.sel td {\n    background: var(--t-sel);\n  }\n  table.grid tr.oneform td {\n    background: var(--t-head);\n  }\n  textarea.results {\n    font: 12px/1.4 Consolas, 'Cascadia Mono', monospace;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 4px;\n    height: 90px;\n    resize: vertical;\n    white-space: pre-wrap;\n  }\n  /* the busy panel over a grid */\n  .busy {\n    position: absolute;\n    inset: 0;\n    display: none;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 12px;\n    background: var(--t-bg);\n    z-index: 5;\n  }\n  .spinner {\n    width: 32px;\n    height: 32px;\n    border: 4px solid var(--t-line);\n    border-top-color: var(--t-accent);\n    border-radius: 50%;\n    animation: tspin 0.8s linear infinite;\n  }\n  @keyframes tspin {\n    to {\n      transform: rotate(360deg);\n    }\n  }\n  .track {\n    width: 60%;\n    max-width: 420px;\n    height: 8px;\n    background: var(--t-line);\n    border-radius: 4px;\n    overflow: hidden;\n  }\n  .track > div {\n    height: 100%;\n    width: 0;\n    background: var(--t-accent);\n    transition: width 0.2s;\n  }\n  /* dialogs drawn in the page */\n  .modal {\n    position: fixed;\n    inset: 0;\n    background: rgba(0, 0, 0, 0.35);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    z-index: 20;\n  }\n  .modal .box {\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 6px;\n    padding: 14px 16px;\n    max-width: 640px;\n    width: 90%;\n    max-height: 85%;\n    overflow: auto;\n    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);\n  }\n  .modal .text {\n    white-space: pre-wrap;\n    margin-bottom: 12px;\n  }\n  .modal .buttons {\n    display: flex;\n    gap: 8px;\n    justify-content: flex-end;\n    margin-top: 10px;\n  }\n  .bookgrid {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));\n    gap: 2px 8px;\n    margin: 8px 0;\n  }\n\n      #intro {\n        max-width: 1000px;\n      }\n      td.num {\n        text-align: right;\n      }\n      td.small {\n        font-size: 12px;\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"row\"><b id=\"title\"></b><span class=\"muted\" id=\"project\"></span></div>\n    <div id=\"intro\" class=\"muted\"></div>\n    <div class=\"row\">\n      <label><input type=\"checkbox\" id=\"oneForm\" /> <span id=\"oneFormLabel\"></span></label>\n      <span class=\"grow\"></span>\n      <button id=\"books\"></button>\n      <button id=\"rescan\"></button>\n    </div>\n    <div id=\"warning\" class=\"warn\"></div>\n    <div class=\"gridbox\" id=\"gridbox\"><table class=\"grid\" id=\"grid\"></table></div>\n    <div id=\"consistent\" class=\"muted\"></div>\n    <div id=\"other\" class=\"muted\"></div>\n    <div class=\"row\">\n      <button id=\"all\"></button>\n      <button id=\"clear\"></button>\n      <span class=\"grow\"></span>\n      <button class=\"primary\" id=\"convert\"></button>\n    </div>\n    <div class=\"muted\" id=\"resultsLabel\"></div>\n    <textarea class=\"results\" id=\"results\" readonly></textarea>\n    <script>\n      \n  const BOOT = __BOOT__;\n  const papi = require('@papi/frontend');\n  const S = BOOT.strings;\n  const $ = (id) => document.getElementById(id);\n\n  function fmt(s, ...args) {\n    return String(s).replace(/\\{(\\d+)\\}/g, (m, n) => (args[n] === undefined ? m : String(args[n])));\n  }\n\n  function esc(s) {\n    return String(s === null || s === undefined ? '' : s)\n      .replace(/&/g, '&amp;')\n      .replace(/</g, '&lt;')\n      .replace(/>/g, '&gt;')\n      .replace(/\"/g, '&quot;');\n  }\n\n  function cmd(name, ...args) {\n    return papi.commands.sendCommand(BOOT.id + '.' + name, ...args);\n  }\n\n  /** Shows the busy panel inside box (a .gridbox) with text and a bar (fraction, or null). */\n  function busy(box, text, fraction) {\n    let panel = box.querySelector('.busy');\n    if (!panel) {\n      panel = document.createElement('div');\n      panel.className = 'busy';\n      panel.innerHTML = '<div class=\"spinner\"></div><div class=\"btext\"></div><div class=\"track\"><div></div></div>';\n      box.appendChild(panel);\n    }\n    panel.style.display = text === null ? 'none' : 'flex';\n    if (text === null) return;\n    panel.querySelector('.btext').textContent = text;\n    panel.querySelector('.track').style.visibility = fraction === null || fraction === undefined ? 'hidden' : 'visible';\n    panel.querySelector('.track > div').style.width = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100) + '%';\n  }\n\n  /** The text for a progress record from the backend. */\n  function progressText(p) {\n    if (!p) return null;\n    if (p.phase === 'open') return [S.Opening, 0];\n    if (p.phase === 'read') return [fmt(S.Reading, p.book, p.done + 1, p.total), p.total ? (p.done / p.total) * 0.9 : 0];\n    if (p.phase === 'check') return [S.Checking, 0.95];\n    if (p.phase === 'write') return [fmt(S.Writing, p.book, p.done + 1, p.total), p.total ? p.done / p.total : 0];\n    return null;\n  }\n\n  /**\n   * Runs a backend command (scan or apply) with the busy panel over box, asking for its progress\n   * every 250 ms. args come before the run id.\n   */\n  async function withProgress(box, firstText, name, ...args) {\n    const runId = String(Date.now()) + Math.random();\n    busy(box, firstText, 0);\n    // A poll still on its way when the run ends must not show the busy panel again.\n    let finished = false;\n    const poll = setInterval(() => {\n      cmd('progress', BOOT.projectId, runId)\n        .then((p) => {\n          const t = progressText(p);\n          if (t && !finished) busy(box, t[0], t[1]);\n        })\n        .catch(() => {});\n    }, 250);\n    try {\n      return await cmd(name, BOOT.projectId, ...args, runId);\n    } finally {\n      finished = true;\n      clearInterval(poll);\n      busy(box, null);\n    }\n  }\n\n  /** A dialog in the page: resolves with the value of the button pressed. */\n  function dialog(text, buttons, extra) {\n    return new Promise((resolve) => {\n      const modal = document.createElement('div');\n      modal.className = 'modal';\n      const box = document.createElement('div');\n      box.className = 'box';\n      const t = document.createElement('div');\n      t.className = 'text';\n      t.textContent = text;\n      box.appendChild(t);\n      if (extra) box.appendChild(extra);\n      const row = document.createElement('div');\n      row.className = 'buttons';\n      buttons.forEach((b) => {\n        const btn = document.createElement('button');\n        btn.textContent = b.label;\n        if (b.primary) btn.className = 'primary';\n        btn.addEventListener('click', () => {\n          if (b.check && !b.check()) return;\n          modal.remove();\n          resolve(b.value);\n        });\n        row.appendChild(btn);\n      });\n      box.appendChild(row);\n      modal.appendChild(box);\n      document.body.appendChild(modal);\n      const first = row.querySelector('button.primary') || row.querySelector('button');\n      if (first) first.focus();\n    });\n  }\n\n  function ask(text) {\n    return dialog(text, [\n      { label: S.Yes, value: true, primary: true },\n      { label: S.No, value: false },\n    ]);\n  }\n\n  function tell(text) {\n    return dialog(text, [{ label: S.Ok || 'OK', value: true, primary: true }]);\n  }\n\n  const OTHER_BOOKS = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');\n\n  /** The books chooser (BookChooserForm): books = [{code, num, chosen}]; resolves with the excluded codes, or null. */\n  async function chooseBooks(books) {\n    const wrap = document.createElement('div');\n    const quick = document.createElement('div');\n    quick.className = 'row';\n    const grid = document.createElement('div');\n    grid.className = 'bookgrid';\n    const boxes = books.map((b) => {\n      const label = document.createElement('label');\n      const cb = document.createElement('input');\n      cb.type = 'checkbox';\n      cb.checked = b.chosen;\n      label.append(cb, ' ' + b.code);\n      grid.appendChild(label);\n      return { b, cb };\n    });\n    const groups = [\n      [S.BooksAll, () => true],\n      [S.BooksNone, () => false],\n      [S.BooksBible, (b) => OTHER_BOOKS.indexOf(b.code) < 0],\n      [S.BooksOT, (b) => b.num >= 1 && b.num <= 39],\n      [S.BooksNT, (b) => b.num >= 40 && b.num <= 66],\n      [S.BooksDC, (b) => b.num >= 67 && b.num <= 92],\n      [S.BooksOther, (b) => OTHER_BOOKS.indexOf(b.code) >= 0],\n    ];\n    groups.forEach(([label, test]) => {\n      const btn = document.createElement('button');\n      btn.textContent = label;\n      btn.addEventListener('click', () => boxes.forEach((x) => (x.cb.checked = test(x.b))));\n      quick.appendChild(btn);\n    });\n    const note = document.createElement('div');\n    note.className = 'warn';\n    wrap.append(quick, grid, note);\n    const ok = await dialog(S.BooksIntro, [\n      {\n        label: S.Ok,\n        value: true,\n        primary: true,\n        check: () => {\n          const any = boxes.some((x) => x.cb.checked);\n          note.textContent = any ? '' : S.BooksNoneChosen;\n          return any;\n        },\n      },\n      { label: S.Cancel, value: false },\n    ], wrap);\n    if (!ok) return null;\n    return boxes.filter((x) => !x.cb.checked).map((x) => x.b.code);\n  }\n\n  function booksLabel(books) {\n    return fmt(S.BooksButton, books.filter((b) => b.chosen).length, books.length);\n  }\n\n  /**\n   * The project's folder. Paratext 10 keeps projects in %USERPROFILE%\\.paratext-10-studio\\projects\\\n   * Paratext 9 Projects\\<project>; the extension's backend may not read files, so the window does.\n   * The user picks the \"Paratext 9 Projects\" folder once (showDirectoryPicker): it is remembered in\n   * IndexedDB (key __projectsRoot, for every window and project), and each window then finds its\n   * project's subfolder itself (by name, else by Settings.xml <Guid>): with no click when the\n   * permission is still granted, else with one click. Picking a single project folder also works\n   * (remembered for that project). Without showDirectoryPicker, a webkitdirectory input (read only).\n   * The folder must be this project's: its Settings.xml <Guid> must be Paratext 10's project id.\n   * Tests replace IndexedDB with window.__pcFolderStore = {get(key), put(key, handle)}.\n   */\n  const ProjectFolder = (function () {\n    let handle = null; // FileSystemDirectoryHandle of the project\n    let files = null; // Map lower-case name -> File (from the input)\n    let writable = false;\n    let label = '';\n    const DB = 'philsChecksFolders';\n    const ROOT_KEY = '__projectsRoot';\n    const MAX_FOLDERS = 500;\n\n    function rootWhere() {\n      return '%USERPROFILE%\\\\.paratext-10-studio\\\\projects\\\\Paratext 9 Projects';\n    }\n    function where() {\n      return rootWhere() + '\\\\' + (BOOT.projectName || '?');\n    }\n\n    // ------------------------------------------------ remembering (IndexedDB, or the tests' store)\n    function db() {\n      return new Promise((resolve, reject) => {\n        const req = indexedDB.open(DB, 1);\n        req.onupgradeneeded = () => req.result.createObjectStore('handles');\n        req.onsuccess = () => resolve(req.result);\n        req.onerror = () => reject(req.error);\n      });\n    }\n    function put(key, h) {\n      if (window.__pcFolderStore) return window.__pcFolderStore.put(key, h);\n      // Not waited for: remembering must never hold up using the folder.\n      db()\n        .then((d) => d.transaction('handles', 'readwrite').objectStore('handles').put(h, key))\n        .catch(() => {});\n    }\n    /** A remembered handle, or null; never waits more than a second (IndexedDB may not answer). */\n    function get(key) {\n      if (window.__pcFolderStore) return Promise.resolve(window.__pcFolderStore.get(key) || null);\n      const look = (async () => {\n        try {\n          const d = await db();\n          return await new Promise((resolve) => {\n            const req = d.transaction('handles').objectStore('handles').get(key);\n            req.onsuccess = () => resolve(req.result || null);\n            req.onerror = () => resolve(null);\n          });\n        } catch (e) {\n          return null;\n        }\n      })();\n      return Promise.race([look, new Promise((r) => setTimeout(() => r(null), 1000))]);\n    }\n\n    // ------------------------------------------------ reading\n    function decode(buf) {\n      const b = new Uint8Array(buf);\n      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));\n      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));\n      if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));\n      return new TextDecoder('utf-8').decode(b);\n    }\n\n    async function fileIn(dir, name) {\n      for await (const entry of dir.values()) if (entry.kind === 'file' && entry.name.toLowerCase() === name.toLowerCase()) return entry.getFile();\n      return null;\n    }\n\n    async function file(name) {\n      if (files) return files.get(name.toLowerCase()) || null;\n      return handle ? fileIn(handle, name) : null;\n    }\n\n    async function names() {\n      if (files) return Array.from(files.values()).map((f) => f.name);\n      const out = [];\n      if (handle) for await (const entry of handle.values()) if (entry.kind === 'file') out.push(entry.name);\n      return out;\n    }\n\n    function identity(xml, fallbackName) {\n      return {\n        guid: (/<Guid>\\s*([^<\\s]*)\\s*<\\/Guid>/.exec(xml) || [])[1] || '',\n        name: (/<Name>([^<]*)<\\/Name>/.exec(xml) || [])[1] || fallbackName,\n      };\n    }\n\n    /** Whether a Settings.xml text is this project's (the Guid; the name when the id is not a Guid). */\n    function isThisProject(xml, fallbackName) {\n      const who = identity(xml, fallbackName);\n      const id = String(BOOT.projectId || '').toLowerCase();\n      if (who.guid && /^[0-9a-f]{20,}$/.test(id)) return who.guid.toLowerCase() === id;\n      return !!BOOT.projectName && who.name === BOOT.projectName;\n    }\n\n    /** Checks the chosen folder is this project's; throws a message for the user when it is not. */\n    async function verify() {\n      const f = await file('Settings.xml');\n      if (!f) throw new Error(fmt(S.FolderNoSettings, label));\n      const xml = decode(await f.arrayBuffer());\n      if (!isThisProject(xml, label)) throw new Error(fmt(S.FolderWrongProject, identity(xml, label).name, BOOT.projectName || BOOT.projectId, where()));\n    }\n\n    async function settingsOf(dir) {\n      try {\n        const f = await fileIn(dir, 'Settings.xml');\n        return f ? decode(await f.arrayBuffer()) : null;\n      } catch (e) {\n        return null;\n      }\n    }\n\n    /**\n     * The project's folder inside a picked folder: the folder itself when it holds a Settings.xml;\n     * otherwise its subfolder named like the project, else the subfolder whose Settings.xml is this\n     * project's. A \"projects\" folder holding \"Paratext 9 Projects\" is looked into. null = not found.\n     */\n    async function findProject(dir) {\n      if (await settingsOf(dir)) return dir;\n      let base = dir;\n      try {\n        base = await dir.getDirectoryHandle('Paratext 9 Projects');\n      } catch (e) {\n        base = dir;\n      }\n      if (BOOT.projectName) {\n        try {\n          const d = await base.getDirectoryHandle(BOOT.projectName);\n          const xml = await settingsOf(d);\n          if (xml && isThisProject(xml, d.name)) return d;\n        } catch (e) {\n          // not by that name\n        }\n      }\n      let n = 0;\n      for await (const entry of base.values()) {\n        if (entry.kind !== 'directory') continue;\n        if (++n > MAX_FOLDERS) break;\n        const xml = await settingsOf(entry);\n        if (xml && isThisProject(xml, entry.name)) return entry;\n      }\n      return null;\n    }\n\n    function use(dir, mode) {\n      handle = dir;\n      files = null;\n      label = dir.name;\n      writable = mode === 'readwrite';\n    }\n\n    // ------------------------------------------------ choosing\n    /** Lets the user pick the projects folder (or a project folder). Resolves true when the project is found. */\n    async function choose(mode) {\n      if (window.showDirectoryPicker) {\n        let h = null;\n        let blocked = false;\n        const remembered = await get(ROOT_KEY);\n        const options = { id: 'philsChecksProjects', mode: mode || 'read', startIn: remembered || 'documents' };\n        try {\n          h = await window.showDirectoryPicker(options);\n        } catch (e) {\n          if (e && e.name === 'AbortError') return false;\n          try {\n            delete options.startIn; // an old or unusable remembered folder\n            h = await window.showDirectoryPicker(options);\n          } catch (e2) {\n            if (e2 && e2.name === 'AbortError') return false;\n            blocked = true; // not allowed here: the input below\n          }\n        }\n        if (!blocked && h) {\n          const project = await findProject(h);\n          if (!project) throw new Error(fmt(S.FolderNotInRoot, h.name, BOOT.projectName || BOOT.projectId));\n          use(project, mode);\n          await verify();\n          put(project === h ? BOOT.projectId : ROOT_KEY, h);\n          return true;\n        }\n      }\n      const list = await new Promise((resolve) => {\n        const input = document.createElement('input');\n        input.type = 'file';\n        input.webkitdirectory = true;\n        input.style.display = 'none';\n        input.addEventListener('change', () => resolve(input.files));\n        document.body.appendChild(input);\n        input.click();\n        setTimeout(() => input.remove(), 60000);\n      });\n      if (!list || list.length === 0) return false;\n      files = new Map();\n      handle = null;\n      writable = false;\n      Array.from(list).forEach((f) => {\n        const parts = (f.webkitRelativePath || f.name).split('/');\n        if (parts.length <= 2) {\n          files.set(f.name.toLowerCase(), f);\n          label = parts.length === 2 ? parts[0] : label;\n        }\n      });\n      await verify();\n      return true;\n    }\n\n    /** What is remembered: {handle, isRoot}, the projects folder first; or null. */\n    async function remembered() {\n      const root = await get(ROOT_KEY);\n      if (root) return { handle: root, isRoot: true };\n      const own = await get(BOOT.projectId);\n      return own ? { handle: own, isRoot: false } : null;\n    }\n\n    /**\n     * Opens the project's folder from what is remembered. ask = false: only when the permission is\n     * still granted (no prompt, no click needed); ask = true: asks for it (needs the user's click).\n     */\n    async function openRemembered(mode, ask) {\n      const r = await remembered();\n      if (!r) return false;\n      const opts = { mode: mode || 'read' };\n      let state = r.handle.queryPermission ? await r.handle.queryPermission(opts) : 'prompt';\n      if (state !== 'granted') {\n        if (!ask) return false;\n        state = await r.handle.requestPermission(opts);\n        if (state !== 'granted') return false;\n      }\n      const project = r.isRoot ? await findProject(r.handle) : r.handle;\n      if (!project) throw new Error(fmt(S.FolderNotInRoot, r.handle.name, BOOT.projectName || BOOT.projectId));\n      use(project, mode);\n      await verify();\n      return true;\n    }\n\n    return {\n      where,\n      rootWhere,\n      choose,\n      remembered,\n      openRemembered,\n      decode,\n      names,\n      chosen: () => !!(handle || files),\n      label: () => label,\n      canWrite: () => !!handle && writable,\n      async has(name) {\n        return !!(await file(name));\n      },\n      /** The file's text (BOM-aware), or null when it is not there. */\n      async readText(name) {\n        const f = await file(name);\n        return f ? decode(await f.arrayBuffer()) : null;\n      },\n      async readBytes(name) {\n        const f = await file(name);\n        return f ? new Uint8Array(await f.arrayBuffer()) : null;\n      },\n      /** {length, mtime} of a file, or null. */\n      async info(name) {\n        const f = await file(name);\n        return f ? { length: f.size, mtime: f.lastModified } : null;\n      },\n      async writeBytes(name, bytes) {\n        if (!handle || !writable) throw new Error(S.FolderReadOnly);\n        const fh = await handle.getFileHandle(name, { create: true });\n        const w = await fh.createWritable();\n        await w.write(bytes);\n        await w.close();\n      },\n    };\n  })();\n\n  /**\n   * The folder row of a window. First time: \"Choose the Paratext 9 Projects folder...\" with where\n   * it is. Afterwards the project's folder opens by itself when the permission is still granted,\n   * else \"Open the project folder (PDT15)\" does it in one click; \"Choose another folder...\" picks\n   * again. onChosen() runs once the project's folder is open.\n   */\n  async function folderBar(container, mode, onChosen) {\n    container.innerHTML = '';\n    const main = document.createElement('button');\n    main.className = 'primary';\n    const other = document.createElement('button');\n    other.textContent = S.FolderChooseOther;\n    other.style.display = 'none';\n    const status = document.createElement('span');\n    status.className = 'muted';\n    container.append(main, other, status);\n    let busyNow = false;\n    async function run(fn) {\n      if (busyNow) return;\n      busyNow = true;\n      try {\n        if (await fn()) {\n          status.textContent = fmt(S.FolderChosen, ProjectFolder.label()) + (mode === 'readwrite' && !ProjectFolder.canWrite() ? ' ' + S.FolderReadOnly : '');\n          status.className = 'muted';\n          main.textContent = fmt(S.FolderOpenProject, BOOT.projectName || ProjectFolder.label());\n          main.onclick = () => run(() => ProjectFolder.openRemembered(mode, true));\n          other.style.display = '';\n          await onChosen();\n        }\n      } catch (e) {\n        status.textContent = e && e.message ? e.message : String(e);\n        status.className = 'warn';\n      } finally {\n        busyNow = false;\n      }\n    }\n    other.addEventListener('click', () => run(() => ProjectFolder.choose(mode)));\n    const r = await ProjectFolder.remembered().catch(() => null);\n    if (r) {\n      main.textContent = fmt(S.FolderOpenProject, BOOT.projectName || r.handle.name);\n      main.onclick = () => run(() => ProjectFolder.openRemembered(mode, true));\n      other.style.display = '';\n      // No click needed while Paratext 10 still grants the permission. Resolves true when the\n      // folder opened by itself (onChosen then runs), so the window need not scan a second time;\n      // after 3 s without an answer it resolves false and the window goes on without the folder.\n      const opened = await Promise.race([\n        ProjectFolder.openRemembered(mode, false).catch(() => false),\n        new Promise((res) => setTimeout(() => res(false), 3000)),\n      ]);\n      if (opened && ProjectFolder.chosen()) {\n        run(async () => true);\n        return true;\n      }\n      return false;\n    }\n    main.textContent = S.FolderChooseRoot;\n    main.onclick = () => run(() => ProjectFolder.choose(mode));\n    status.textContent = fmt(S.FolderRootWhere, ProjectFolder.rootWhere());\n    return false;\n  }\n\n    </script>\n    <script>\n      let state = null; // the last scan\n      let books = [];\n      const ticks = new Map(); // family -> ticked\n      const chosen = new Map(); // family -> direction\n\n      function rows() {\n        if (!state) return [];\n        return state.mixed.concat($('oneForm').checked ? state.oneForm : []);\n      }\n\n      function draw() {\n        const table = $('grid');\n        table.innerHTML = '';\n        const list = rows();\n        const head = document.createElement('tr');\n        [S.ColConvert, S.ColMarker, S.ColKind, S.ColChangeTo, S.ColBare, S.ColLevels, S.ColOther, S.ColCan, S.ColCannot, S.ColWhere].forEach((h) => {\n          const th = document.createElement('th');\n          th.textContent = h;\n          head.appendChild(th);\n        });\n        table.appendChild(head);\n        list.forEach((r) => {\n          const dir = chosen.get(r.family) || r.defaultDirection;\n          const info = r.byDirection[dir];\n          const tr = document.createElement('tr');\n          if (r.kind === 'oneForm') tr.className = 'oneform';\n          const tick = document.createElement('input');\n          tick.type = 'checkbox';\n          tick.checked = !!ticks.get(r.family);\n          tick.disabled = !info.canConvert;\n          tick.addEventListener('change', () => {\n            ticks.set(r.family, tick.checked);\n            updateButtons();\n          });\n          let change;\n          if (r.directions.length > 1) {\n            change = document.createElement('select');\n            r.directions.forEach((d) => {\n              const o = document.createElement('option');\n              o.value = d;\n              o.textContent = r.byDirection[d].label;\n              change.appendChild(o);\n            });\n            change.value = dir;\n            change.addEventListener('change', () => {\n              chosen.set(r.family, change.value);\n              draw();\n            });\n          } else {\n            change = document.createElement('span');\n            change.textContent = info.label;\n          }\n          const cells = [tick, '\\\\' + r.family, r.kind === 'mixed' ? S.KindMixed : S.KindOneForm, change, r.bare, r.levels, r.other, info.canConvert, info.cannotEdit, info.where];\n          cells.forEach((c, i) => {\n            const td = document.createElement('td');\n            if (c instanceof Node) td.appendChild(c);\n            else td.textContent = c;\n            if (i === 4) td.className = 'num';\n            if (i >= 7) td.className = 'small';\n            tr.appendChild(td);\n          });\n          table.appendChild(tr);\n        });\n        $('warning').textContent = warning(list);\n        $('consistent').textContent = fmt(S.ConsistentHeader, state && state.consistent ? state.consistent : S.ConsistentNone);\n        $('other').textContent = state && state.showOther ? S.OtherNote : '';\n        updateButtons();\n      }\n\n      function warning(list) {\n        if (!state) return '';\n        if (list.length === 0 || state.mixed.length === 0) return S.MixedNone;\n        if (!state.canEdit) return S.NoPermissionP10;\n        return '';\n      }\n\n      function tickedChoices() {\n        const out = {};\n        rows().forEach((r) => {\n          if (ticks.get(r.family)) out[r.family] = chosen.get(r.family) || r.defaultDirection;\n        });\n        return out;\n      }\n\n      function updateButtons() {\n        const can = !!state && state.canEdit && rows().length > 0;\n        $('all').disabled = !can || state.mixed.length === 0;\n        $('clear').disabled = !can;\n        $('convert').disabled = !can;\n      }\n\n      async function scan() {\n        $('results').value = $('results').value || '';\n        try {\n          books = await cmd('books', BOOT.projectId);\n          $('books').textContent = booksLabel(books);\n          state = await withProgress($('gridbox'), S.Opening, 'scan');\n          if (state.failed.length > 0) $('results').value = fmt(S.NotRead, state.failed.join('; '));\n        } catch (e) {\n          state = null;\n          $('results').value = fmt(S.Error, e && e.message ? e.message : e);\n        }\n        draw();\n      }\n\n      async function convert() {\n        const choices = tickedChoices();\n        const names = Object.keys(choices);\n        if (names.length === 0) {\n          await tell(S.NothingSelected);\n          return;\n        }\n        const label = names.map((n) => fmt(choices[n] === 'RemoveNumber' ? S.DirRemove : S.DirAdd, n)).join(', ');\n        const bookSet = new Set();\n        rows().forEach((r) => {\n          if (choices[r.family]) r.byDirection[choices[r.family]].canConvert.split(', ').filter(Boolean).forEach((b) => bookSet.add(b));\n        });\n        if (!(await ask(fmt(S.ConfirmP10, label, bookSet.size)))) return;\n        let report;\n        try {\n          report = await withProgress($('gridbox'), S.Opening, 'apply', { choices });\n        } catch (e) {\n          await tell(fmt(S.Error, e && e.message ? e.message : e));\n          return;\n        }\n        const lines = [];\n        report.changes.forEach((c) => lines.push(fmt(c.direction === 'RemoveNumber' ? S.ResChangeRemove : S.ResChange, c.book, c.family, c.count)));\n        lines.push(report.changes.length > 0 ? fmt(S.ResTotal, report.total, report.booksChanged) : S.ResNothing);\n        if (report.noPermission.length > 0) lines.push(fmt(S.ResNoPermission, report.noPermission.join(', ')));\n        if (report.changed.length > 0) lines.push(fmt(S.ResChanged, report.changed.join(', ')));\n        report.failed.forEach((f) => lines.push(fmt(S.ResFailed, f)));\n        if (report.backups > 0) lines.push(fmt(S.ResBackupsP10, report.backups));\n        ticks.clear();\n        await scan();\n        $('results').value = lines.join('\\n');\n      }\n\n      async function chooseAndRescan() {\n        const excluded = await chooseBooks(books);\n        if (excluded === null) return;\n        await cmd('saveBooks', BOOT.projectId, excluded);\n        await scan();\n      }\n\n      $('title').textContent = S.Title + ' ' + (BOOT.version || '');\n      $('project').textContent = BOOT.projectName ? fmt(S.ProjectLabel, BOOT.projectName) : '';\n      $('intro').textContent = S.Intro + ' ' + S.IntroRemove;\n      $('oneFormLabel').textContent = S.ShowOneForm;\n      $('rescan').textContent = S.Rescan;\n      $('all').textContent = S.SelectAll;\n      $('clear').textContent = S.Clear;\n      $('convert').textContent = S.ConvertButton;\n      $('resultsLabel').textContent = S.ResultsLabel;\n      $('books').textContent = fmt(S.BooksButton, '?', '?');\n      $('oneForm').addEventListener('change', draw);\n      $('rescan').addEventListener('click', scan);\n      $('books').addEventListener('click', chooseAndRescan);\n      $('all').addEventListener('click', () => {\n        if (state) state.mixed.forEach((r) => ticks.set(r.family, true));\n        draw();\n      });\n      $('clear').addEventListener('click', () => {\n        ticks.clear();\n        draw();\n      });\n      $('convert').addEventListener('click', convert);\n      scan();\n    </script>\n  </body>\n</html>\n";
// NumberedMarkers backend (src/tools/numbered-markers/backend.js), in its own scope.
const NumberedMarkers = (function () {
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

})();
// Numbered Book Titles core: a port of Numbered_Book_Titles\NumberedBookTitlesPlugin\TitleScanner.cs
// and the text part of FixRunner.cs. How the numbered books (1SA ... 3JN) write their number in
// \h, \toc1-3, \mt (and BookNames.xml, which Paratext 10 does not give extensions: those fields
// are passed as null and so never compared). No papi here.
var NBTCore = (function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;

  var STYLES = ['Digit', 'DigitNbsp', 'DigitNoSpace', 'DigitPeriod', 'DigitSuffix', 'Roman', 'AfterDigit', 'AfterRoman', 'Word'];
  var S = {};
  STYLES.forEach(function (n, i) {
    S[n] = i;
  });
  var FIELDS = ['H', 'Toc1', 'Toc2', 'Toc3', 'Mt', 'BookNamesLong', 'BookNamesShort', 'BookNamesAbbr'];
  var F = {};
  FIELDS.forEach(function (n, i) {
    F[n] = i;
  });

  var HEADER_MARKER = R.compile('^\\\\(toc1|toc2|toc3|mt[0-9]?|h)[ \\t]+([^\\r\\n]*)', R.MULTILINE);
  var WS_RUN = R.compile('[ \\t]+');
  var LEAD_DIGIT = R.compile('^(\\d+)(.*)$', R.DOTALL);
  var SUFFIX = R.compile(
    '^\\.?[\\u00AA\\u00BA\\u00B0]|^\\.?(?:st|nd|rd|th|er|re|ere|\\u00E8re|eme|\\u00E8me|e|ra|ro|o|a)(?=[ \\u00A0.]|$)',
  );
  var LEAD_ROMAN = R.compile('^(I{1,3})[ \\u00A0]');
  var TRAIL_DIGIT = R.compile('[ \\u00A0](\\d+)$');
  var TRAIL_ROMAN = R.compile('[ \\u00A0](I{1,3})$');
  var FIRST_WORD = R.compile('^\\S+');
  var CHAPTER_RE = R.compile('\\\\c[ \\t]+(\\d+)');

  function isNumberedBook(num, code) {
    return num >= 1 && num <= 66 && code.length === 3 && code[0] >= '1' && code[0] <= '3';
  }

  /** CR removed, LF a space, runs of spaces/tabs one space, then trimmed (.NET Trim). */
  function collapseWs(s) {
    if (s === null || s === undefined) return s;
    return T.strip(R.sub(WS_RUN, s.replace(/\r/g, '').replace(/\n/g, ' '), ' '));
  }

  /** A literal // (a soft line break) counts as a space. */
  function stripSoftBreaks(s) {
    return collapseWs(s.split('//').join(' '));
  }

  function trimStartChars(s, chars) {
    var i = 0;
    while (i < s.length && chars.indexOf(s[i]) >= 0) i++;
    return s.substring(i);
  }
  function trimEndChars(s, chars) {
    var i = s.length;
    while (i > 0 && chars.indexOf(s[i - 1]) >= 0) i--;
    return s.substring(0, i);
  }
  var SPACES = ' \u00A0';

  /** {style, token}: how the number is written, and the part that shows it. */
  function styleOf(text) {
    var m = R.search(LEAD_DIGIT, text, 0);
    if (m) {
      var digits = m[1];
      var rest = m[2];
      var sm = R.search(SUFFIX, rest, 0);
      if (sm) return { style: S.DigitSuffix, token: digits + sm[0] };
      if (rest[0] === '.') return { style: S.DigitPeriod, token: digits + '.' };
      if (rest[0] === '\u00A0') return { style: S.DigitNbsp, token: digits };
      if (rest[0] === ' ' || rest.length === 0) return { style: S.Digit, token: digits };
      return { style: S.DigitNoSpace, token: digits };
    }
    m = R.search(LEAD_ROMAN, text, 0);
    if (m) return { style: S.Roman, token: m[1] };
    m = R.search(TRAIL_DIGIT, text, 0);
    if (m) return { style: S.AfterDigit, token: m[1] };
    m = R.search(TRAIL_ROMAN, text, 0);
    if (m) return { style: S.AfterRoman, token: m[1] };
    m = R.search(FIRST_WORD, text, 0);
    return { style: S.Word, token: m ? m[0] : text };
  }

  /** The text without the part that shows the number (the book's name, mostly). */
  function namePart(text, style) {
    var token = styleOf(text).token;
    if (style === S.AfterDigit || style === S.AfterRoman)
      return trimEndChars(text.substring(0, Math.max(0, text.length - token.length)), SPACES);
    return trimStartChars(T.lstrip(text.substring(Math.min(token.length, text.length))), SPACES);
  }

  function roman(n) {
    return n === 1 ? 'I' : n === 2 ? 'II' : 'III';
  }

  // ------------------------------------------------------------ reading

  function asciiInt(s) {
    return /^[0-9]+$/.test(s) && s.length < 10 ? parseInt(s, 10) : NaN;
  }

  /** [start, end] of chapter 1 in the book (with the header), or null when the book has no chapter 1. */
  function chapter1Span(text) {
    var starts = [];
    R.findAll(CHAPTER_RE, text).forEach(function (m) {
      var c = asciiInt(m[1]);
      if (!isNaN(c)) starts.push([c, m.index]);
    });
    if (starts.length === 0) return [0, text.length];
    for (var i = 0; i < starts.length; i++) {
      if (starts[i][0] !== 1) continue;
      var start = i === 0 ? 0 : starts[i][1];
      var end = i + 1 < starts.length ? starts[i + 1][1] : text.length;
      return [start, end];
    }
    return null;
  }

  /** Chapter 1 (from \id to \c 2); a book with no chapter 1 is read whole (ReadChapter1). */
  function readChapter1(bookText) {
    if (bookText === null || bookText === undefined) return null;
    var span = chapter1Span(bookText);
    return span ? bookText.substring(span[0], span[1]) : bookText;
  }

  function addFirst(t, field, line, value) {
    if (t.lines.has(field)) return;
    t.lines.set(field, line);
    t.values.set(field, value);
  }

  /** The header markers of one book. */
  function readTitles(num, code, text) {
    var t = { num: num, code: code, number: code.charCodeAt(0) - 48, chapterText: text, values: new Map(), lines: new Map(), mtLines: [] };
    R.findAll(HEADER_MARKER, text).forEach(function (m) {
      var valueStart = m.index + m[0].length - m[2].length;
      var line = { marker: m[1], valueStart: valueStart, valueLength: m[2].length, value: collapseWs(m[2]) };
      if (line.marker === 'h') addFirst(t, F.H, line, line.value);
      else if (line.marker === 'toc1') addFirst(t, F.Toc1, line, stripSoftBreaks(line.value));
      else if (line.marker === 'toc2') addFirst(t, F.Toc2, line, line.value);
      else if (line.marker === 'toc3') addFirst(t, F.Toc3, line, line.value);
      else t.mtLines.push(line);
    });
    if (t.mtLines.length > 0) {
      var mt = t.mtLines
        .filter(function (l) {
          return l.value.length > 0;
        })
        .map(function (l) {
          return l.value;
        })
        .join(' ');
      t.values.set(F.Mt, stripSoftBreaks(mt));
    }
    return t;
  }

  // ------------------------------------------------------------ comparing

  function compare(result) {
    FIELDS.forEach(function (_, field) {
      var styles = new Map(); // book number -> style, in book order
      result.books.forEach(function (t) {
        var v = t.values.get(field);
        if (v) styles.set(t.num, styleOf(v).style);
      });
      if (styles.size < 2) return;
      var r = { field: field, usual: null, counts: new Map(), outliers: new Map() };
      styles.forEach(function (st) {
        r.counts.set(st, (r.counts.get(st) || 0) + 1);
      });
      var top = Math.max.apply(null, Array.from(r.counts.values()));
      var leaders = Array.from(r.counts.entries())
        .filter(function (kv) {
          return kv[1] === top;
        })
        .map(function (kv) {
          return kv[0];
        });
      if (leaders.length === 1) {
        r.usual = leaders[0];
        styles.forEach(function (st, num) {
          if (st !== r.usual) r.outliers.set(num, st);
        });
        result.issueCount += r.outliers.size;
      } else {
        styles.forEach(function (st, num) {
          r.outliers.set(num, st);
        });
        result.issueCount += 1;
      }
      if (r.outliers.size === 0) return;
      result.results.push(r);
      Array.from(r.outliers.keys())
        .sort(function (a, b) {
          return a - b;
        })
        .forEach(function (num) {
          var t = result.books.find(function (b) {
            return b.num === num;
          });
          var text = t.values.get(field);
          var so = styleOf(text);
          result.issues.push({
            titles: t,
            result: r,
            field: field,
            text: text,
            style: so.style,
            token: so.token,
            target: targetLine(t, field, so.style),
            suggestion: null,
            newValue: null,
          });
        });
    });
  }

  /** The marker line a fix changes: for \mt the first non-empty line, or the last when the number follows the name. */
  function targetLine(t, field, style) {
    if (field === F.Mt) {
      var lines = t.mtLines.filter(function (l) {
        return l.value.length > 0;
      });
      if (lines.length === 0) return null;
      return style === S.AfterDigit || style === S.AfterRoman ? lines[lines.length - 1] : lines[0];
    }
    return t.lines.get(field) || null;
  }

  // ------------------------------------------------------------ suggestions

  function siblingToken(issue, result, style) {
    var tokens = [];
    result.books.forEach(function (other) {
      if (other === issue.titles || other.number !== issue.titles.number) return;
      var v = other.values.get(issue.field);
      if (!v) return;
      var so = styleOf(v);
      if (so.style === style && tokens.indexOf(so.token) < 0) tokens.push(so.token);
    });
    return tokens.length === 1 ? tokens[0] : null;
  }

  function sameIgnoringCase(a, b) {
    return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
  }

  function nameConfirmed(t, name) {
    var found = false;
    t.values.forEach(function (v) {
      if (found || !v) return;
      var st = styleOf(v).style;
      if (st === S.Word) return;
      if (sameIgnoringCase(stripSoftBreaks(namePart(v, st)), name)) found = true;
    });
    return found;
  }

  function suggest(issue, result) {
    if (!issue.target || issue.result.usual === null) return null;
    var usual = issue.result.usual;
    var t = issue.titles;
    var value = issue.target.value;
    var style = styleOf(value).style;
    if (style === usual) return null;
    var name = namePart(value, style);
    if (name.length === 0) return null;
    var n = t.number;

    if (usual === S.Word) {
      var singleMt =
        t.mtLines.filter(function (l) {
          return l.value.length > 0;
        }).length === 1;
      if (issue.field === F.Toc1) {
        var mt = t.values.get(F.Mt);
        if (mt && styleOf(mt).style === S.Word) return mt;
      }
      if (issue.field === F.Mt && singleMt) {
        var toc1 = t.values.get(F.Toc1);
        if (toc1 && styleOf(toc1).style === S.Word) return toc1;
      }
      var word = siblingToken(issue, result, S.Word);
      return word === null ? null : word + ' ' + name;
    }

    if (style === S.Word && !nameConfirmed(t, stripSoftBreaks(name))) return null;

    switch (usual) {
      case S.Digit:
        return n + ' ' + name;
      case S.DigitNbsp:
        return n + '\u00A0' + name;
      case S.DigitNoSpace:
        return n + name;
      case S.DigitPeriod:
        return n + '. ' + name;
      case S.Roman:
        return roman(n) + ' ' + name;
      case S.AfterDigit:
        return name + ' ' + n;
      case S.AfterRoman:
        return name + ' ' + roman(n);
      case S.DigitSuffix: {
        var token = siblingToken(issue, result, S.DigitSuffix);
        return token === null ? null : token + ' ' + name;
      }
    }
    return null;
  }

  /**
   * Compares the numbered books. books = [{num, code, text}] (the whole book text); bookNames =
   * {code: [long, short, abbr]} or null (always null in Paratext 10).
   */
  function scan(books, bookNames) {
    var result = { books: [], results: [], issues: [], issueCount: 0, bookNamesFound: !!bookNames };
    books
      .filter(function (b) {
        return isNumberedBook(b.num, b.code);
      })
      .sort(function (a, b) {
        return a.num - b.num;
      })
      .forEach(function (b) {
        var text = readChapter1(b.text);
        if (text === null) return;
        var t = readTitles(b.num, b.code, text);
        var names = bookNames && bookNames[b.code];
        if (names)
          [F.BookNamesLong, F.BookNamesShort, F.BookNamesAbbr].forEach(function (field, i) {
            var v = stripSoftBreaks(names[i] || '');
            if (v.length > 0) t.values.set(field, v);
          });
        result.books.push(t);
      });
    compare(result);
    result.issues.forEach(function (issue) {
      issue.suggestion = suggest(issue, result);
      issue.newValue = issue.suggestion;
    });
    return result;
  }

  // ------------------------------------------------------------ fixing

  function canFix(issue) {
    return !!issue.target && !!issue.newValue && T.strip(issue.newValue).length > 0 && collapseWs(issue.newValue) !== issue.target.value;
  }

  /** The chapter text with each issue's target line set to its new text. */
  function apply(chapterText, issues) {
    var text = chapterText;
    issues
      .filter(canFix)
      .sort(function (a, b) {
        return b.target.valueStart - a.target.valueStart;
      })
      .forEach(function (i) {
        text = text.substring(0, i.target.valueStart) + T.strip(i.newValue) + text.substring(i.target.valueStart + i.target.valueLength);
      });
    return text;
  }

  /** The book text with its chapter 1 replaced (as WriteChapter(book, 1, ...) does). */
  function replaceChapter1(bookText, chapter1) {
    var span = chapter1Span(bookText);
    if (!span) return null;
    return bookText.substring(0, span[0]) + chapter1 + bookText.substring(span[1]);
  }

  /** Every fixed line holds its new text in the chapter read back (FixRunner.AllStored). */
  function allStored(num, code, text, issues) {
    var now = readTitles(num, code, text);
    return issues.every(function (i) {
      var want = collapseWs(i.newValue);
      if (i.field === F.Mt)
        return now.mtLines.some(function (l) {
          return l.marker === i.target.marker && l.value === want;
        });
      var line = now.lines.get(i.field);
      return !!line && line.value === want;
    });
  }

  /**
   * TitleScanner.LoadBookNames: BookNames.xml as {code: [long, short, abbr]}, or null when it
   * cannot be read. Uses the XML reader of the Project Settings core (PSCore.parseXml).
   */
  function parseBookNames(xmlText) {
    if (!xmlText) return null;
    var root;
    try {
      root = PSCore.parseXml(xmlText);
    } catch (e) {
      return null;
    }
    if (!root) return null;
    var names = {};
    root.children.forEach(function (el) {
      if (el.type !== 'el' || el.name !== 'book') return;
      var get = function (n) {
        for (var i = 0; i < el.attrs.length; i++) if (el.attrs[i][0] === n) return el.attrs[i][1];
        return '';
      };
      var code = get('code');
      if (!code) return;
      names[code] = [get('long'), get('short'), get('abbr')];
    });
    return names;
  }

  return {
    parseBookNames: parseBookNames,
    STYLES: STYLES,
    FIELDS: FIELDS,
    S: S,
    F: F,
    isNumberedBook: isNumberedBook,
    collapseWs: collapseWs,
    styleOf: styleOf,
    readChapter1: readChapter1,
    readTitles: readTitles,
    scan: scan,
    canFix: canFix,
    apply: apply,
    replaceChapter1: replaceChapter1,
    allStored: allStored,
  };
})();

const NBT_STRINGS = {"en": {"AllHint": "Highlighted cells write the number differently from the usual style in their column. Double-click a book to go to its header.", "BookNamesFix": "(change in Paratext: Scripture reference settings..., Book names tab)", "BookNamesFromFolder": "Book names are read from BookNames.xml in the project folder you chose. They can only be changed in Paratext: Scripture reference settings..., Book names tab.", "BookNamesMissing": "BookNames.xml was not found, so the book names are not included.", "BookNamesP10": "Book names (BookNames.xml) cannot be read in Paratext 10 yet, so they are not compared. Check them in Paratext 9: Scripture reference settings..., Book names tab.", "BooksAll": "All", "BooksBible": "Bible books", "BooksButton": "Books: {0} of {1}...", "BooksDC": "Deuterocanon", "BooksIntro": "Tick the books to examine. Only the numbered books (1SA-2CH, 1CO-3JN) are compared. The choice is saved for this project.", "BooksNT": "New Testament", "BooksNone": "None", "BooksNoneChosen": "Tick at least one book.", "BooksOT": "Old Testament", "BooksOther": "Other books", "BooksTitle": "Books to examine", "Cancel": "Cancel", "CannotEdit": "cannot edit", "Checking": "Comparing the titles...", "ClearAll": "Untick all", "Close": "Close", "ColBook": "Book", "ColChangeTo": "Change to", "ColField": "Field", "ColFix": "Change", "ColLine": "Line", "ColNow": "Now", "ColPermission": "Permission", "ColStyle": "How the number is written", "ColUsual": "Usual in this field", "Confirm": "Change {0} line(s) in {1} book(s) you can edit?\n\nA point is first added to the project history, and each changed book is saved as a .bak file in:\n{2}", "ConfirmP10": "Change {0} line(s) in {1} book(s)?\n\nThe text of each book is first kept in the Phils Checks extension's storage (Paratext 10 does not let extensions add a point to the project history).", "ConfirmTitle": "Change numbered book titles", "Counts": "{0} difference(s), {1} can be changed here, {2} ticked.", "Description": "Checks that the numbered books (1 Samuel to 3 John) write their number the same way in \\h, \\toc1, \\toc2, \\toc3, \\mt and the book names (1 John, 1st John, I John, First John, ...), and changes the lines you tick to the usual style.", "Error": "Numbered Book Titles could not finish:\n{0}", "FieldNames": ["\\h", "\\toc1", "\\toc2", "\\toc3", "\\mt", "BookNames.xml (long)", "BookNames.xml (short)", "BookNames.xml (abbr)"], "FixButton": "Change ticked lines ({0})", "FolderChooseOther": "Choose another folder...", "FolderChooseRoot": "Choose the Paratext 9 Projects folder...", "FolderChosen": "Folder: {0}", "FolderNoSettings": "This folder has no Settings.xml, so it is not a Paratext project folder: {0}", "FolderNone": "No folder chosen yet.", "FolderNotAllowed": "Paratext 10 did not allow the folder to be read: {0}", "FolderNotInRoot": "The folder {0} has no folder for the project {1}.", "FolderOpenProject": "Open the project folder ({0})", "FolderReadOnly": "The folder can be read but not written to here, so Save will download the file instead.", "FolderRootWhere": "Only once: choose the folder where Paratext 10 keeps its projects, {0}. After that each window finds its project's folder by itself.", "FolderWrongProject": "This is the folder of project {0}, not of the project open here ({1}). Choose the folder {2}.", "GoToButton": "Go to in Paratext", "HistoryMessage": "Numbered Book Titles: before changing {0} header line(s)", "HistoryNoFolder": "the project folder or its history (.hg) was not found", "HistoryNotRecorded": "Paratext did not record the history point (the project may be in use)", "HistoryStopped": "Could not add a point to the project history, so nothing was changed: {0}\n\nFinish or close any editing in this project, then try again.", "Intro": "Each field is compared on its own across the numbered books (1SA-2CH, 1CO-3JN): the way most books write the number there is the usual one, and the books listed below write it differently. Check or type the text in \"Change to\", tick the rows to change, then click Change. Double-click a row (or select it and click Go to in Paratext) to go to the book's header in Paratext.", "MenuText": "Numbered Book Titles...", "Missing": "missing", "No": "No", "NoNumberedBooks": "This project has fewer than two numbered books, so there is nothing to compare.", "NoPermissionP10": "You do not have permission to edit this project, so nothing can be changed.", "NoProblems": "Every field writes the number the same way in every numbered book.", "NoSuggestion": "(type the new text)", "NoUsual": "No usual style: {0}", "NoUsualShort": "(no usual style)", "NotRead": "Not read: {0}", "NotSaved": "Paratext did not save the change as written", "NothingSelected": "Tick at least one line to change.", "Ok": "OK", "OpenProjectFirst": "Open a project in a Scripture window first, then choose Numbered Book Titles...", "Opening": "Opening the project...", "ProjectLabel": "Project: {0}", "Reading": "Reading {0} ({1} of {2})...", "ResBackups": "Backups of the changed books are in: {0}", "ResBackupsP10": "The old text of the {0} changed book(s) is kept in the Phils Checks extension's storage.", "ResBusy": "Not changed, because the text is in use (finish editing it, then try again): {0}", "ResChanged": "Not changed, because the text changed after the scan (scan again, then try again): {0}", "ResFailed": "Could not change: {0}", "ResFixed": "{0}: {1} line(s) changed", "ResNoPermission": "Not changed, because you do not have permission to edit: {0}", "ResNothing": "Nothing was changed.", "ResTotal": "Changed: {0} line(s) in {1} book(s).", "Rescan": "Scan again", "ResultsLabel": "Results: after you click Change, the changes made (and anything not changed) are listed here.", "Scanning": "Reading {0}...", "SelectAll": "Tick all that can change", "SomeNotEditable": "Some books are ones you cannot edit. Their rows cannot be ticked.", "StyleNames": ["Number and space (1 John)", "Number and non-breaking space", "Number with no space (1John)", "Number and period (1. John)", "Number with an ending (1st, 1.\u00ba, 1\u00aa)", "Roman numeral (I John)", "Number after the name (John 1)", "Roman numeral after the name (John I)", "Word (First)"], "Summary": "{0} numbered book(s), {1} inconsistency(ies) found.", "TabAll": "All numbered books", "TabIssues": "Differences", "Title": "Numbered Book Titles", "UsualCount": "{0} ({1} of {2} books)", "UsualRow": "Usual", "Writing": "Changing {0} ({1} of {2})...", "Yes": "Yes"}, "es": {"AllHint": "Las celdas resaltadas escriben el n\u00famero de forma distinta al estilo habitual de su columna. Haga doble clic en un libro para ir a su encabezado.", "BookNamesFix": "(c\u00e1mbielo en Paratext: Configuraci\u00f3n de referencias b\u00edblicas..., pesta\u00f1a Nombres de libros)", "BookNamesFromFolder": "Los nombres de los libros se leen de BookNames.xml en la carpeta del proyecto que eligi\u00f3. Solo se pueden cambiar en Paratext: Configuraci\u00f3n de referencias de Escritura..., pesta\u00f1a Nombres de libros.", "BookNamesMissing": "No se encontr\u00f3 BookNames.xml, as\u00ed que los nombres de libros no se incluyen.", "BookNamesP10": "Los nombres de los libros (BookNames.xml) todav\u00eda no se pueden leer en Paratext 10, as\u00ed que no se comparan. Rev\u00edselos en Paratext 9: Configuraci\u00f3n de referencias de Escritura..., pesta\u00f1a Nombres de libros.", "BooksAll": "Todos", "BooksBible": "Libros de la Biblia", "BooksButton": "Libros: {0} de {1}...", "BooksDC": "Deuterocan\u00f3nicos", "BooksIntro": "Marque los libros que se examinan. Solo se comparan los libros numerados (1SA-2CH, 1CO-3JN). La elecci\u00f3n se guarda para este proyecto.", "BooksNT": "Nuevo Testamento", "BooksNone": "Ninguno", "BooksNoneChosen": "Marque por lo menos un libro.", "BooksOT": "Antiguo Testamento", "BooksOther": "Otros libros", "BooksTitle": "Libros que se examinan", "Cancel": "Cancelar", "CannotEdit": "no puede editar", "Checking": "Comparando los t\u00edtulos...", "ClearAll": "Desmarcar todas", "Close": "Cerrar", "ColBook": "Libro", "ColChangeTo": "Cambiar a", "ColField": "Campo", "ColFix": "Cambiar", "ColLine": "L\u00ednea", "ColNow": "Ahora", "ColPermission": "Permiso", "ColStyle": "C\u00f3mo se escribe el n\u00famero", "ColUsual": "Lo habitual en este campo", "Confirm": "\u00bfCambiar {0} l\u00ednea(s) en {1} libro(s) que usted puede editar?\n\nPrimero se agrega un punto al historial del proyecto, y cada libro cambiado se guarda como archivo .bak en:\n{2}", "ConfirmP10": "\u00bfCambiar {0} l\u00ednea(s) en {1} libro(s)?\n\nEl texto de cada libro se guarda primero en el almacenamiento de la extensi\u00f3n Phils Checks (Paratext 10 no permite que las extensiones a\u00f1adan un punto al historial del proyecto).", "ConfirmTitle": "Cambiar t\u00edtulos de libros numerados", "Counts": "{0} diferencia(s), {1} se pueden cambiar aqu\u00ed, {2} marcada(s).", "Description": "Revisa que los libros numerados (1 Samuel a 3 Juan) escriban su n\u00famero de la misma forma en \\h, \\toc1, \\toc2, \\toc3, \\mt y los nombres de libros (1 Juan, 1.\u00ba Juan, I Juan, Primera de Juan, ...), y cambia las l\u00edneas que usted marque al estilo habitual.", "Error": "T\u00edtulos de libros numerados no pudo terminar:\n{0}", "FieldNames": ["\\h", "\\toc1", "\\toc2", "\\toc3", "\\mt", "BookNames.xml (nombre largo)", "BookNames.xml (nombre corto)", "BookNames.xml (abreviatura)"], "FixButton": "Cambiar las l\u00edneas marcadas ({0})", "FolderChooseOther": "Elegir otra carpeta...", "FolderChooseRoot": "Elegir la carpeta Paratext 9 Projects...", "FolderChosen": "Carpeta: {0}", "FolderNoSettings": "Esta carpeta no tiene Settings.xml, as\u00ed que no es la carpeta de un proyecto de Paratext: {0}", "FolderNone": "Todav\u00eda no se ha elegido una carpeta.", "FolderNotAllowed": "Paratext 10 no permiti\u00f3 leer la carpeta: {0}", "FolderNotInRoot": "La carpeta {0} no tiene una carpeta para el proyecto {1}.", "FolderOpenProject": "Abrir la carpeta del proyecto ({0})", "FolderReadOnly": "La carpeta se puede leer pero aqu\u00ed no se puede escribir en ella, as\u00ed que Guardar descargar\u00e1 el archivo.", "FolderRootWhere": "Solo una vez: elija la carpeta donde Paratext 10 guarda sus proyectos, {0}. Despu\u00e9s cada ventana encuentra sola la carpeta de su proyecto.", "FolderWrongProject": "Esta es la carpeta del proyecto {0}, no del proyecto abierto aqu\u00ed ({1}). Elija la carpeta {2}.", "GoToButton": "Ir en Paratext", "HistoryMessage": "T\u00edtulos de libros numerados: antes de cambiar {0} l\u00ednea(s) de encabezado", "HistoryNoFolder": "no se encontr\u00f3 la carpeta del proyecto o su historial (.hg)", "HistoryNotRecorded": "Paratext no registr\u00f3 el punto del historial (puede que el proyecto est\u00e9 en uso)", "HistoryStopped": "No se pudo agregar un punto al historial del proyecto, as\u00ed que no se cambi\u00f3 nada: {0}\n\nTermine o cierre cualquier edici\u00f3n en este proyecto y vuelva a intentarlo.", "Intro": "Cada campo se compara por separado entre los libros numerados (1SA-2CH, 1CO-3JN): la forma en que la mayor\u00eda de los libros escribe el n\u00famero all\u00ed es la habitual, y los libros de la lista la escriben de otra forma. Revise o escriba el texto en \"Cambiar a\", marque las filas que desea cambiar y haga clic en Cambiar. Haga doble clic en una fila (o selecci\u00f3nela y haga clic en Ir en Paratext) para ir al encabezado del libro en Paratext.", "MenuText": "T\u00edtulos de libros numerados...", "Missing": "ausente", "No": "No", "NoNumberedBooks": "Este proyecto tiene menos de dos libros numerados, as\u00ed que no hay nada que comparar.", "NoPermissionP10": "No tiene permiso para editar este proyecto, as\u00ed que no se puede cambiar nada.", "NoProblems": "Cada campo escribe el n\u00famero de la misma forma en todos los libros numerados.", "NoSuggestion": "(escriba el texto nuevo)", "NoUsual": "Sin estilo habitual: {0}", "NoUsualShort": "(sin estilo habitual)", "NotRead": "No se ley\u00f3: {0}", "NotSaved": "Paratext no guard\u00f3 el cambio tal como se escribi\u00f3", "NothingSelected": "Marque al menos una l\u00ednea para cambiar.", "Ok": "Aceptar", "OpenProjectFirst": "Abra primero un proyecto en una ventana de Escritura y luego elija T\u00edtulos de libros numerados...", "Opening": "Abriendo el proyecto...", "ProjectLabel": "Proyecto: {0}", "Reading": "Leyendo {0} ({1} de {2})...", "ResBackups": "Las copias de seguridad de los libros cambiados est\u00e1n en: {0}", "ResBackupsP10": "El texto anterior de los {0} libro(s) cambiados se guarda en el almacenamiento de la extensi\u00f3n Phils Checks.", "ResBusy": "No se cambiaron, porque el texto est\u00e1 en uso (termine de editarlo y vuelva a intentarlo): {0}", "ResChanged": "No se cambiaron, porque el texto cambi\u00f3 despu\u00e9s de la revisi\u00f3n (revise de nuevo y vuelva a intentarlo): {0}", "ResFailed": "No se pudo cambiar: {0}", "ResFixed": "{0}: {1} l\u00ednea(s) cambiada(s)", "ResNoPermission": "No se cambiaron, porque usted no tiene permiso para editar: {0}", "ResNothing": "No se cambi\u00f3 nada.", "ResTotal": "Cambiado: {0} l\u00ednea(s) en {1} libro(s).", "Rescan": "Revisar de nuevo", "ResultsLabel": "Resultados: despu\u00e9s de hacer clic en Cambiar, aqu\u00ed se muestran los cambios hechos (y lo que no se cambi\u00f3).", "Scanning": "Leyendo {0}...", "SelectAll": "Marcar todas las que se pueden cambiar", "SomeNotEditable": "Algunos libros son libros que usted no puede editar. Sus filas no se pueden marcar.", "StyleNames": ["N\u00famero y espacio (1 Juan)", "N\u00famero y espacio de no separaci\u00f3n", "N\u00famero sin espacio (1Juan)", "N\u00famero y punto (1. Juan)", "N\u00famero con terminaci\u00f3n (1.\u00ba, 1\u00aa, 1st)", "N\u00famero romano (I Juan)", "N\u00famero despu\u00e9s del nombre (Juan 1)", "N\u00famero romano despu\u00e9s del nombre (Juan I)", "Palabra (Primera)"], "Summary": "{0} libro(s) numerado(s), {1} incoherencia(s) encontrada(s).", "TabAll": "Todos los libros numerados", "TabIssues": "Diferencias", "Title": "T\u00edtulos de libros numerados", "UsualCount": "{0} ({1} de {2} libros)", "UsualRow": "Habitual", "Writing": "Cambiando {0} ({1} de {2})...", "Yes": "S\u00ed"}, "fr": {"AllHint": "Les cellules en surbrillance \u00e9crivent le num\u00e9ro autrement que le style habituel de leur colonne. Double-cliquez sur un livre pour aller \u00e0 son en-t\u00eate.", "BookNamesFix": "(\u00e0 modifier dans Paratext\u00a0: Param\u00e8tres des r\u00e9f\u00e9rences bibliques..., onglet Noms des livres)", "BookNamesFromFolder": "Les noms des livres sont lus dans BookNames.xml du dossier du projet que vous avez choisi. Ils ne peuvent \u00eatre modifi\u00e9s que dans Paratext : Param\u00e8tres des r\u00e9f\u00e9rences bibliques..., onglet Noms des livres.", "BookNamesMissing": "BookNames.xml est introuvable\u00a0: les noms des livres ne sont donc pas inclus.", "BookNamesP10": "Les noms des livres (BookNames.xml) ne peuvent pas encore \u00eatre lus dans Paratext 10 ; ils ne sont donc pas compar\u00e9s. V\u00e9rifiez-les dans Paratext 9 : Param\u00e8tres des r\u00e9f\u00e9rences bibliques..., onglet Noms des livres.", "BooksAll": "Tous", "BooksBible": "Livres de la Bible", "BooksButton": "Livres : {0} sur {1}...", "BooksDC": "Deut\u00e9rocanoniques", "BooksIntro": "Cochez les livres \u00e0 examiner. Seuls les livres num\u00e9rot\u00e9s (1SA-2CH, 1CO-3JN) sont compar\u00e9s. Le choix est enregistr\u00e9 pour ce projet.", "BooksNT": "Nouveau Testament", "BooksNone": "Aucun", "BooksNoneChosen": "Cochez au moins un livre.", "BooksOT": "Ancien Testament", "BooksOther": "Autres livres", "BooksTitle": "Livres \u00e0 examiner", "Cancel": "Annuler", "CannotEdit": "lecture seule", "Checking": "Comparaison des titres...", "ClearAll": "Tout d\u00e9cocher", "Close": "Fermer", "ColBook": "Livre", "ColChangeTo": "Remplacer par", "ColField": "Champ", "ColFix": "Modifier", "ColLine": "Ligne", "ColNow": "Actuellement", "ColPermission": "Permission", "ColStyle": "Fa\u00e7on d'\u00e9crire le num\u00e9ro", "ColUsual": "Habituel dans ce champ", "Confirm": "Modifier {0} ligne(s) dans {1} livre(s) que vous pouvez modifier\u00a0?\n\nUn point est d'abord ajout\u00e9 \u00e0 l'historique du projet, et chaque livre modifi\u00e9 est enregistr\u00e9 dans un fichier .bak dans\u00a0:\n{2}", "ConfirmP10": "Modifier {0} ligne(s) dans {1} livre(s) ?\n\nLe texte de chaque livre est d\u2019abord conserv\u00e9 dans le stockage de l\u2019extension Phils Checks (Paratext 10 ne permet pas aux extensions d\u2019ajouter un point \u00e0 l\u2019historique du projet).", "ConfirmTitle": "Modifier les titres des livres num\u00e9rot\u00e9s", "Counts": "{0} diff\u00e9rence(s), {1} modifiable(s) ici, {2} coch\u00e9e(s).", "Description": "V\u00e9rifie que les livres num\u00e9rot\u00e9s (1 Samuel \u00e0 3 Jean) \u00e9crivent leur num\u00e9ro de la m\u00eame fa\u00e7on dans \\h, \\toc1, \\toc2, \\toc3, \\mt et les noms des livres (1 Jean, 1re Jean, I Jean, Premi\u00e8re \u00e9p\u00eetre de Jean, ...), et met les lignes que vous cochez dans le style habituel.", "Error": "Titres des livres num\u00e9rot\u00e9s n'a pas pu terminer\u00a0:\n{0}", "FieldNames": ["\\h", "\\toc1", "\\toc2", "\\toc3", "\\mt", "BookNames.xml (nom long)", "BookNames.xml (nom court)", "BookNames.xml (abr\u00e9viation)"], "FixButton": "Modifier les lignes coch\u00e9es ({0})", "FolderChooseOther": "Choisir un autre dossier...", "FolderChooseRoot": "Choisir le dossier Paratext 9 Projects...", "FolderChosen": "Dossier : {0}", "FolderNoSettings": "Ce dossier n\u2019a pas de Settings.xml ; ce n\u2019est donc pas le dossier d\u2019un projet Paratext : {0}", "FolderNone": "Aucun dossier choisi pour l\u2019instant.", "FolderNotAllowed": "Paratext 10 n\u2019a pas permis de lire le dossier : {0}", "FolderNotInRoot": "Le dossier {0} n\u2019a pas de dossier pour le projet {1}.", "FolderOpenProject": "Ouvrir le dossier du projet ({0})", "FolderReadOnly": "Le dossier peut \u00eatre lu, mais pas modifi\u00e9 ici ; Enregistrer t\u00e9l\u00e9chargera donc le fichier.", "FolderRootWhere": "Une seule fois : choisissez le dossier o\u00f9 Paratext 10 garde ses projets, {0}. Ensuite chaque fen\u00eatre trouve seule le dossier de son projet.", "FolderWrongProject": "C\u2019est le dossier du projet {0}, pas celui du projet ouvert ici ({1}). Choisissez le dossier {2}.", "GoToButton": "Aller dans Paratext", "HistoryMessage": "Titres des livres num\u00e9rot\u00e9s\u00a0: avant de modifier {0} ligne(s) d'en-t\u00eate", "HistoryNoFolder": "le dossier du projet ou son historique (.hg) est introuvable", "HistoryNotRecorded": "Paratext n'a pas enregistr\u00e9 le point d'historique (le projet est peut-\u00eatre en cours d'utilisation)", "HistoryStopped": "Impossible d'ajouter un point \u00e0 l'historique du projet, donc rien n'a \u00e9t\u00e9 modifi\u00e9\u00a0: {0}\n\nTerminez ou fermez toute modification en cours dans ce projet, puis r\u00e9essayez.", "Intro": "Chaque champ est compar\u00e9 s\u00e9par\u00e9ment entre les livres num\u00e9rot\u00e9s (1SA-2CH, 1CO-3JN)\u00a0: la fa\u00e7on dont la plupart des livres y \u00e9crivent le num\u00e9ro est la fa\u00e7on habituelle, et les livres de la liste l'\u00e9crivent autrement. V\u00e9rifiez ou tapez le texte dans \u00ab\u00a0Remplacer par\u00a0\u00bb, cochez les lignes \u00e0 modifier, puis cliquez sur Modifier. Double-cliquez sur une ligne (ou s\u00e9lectionnez-la et cliquez sur Aller dans Paratext) pour aller \u00e0 l'en-t\u00eate du livre dans Paratext.", "MenuText": "Titres des livres num\u00e9rot\u00e9s...", "Missing": "absent", "No": "Non", "NoNumberedBooks": "Ce projet a moins de deux livres num\u00e9rot\u00e9s\u00a0: il n'y a donc rien \u00e0 comparer.", "NoPermissionP10": "Vous n\u2019avez pas la permission de modifier ce projet, rien ne peut donc \u00eatre modifi\u00e9.", "NoProblems": "Chaque champ \u00e9crit le num\u00e9ro de la m\u00eame fa\u00e7on dans tous les livres num\u00e9rot\u00e9s.", "NoSuggestion": "(tapez le nouveau texte)", "NoUsual": "Aucun style habituel\u00a0: {0}", "NoUsualShort": "(aucun style habituel)", "NotRead": "Non lu : {0}", "NotSaved": "Paratext n'a pas enregistr\u00e9 la modification telle qu'elle \u00e9tait \u00e9crite", "NothingSelected": "Cochez au moins une ligne \u00e0 modifier.", "Ok": "OK", "OpenProjectFirst": "Ouvrez d'abord un projet dans une fen\u00eatre de texte biblique, puis choisissez Titres des livres num\u00e9rot\u00e9s...", "Opening": "Ouverture du projet...", "ProjectLabel": "Projet\u00a0: {0}", "Reading": "Lecture de {0} ({1} sur {2})...", "ResBackups": "Les copies de sauvegarde des livres modifi\u00e9s se trouvent dans\u00a0: {0}", "ResBackupsP10": "L\u2019ancien texte des {0} livre(s) modifi\u00e9(s) est conserv\u00e9 dans le stockage de l\u2019extension Phils Checks.", "ResBusy": "Non modifi\u00e9(s), car le texte est en cours d'utilisation (terminez sa modification, puis r\u00e9essayez)\u00a0: {0}", "ResChanged": "Non modifi\u00e9(s), car le texte a chang\u00e9 apr\u00e8s l'analyse (analysez \u00e0 nouveau, puis r\u00e9essayez)\u00a0: {0}", "ResFailed": "Modification impossible\u00a0: {0}", "ResFixed": "{0}\u00a0: {1} ligne(s) modifi\u00e9e(s)", "ResNoPermission": "Non modifi\u00e9(s), car vous n'avez pas la permission de modifier\u00a0: {0}", "ResNothing": "Rien n'a \u00e9t\u00e9 modifi\u00e9.", "ResTotal": "Modifi\u00e9\u00a0: {0} ligne(s) dans {1} livre(s).", "Rescan": "Analyser \u00e0 nouveau", "ResultsLabel": "R\u00e9sultats\u00a0: apr\u00e8s un clic sur Modifier, les modifications faites (et ce qui n'a pas \u00e9t\u00e9 modifi\u00e9) s'affichent ici.", "Scanning": "Lecture de {0}...", "SelectAll": "Cocher toutes celles qui peuvent changer", "SomeNotEditable": "Vous ne pouvez pas modifier certains livres. Leurs lignes ne peuvent pas \u00eatre coch\u00e9es.", "StyleNames": ["Num\u00e9ro et espace (1 Jean)", "Num\u00e9ro et espace ins\u00e9cable", "Num\u00e9ro sans espace (1Jean)", "Num\u00e9ro et point (1. Jean)", "Num\u00e9ro avec suffixe (1er, 1re, 2e)", "Chiffre romain (I Jean)", "Num\u00e9ro apr\u00e8s le nom (Jean 1)", "Chiffre romain apr\u00e8s le nom (Jean I)", "Mot (Premi\u00e8re)"], "Summary": "{0} livre(s) num\u00e9rot\u00e9(s), {1} incoh\u00e9rence(s) trouv\u00e9e(s).", "TabAll": "Tous les livres num\u00e9rot\u00e9s", "TabIssues": "Diff\u00e9rences", "Title": "Titres des livres num\u00e9rot\u00e9s", "UsualCount": "{0} ({1} livres sur {2})", "UsualRow": "Habituel", "Writing": "Modification de {0} ({1} sur {2})...", "Yes": "Oui"}, "version": "1.1"};
const NBT_WINDOW_HTML = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      \n  :root {\n    --t-bg: #ffffff;\n    --t-fg: #1f2328;\n    --t-muted: #59636e;\n    --t-line: #d0d7de;\n    --t-head: #f3f5f7;\n    --t-sel: #dbeafe;\n    --t-accent: #0b6bcb;\n    --t-warn: #8a1c00;\n    --t-odd: #ffe4b5;\n    --t-usual: #eef6ff;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --t-bg: #1e1f22;\n      --t-fg: #e6e6e6;\n      --t-muted: #a0a6ad;\n      --t-line: #3a3d42;\n      --t-head: #2a2c30;\n      --t-sel: #1e3a5f;\n      --t-accent: #6cb6ff;\n      --t-warn: #fdba74;\n      --t-odd: #5a4320;\n      --t-usual: #1d2b3a;\n    }\n  }\n  html,\n  body {\n    margin: 0;\n    height: 100%;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    font: 13px/1.4 'Segoe UI', system-ui, sans-serif;\n  }\n  body {\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    padding: 8px 12px;\n    box-sizing: border-box;\n  }\n  .row {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 8px;\n  }\n  .grow {\n    flex: 1;\n  }\n  .muted {\n    color: var(--t-muted);\n  }\n  .warn {\n    color: var(--t-warn);\n    font-weight: 600;\n  }\n  button {\n    font: inherit;\n    padding: 3px 12px;\n    border: 1px solid var(--t-line);\n    background: var(--t-head);\n    color: var(--t-fg);\n    border-radius: 4px;\n    cursor: pointer;\n  }\n  button.primary {\n    background: var(--t-accent);\n    border-color: var(--t-accent);\n    color: #fff;\n    font-weight: 600;\n  }\n  button:disabled {\n    opacity: 0.5;\n    cursor: default;\n  }\n  select,\n  input[type='text'] {\n    font: inherit;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 3px;\n    padding: 1px 4px;\n  }\n  .gridbox {\n    flex: 1;\n    min-height: 120px;\n    overflow: auto;\n    border: 1px solid var(--t-line);\n    border-radius: 4px;\n    position: relative;\n  }\n  table.grid {\n    border-collapse: collapse;\n    width: 100%;\n  }\n  table.grid th {\n    position: sticky;\n    top: 0;\n    background: var(--t-head);\n    text-align: left;\n    font-weight: 600;\n    z-index: 1;\n  }\n  table.grid th,\n  table.grid td {\n    border-bottom: 1px solid var(--t-line);\n    padding: 3px 6px;\n    vertical-align: top;\n  }\n  table.grid tr.sel td {\n    background: var(--t-sel);\n  }\n  table.grid tr.oneform td {\n    background: var(--t-head);\n  }\n  textarea.results {\n    font: 12px/1.4 Consolas, 'Cascadia Mono', monospace;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 4px;\n    height: 90px;\n    resize: vertical;\n    white-space: pre-wrap;\n  }\n  /* the busy panel over a grid */\n  .busy {\n    position: absolute;\n    inset: 0;\n    display: none;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 12px;\n    background: var(--t-bg);\n    z-index: 5;\n  }\n  .spinner {\n    width: 32px;\n    height: 32px;\n    border: 4px solid var(--t-line);\n    border-top-color: var(--t-accent);\n    border-radius: 50%;\n    animation: tspin 0.8s linear infinite;\n  }\n  @keyframes tspin {\n    to {\n      transform: rotate(360deg);\n    }\n  }\n  .track {\n    width: 60%;\n    max-width: 420px;\n    height: 8px;\n    background: var(--t-line);\n    border-radius: 4px;\n    overflow: hidden;\n  }\n  .track > div {\n    height: 100%;\n    width: 0;\n    background: var(--t-accent);\n    transition: width 0.2s;\n  }\n  /* dialogs drawn in the page */\n  .modal {\n    position: fixed;\n    inset: 0;\n    background: rgba(0, 0, 0, 0.35);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    z-index: 20;\n  }\n  .modal .box {\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 6px;\n    padding: 14px 16px;\n    max-width: 640px;\n    width: 90%;\n    max-height: 85%;\n    overflow: auto;\n    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);\n  }\n  .modal .text {\n    white-space: pre-wrap;\n    margin-bottom: 12px;\n  }\n  .modal .buttons {\n    display: flex;\n    gap: 8px;\n    justify-content: flex-end;\n    margin-top: 10px;\n  }\n  .bookgrid {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));\n    gap: 2px 8px;\n    margin: 8px 0;\n  }\n\n      .tabs {\n        display: flex;\n        gap: 2px;\n        border-bottom: 1px solid var(--t-line);\n      }\n      .tabs button {\n        border-radius: 4px 4px 0 0;\n        border-bottom: none;\n      }\n      .tabs button.on {\n        background: var(--t-bg);\n        font-weight: 600;\n        border-color: var(--t-line);\n      }\n      td.odd {\n        background: var(--t-odd);\n      }\n      tr.usual td {\n        background: var(--t-usual);\n        font-style: italic;\n      }\n      td.missing {\n        color: var(--t-muted);\n      }\n      input.changeto {\n        width: 100%;\n        box-sizing: border-box;\n      }\n      #note {\n        max-width: 1100px;\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"row\"><b id=\"title\"></b><span class=\"muted\" id=\"project\"></span></div>\n    <div id=\"intro\" class=\"muted\"></div>\n    <div id=\"note\" class=\"muted\"></div>\n    <div class=\"row\" id=\"folderRow\"></div>\n    <div class=\"row\">\n      <b id=\"summary\"></b>\n      <span class=\"grow\"></span>\n      <button id=\"books\"></button>\n      <button id=\"rescan\"></button>\n    </div>\n    <div id=\"warning\" class=\"warn\"></div>\n    <div class=\"tabs\"><button id=\"tabIssues\" class=\"on\"></button><button id=\"tabAll\"></button></div>\n    <div class=\"gridbox\" id=\"gridbox\">\n      <table class=\"grid\" id=\"issues\"></table>\n      <table class=\"grid\" id=\"matrix\" style=\"display: none\"></table>\n    </div>\n    <div class=\"row\">\n      <span id=\"counts\" class=\"muted\"></span>\n      <span class=\"grow\"></span>\n      <button id=\"all\"></button>\n      <button id=\"none\"></button>\n      <button id=\"goto\"></button>\n      <button class=\"primary\" id=\"fix\"></button>\n    </div>\n    <div class=\"muted\" id=\"resultsLabel\"></div>\n    <textarea class=\"results\" id=\"results\" readonly></textarea>\n    <script>\n      \n  const BOOT = __BOOT__;\n  const papi = require('@papi/frontend');\n  const S = BOOT.strings;\n  const $ = (id) => document.getElementById(id);\n\n  function fmt(s, ...args) {\n    return String(s).replace(/\\{(\\d+)\\}/g, (m, n) => (args[n] === undefined ? m : String(args[n])));\n  }\n\n  function esc(s) {\n    return String(s === null || s === undefined ? '' : s)\n      .replace(/&/g, '&amp;')\n      .replace(/</g, '&lt;')\n      .replace(/>/g, '&gt;')\n      .replace(/\"/g, '&quot;');\n  }\n\n  function cmd(name, ...args) {\n    return papi.commands.sendCommand(BOOT.id + '.' + name, ...args);\n  }\n\n  /** Shows the busy panel inside box (a .gridbox) with text and a bar (fraction, or null). */\n  function busy(box, text, fraction) {\n    let panel = box.querySelector('.busy');\n    if (!panel) {\n      panel = document.createElement('div');\n      panel.className = 'busy';\n      panel.innerHTML = '<div class=\"spinner\"></div><div class=\"btext\"></div><div class=\"track\"><div></div></div>';\n      box.appendChild(panel);\n    }\n    panel.style.display = text === null ? 'none' : 'flex';\n    if (text === null) return;\n    panel.querySelector('.btext').textContent = text;\n    panel.querySelector('.track').style.visibility = fraction === null || fraction === undefined ? 'hidden' : 'visible';\n    panel.querySelector('.track > div').style.width = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100) + '%';\n  }\n\n  /** The text for a progress record from the backend. */\n  function progressText(p) {\n    if (!p) return null;\n    if (p.phase === 'open') return [S.Opening, 0];\n    if (p.phase === 'read') return [fmt(S.Reading, p.book, p.done + 1, p.total), p.total ? (p.done / p.total) * 0.9 : 0];\n    if (p.phase === 'check') return [S.Checking, 0.95];\n    if (p.phase === 'write') return [fmt(S.Writing, p.book, p.done + 1, p.total), p.total ? p.done / p.total : 0];\n    return null;\n  }\n\n  /**\n   * Runs a backend command (scan or apply) with the busy panel over box, asking for its progress\n   * every 250 ms. args come before the run id.\n   */\n  async function withProgress(box, firstText, name, ...args) {\n    const runId = String(Date.now()) + Math.random();\n    busy(box, firstText, 0);\n    // A poll still on its way when the run ends must not show the busy panel again.\n    let finished = false;\n    const poll = setInterval(() => {\n      cmd('progress', BOOT.projectId, runId)\n        .then((p) => {\n          const t = progressText(p);\n          if (t && !finished) busy(box, t[0], t[1]);\n        })\n        .catch(() => {});\n    }, 250);\n    try {\n      return await cmd(name, BOOT.projectId, ...args, runId);\n    } finally {\n      finished = true;\n      clearInterval(poll);\n      busy(box, null);\n    }\n  }\n\n  /** A dialog in the page: resolves with the value of the button pressed. */\n  function dialog(text, buttons, extra) {\n    return new Promise((resolve) => {\n      const modal = document.createElement('div');\n      modal.className = 'modal';\n      const box = document.createElement('div');\n      box.className = 'box';\n      const t = document.createElement('div');\n      t.className = 'text';\n      t.textContent = text;\n      box.appendChild(t);\n      if (extra) box.appendChild(extra);\n      const row = document.createElement('div');\n      row.className = 'buttons';\n      buttons.forEach((b) => {\n        const btn = document.createElement('button');\n        btn.textContent = b.label;\n        if (b.primary) btn.className = 'primary';\n        btn.addEventListener('click', () => {\n          if (b.check && !b.check()) return;\n          modal.remove();\n          resolve(b.value);\n        });\n        row.appendChild(btn);\n      });\n      box.appendChild(row);\n      modal.appendChild(box);\n      document.body.appendChild(modal);\n      const first = row.querySelector('button.primary') || row.querySelector('button');\n      if (first) first.focus();\n    });\n  }\n\n  function ask(text) {\n    return dialog(text, [\n      { label: S.Yes, value: true, primary: true },\n      { label: S.No, value: false },\n    ]);\n  }\n\n  function tell(text) {\n    return dialog(text, [{ label: S.Ok || 'OK', value: true, primary: true }]);\n  }\n\n  const OTHER_BOOKS = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');\n\n  /** The books chooser (BookChooserForm): books = [{code, num, chosen}]; resolves with the excluded codes, or null. */\n  async function chooseBooks(books) {\n    const wrap = document.createElement('div');\n    const quick = document.createElement('div');\n    quick.className = 'row';\n    const grid = document.createElement('div');\n    grid.className = 'bookgrid';\n    const boxes = books.map((b) => {\n      const label = document.createElement('label');\n      const cb = document.createElement('input');\n      cb.type = 'checkbox';\n      cb.checked = b.chosen;\n      label.append(cb, ' ' + b.code);\n      grid.appendChild(label);\n      return { b, cb };\n    });\n    const groups = [\n      [S.BooksAll, () => true],\n      [S.BooksNone, () => false],\n      [S.BooksBible, (b) => OTHER_BOOKS.indexOf(b.code) < 0],\n      [S.BooksOT, (b) => b.num >= 1 && b.num <= 39],\n      [S.BooksNT, (b) => b.num >= 40 && b.num <= 66],\n      [S.BooksDC, (b) => b.num >= 67 && b.num <= 92],\n      [S.BooksOther, (b) => OTHER_BOOKS.indexOf(b.code) >= 0],\n    ];\n    groups.forEach(([label, test]) => {\n      const btn = document.createElement('button');\n      btn.textContent = label;\n      btn.addEventListener('click', () => boxes.forEach((x) => (x.cb.checked = test(x.b))));\n      quick.appendChild(btn);\n    });\n    const note = document.createElement('div');\n    note.className = 'warn';\n    wrap.append(quick, grid, note);\n    const ok = await dialog(S.BooksIntro, [\n      {\n        label: S.Ok,\n        value: true,\n        primary: true,\n        check: () => {\n          const any = boxes.some((x) => x.cb.checked);\n          note.textContent = any ? '' : S.BooksNoneChosen;\n          return any;\n        },\n      },\n      { label: S.Cancel, value: false },\n    ], wrap);\n    if (!ok) return null;\n    return boxes.filter((x) => !x.cb.checked).map((x) => x.b.code);\n  }\n\n  function booksLabel(books) {\n    return fmt(S.BooksButton, books.filter((b) => b.chosen).length, books.length);\n  }\n\n  /**\n   * The project's folder. Paratext 10 keeps projects in %USERPROFILE%\\.paratext-10-studio\\projects\\\n   * Paratext 9 Projects\\<project>; the extension's backend may not read files, so the window does.\n   * The user picks the \"Paratext 9 Projects\" folder once (showDirectoryPicker): it is remembered in\n   * IndexedDB (key __projectsRoot, for every window and project), and each window then finds its\n   * project's subfolder itself (by name, else by Settings.xml <Guid>): with no click when the\n   * permission is still granted, else with one click. Picking a single project folder also works\n   * (remembered for that project). Without showDirectoryPicker, a webkitdirectory input (read only).\n   * The folder must be this project's: its Settings.xml <Guid> must be Paratext 10's project id.\n   * Tests replace IndexedDB with window.__pcFolderStore = {get(key), put(key, handle)}.\n   */\n  const ProjectFolder = (function () {\n    let handle = null; // FileSystemDirectoryHandle of the project\n    let files = null; // Map lower-case name -> File (from the input)\n    let writable = false;\n    let label = '';\n    const DB = 'philsChecksFolders';\n    const ROOT_KEY = '__projectsRoot';\n    const MAX_FOLDERS = 500;\n\n    function rootWhere() {\n      return '%USERPROFILE%\\\\.paratext-10-studio\\\\projects\\\\Paratext 9 Projects';\n    }\n    function where() {\n      return rootWhere() + '\\\\' + (BOOT.projectName || '?');\n    }\n\n    // ------------------------------------------------ remembering (IndexedDB, or the tests' store)\n    function db() {\n      return new Promise((resolve, reject) => {\n        const req = indexedDB.open(DB, 1);\n        req.onupgradeneeded = () => req.result.createObjectStore('handles');\n        req.onsuccess = () => resolve(req.result);\n        req.onerror = () => reject(req.error);\n      });\n    }\n    function put(key, h) {\n      if (window.__pcFolderStore) return window.__pcFolderStore.put(key, h);\n      // Not waited for: remembering must never hold up using the folder.\n      db()\n        .then((d) => d.transaction('handles', 'readwrite').objectStore('handles').put(h, key))\n        .catch(() => {});\n    }\n    /** A remembered handle, or null; never waits more than a second (IndexedDB may not answer). */\n    function get(key) {\n      if (window.__pcFolderStore) return Promise.resolve(window.__pcFolderStore.get(key) || null);\n      const look = (async () => {\n        try {\n          const d = await db();\n          return await new Promise((resolve) => {\n            const req = d.transaction('handles').objectStore('handles').get(key);\n            req.onsuccess = () => resolve(req.result || null);\n            req.onerror = () => resolve(null);\n          });\n        } catch (e) {\n          return null;\n        }\n      })();\n      return Promise.race([look, new Promise((r) => setTimeout(() => r(null), 1000))]);\n    }\n\n    // ------------------------------------------------ reading\n    function decode(buf) {\n      const b = new Uint8Array(buf);\n      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));\n      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));\n      if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));\n      return new TextDecoder('utf-8').decode(b);\n    }\n\n    async function fileIn(dir, name) {\n      for await (const entry of dir.values()) if (entry.kind === 'file' && entry.name.toLowerCase() === name.toLowerCase()) return entry.getFile();\n      return null;\n    }\n\n    async function file(name) {\n      if (files) return files.get(name.toLowerCase()) || null;\n      return handle ? fileIn(handle, name) : null;\n    }\n\n    async function names() {\n      if (files) return Array.from(files.values()).map((f) => f.name);\n      const out = [];\n      if (handle) for await (const entry of handle.values()) if (entry.kind === 'file') out.push(entry.name);\n      return out;\n    }\n\n    function identity(xml, fallbackName) {\n      return {\n        guid: (/<Guid>\\s*([^<\\s]*)\\s*<\\/Guid>/.exec(xml) || [])[1] || '',\n        name: (/<Name>([^<]*)<\\/Name>/.exec(xml) || [])[1] || fallbackName,\n      };\n    }\n\n    /** Whether a Settings.xml text is this project's (the Guid; the name when the id is not a Guid). */\n    function isThisProject(xml, fallbackName) {\n      const who = identity(xml, fallbackName);\n      const id = String(BOOT.projectId || '').toLowerCase();\n      if (who.guid && /^[0-9a-f]{20,}$/.test(id)) return who.guid.toLowerCase() === id;\n      return !!BOOT.projectName && who.name === BOOT.projectName;\n    }\n\n    /** Checks the chosen folder is this project's; throws a message for the user when it is not. */\n    async function verify() {\n      const f = await file('Settings.xml');\n      if (!f) throw new Error(fmt(S.FolderNoSettings, label));\n      const xml = decode(await f.arrayBuffer());\n      if (!isThisProject(xml, label)) throw new Error(fmt(S.FolderWrongProject, identity(xml, label).name, BOOT.projectName || BOOT.projectId, where()));\n    }\n\n    async function settingsOf(dir) {\n      try {\n        const f = await fileIn(dir, 'Settings.xml');\n        return f ? decode(await f.arrayBuffer()) : null;\n      } catch (e) {\n        return null;\n      }\n    }\n\n    /**\n     * The project's folder inside a picked folder: the folder itself when it holds a Settings.xml;\n     * otherwise its subfolder named like the project, else the subfolder whose Settings.xml is this\n     * project's. A \"projects\" folder holding \"Paratext 9 Projects\" is looked into. null = not found.\n     */\n    async function findProject(dir) {\n      if (await settingsOf(dir)) return dir;\n      let base = dir;\n      try {\n        base = await dir.getDirectoryHandle('Paratext 9 Projects');\n      } catch (e) {\n        base = dir;\n      }\n      if (BOOT.projectName) {\n        try {\n          const d = await base.getDirectoryHandle(BOOT.projectName);\n          const xml = await settingsOf(d);\n          if (xml && isThisProject(xml, d.name)) return d;\n        } catch (e) {\n          // not by that name\n        }\n      }\n      let n = 0;\n      for await (const entry of base.values()) {\n        if (entry.kind !== 'directory') continue;\n        if (++n > MAX_FOLDERS) break;\n        const xml = await settingsOf(entry);\n        if (xml && isThisProject(xml, entry.name)) return entry;\n      }\n      return null;\n    }\n\n    function use(dir, mode) {\n      handle = dir;\n      files = null;\n      label = dir.name;\n      writable = mode === 'readwrite';\n    }\n\n    // ------------------------------------------------ choosing\n    /** Lets the user pick the projects folder (or a project folder). Resolves true when the project is found. */\n    async function choose(mode) {\n      if (window.showDirectoryPicker) {\n        let h = null;\n        let blocked = false;\n        const remembered = await get(ROOT_KEY);\n        const options = { id: 'philsChecksProjects', mode: mode || 'read', startIn: remembered || 'documents' };\n        try {\n          h = await window.showDirectoryPicker(options);\n        } catch (e) {\n          if (e && e.name === 'AbortError') return false;\n          try {\n            delete options.startIn; // an old or unusable remembered folder\n            h = await window.showDirectoryPicker(options);\n          } catch (e2) {\n            if (e2 && e2.name === 'AbortError') return false;\n            blocked = true; // not allowed here: the input below\n          }\n        }\n        if (!blocked && h) {\n          const project = await findProject(h);\n          if (!project) throw new Error(fmt(S.FolderNotInRoot, h.name, BOOT.projectName || BOOT.projectId));\n          use(project, mode);\n          await verify();\n          put(project === h ? BOOT.projectId : ROOT_KEY, h);\n          return true;\n        }\n      }\n      const list = await new Promise((resolve) => {\n        const input = document.createElement('input');\n        input.type = 'file';\n        input.webkitdirectory = true;\n        input.style.display = 'none';\n        input.addEventListener('change', () => resolve(input.files));\n        document.body.appendChild(input);\n        input.click();\n        setTimeout(() => input.remove(), 60000);\n      });\n      if (!list || list.length === 0) return false;\n      files = new Map();\n      handle = null;\n      writable = false;\n      Array.from(list).forEach((f) => {\n        const parts = (f.webkitRelativePath || f.name).split('/');\n        if (parts.length <= 2) {\n          files.set(f.name.toLowerCase(), f);\n          label = parts.length === 2 ? parts[0] : label;\n        }\n      });\n      await verify();\n      return true;\n    }\n\n    /** What is remembered: {handle, isRoot}, the projects folder first; or null. */\n    async function remembered() {\n      const root = await get(ROOT_KEY);\n      if (root) return { handle: root, isRoot: true };\n      const own = await get(BOOT.projectId);\n      return own ? { handle: own, isRoot: false } : null;\n    }\n\n    /**\n     * Opens the project's folder from what is remembered. ask = false: only when the permission is\n     * still granted (no prompt, no click needed); ask = true: asks for it (needs the user's click).\n     */\n    async function openRemembered(mode, ask) {\n      const r = await remembered();\n      if (!r) return false;\n      const opts = { mode: mode || 'read' };\n      let state = r.handle.queryPermission ? await r.handle.queryPermission(opts) : 'prompt';\n      if (state !== 'granted') {\n        if (!ask) return false;\n        state = await r.handle.requestPermission(opts);\n        if (state !== 'granted') return false;\n      }\n      const project = r.isRoot ? await findProject(r.handle) : r.handle;\n      if (!project) throw new Error(fmt(S.FolderNotInRoot, r.handle.name, BOOT.projectName || BOOT.projectId));\n      use(project, mode);\n      await verify();\n      return true;\n    }\n\n    return {\n      where,\n      rootWhere,\n      choose,\n      remembered,\n      openRemembered,\n      decode,\n      names,\n      chosen: () => !!(handle || files),\n      label: () => label,\n      canWrite: () => !!handle && writable,\n      async has(name) {\n        return !!(await file(name));\n      },\n      /** The file's text (BOM-aware), or null when it is not there. */\n      async readText(name) {\n        const f = await file(name);\n        return f ? decode(await f.arrayBuffer()) : null;\n      },\n      async readBytes(name) {\n        const f = await file(name);\n        return f ? new Uint8Array(await f.arrayBuffer()) : null;\n      },\n      /** {length, mtime} of a file, or null. */\n      async info(name) {\n        const f = await file(name);\n        return f ? { length: f.size, mtime: f.lastModified } : null;\n      },\n      async writeBytes(name, bytes) {\n        if (!handle || !writable) throw new Error(S.FolderReadOnly);\n        const fh = await handle.getFileHandle(name, { create: true });\n        const w = await fh.createWritable();\n        await w.write(bytes);\n        await w.close();\n      },\n    };\n  })();\n\n  /**\n   * The folder row of a window. First time: \"Choose the Paratext 9 Projects folder...\" with where\n   * it is. Afterwards the project's folder opens by itself when the permission is still granted,\n   * else \"Open the project folder (PDT15)\" does it in one click; \"Choose another folder...\" picks\n   * again. onChosen() runs once the project's folder is open.\n   */\n  async function folderBar(container, mode, onChosen) {\n    container.innerHTML = '';\n    const main = document.createElement('button');\n    main.className = 'primary';\n    const other = document.createElement('button');\n    other.textContent = S.FolderChooseOther;\n    other.style.display = 'none';\n    const status = document.createElement('span');\n    status.className = 'muted';\n    container.append(main, other, status);\n    let busyNow = false;\n    async function run(fn) {\n      if (busyNow) return;\n      busyNow = true;\n      try {\n        if (await fn()) {\n          status.textContent = fmt(S.FolderChosen, ProjectFolder.label()) + (mode === 'readwrite' && !ProjectFolder.canWrite() ? ' ' + S.FolderReadOnly : '');\n          status.className = 'muted';\n          main.textContent = fmt(S.FolderOpenProject, BOOT.projectName || ProjectFolder.label());\n          main.onclick = () => run(() => ProjectFolder.openRemembered(mode, true));\n          other.style.display = '';\n          await onChosen();\n        }\n      } catch (e) {\n        status.textContent = e && e.message ? e.message : String(e);\n        status.className = 'warn';\n      } finally {\n        busyNow = false;\n      }\n    }\n    other.addEventListener('click', () => run(() => ProjectFolder.choose(mode)));\n    const r = await ProjectFolder.remembered().catch(() => null);\n    if (r) {\n      main.textContent = fmt(S.FolderOpenProject, BOOT.projectName || r.handle.name);\n      main.onclick = () => run(() => ProjectFolder.openRemembered(mode, true));\n      other.style.display = '';\n      // No click needed while Paratext 10 still grants the permission. Resolves true when the\n      // folder opened by itself (onChosen then runs), so the window need not scan a second time;\n      // after 3 s without an answer it resolves false and the window goes on without the folder.\n      const opened = await Promise.race([\n        ProjectFolder.openRemembered(mode, false).catch(() => false),\n        new Promise((res) => setTimeout(() => res(false), 3000)),\n      ]);\n      if (opened && ProjectFolder.chosen()) {\n        run(async () => true);\n        return true;\n      }\n      return false;\n    }\n    main.textContent = S.FolderChooseRoot;\n    main.onclick = () => run(() => ProjectFolder.choose(mode));\n    status.textContent = fmt(S.FolderRootWhere, ProjectFolder.rootWhere());\n    return false;\n  }\n\n    </script>\n    <script>\n      let state = null;\n      let books = [];\n      const ticked = new Set();\n      const typed = new Map(); // key -> \"Change to\" text\n      let selectedBook = null;\n\n      function canTick(r) {\n        return r.fixable && state.canEdit && newValue(r).trim().length > 0 && newValue(r).replace(/\\s+/g, ' ').trim() !== r.now;\n      }\n\n      function newValue(r) {\n        return typed.has(r.key) ? typed.get(r.key) : r.changeTo;\n      }\n\n      function drawIssues() {\n        const table = $('issues');\n        table.innerHTML = '';\n        const head = document.createElement('tr');\n        [S.ColFix, S.ColBook, S.ColField, S.ColLine, S.ColNow, S.ColStyle, S.ColUsual, S.ColChangeTo, S.ColPermission].forEach((h) => {\n          const th = document.createElement('th');\n          th.textContent = h;\n          head.appendChild(th);\n        });\n        table.appendChild(head);\n        if (!state) return;\n        state.rows.forEach((r) => {\n          const tr = document.createElement('tr');\n          if (r.book === selectedBook) tr.className = 'sel';\n          const tick = document.createElement('input');\n          tick.type = 'checkbox';\n          tick.checked = ticked.has(r.key);\n          tick.disabled = !canTick(r);\n          tick.addEventListener('change', () => {\n            if (tick.checked) ticked.add(r.key);\n            else ticked.delete(r.key);\n            updateCounts();\n          });\n          let change;\n          if (r.fixable) {\n            change = document.createElement('input');\n            change.type = 'text';\n            change.className = 'changeto';\n            change.value = newValue(r);\n            change.placeholder = S.NoSuggestion;\n            change.addEventListener('input', () => {\n              typed.set(r.key, change.value);\n              tick.disabled = !canTick(r);\n              if (tick.disabled) {\n                tick.checked = false;\n                ticked.delete(r.key);\n              }\n              updateCounts();\n            });\n          } else {\n            change = document.createElement('span');\n            change.className = 'muted';\n            change.textContent = S.BookNamesFix;\n          }\n          [tick, r.book, r.field, r.line, r.now, r.style, r.usual, change, r.permission].forEach((c) => {\n            const td = document.createElement('td');\n            if (c instanceof Node) td.appendChild(c);\n            else td.textContent = c;\n            tr.appendChild(td);\n          });\n          tr.addEventListener('click', (ev) => {\n            if (ev.target.tagName === 'INPUT') return;\n            selectedBook = r.book;\n            drawIssues();\n          });\n          tr.addEventListener('dblclick', () => goTo(r.book));\n          table.appendChild(tr);\n        });\n      }\n\n      function drawMatrix() {\n        const table = $('matrix');\n        table.innerHTML = '';\n        if (!state) return;\n        const m = state.matrix;\n        const head = document.createElement('tr');\n        [S.ColBook].concat(m.fields).forEach((h) => {\n          const th = document.createElement('th');\n          th.textContent = h;\n          head.appendChild(th);\n        });\n        table.appendChild(head);\n        const ur = document.createElement('tr');\n        ur.className = 'usual';\n        const first = document.createElement('td');\n        first.textContent = S.UsualRow;\n        ur.appendChild(first);\n        m.usual.forEach((u) => {\n          const td = document.createElement('td');\n          td.textContent = u.text;\n          td.title = u.tip;\n          ur.appendChild(td);\n        });\n        table.appendChild(ur);\n        m.rows.forEach((r) => {\n          const tr = document.createElement('tr');\n          if (r.book === selectedBook) tr.className = 'sel';\n          const b = document.createElement('td');\n          b.innerHTML = '<b>' + esc(r.book) + '</b>';\n          tr.appendChild(b);\n          r.cells.forEach((c) => {\n            const td = document.createElement('td');\n            td.textContent = c.text;\n            if (c.tip) td.title = c.tip;\n            if (c.missing) td.className = 'missing';\n            else if (c.odd) td.className = 'odd';\n            tr.appendChild(td);\n          });\n          tr.addEventListener('click', () => {\n            selectedBook = r.book;\n            drawMatrix();\n          });\n          tr.addEventListener('dblclick', () => goTo(r.book));\n          table.appendChild(tr);\n        });\n      }\n\n      function updateCounts() {\n        if (!state) {\n          $('counts').textContent = '';\n          return;\n        }\n        const can = state.rows.filter(canTick).length;\n        $('counts').textContent = fmt(S.Counts, state.rows.length, can, ticked.size);\n        $('fix').textContent = fmt(S.FixButton, ticked.size);\n        $('fix').disabled = ticked.size === 0;\n        $('all').disabled = can === 0;\n        $('none').disabled = ticked.size === 0;\n      }\n\n      function draw() {\n        $('summary').textContent = state ? state.summary : '';\n        $('note').textContent = state && state.bookNames ? S.BookNamesFromFolder : S.BookNamesP10;\n        let warn = '';\n        if (state && state.numberedBooks < 2) warn = S.NoNumberedBooks;\n        else if (state && state.rows.length === 0) warn = S.NoProblems;\n        else if (state && !state.canEdit) warn = S.NoPermissionP10;\n        $('warning').textContent = warn;\n        drawIssues();\n        drawMatrix();\n        updateCounts();\n      }\n\n      function goTo(book) {\n        cmd('goTo', BOOT.projectId, book, 1, 0).catch((e) => ($('results').value = String(e)));\n      }\n\n      async function scan() {\n        try {\n          books = await cmd('books', BOOT.projectId);\n          $('books').textContent = booksLabel(books);\n          // With a chosen folder, its BookNames.xml is compared too.\n          const bookNamesXml = ProjectFolder.chosen() ? await ProjectFolder.readText('BookNames.xml') : null;\n          state = bookNamesXml\n            ? await withProgress($('gridbox'), S.Opening, 'scanWith', { bookNamesXml })\n            : await withProgress($('gridbox'), S.Opening, 'scan');\n          // Ticks and typed texts are kept for rows still there.\n          const keys = new Set(state.rows.map((r) => r.key));\n          Array.from(ticked).forEach((k) => {\n            if (!keys.has(k)) ticked.delete(k);\n          });\n          if (state.failed.length > 0) $('results').value = fmt(S.NotRead, state.failed.join('; '));\n        } catch (e) {\n          state = null;\n          $('results').value = fmt(S.Error, e && e.message ? e.message : e);\n        }\n        draw();\n      }\n\n      async function fix() {\n        const chosen = state ? state.rows.filter((r) => ticked.has(r.key) && canTick(r)) : [];\n        if (chosen.length === 0) {\n          await tell(S.NothingSelected);\n          return;\n        }\n        const bookCount = new Set(chosen.map((r) => r.book)).size;\n        if (!(await ask(fmt(S.ConfirmP10, chosen.length, bookCount)))) return;\n        let report;\n        try {\n          report = await withProgress($('gridbox'), S.Opening, 'apply', { rows: chosen.map((r) => ({ key: r.key, newValue: newValue(r) })) });\n        } catch (e) {\n          await tell(fmt(S.Error, e && e.message ? e.message : e));\n          return;\n        }\n        const lines = [];\n        report.fixed.forEach((f) => lines.push(fmt(S.ResFixed, f.book, f.count)));\n        lines.push(report.fixed.length > 0 ? fmt(S.ResTotal, report.total, report.booksChanged) : S.ResNothing);\n        if (report.noPermission.length > 0) lines.push(fmt(S.ResNoPermission, report.noPermission.join(', ')));\n        if (report.changed.length > 0) lines.push(fmt(S.ResChanged, report.changed.join(', ')));\n        report.failed.forEach((f) => lines.push(fmt(S.ResFailed, f)));\n        if (report.backups > 0) lines.push(fmt(S.ResBackupsP10, report.backups));\n        ticked.clear();\n        typed.clear();\n        await scan();\n        $('results').value = lines.join('\\n');\n      }\n\n      function showTab(all) {\n        $('tabIssues').className = all ? '' : 'on';\n        $('tabAll').className = all ? 'on' : '';\n        $('issues').style.display = all ? 'none' : '';\n        $('matrix').style.display = all ? '' : 'none';\n        $('intro').textContent = all ? S.AllHint : S.Intro;\n      }\n\n      $('title').textContent = S.Title + ' ' + (BOOT.version || '');\n      $('project').textContent = BOOT.projectName ? fmt(S.ProjectLabel, BOOT.projectName) : '';\n      $('note').textContent = S.BookNamesP10;\n      $('tabIssues').textContent = S.TabIssues;\n      $('tabAll').textContent = S.TabAll;\n      $('rescan').textContent = S.Rescan;\n      $('all').textContent = S.SelectAll;\n      $('none').textContent = S.ClearAll;\n      $('goto').textContent = S.GoToButton;\n      $('resultsLabel').textContent = S.ResultsLabel;\n      $('books').textContent = fmt(S.BooksButton, '?', '?');\n      $('fix').textContent = fmt(S.FixButton, 0);\n      showTab(false);\n      const folderOpened = folderBar($('folderRow'), 'read', scan);\n      $('tabIssues').addEventListener('click', () => showTab(false));\n      $('tabAll').addEventListener('click', () => showTab(true));\n      $('rescan').addEventListener('click', scan);\n      $('books').addEventListener('click', async () => {\n        const excluded = await chooseBooks(books);\n        if (excluded === null) return;\n        await cmd('saveBooks', BOOT.projectId, excluded);\n        await scan();\n      });\n      $('all').addEventListener('click', () => {\n        if (state) state.rows.filter(canTick).forEach((r) => ticked.add(r.key));\n        drawIssues();\n        updateCounts();\n      });\n      $('none').addEventListener('click', () => {\n        ticked.clear();\n        drawIssues();\n        updateCounts();\n      });\n      $('goto').addEventListener('click', () => {\n        if (selectedBook) goTo(selectedBook);\n      });\n      $('fix').addEventListener('click', fix);\n      // One scan at start: with the folder's BookNames.xml when it opens by itself.\n      folderOpened.then((opened) => {\n        if (!opened) scan();\n      });\n    </script>\n  </body>\n</html>\n";
// NumberedBookTitles backend (src/tools/numbered-book-titles/backend.js), in its own scope.
const NumberedBookTitles = (function () {
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

})();
// Project Settings Report core: a port of Project_Settings\ProjectSettingsPlugin (SettingsFile,
// LdmlFile, SettingCatalog, ValueFormatter, LookAlikes, StyleSheets, UsfmTextTokens,
// CharacterUsage, PunctuationUsage, HtmlReport). No papi, no files: the caller gives the texts.
// PSCore.init({settingsTxt, usfmSty}) must be called once (the build and the tests do).
// .NET details kept: WebUtility.HtmlEncode, UnicodeCategory order, .NET Framework text elements
// (a code point plus its combining marks), char.IsWhiteSpace, ordinal comparisons.
var PSCore = (function () {
  'use strict';

  var cfg = { settingsTxt: '', usfmSty: '' };

  // ============================================================ Unicode helpers (.NET semantics)

  // UnicodeCategory, in .NET's enum order.
  var CAT = {
    Lu: 0, Ll: 1, Lt: 2, Lm: 3, Lo: 4, Mn: 5, Mc: 6, Me: 7, Nd: 8, Nl: 9, No: 10, Zs: 11, Zl: 12, Zp: 13,
    Cc: 14, Cf: 15, Cs: 16, Co: 17, Pc: 18, Pd: 19, Ps: 20, Pe: 21, Pi: 22, Pf: 23, Po: 24, Sm: 25, Sc: 26, Sk: 27,
    So: 28, Cn: 29,
  };
  var CAT_TESTS = Object.keys(CAT)
    .filter(function (k) {
      return k !== 'Cs' && k !== 'Cn';
    })
    .map(function (k) {
      return [new RegExp('^\\p{' + k + '}$', 'u'), CAT[k]];
    });
  var catCache = new Map();

  /** The category of a code point. */
  function catOfCp(cp) {
    if (catCache.has(cp)) return catCache.get(cp);
    var r = CAT.Cn;
    if (cp >= 0xd800 && cp <= 0xdfff) r = CAT.Cs;
    else {
      var s = String.fromCodePoint(cp);
      for (var i = 0; i < CAT_TESTS.length; i++)
        if (CAT_TESTS[i][0].test(s)) {
          r = CAT_TESTS[i][1];
          break;
        }
    }
    catCache.set(cp, r);
    return r;
  }

  /** char.GetUnicodeCategory(char): one UTF-16 unit (a surrogate half is Surrogate). */
  function catOfChar(c) {
    return catOfCp(c.charCodeAt(0));
  }

  /** CharUnicodeInfo.GetUnicodeCategory(string, index): the code point at index. */
  function catAt(s, i) {
    return catOfCp(s.codePointAt(i));
  }

  function isMarkCat(c) {
    return c === CAT.Mn || c === CAT.Mc || c === CAT.Me;
  }
  function isLetterCat(c) {
    return c <= CAT.Lo;
  }
  function isLetterAt(s, i) {
    return isLetterCat(catAt(s, i));
  }
  var WHITE = /^[\t-\r\x85\p{Z}]$/u;
  function isWhite(c) {
    return WHITE.test(c);
  }
  function isHigh(c) {
    var n = c.charCodeAt(0);
    return n >= 0xd800 && n <= 0xdbff;
  }
  function isLow(c) {
    var n = c ? c.charCodeAt(0) : 0;
    return n >= 0xdc00 && n <= 0xdfff;
  }

  /** PunctuationRules.CodePoints */
  function codePoints(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      if (isHigh(s[i]) && i + 1 < s.length && isLow(s[i + 1])) {
        out.push(s.codePointAt(i));
        i++;
      } else out.push(s.charCodeAt(i));
    }
    return out;
  }

  /** .NET Framework 4.8 text elements: a code point (or pair) and the combining marks after it. */
  function textElements(s) {
    var out = [];
    var i = 0;
    while (i < s.length) {
      var start = i;
      i += isHigh(s[i]) && i + 1 < s.length && isLow(s[i + 1]) ? 2 : 1;
      while (i < s.length) {
        var len = isHigh(s[i]) && i + 1 < s.length && isLow(s[i + 1]) ? 2 : 1;
        if (!isMarkCat(catAt(s, i))) break;
        i += len;
      }
      out.push(s.substring(start, i));
    }
    return out;
  }

  /** WebUtility.HtmlEncode */
  function enc(s) {
    s = s === null || s === undefined ? '' : String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      var n = s.charCodeAt(i);
      if (c === '<') out += '&lt;';
      else if (c === '>') out += '&gt;';
      else if (c === '"') out += '&quot;';
      else if (c === '&') out += '&amp;';
      else if (c === "'") out += '&#39;';
      else if (n >= 160 && n < 256) out += '&#' + n + ';';
      else if (n >= 0xd800 && n <= 0xdbff) {
        if (i + 1 < s.length && isLow(s[i + 1])) {
          out += '&#' + s.codePointAt(i) + ';';
          i++;
        } else out += '\uFFFD';
      } else if (n >= 0xdc00 && n <= 0xdfff) out += '\uFFFD';
      else out += c;
    }
    return out;
  }

  /** WebUtility.HtmlDecode (the named entities the copyright HTML uses, and numeric ones). */
  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', copy: '\u00A9', reg: '\u00AE' };
  function htmlDecode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, function (m, e) {
      if (e[0] === '#') {
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10);
        try {
          return String.fromCodePoint(n);
        } catch (x) {
          return m;
        }
      }
      return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
    });
  }

  function fmt(s, args) {
    return PC.report.format(s, args);
  }

  /** string.Trim(): char.IsWhiteSpace at both ends. */
  function trim(s) {
    return PC.text.strip(s);
  }

  /** Split on ' ', '\t', '\r', '\n' without empty entries. */
  function splitWs(s) {
    return (s || '').split(/[ \t\r\n]+/).filter(function (x) {
      return x.length > 0;
    });
  }

  function distinct(list) {
    var seen = new Set();
    return list.filter(function (x) {
      if (seen.has(x)) return false;
      seen.add(x);
      return true;
    });
  }

  function ord(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // ============================================================ XML (as XmlDocument reads it)

  /**
   * Parses XML into {type:'el', name, local, ns, attrs:[[name, value]], children, empty}; text
   * nodes are {type:'text', text}. Line ends become \n; attribute white space becomes spaces.
   */
  function parseXml(src) {
    var s = src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var i = 0;
    var root = { type: 'doc', children: [] };
    var stack = [root];
    function decode(t, attr) {
      if (attr) t = t.replace(/[\t\n]/g, ' ');
      return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, function (m, e) {
        if (e === 'amp') return '&';
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        return String.fromCodePoint(e[1] === 'x' ? parseInt(e.substring(2), 16) : parseInt(e.substring(1), 10));
      });
    }
    while (i < s.length) {
      var lt = s.indexOf('<', i);
      if (lt < 0) lt = s.length;
      if (lt > i) {
        var top = stack[stack.length - 1];
        if (top.type === 'el') top.children.push({ type: 'text', text: decode(s.substring(i, lt), false) });
      }
      if (lt >= s.length) break;
      if (s.startsWith('<!--', lt)) {
        var ce = s.indexOf('-->', lt + 4);
        if (ce < 0) throw new Error('XML: unclosed comment');
        var tp = stack[stack.length - 1];
        if (tp.type === 'el') tp.children.push({ type: 'comment', text: s.substring(lt + 4, ce) });
        i = ce + 3;
      } else if (s.startsWith('<![CDATA[', lt)) {
        var de = s.indexOf(']]>', lt + 9);
        if (de < 0) throw new Error('XML: unclosed CDATA');
        stack[stack.length - 1].children.push({ type: 'text', text: s.substring(lt + 9, de), cdata: true });
        i = de + 3;
      } else if (s.startsWith('<?', lt)) {
        var pe = s.indexOf('?>', lt);
        i = pe < 0 ? s.length : pe + 2;
      } else if (s.startsWith('<!', lt)) {
        // DOCTYPE (with an internal subset in brackets)
        var depth = 0;
        var j = lt + 2;
        for (; j < s.length; j++) {
          if (s[j] === '[') depth++;
          else if (s[j] === ']') depth--;
          else if (s[j] === '>' && depth <= 0) break;
        }
        i = j + 1;
      } else if (s[lt + 1] === '/') {
        var ge = s.indexOf('>', lt);
        var closing = s.substring(lt + 2, ge).trim();
        var open = stack.pop();
        if (!open || open.type !== 'el' || open.name !== closing) throw new Error('XML: </' + closing + '> does not close <' + (open && open.name) + '>');
        i = ge + 1;
      } else {
        var m = /^<([^\s/>]+)/.exec(s.substring(lt, lt + 300));
        if (!m) throw new Error('XML: bad tag at ' + lt);
        var el = { type: 'el', name: m[1], attrs: [], children: [], empty: false, parent: stack[stack.length - 1] };
        var k = lt + m[0].length;
        for (;;) {
          while (k < s.length && /\s/.test(s[k])) k++;
          if (s[k] === '/' && s[k + 1] === '>') {
            el.empty = true;
            k += 2;
            break;
          }
          if (s[k] === '>') {
            k++;
            break;
          }
          var am = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(s.substring(k, k + 100000));
          if (!am) throw new Error('XML: bad attribute in <' + el.name + '>');
          el.attrs.push([am[1], decode(am[3] !== undefined ? am[3] : am[4], true)]);
          k += am[0].length;
        }
        resolveNs(el);
        stack[stack.length - 1].children.push(el);
        if (!el.empty) stack.push(el);
        i = k;
      }
    }
    var docEl = root.children.filter(function (c) {
      return c.type === 'el';
    })[0];
    return docEl || null;
  }

  function resolveNs(el) {
    var colon = el.name.indexOf(':');
    var prefix = colon >= 0 ? el.name.substring(0, colon) : '';
    el.local = colon >= 0 ? el.name.substring(colon + 1) : el.name;
    el.ns = lookupNs(el, prefix);
  }

  function lookupNs(el, prefix) {
    var attr = prefix ? 'xmlns:' + prefix : 'xmlns';
    for (var e = el; e && e.type === 'el'; e = e.parent) {
      for (var i = 0; i < e.attrs.length; i++) if (e.attrs[i][0] === attr) return e.attrs[i][1];
    }
    return prefix === 'xml' ? 'http://www.w3.org/XML/1998/namespace' : '';
  }

  function attrOf(el, name) {
    for (var i = 0; i < el.attrs.length; i++) if (el.attrs[i][0] === name) return el.attrs[i][1];
    return '';
  }
  function hasAttr(el, name) {
    return el.attrs.some(function (a) {
      return a[0] === name;
    });
  }

  function innerText(node) {
    if (node.type === 'text') return node.text;
    if (node.type !== 'el') return '';
    return node.children.map(innerText).join('');
  }

  function escText(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function outerXml(n) {
    if (n.type === 'text') return n.cdata ? '<![CDATA[' + n.text + ']]>' : escText(n.text);
    if (n.type === 'comment') return '<!--' + n.text + '-->';
    var a = n.attrs
      .map(function (x) {
        return ' ' + x[0] + '="' + escAttr(x[1]) + '"';
      })
      .join('');
    if (n.empty) return '<' + n.name + a + ' />';
    return '<' + n.name + a + '>' + n.children.map(outerXml).join('') + '</' + n.name + '>';
  }

  /**
   * The few XPath forms LdmlFile uses: steps separated by '/', each a name (prefix "sil:" for
   * the SIL namespace) with an optional [not(@a)] or [@a='v'] predicate. First match in order.
   */
  var SIL_NS = 'urn://www.sil.org/ldml/0.1';
  function selectAll(node, path) {
    var set = [node];
    path.split('/').forEach(function (step) {
      var m = /^([\w:.-]+)(?:\[(not\(@([\w:-]+)\)|@([\w:-]+)='([^']*)')\])?$/.exec(step);
      if (!m) throw new Error('xpath ' + step);
      var name = m[1];
      var colon = name.indexOf(':');
      var ns = colon >= 0 ? (name.substring(0, colon) === 'sil' ? SIL_NS : '?') : '';
      var local = colon >= 0 ? name.substring(colon + 1) : name;
      var next = [];
      set.forEach(function (n) {
        n.children.forEach(function (c) {
          if (c.type !== 'el' || c.local !== local || c.ns !== ns) return;
          if (m[3] && hasAttr(c, m[3])) return;
          if (m[4] && attrOf(c, m[4]) !== m[5]) return;
          next.push(c);
        });
      });
      set = next;
    });
    return set;
  }
  function selectOne(node, path) {
    return selectAll(node, path)[0] || null;
  }

  // ============================================================ SettingsFile

  function item(name, value, attrs) {
    return { name: name, value: value, attrs: attrs || [] };
  }

  /** SettingItem.HasValue */
  function hasValue(it) {
    if (it.value && it.value !== 'NullValue') return true;
    return it.attrs.some(function (a) {
      return !!a[1];
    });
  }

  /** SettingsFile.Read: the root's child elements, in file order. */
  function readSettings(xmlText) {
    var root = parseXml(xmlText);
    var items = [];
    if (!root) return items;
    root.children.forEach(function (el) {
      if (el.type !== 'el') return;
      var hasChildEls = el.children.some(function (c) {
        return c.type === 'el';
      });
      var value = hasChildEls ? el.children.map(outerXml).join('') : innerText(el);
      items.push(item(el.name, value, el.attrs.slice()));
    });
    return items;
  }

  function valueOf(items, name) {
    for (var i = 0; i < items.length; i++) if (items[i].name === name) return items[i].value;
    return null;
  }

  // ============================================================ LdmlFile

  var FILE_ROW = 'ldml';

  function fileNameFor(code) {
    if (!code) return null;
    var tag = code
      .split(':')
      .filter(function (p) {
        return trim(p).length > 0;
      })
      .map(trim)
      .join('-');
    return tag.length > 0 ? tag + '.ldml' : null;
  }

  /** ldmlFiles = {fileName: text} (the project's .ldml files); null = not known (P10 without files). */
  function readLanguage(ldmlFiles, code) {
    var names = Object.keys(ldmlFiles || {}).sort(function (a, b) {
      return ord(a.toUpperCase(), b.toUpperCase());
    });
    var wanted = fileNameFor(code);
    var file = null;
    if (wanted)
      names.forEach(function (f) {
        if (!file && f.toUpperCase() === wanted.toUpperCase()) file = f;
      });
    var rows = [item(FILE_ROW, file || ''), item('ldml-others', names.filter((f) => f !== file).join(' '))];
    if (file === null) return rows;
    var root = parseXml(ldmlFiles[file]);
    if (!root) return rows;
    function text(node, path) {
      var f = selectOne(node, path);
      return f ? innerText(f) : '';
    }
    function attr(path, a) {
      var f = selectOne(root, path);
      return f ? attrOf(f, a) : '';
    }
    function set(s) {
      s = trim(s || '');
      return s === '[]' ? '' : s;
    }
    function lines(t) {
      if (!t) return '';
      return t
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(trim)
        .filter((l) => l.length > 0)
        .join('\n');
    }
    rows.push(item('identity', [attr('identity/language', 'type'), attr('identity/script', 'type'), attr('identity/territory', 'type'), attr('identity/variant', 'type')].join(':')));
    rows.push(item('exemplarCharacters', set(text(root, 'characters/exemplarCharacters[not(@type)]'))));
    ['auxiliary', 'index', 'punctuation'].forEach(function (t) {
      rows.push(item('exemplarCharacters[' + t + ']', set(text(root, "characters/exemplarCharacters[@type='" + t + "']"))));
    });
    ['wordFormingPunctuation', 'footnotes', 'crossrefs', 'verseSegments', 'diacritics', 'wordBreaks', 'numbers'].forEach(function (t) {
      rows.push(item('sil:exemplarCharacters[' + t + ']', set(text(root, "characters/special/sil:exemplarCharacters[@type='" + t + "']"))));
    });
    var defaultCollation = text(root, 'collations/defaultCollation');
    var collationType = !defaultCollation ? 'standard' : trim(defaultCollation);
    var collation = selectOne(root, "collations/collation[@type='" + collationType + "']");
    var simple = collation ? text(collation, 'special/sil:simple') : null;
    var rules = collation ? text(collation, 'cr') : null;
    rows.push(item('sil:simple', lines(simple)));
    if (!lines(simple)) rows.push(item('collation[' + collationType + ']', trim(rules || '')));
    var pairs = selectAll(root, 'delimiters/special/sil:matched-pairs/sil:matched-pair');
    rows.push(item('sil:matched-pairs', pairs.map((p) => attrOf(p, 'open') + '/' + attrOf(p, 'close')).join(' ')));
    rows.push(
      item(
        'sil:matched-pair[paraClose]',
        pairs
          .filter((p) => attrOf(p, 'paraClose').toLowerCase() === 'true')
          .map((p) => attrOf(p, 'open') + '/' + attrOf(p, 'close'))
          .join(' '),
      ),
    );
    rows.push(
      item(
        'sil:punctuation-patterns',
        selectAll(root, 'delimiters/special/sil:punctuation-patterns/sil:punctuation-pattern')
          .map((p) => attrOf(p, 'pattern'))
          .filter((p) => p.length > 0)
          .join(' '),
      ),
    );
    rows.push(item('quotationStart', text(root, 'delimiters/quotationStart')));
    rows.push(item('quotationEnd', text(root, 'delimiters/quotationEnd')));
    rows.push(item('alternateQuotationStart', text(root, 'delimiters/alternateQuotationStart')));
    rows.push(item('alternateQuotationEnd', text(root, 'delimiters/alternateQuotationEnd')));
    var marks = selectOne(root, 'delimiters/special/sil:quotation-marks');
    rows.push(item('sil:quotation-marks[paraContinueType]', marks ? attrOf(marks, 'paraContinueType') : ''));
    rows.push(item('sil:quotationContinue', text(root, 'delimiters/special/sil:quotation-marks/sil:quotationContinue')));
    rows.push(item('sil:alternateQuotationContinue', text(root, 'delimiters/special/sil:quotation-marks/sil:alternateQuotationContinue')));
    rows.push(
      item(
        'sil:quotation',
        selectAll(root, 'delimiters/special/sil:quotation-marks/sil:quotation')
          .map((q) => [attrOf(q, 'level'), attrOf(q, 'open'), attrOf(q, 'close'), attrOf(q, 'continue'), attrOf(q, 'type')].join('|'))
          .join('\n'),
      ),
    );
    rows.push(item('characterOrder', text(root, 'layout/orientation/characterOrder')));
    rows.push(item('numberingSystem[digits]', attr('numbers/numberingSystem', 'digits')));
    rows.push(
      item(
        'sil:font',
        selectAll(root, 'special/sil:external-resources/sil:font')
          .map((f) => [attrOf(f, 'name'), attrOf(f, 'types'), attrOf(f, 'size'), attrOf(f, 'features')].join('|'))
          .join('\n'),
      ),
    );
    rows.push(
      item(
        'sil:kbd',
        selectAll(root, 'special/sil:external-resources/sil:kbd')
          .map((k) => attrOf(k, 'id') + (attrOf(k, 'type').length > 0 ? ' (' + attrOf(k, 'type') + ')' : ''))
          .join('\n'),
      ),
    );
    return rows;
  }

  /** LdmlFile.LettersNotInList */
  function lettersNotInList(validCharacters, simple) {
    var exact = new Set();
    var lower = new Set();
    splitWs(simple).forEach(function (token) {
      token.split('/').forEach(function (form) {
        if (form.length === 0) return;
        var nfc = form.normalize('NFC');
        exact.add(nfc);
        lower.add(nfc.toLowerCase());
      });
    });
    var missing = [];
    splitWs(validCharacters).forEach(function (token) {
      var it = token.normalize('NFC');
      if (!hasLetter(it) || exact.has(it) || missing.indexOf(it) >= 0) return;
      var combination = textElements(it).length > 1;
      if (combination && lower.has(it.toLowerCase())) return;
      missing.push(it);
    });
    return missing;
  }

  function hasLetter(s) {
    for (var i = 0; i < s.length; i++) {
      if (isLetterAt(s, i)) return true;
      if (isHigh(s[i])) i++;
    }
    return false;
  }

  /** LdmlFile.ParseSet: throws on syntax it does not know. */
  function parseSet(set) {
    var s = trim(set || '');
    if (s.length < 2 || s[0] !== '[' || s[s.length - 1] !== ']') throw new Error('not a set');
    s = s.substring(1, s.length - 1);
    var items = [];
    var pos = { i: 0 };
    while (pos.i < s.length) {
      var c = s[pos.i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        pos.i++;
        continue;
      }
      if (c === '{') {
        var sb = '';
        pos.i++;
        while (pos.i < s.length && s[pos.i] !== '}') {
          if (s[pos.i] === '\\') sb += escapeAt(s, pos);
          else sb += s[pos.i++];
        }
        if (pos.i >= s.length) throw new Error('unclosed {');
        pos.i++;
        items.push(sb);
        continue;
      }
      if (c === '[' || c === '^' || c === '$' || c === '&') throw new Error('unsupported set syntax');
      var first = c === '\\' ? escapeAt(s, pos) : s[pos.i++];
      if (pos.i + 1 < s.length && s[pos.i] === '-' && s[pos.i + 1] !== ']') {
        pos.i++;
        var last = s[pos.i] === '\\' ? escapeAt(s, pos) : s[pos.i++];
        var from = first.codePointAt(0);
        var to = last.codePointAt(0);
        if (to < from || to - from > 400) throw new Error('range too large');
        for (var cp = from; cp <= to; cp++) items.push(String.fromCodePoint(cp));
        continue;
      }
      items.push(first);
    }
    return items;
  }

  function hexCp(hex) {
    if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error('bad hex');
    return String.fromCodePoint(parseInt(hex, 16));
  }

  function escapeAt(s, pos) {
    pos.i++;
    if (pos.i >= s.length) throw new Error('trailing backslash');
    var c = s[pos.i];
    if (c === 'u' && pos.i + 4 < s.length) {
      var hex = s.substr(pos.i + 1, 4);
      pos.i += 5;
      return hexCp(hex);
    }
    if (c === 'U' && pos.i + 8 < s.length) {
      var h8 = s.substr(pos.i + 1, 8);
      pos.i += 9;
      return hexCp(h8);
    }
    if (c === 'x' && pos.i + 1 < s.length && s[pos.i + 1] === '{') {
      var close = s.indexOf('}', pos.i);
      if (close < 0) throw new Error('bad \\x');
      var hx = s.substring(pos.i + 2, close);
      pos.i = close + 1;
      return hexCp(hx);
    }
    pos.i++;
    return c;
  }

  // ============================================================ SettingCatalog

  var GROUP_ORDER = ['general', 'files', 'books', 'display', 'language', 'chars', 'punct', 'quotes', 'caps', 'markers', 'words', 'numbers', 'refs', 'notes', 'terms', 'studybible', 'publishing', 'cms', 'cmsmsg', 'other'];
  var MAXINT = 2147483647;

  function isShown(group) {
    return group !== 'cms' && group !== 'cmsmsg' && group !== 'other' && GROUP_ORDER.indexOf(group) >= 0;
  }

  var catalog = null;
  function loadCatalog() {
    if (catalog) return catalog;
    var list = [];
    cfg.settingsTxt.split('\n').forEach(function (raw) {
      var line = raw.replace(/\r+$/, '');
      if (line.trim().length === 0 || line[0] === '#') return;
      var fields = [];
      var cur = '';
      for (var i = 0; i < line.length; i++) {
        if (line[i] === '\\' && line[i + 1] === '|') {
          cur += '|';
          i++;
        } else if (line[i] === '|') {
          fields.push(cur);
          cur = '';
        } else cur += line[i];
      }
      fields.push(cur);
      if (fields.length !== 6) throw new Error('settings.txt: expected 6 fields: ' + line);
      list.push({ name: trim(fields[0]), group: trim(fields[1]), decoder: trim(fields[2]), text: [trim(fields[3]), trim(fields[4]), trim(fields[5])], index: list.length });
    });
    var exact = new Map();
    var ignoreCase = new Map();
    var patterns = [];
    list.forEach(function (info) {
      if (info.name.indexOf('*') >= 0) patterns.push(info);
      else {
        exact.set(info.name, info);
        if (!ignoreCase.has(info.name.toUpperCase())) ignoreCase.set(info.name.toUpperCase(), info);
      }
    });
    catalog = { exact: exact, ignoreCase: ignoreCase, patterns: patterns };
    return catalog;
  }

  function patternMatch(info, name) {
    var star = info.name.indexOf('*');
    var prefix = info.name.substring(0, star);
    var suffix = info.name.substring(star + 1);
    if (name.length < prefix.length + suffix.length) return null;
    if (name.substring(0, prefix.length).toUpperCase() !== prefix.toUpperCase()) return null;
    if (name.substring(name.length - suffix.length).toUpperCase() !== suffix.toUpperCase()) return null;
    var rest = name.substring(prefix.length, name.length - suffix.length);
    return rest.length > 0 ? rest : null;
  }

  function pick(info, lang) {
    var t = info.text[lang];
    return t ? t : info.text[0];
  }

  /** "MarginTop" -> "Margin Top" */
  function splitWords(name) {
    var out = '';
    for (var i = 0; i < name.length; i++) {
      var c = name[i];
      var up = /^\p{Lu}$/u.test(c);
      var lowPrev = i > 0 && /^\p{Ll}$/u.test(name[i - 1]);
      var lowNext = i + 1 < name.length && /^\p{Ll}$/u.test(name[i + 1]);
      var upPrev = i > 0 && /^\p{Lu}$/u.test(name[i - 1]);
      if (i > 0 && up && (lowPrev || (lowNext && upPrev))) out += ' ';
      out += c;
    }
    return out;
  }

  /** SettingCatalog.Describe (custom-check options are not known in Paratext 10: no cms folder). */
  function describe(it, L) {
    var c = loadCatalog();
    var d = { item: it, group: null, decoder: null, order: MAXINT, text: null, note: null, idPrefix: 's', displayName: null, counts: null, invalid: false };
    var info = c.exact.get(it.name) || c.ignoreCase.get(it.name.toUpperCase());
    if (info) {
      d.group = info.group;
      d.decoder = info.decoder;
      d.order = info.index;
      d.text = pick(info, L.lang);
      return d;
    }
    for (var i = 0; i < c.patterns.length; i++) {
      var p = c.patterns[i];
      var rest = patternMatch(p, it.name);
      if (rest === null) continue;
      d.group = p.group;
      d.decoder = p.decoder;
      d.order = p.index;
      d.text = fmt(pick(p, L.lang), [p.group === 'publishing' ? splitWords(rest) : rest]);
      return d;
    }
    d.group = 'other';
    d.decoder = 'text';
    return d;
  }

  var OTHER_DISAPPROVED = ['NONREPEATABLEWORDS', 'UNMATCHEDPAIRINGCHARACTERS', 'UNMATCHEDPAIRINGCHARACTERS_NONTEXT'];
  function isDisapprovedList(name) {
    if (!name || name.toUpperCase().indexOf('ERR_') === 0) return false;
    return name.toLowerCase().indexOf('invalid') >= 0 || OTHER_DISAPPROVED.indexOf(name.toUpperCase()) >= 0;
  }

  // ============================================================ LookAlikes

  var LOOK = new Set([
    0x0027, 0x02bc, 0xa78c, 0xa78b, 0x2019, 0x2018, 0x201b, 0x02bb, 0x02bd, 0x02b9, 0x00b4, 0x0060, 0x2032, 0x02c8, 0x02ca, 0x02cb, 0x02be, 0x02bf,
    0x0022, 0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x02dd, 0x02ba, 0x2039, 0x203a, 0x201a,
    0x002d, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0x2043, 0x02d7, 0x005f, 0x203e,
    0x003a, 0xa789, 0x02d0, 0x2236, 0x02f8, 0x00b7, 0x2022, 0x2027, 0x2219, 0x22c5, 0x2024,
    0x01c0, 0x007c, 0x2223,
    0x005e, 0x02c6, 0x007e, 0x02dc, 0x00a8,
    0x0430, 0x0432, 0x0435, 0x043a, 0x043c, 0x043d, 0x043e, 0x0440, 0x0441, 0x0442, 0x0443, 0x0445, 0x0455, 0x0456, 0x0458, 0x04bb, 0x04cf, 0x0501, 0x051b, 0x051d, 0x04af,
    0x0410, 0x0412, 0x0415, 0x041a, 0x041c, 0x041d, 0x041e, 0x0420, 0x0421, 0x0422, 0x0423, 0x0425, 0x0405, 0x0406, 0x0408, 0x04ba, 0x04c0, 0x0500, 0x051a, 0x051c, 0x04ae,
    0x03b1, 0x03b2, 0x03b5, 0x03b9, 0x03ba, 0x03bd, 0x03bf, 0x03c1, 0x03c4, 0x03c5, 0x03c7, 0x03f2,
    0x0391, 0x0392, 0x0395, 0x0396, 0x0397, 0x0399, 0x039a, 0x039c, 0x039d, 0x039f, 0x03a1, 0x03a4, 0x03a5, 0x03a7,
    0x025b, 0x0254, 0x0251, 0x0261, 0x0131, 0x0269, 0x0283, 0x0292,
  ]);

  function isLookAlike(cp) {
    return LOOK.has(cp) || isMarkCat(catOfCp(cp));
  }

  function hex4(cp) {
    var h = cp.toString(16).toUpperCase();
    while (h.length < 4) h = '0' + h;
    return h;
  }

  function lookAlikeCodes(text) {
    if (!text) return '';
    var seen = new Set();
    var out = [];
    codePoints(text).forEach(function (cp) {
      if (!isLookAlike(cp) || seen.has(cp)) return;
      seen.add(cp);
      out.push('U+' + hex4(cp));
    });
    return out.join(' ');
  }

  // ============================================================ StyleSheets

  /** StyleSheets.ParseText (#!\ lines active; a # after white space starts a comment). */
  function parseStyText(text) {
    var entries = new Map();
    var current = null;
    (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .forEach(function (raw) {
        var line = trim(raw);
        if (line.indexOf('#!') === 0) line = trim(line.substring(2));
        if (line.length === 0 || line[0] === '#' || line[0] !== '\\') return;
        for (var i = 1; i < line.length; i++)
          if (line[i] === '#' && isWhite(line[i - 1])) {
            line = trim(line.substring(0, i));
            break;
          }
        var rest = line.substring(1);
        var ws = 0;
        while (ws < rest.length && !isWhite(rest[ws])) ws++;
        var field = rest.substring(0, ws);
        if (field.length === 0) return;
        var value = trim(rest.substring(ws));
        if (field.toUpperCase() === 'MARKER') {
          current = entries.get(value);
          if (!current) {
            current = new Map();
            entries.set(value, current);
          }
        } else if (current) current.set(field.toLowerCase(), value);
      });
    return entries;
  }

  /** usfm (Map) with custom (Map) laid over it. */
  function mergeSty(base, custom) {
    var m = new Map();
    base.forEach(function (f, k) {
      m.set(k, new Map(f));
    });
    (custom || new Map()).forEach(function (f, k) {
      var t = m.get(k);
      if (!t) {
        t = new Map();
        m.set(k, t);
      }
      f.forEach(function (v, n) {
        t.set(n, v);
      });
    });
    return m;
  }

  /** Paratext 10's StyleInfo (merged usfm + custom) as the same table: styletype and textproperties. */
  function styFromStyleInfo(info) {
    var m = new Map();
    var all = (info && info.markers) || {};
    Object.keys(all).forEach(function (k) {
      var s = all[k] || {};
      var f = new Map();
      if (s.styleType) f.set('styletype', String(s.styleType));
      if (Array.isArray(s.textProperties)) f.set('textproperties', s.textProperties.join(' '));
      m.set(s.marker || k, f);
    });
    return m;
  }

  function builtInSty() {
    return parseStyText(cfg.usfmSty);
  }

  function styleType(sty, marker) {
    var f = marker !== null && marker !== undefined ? sty.get(marker) : null;
    var t = f ? f.get('styletype') : undefined;
    return t !== undefined ? trim(t).toLowerCase() : null;
  }

  function isNonpublishable(sty, marker) {
    var f = sty.get(marker);
    var p = f ? f.get('textproperties') : undefined;
    return p !== undefined && (' ' + p.toLowerCase() + ' ').indexOf(' nonpublishable ') >= 0;
  }

  // ============================================================ UsfmTextTokens

  var MARKER = /\\(\+?)([A-Za-z0-9_-]*)(\*?)/y;
  var CELL = /^t[hc]r?c?\d+(-\d+)?$/;

  function markerAt(s, bs) {
    MARKER.lastIndex = bs;
    return MARKER.exec(s);
  }

  /** UsfmTextTokens.Tokenize: [{text, type: 'main'|'note'|'chapter'|'verse', paraStart, noteStart, cellStart, isFigure}] */
  function tokenize(usfm, sty) {
    var tokens = [];
    if (!usfm) return tokens;
    var s = usfm.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var para = null;
    var note = null;
    var chars = [];
    var noteChars = [];
    var pos = 0;
    function tok(o) {
      tokens.push(Object.assign({ text: '', type: 'main', paraStart: false, noteStart: false, cellStart: false, isFigure: false }, o));
    }
    function publishable() {
      if (para !== null && isNonpublishable(sty, para)) return false;
      for (var a = 0; a < chars.length; a++) if (isNonpublishable(sty, chars[a])) return false;
      for (var b = 0; b < noteChars.length; b++) if (isNonpublishable(sty, noteChars[b])) return false;
      return true;
    }
    while (pos < s.length) {
      var bs = s.indexOf('\\', pos);
      if (bs < 0) bs = s.length;
      if (bs > pos) {
        var run = s.substring(pos, bs);
        if ((chars.length > 0 || noteChars.length > 0) && bs < s.length && isEndMarkerAt(s, bs)) {
          var bar = run.indexOf('|');
          if (bar >= 0) run = run.substring(0, bar);
        }
        if (publishable()) tok({ text: run, type: note !== null ? 'note' : 'main' });
      }
      if (bs >= s.length) break;
      var m = markerAt(s, bs);
      var name = m[2];
      var isEnd = m[3] === '*';
      pos = bs + m[0].length;
      if (name.length === 0) {
        if (!isEnd) pos = bs + 1;
        continue;
      }
      if (isEnd) {
        if (name === note) {
          note = null;
          noteChars = [];
        } else removeLast(note !== null ? noteChars : chars, name);
        continue;
      }
      pos = skipSep(s, pos);
      if (name === 'c' || name === 'v') {
        var rw = readWord(s, pos);
        pos = rw.pos;
        chars = [];
        if (name === 'c') {
          note = null;
          noteChars = [];
        }
        tok({ text: rw.word, type: name === 'c' ? 'chapter' : 'verse' });
        continue;
      }
      var type = styleType(sty, name);
      if (endsWith(name, '-s') || endsWith(name, '-e') || type === 'milestone') {
        pos = skipMilestone(s, pos);
        continue;
      }
      if (CELL.test(name)) {
        tok({ type: 'main', cellStart: true });
        continue;
      }
      if (type === 'paragraph' || name === 'id' || (type === null && note === null)) {
        para = name;
        note = null;
        chars = [];
        noteChars = [];
        if (publishable()) tok({ type: 'main', paraStart: true });
        continue;
      }
      if (type === 'note') {
        note = name;
        noteChars = [];
        pos = readWord(s, pos).pos;
        pos = skipSep(s, pos);
        if (publishable()) tok({ type: 'note', noteStart: true });
        continue;
      }
      if (name === 'fig') {
        pos = addFigure(s, pos, note !== null, tok);
        continue;
      }
      if (note !== null) {
        if (!hasEndMarkerAhead(s, pos, name)) noteChars = [];
        noteChars.push(name);
      } else if (type === 'character' || hasEndMarkerAhead(s, pos, name)) chars.push(name);
    }
    return tokens;
  }

  function endsWith(s, x) {
    return s.length >= x.length && s.substring(s.length - x.length) === x;
  }

  function isEndMarkerAt(s, bs) {
    var m = markerAt(s, bs);
    return !!m && m[3] === '*' && m[2].length > 0;
  }

  function hasEndMarkerAhead(s, pos, name) {
    // Only up to the next marker line: searching the rest of the book made long books slow.
    var nextLine = s.indexOf('\n\\', pos);
    var limit = nextLine < 0 ? s.length : nextLine;
    return s.substring(pos, limit).indexOf('\\' + name + '*') >= 0;
  }

  function removeLast(list, name) {
    var i = list.lastIndexOf(name);
    if (i >= 0) list.splice(i, list.length - i);
  }

  function skipSep(s, pos) {
    return pos < s.length && (s[pos] === ' ' || s[pos] === '\n' || s[pos] === '\t') ? pos + 1 : pos;
  }

  function readWord(s, pos) {
    var start = pos;
    while (pos < s.length && !isWhite(s[pos]) && s[pos] !== '\\') pos++;
    var word = s.substring(start, pos);
    return { word: word, pos: skipSep(s, pos) };
  }

  function skipMilestone(s, pos) {
    var bs = s.indexOf('\\', pos);
    if (bs >= 0 && bs + 1 < s.length && s[bs + 1] === '*') return bs + 2;
    return pos;
  }

  var FIG_REF = /\bref="([^"]*)"/;
  function addFigure(s, pos, inNote, tok) {
    var end = s.indexOf('\\fig*', pos);
    if (end < 0) end = s.length;
    var body = s.substring(pos, end);
    var caption;
    var reference = '';
    var fields = body.split('|');
    if (fields.length === 7) {
      caption = fields[5];
      reference = fields[6];
    } else {
      caption = fields[0];
      if (fields.length > 1) {
        var r = FIG_REF.exec(body.substring(body.indexOf('|')));
        if (r) reference = r[1];
      }
    }
    var type = inNote ? 'note' : 'main';
    if (caption.length > 0) tok({ text: caption, type: type, isFigure: true });
    if (reference.length > 0) tok({ text: reference, type: type, isFigure: true });
    return Math.min(s.length, end + 5);
  }

  function tokensText(tokens) {
    var out = [];
    tokens.forEach(function (t) {
      if (t.type === 'chapter' || t.type === 'verse' || t.paraStart || t.noteStart || t.cellStart || t.isFigure) out.push('\n');
      if (t.type === 'main' || t.type === 'note') out.push(t.text);
      if (t.isFigure) out.push('\n');
    });
    return out.join('');
  }

  // ============================================================ CharacterUsage

  function CharacterUsage(books) {
    this.text = [];
    this.codePoints = new Map();
    this.elements = new Map();
    this.searched = new Map();
    this.loneMarks = new Map();
    this.joined = null;
    this.bookCount = 0;
    var self = this;
    books.forEach(function (tokens) {
      if (!tokens || tokens.length === 0) return;
      var clean = tokensText(tokens).normalize('NFC');
      self.text.push(clean, '\n');
      self.countOne(clean);
      self.bookCount++;
    });
  }

  function add(map, k) {
    map.set(k, (map.get(k) || 0) + 1);
  }

  CharacterUsage.prototype.countOne = function (s) {
    var afterLetter = false;
    for (var i = 0; i < s.length; i++) {
      var len = isHigh(s[i]) && i + 1 < s.length && isLow(s[i + 1]) ? 2 : 1;
      var cp = s.substring(i, i + len);
      add(this.codePoints, cp);
      var cat = catAt(s, i);
      if (isMarkCat(cat)) {
        if (!afterLetter) add(this.loneMarks, cp);
      } else afterLetter = isLetterCat(cat);
      if (len === 2) i++;
    }
    var self = this;
    textElements(s).forEach(function (e) {
      add(self.elements, e);
    });
  };

  function isOneCodePoint(s) {
    return s.length === 1 || (s.length === 2 && isHigh(s[0]) && isLow(s[1]));
  }

  CharacterUsage.prototype.count = function (it) {
    if (!it) return 0;
    var key = it.normalize('NFC');
    if (isOneCodePoint(key) && isMarkCat(catAt(key, 0))) return this.loneMarks.get(key) || 0;
    if (this.codePoints.has(key) || isOneCodePoint(key)) return this.codePoints.get(key) || 0;
    if (textElements(key).length === 1) return this.elements.get(key) || 0;
    if (this.searched.has(key)) return this.searched.get(key);
    if (this.joined === null) this.joined = this.text.join('');
    var n = 0;
    for (var at = this.joined.indexOf(key); at >= 0; at = this.joined.indexOf(key, at + 1)) if (onBoundaries(this.joined, at, key.length)) n++;
    this.searched.set(key, n);
    return n;
  };

  function onBoundaries(text, start, length) {
    if (isMarkCat(catAt(text, start)) && start > 0) {
      var prev = isLow(text[start - 1]) && start > 1 ? start - 2 : start - 1;
      var before = catAt(text, prev);
      if (isLetterAt(text, prev) || isMarkCat(before)) return false;
    }
    var end = start + length;
    return end >= text.length || !isMarkCat(catAt(text, end));
  }

  // ============================================================ PunctuationRules / PunctuationUsage

  function punctuationRules(settings, language) {
    var r = { advanced: valueOf(settings, 'AdvancedView') === 'True', showWs: false, begin: null, end: null, wordForming: new Set(), medial: new Set(), diacritics: new Set() };
    var ws = valueOf(settings, 'PunctuationShowWhitespaceBetweenQuotes') || '';
    r.showWs = ws === 'True' || ws === 'T';
    var begin = new Set();
    var end = new Set();
    ['Quotes', 'InnerQuotes', 'InnerInnerQuotes'].forEach(function (name) {
      var marks = (valueOf(settings, name) || '').split(' ').filter(function (x) {
        return x.length > 0;
      });
      if (marks.length > 0) begin.add(marks[0]);
      if (marks.length > 1) end.add(marks[1]);
      if (marks.length > 2) begin.add(marks[2]);
      if (marks.length > 3) end.add(marks[3]);
    });
    if (begin.size > 0 || end.size > 0) {
      r.begin = begin;
      r.end = end;
    }
    var simple = language ? valueOf(language, 'sil:simple') : null;
    var medial = language ? valueOf(language, 'sil:exemplarCharacters[wordFormingPunctuation]') : null;
    var diacritics = language ? valueOf(language, 'sil:exemplarCharacters[diacritics]') : null;
    if (!simple && !medial) r.medial.add('-'.charCodeAt(0));
    else {
      codePoints(simple || '').forEach(function (cp) {
        var ch = String.fromCodePoint(cp);
        if (cp === 0x2f || isWhite(ch[0])) return;
        var cat = catOfCp(cp);
        if (cat > CAT.Lo || cat === CAT.Lm) r.wordForming.add(cp);
      });
      safeSet(medial).forEach(function (it) {
        codePoints(it).forEach(function (cp) {
          if (!isWhite(String.fromCodePoint(cp)[0])) r.medial.add(cp);
        });
      });
      safeSet(diacritics).forEach(function (it) {
        codePoints(it).forEach(function (cp) {
          if (!isMarkCat(catOfCp(cp)) && !isWhite(String.fromCodePoint(cp)[0])) r.diacritics.add(cp);
        });
      });
    }
    return r;
  }

  function safeSet(set) {
    if (!set) return [];
    try {
      return parseSet(set);
    } catch (e) {
      return [];
    }
  }

  function isWordForming(r, c) {
    if (c === '\u200D' || c === '\u200C') return true;
    var cat = catOfChar(c);
    if (cat <= CAT.Mc || cat === CAT.Co || cat === CAT.Cn) return true;
    var n = c.charCodeAt(0);
    if (r.wordForming.has(n) || r.diacritics.has(n)) return true;
    return r.medial.has(n);
  }

  function isPunctuation(r, c) {
    if (r.medial.has(c.charCodeAt(0))) return true;
    var cat = catOfChar(c);
    if (cat >= CAT.Pc && cat <= CAT.So) return !isWordForming(r, c);
    return false;
  }

  function PunctuationUsage(books, rules) {
    this.counts = new Map();
    this.bookCount = 0;
    var self = this;
    books.forEach(function (tokens) {
      if (!tokens || tokens.length === 0) return;
      self.bookCount++;
      var main = new Processor(rules, self.counts);
      var notes = new Processor(rules, self.counts);
      tokens.forEach(function (t) {
        if (t.type === 'note') {
          if (t.noteStart) notes.finalize(true);
          notes.process(t);
        } else {
          notes.finalize(true);
          main.process(t);
        }
      });
      notes.finalize(true);
      main.finalize(true);
    });
  }
  PunctuationUsage.prototype.count = function (it) {
    return it !== null && it !== undefined ? this.counts.get(it) || 0 : 0;
  };

  var WS = 0;
  var PUNCT = 1;
  var NUM = 2;
  function pieceText(p) {
    return p.kind === WS ? '_' : p.kind === NUM ? '' : p.text;
  }

  function Processor(rules, counts) {
    this.rules = rules;
    this.counts = counts;
    this.puncts = [];
    this.finalizedWithNumber = false;
  }
  Processor.prototype.process = function (t) {
    var number = t.type === 'chapter' || t.type === 'verse';
    if (t.paraStart || t.cellStart || t.isFigure || number) this.finalize(true);
    if (t.paraStart || t.noteStart || t.cellStart || t.isFigure || number) this.addWs();
    if (number) return;
    var text = t.text;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '\u200F') continue;
      if (c === '/' && i + 1 < text.length && text[i + 1] === '/') {
        this.addWsChar(c);
        i++;
      } else if (isPunctuation(this.rules, c)) this.addPunct(c);
      else if (catOfChar(c) === CAT.Nd) {
        if (this.finalizedWithNumber && this.puncts.length === 1 && this.puncts[0].kind === PUNCT) {
          this.puncts = [];
          continue;
        }
        this.puncts.push({ kind: NUM });
        this.finalize(false);
      } else if (isWhite(c)) this.addWsChar(c);
      else this.finalize(false);
    }
  };
  Processor.prototype.addPunct = function (mark) {
    var r = this.rules;
    var p = { kind: PUNCT, text: mark, initial: !!(r.begin && r.begin.has(mark)), final: !!(r.end && r.end.has(mark)) };
    this.puncts.push(p);
    var n = this.puncts.length;
    var q = this.puncts;
    if ((!r.advanced || !r.showWs) && n >= 3 && q[n - 2].kind === WS && q[n - 3].kind === PUNCT && ((q[n - 3].initial && q[n - 1].initial) || (q[n - 3].final && q[n - 1].final)))
      q.splice(n - 2, 1);
  };
  Processor.prototype.addWsChar = function (c) {
    if (c < '\u2000' || c > '\u200B') this.addWs();
  };
  Processor.prototype.addWs = function () {
    if (this.puncts.length === 0 || this.puncts[this.puncts.length - 1].kind !== WS) this.puncts.push({ kind: WS });
  };
  Processor.prototype.finalize = function (addWs) {
    var q = this.puncts;
    this.finalizedWithNumber = q.length > 0 && q[q.length - 1].kind === NUM;
    if (q.length === 0) return;
    if (
      !q.some(function (p) {
        return p.kind === PUNCT;
      })
    ) {
      this.puncts = [];
      return;
    }
    if (addWs) this.addWs();
    q = this.puncts;
    if (this.rules.advanced) this.addItem(q.map(pieceText).join(''));
    else this.basic();
    this.puncts = [];
  };
  Processor.prototype.basic = function () {
    var q = this.puncts;
    for (var i = 0; i < q.length; i++) {
      if (q[i].kind !== PUNCT) continue;
      var last = i;
      while (pieceText(q[i]) === '.' && last + 1 < q.length && pieceText(q[last + 1]) === '.') last++;
      var text = prefix(q, i);
      for (var j = i; j <= last; j++) text += pieceText(q[j]);
      text += suffix(q, last);
      this.addItem(text);
      i = last;
    }
  };
  function prefix(q, index) {
    for (var i = index - 1; i >= 0; i--) if (q[i].kind !== PUNCT) return pieceText(q[i]);
    return '';
  }
  function suffix(q, index) {
    for (var i = index; i < q.length; i++) if (q[i].kind !== PUNCT) return pieceText(q[i]);
    return '';
  }
  Processor.prototype.addItem = function (it) {
    this.counts.set(it, (this.counts.get(it) || 0) + 1);
  };

  // ============================================================ ValueFormatter

  var BOOK_CODES = PC.usfm.BOOKS;
  var ENCODINGS = {
    1250: 'Central European (Windows) (windows-1250)',
    1251: 'Cyrillic (Windows) (windows-1251)',
    1252: 'Western European (Windows) (Windows-1252)',
    1253: 'Greek (Windows) (windows-1253)',
    1254: 'Turkish (Windows) (windows-1254)',
    1255: 'Hebrew (Windows) (windows-1255)',
    1256: 'Arabic (Windows) (windows-1256)',
    1257: 'Baltic (Windows) (windows-1257)',
    1258: 'Vietnamese (Windows) (windows-1258)',
    874: 'Thai (Windows) (windows-874)',
    28591: 'Western European (ISO) (iso-8859-1)',
    1200: 'Unicode (utf-16)',
  };

  function Formatter(S, fontInstalled) {
    this.S = S;
    this.fontInstalled = fontInstalled;
  }

  Formatter.prototype.format = function (d) {
    var it = d.item;
    var value = it.value || '';
    var h = [];
    if ((value.length === 0 || value === 'NullValue') && d.decoder !== 'naming') {
      h.push('<span class="empty">' + enc(this.S.Empty) + '</span>');
      if (value.length > 0) this.stored(h, value);
    } else {
      switch (d.decoder) {
        case 'bool':
          this.bool(h, value);
          break;
        case 'books':
          this.books(h, value, it.name === 'BooksPresent');
          break;
        case 'vrs':
          this.vrs(h, value);
          break;
        case 'encoding':
          this.encoding(h, value);
          break;
        case 'langcode':
          this.langcode(h, value);
          break;
        case 'projtype':
          this.projtype(h, value);
          break;
        case 'html':
          this.html(h, value);
          break;
        case 'font':
          this.font(h, value);
          break;
        case 'list':
          this.list(h, value, null, null);
          break;
        case 'chars':
          this.list(h, value, null, d.counts);
          break;
        case 'punct':
          this.list(h, value, 'punct', d.counts);
          break;
        case 'pairs':
          this.list(h, value, 'pairs', null);
          break;
        case 'bar':
          this.bar(h, value);
          break;
        case 'naming':
          this.naming(h, it);
          break;
        case 'uset':
          this.uset(h, value);
          break;
        case 'lines':
          this.lines(h, value);
          break;
        case 'quotes':
          this.quotes(h, value);
          break;
        case 'fonts':
          this.fonts(h, value);
          break;
        case 'code':
          h.push('<pre class="rules">' + enc(value) + '</pre>');
          break;
        default:
          h.push('<span class="v">' + this.textHtml(value) + '</span>');
          var codes = trim(value).length <= 3 ? lookAlikeCodes(value) : '';
          if (codes.length > 0) h.push(' <span class="cp inline">' + enc(codes) + '</span>');
      }
    }
    if (it.attrs.length > 0 && d.decoder !== 'naming') this.attributes(h, it);
    return h.join('');
  };

  Formatter.prototype.bool = function (h, value) {
    var v = trim(value);
    var shown = null;
    var u = v.toUpperCase();
    if (v === 'T' || u === 'TRUE' || u === 'YES') shown = this.S.Yes;
    else if (v === 'F' || u === 'FALSE' || u === 'NO') shown = this.S.No;
    if (shown === null) {
      h.push('<span class="v">' + this.textHtml(value) + '</span>');
      return;
    }
    h.push('<b>' + enc(shown) + '</b>');
    if (shown !== value) this.stored(h, value);
  };

  Formatter.prototype.books = function (h, value, listMissing) {
    var bits = trim(value);
    if (/[^01]/.test(bits)) {
      h.push('<span class="v">' + this.textHtml(value) + '</span>');
      return;
    }
    var codes = [];
    for (var i = 0; i < bits.length && i < BOOK_CODES.length; i++) if (bits[i] === '1') codes.push(BOOK_CODES[i]);
    if (codes.length === 0) h.push(enc(this.S.BooksNone));
    else {
      h.push('<div>' + enc(fmt(this.S.BooksCount, [codes.length])) + '</div><div class="chips">');
      codes.forEach(function (c) {
        h.push('<span class="chip book">' + c + '</span>');
      });
      h.push('</div>');
    }
    if (listMissing) {
      var missing = [];
      for (var j = 0; j < 66; j++) if (j >= bits.length || bits[j] !== '1') missing.push(BOOK_CODES[j]);
      if (missing.length === 0) h.push('<div class="missing">' + enc(this.S.BooksNoneMissing) + '</div>');
      else {
        h.push('<div class="missing">' + enc(fmt(this.S.BooksMissing, [missing.length])) + '</div><div class="chips">');
        missing.forEach(function (c) {
          h.push('<span class="chip book absent">' + c + '</span>');
        });
        h.push('</div>');
      }
    }
    this.stored(h, value);
  };

  function tryInt(s) {
    var t = trim(s);
    return /^[+-]?\d+$/.test(t) && Math.abs(parseInt(t, 10)) <= MAXINT ? parseInt(t, 10) : null;
  }

  Formatter.prototype.vrs = function (h, value) {
    var n = tryInt(value);
    var names = this.S.VersificationNames;
    if (n !== null && n >= 0 && n < names.length) {
      h.push('<b>' + enc(names[n]) + '</b>');
      this.stored(h, value);
    } else h.push('<span class="v">' + this.textHtml(value) + '</span>');
  };

  Formatter.prototype.encoding = function (h, value) {
    var cp = tryInt(value);
    var name = null;
    if (cp !== null) name = cp === 65001 ? 'UTF-8 (Unicode)' : ENCODINGS[cp] || null;
    if (name === null) {
      h.push('<span class="v">' + this.textHtml(value) + '</span>');
      return;
    }
    h.push('<b>' + enc(name) + '</b>');
    this.stored(h, value);
  };

  Formatter.prototype.langcode = function (h, value) {
    var parts = trim(value).split(':');
    var labels = [this.S.LangLanguage, this.S.LangScript, this.S.LangRegion, this.S.LangVariant];
    h.push('<table class="parts">');
    for (var i = 0; i < labels.length; i++) {
      var part = i < parts.length ? parts[i] : '';
      if (part.length === 0) continue;
      h.push('<tr><td>' + enc(labels[i]) + '</td><td><b>' + enc(part) + '</b></td></tr>');
    }
    h.push('</table>');
    this.stored(h, value);
  };

  Formatter.prototype.projtype = function (h, value) {
    var parts = value.split(':');
    h.push('<table class="parts"><tr><td>' + enc(this.S.ProjType) + '</td><td><b>' + enc(parts[0]) + '</b></td></tr>');
    var baseName = parts.length > 1 ? parts[1] : '';
    var baseId = parts.length > 2 ? parts.slice(2).join(':') : '';
    if (baseName.length > 0 || baseId.length > 0) {
      h.push('<tr><td>' + enc(this.S.ProjBasedOn) + '</td><td><b>' + enc(baseName) + '</b>');
      if (baseId.length > 0) h.push(' <span class="small">' + enc(baseId) + '</span>');
      h.push('</td></tr>');
    }
    h.push('</table>');
    this.stored(h, value);
  };

  Formatter.prototype.html = function (h, value) {
    var text = value.replace(/<\s*(br|\/p|\/div|\/li)\b[^>]*>/gi, '\n');
    text = text.replace(/<[^>]*>/g, '');
    text = trim(htmlDecode(text));
    h.push('<span class="v">' + enc(text).split('\n').join('<br>') + '</span>');
    if (text !== value) this.stored(h, value);
  };

  function cssString(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (/^[\p{L}\p{Nd}]$/u.test(c) || c === ' ' || c === '-' || c === '_') out += c;
    }
    return out;
  }

  Formatter.prototype.font = function (h, value) {
    h.push('<span class="v" style="font-family:\'' + cssString(trim(value)) + '\'">' + enc(value) + '</span>');
    if (this.fontInstalled && !this.fontInstalled(trim(value))) h.push(' <span class="warn">' + enc(this.S.FontMissing) + '</span>');
  };

  function numberGroups(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  Formatter.prototype.list = function (h, value, kind, counts) {
    var items = splitWs(value);
    if (items.length === 0) {
      h.push('<span class="v">' + this.textHtml(value) + '</span>');
      return;
    }
    if (kind === 'punct') h.push('<div class="note">' + enc(this.S.PunctNote) + '</div>');
    h.push('<div class="chips v">');
    var self = this;
    items.forEach(function (it) {
      h.push('<span class="chip"');
      if (kind === 'punct') h.push(' title="' + enc(self.punctPlace(it)) + '"');
      h.push('>');
      if (kind === 'pairs' && it.length >= 3 && it.indexOf('/') > 0) {
        var slash = it.indexOf('/');
        h.push(self.tokenHtml(it.substring(0, slash)) + '<span class="dim"> \u2026 </span>' + self.tokenHtml(it.substring(slash + 1)));
      } else h.push(self.tokenHtml(it));
      var count = counts ? counts.get(it) : undefined;
      if (counts && count !== undefined && count > 0) h.push('<sup class="n">' + numberGroups(count) + '</sup>');
      var codesOf = kind === 'punct' && it.replace(/^_+|_+$/g, '').length > 0 ? it.split('_').join('') : it;
      h.push(codesHtml(codesOf) + '</span>');
    });
    h.push('</div>');
  };

  function codesHtml(it) {
    var codes = lookAlikeCodes(it);
    return codes.length > 0 ? '<span class="cp">' + enc(codes) + '</span>' : '';
  }

  Formatter.prototype.punctPlace = function (it) {
    var before = it[0] === '_' && it.length > 1;
    var after = it[it.length - 1] === '_' && it.length > 1;
    if (before && after) return this.S.PunctIsolated;
    if (before) return this.S.PunctInitial;
    if (after) return this.S.PunctFinal;
    return this.S.PunctMedial;
  };

  Formatter.prototype.bar = function (h, value) {
    var self = this;
    h.push('<ul class="bar v">');
    value.split('|').forEach(function (it) {
      h.push('<li>' + self.textHtml(it) + '</li>');
    });
    h.push('</ul>');
  };

  function attrValue(it, name) {
    for (var i = 0; i < it.attrs.length; i++) if (it.attrs[i][0] === name) return it.attrs[i][1];
    return null;
  }

  Formatter.prototype.naming = function (h, it) {
    var pre = attrValue(it, 'PrePart') || '';
    var post = attrValue(it, 'PostPart') || '';
    var form = attrValue(it, 'BookNameForm') || '';
    if (form.length > 0 || post.length > 0) h.push('<div><b>' + enc(fmt(this.S.MatthewFile, [pre + form + post])) + '</b></div>');
    var v = it.value || '';
    if (!(v.length === 0 || v === 'NullValue')) h.push('<div class="v">' + this.textHtml(it.value) + '</div>');
    this.attributes(h, it);
  };

  Formatter.prototype.uset = function (h, value) {
    var items;
    try {
      items = parseSet(value);
    } catch (e) {
      h.push('<span class="v">' + this.textHtml(value) + '</span>');
      return;
    }
    var self = this;
    h.push('<div class="chips v">');
    items.forEach(function (it) {
      h.push('<span class="chip">');
      if (trim(it).length === 0) h.push(badge(self.S.Space));
      else h.push(self.tokenHtml(it) + codesHtml(it));
      h.push('</span>');
    });
    h.push('</div>');
  };

  Formatter.prototype.lines = function (h, value) {
    var self = this;
    h.push('<ol class="lines v">');
    value.split('\n').forEach(function (line) {
      h.push('<li>');
      line
        .split(' ')
        .filter(function (p) {
          return p.length > 0;
        })
        .forEach(function (part) {
          h.push('<span class="chip">' + self.tokenHtml(part) + codesHtml(part) + '</span> ');
        });
      h.push('</li>');
    });
    h.push('</ol>');
  };

  Formatter.prototype.quotes = function (h, value) {
    var self = this;
    var S = this.S;
    h.push('<ul class="bar v">');
    value.split('\n').forEach(function (line) {
      var f = line.split('|');
      if (f.length < 5) return;
      var parts = [];
      if (f[1].length > 0 || f[2].length > 0) parts.push(fmt(S.QuoteOpenClose, [self.textHtml(f[1]), self.textHtml(f[2])]));
      if (f[3].length > 0) parts.push(enc(fmt(S.QuoteContinue, ['\u0001'])).split('\u0001').join(self.textHtml(f[3])));
      h.push('<li><b>' + enc(fmt(S.QuoteLevel, [f[0]])) + '</b>');
      if (f[4].length > 0) h.push(' (' + enc(f[4] === 'narrative' ? S.QuoteNarrative : f[4]) + ')');
      h.push(': ' + parts.join('; ') + '</li>');
    });
    h.push('</ul>');
  };

  Formatter.prototype.fonts = function (h, value) {
    var self = this;
    var S = this.S;
    h.push('<ul class="bar">');
    value.split('\n').forEach(function (line) {
      var f = line.split('|');
      if (f.length < 4 || f[0].length === 0) return;
      h.push('<li><span class="v" style="font-family:\'' + cssString(f[0]) + '\'">' + enc(f[0]) + '</span>');
      var extra = [];
      if (f[1].length > 0) extra.push(f[1]);
      if (f[2].length > 0) extra.push(fmt(S.FontSize, [f[2]]));
      if (f[3].length > 0) extra.push(fmt(S.FontFeatureList, [f[3]]));
      if (extra.length > 0) h.push(' <span class="dim">(' + enc(extra.join(', ')) + ')</span>');
      if (self.fontInstalled && !self.fontInstalled(f[0])) h.push(' <span class="warn">' + enc(S.FontMissing) + '</span>');
      h.push('</li>');
    });
    h.push('</ul>');
  };

  Formatter.prototype.stored = function (h, value) {
    h.push('<div class="stored">' + enc(this.S.StoredAs) + ' <code>' + this.textHtml(value) + '</code></div>');
  };

  Formatter.prototype.attributes = function (h, it) {
    var self = this;
    h.push('<div class="stored">' + enc(this.S.Attributes));
    it.attrs.forEach(function (a) {
      h.push(' <code>' + enc(a[0]) + '="' + self.textHtml(a[1]) + '"</code>');
    });
    h.push('</div>');
  };

  Formatter.prototype.textHtml = function (value) {
    if (value.length === 0) return '';
    var start = 0;
    var end = value.length;
    while (start < end && value[start] === ' ') start++;
    while (end > start && value[end - 1] === ' ') end--;
    var out = '';
    for (var i = 0; i < start; i++) out += badge(this.S.Space);
    out += this.tokenHtml(value.substring(start, end));
    for (var j = end; j < value.length; j++) out += badge(this.S.Space);
    return out.split('\r\n').join('\n').split('\n').join('<br>');
  };

  Formatter.prototype.tokenHtml = function (token) {
    var out = '';
    for (var i = 0; i < token.length; i++) {
      var c = token[i];
      if (isHigh(c) && i + 1 < token.length && isLow(token[i + 1])) {
        out += token.substring(i, i + 2);
        i++;
        continue;
      }
      var name = specialName(c);
      if (name !== null) {
        out += badge(name + ' U+' + hex4(c.charCodeAt(0)));
        continue;
      }
      var cat = catOfChar(c);
      if (isMarkCat(cat) && (i === 0 || specialName(token[i - 1]) !== null)) out += '\u25CC';
      if (c === '\n' || c === '\r') out += c;
      else out += enc(c);
    }
    return out;
  };

  var SPECIAL = {
    '\u00A0': 'NBSP', '\u00AD': 'SHY', '\u2002': 'EN SP', '\u2003': 'EM SP', '\u2009': 'THIN SP', '\u200A': 'HAIR SP',
    '\u200B': 'ZWSP', '\u200C': 'ZWNJ', '\u200D': 'ZWJ', '\u200E': 'LRM', '\u200F': 'RLM', '\u202F': 'NNBSP',
    '\u2060': 'WJ', '\uFEFF': 'ZWNBSP', '\t': 'TAB',
  };
  function specialName(c) {
    if (Object.prototype.hasOwnProperty.call(SPECIAL, c)) return SPECIAL[c];
    if (c === '\n' || c === '\r' || c === ' ') return null;
    var cat = catOfChar(c);
    if (cat === CAT.Zs) return 'SPACE';
    if (cat === CAT.Cf || cat === CAT.Cc) return 'CTRL';
    return null;
  }

  function badge(text) {
    return '<span class="badge">' + enc(text) + '</span>';
  }

  // ============================================================ HtmlReport

  var GROUP_TITLE = {
    general: 'GroupGeneral', files: 'GroupFiles', books: 'GroupBooks', display: 'GroupDisplay', language: 'GroupLanguage', quotes: 'GroupQuotes',
    chars: 'GroupChars', punct: 'GroupPunct', caps: 'GroupCaps', words: 'GroupWords', numbers: 'GroupNumbers', refs: 'GroupRefs',
    markers: 'GroupMarkers', notes: 'GroupNotes', terms: 'GroupTerms', studybible: 'GroupStudyBible', publishing: 'GroupPublishing',
    cms: 'GroupCms', cmsmsg: 'GroupCmsMessages',
  };

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function stamp(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function derived(anchor, name, none, items, displayName, decoder) {
    var d = {
      item: item(name, items.length > 0 ? items.join(' ') : none),
      group: anchor.group,
      order: anchor.order,
      decoder: items.length > 0 ? decoder || 'chars' : 'text',
      idPrefix: 'x',
      displayName: displayName,
      text: null,
      note: null,
      counts: null,
      invalid: false,
    };
    return d;
  }

  function countAll(list, count) {
    var m = new Map();
    list.forEach(function (it) {
      if (!m.has(it)) m.set(it, count(it));
    });
    return m;
  }

  function splitByUsage(row, u, S) {
    var all = distinct(splitWs(row.item.value));
    var counts = countAll(all, u.count);
    var used = all.filter((i) => counts.get(i) > 0);
    var unused = all.filter((i) => counts.get(i) === 0);
    row.item = item(row.item.name, used.length > 0 ? used.join(' ') : S.Empty);
    row.decoder = used.length > 0 ? u.decoder : 'text';
    row.counts = counts;
    row.text = fmt(u.usedDesc, [u.books]);
    var d = derived(row, row.item.name + '-unused', u.unusedNone, unused, u.unusedName, u.decoder);
    d.text = fmt(u.unusedDesc, [u.books]);
    return d;
  }

  function invalidFoundRow(row, u) {
    var all = distinct(splitWs(row.item.value));
    var counts = countAll(all, u.count);
    var found = all.filter((i) => counts.get(i) > 0);
    var d = derived(row, row.item.name + '-found', u.foundNone, found, u.foundName, u.decoder);
    d.text = fmt(u.foundDesc, [u.books]);
    if (found.length > 0) d.counts = counts;
    d.invalid = true;
    return d;
  }

  function characterRows(usage, S) {
    return {
      count: (i) => usage.count(i), books: usage.bookCount, decoder: 'chars', usedDesc: S.UsedValidDesc, unusedName: S.UnusedName,
      unusedDesc: S.UnusedDesc, unusedNone: S.UnusedNone, foundName: S.InvalidFoundName, foundDesc: S.InvalidFoundDesc, foundNone: S.InvalidFoundNone,
    };
  }
  function punctuationRows(usage, S) {
    return {
      count: (i) => usage.count(i), books: usage.bookCount, decoder: 'punct', usedDesc: S.PunctUsedDesc, unusedName: S.UnusedName,
      unusedDesc: S.PunctUnusedDesc, unusedNone: S.PunctUnusedNone, foundName: S.PunctFoundName, foundDesc: S.PunctFoundDesc, foundNone: S.PunctFoundNone,
    };
  }

  function notInLanguageRow(validRow, original, simple, ldmlFile, usage, S) {
    var missing = lettersNotInList(original, simple);
    var counts = null;
    if (usage) {
      counts = countAll(missing, (i) => usage.count(i));
      missing = missing.filter((m) => counts.get(m) > 0);
    }
    var d = derived(validRow, 'ValidCharacters-notInLanguageSettings', usage ? S.NotInLanguageNoneUsed : S.NotInLanguageNone, missing, S.NotInLanguageName);
    d.text = fmt(usage ? S.NotInLanguageDescUsed : S.NotInLanguageDesc, [ldmlFile]);
    if (missing.length > 0) d.counts = counts;
    return d;
  }

  function anchor(described, name, L) {
    var row = described.find((d) => d.idPrefix === 's' && d.item.name === name);
    return row || describe(item(name, null), L);
  }

  /** fileInfo(name) = {exists, length, mtime: Date} or null when it cannot be known (Paratext 10). */
  function projectFileRow(fileInfo, fileName, anchorRow, description, S) {
    var f = fileInfo ? fileInfo(fileName) : null;
    var value;
    if (!f) value = fmt(S.FileUnknown, [fileName]);
    else if (f.exists) value = fmt(S.FilePresent, [f.length, stamp(f.mtime)]);
    else value = fmt(S.FileAbsent, [fileName]);
    var d = derived(anchorRow, 'file-' + fileName, value, [], fmt(S.ProjectFileName, [fileName]));
    d.text = description;
    return d;
  }

  function css(projectFont) {
    var valueFont = !projectFont ? 'inherit' : "'" + cssString(projectFont) + "', 'Segoe UI', 'Charis SIL', sans-serif";
    return (
      ':root{--bg:#fbfaf7;--fg:#1f2328;--muted:#5f6670;--line:#dcd8cf;--head:#efece4;--chip:#ffffff;--chipline:#cfcabe;--accent:#2f5f8a;--badge:#fde9b8;--badgefg:#5a4300;--warn:#a33a1f;--invalid:#ffd9b0;--emptyname:#fff3a8;}\n' +
      '@media (prefers-color-scheme: dark){:root{--bg:#1c1d1f;--fg:#e6e3dc;--muted:#a3a7ad;--line:#3a3c40;--head:#26282b;--chip:#2a2c30;--chipline:#4a4d52;--accent:#8fb8de;--badge:#5a4a1c;--badgefg:#fbe7b0;--warn:#f08f72;--invalid:#6a4318;--emptyname:#5c5418;}}\n' +
      '*{box-sizing:border-box}\n' +
      "body{margin:0;padding:0 16px 48px;background:var(--bg);color:var(--fg);font:15px/1.5 'Segoe UI',system-ui,sans-serif}\n" +
      '.page{max-width:1200px;margin:0 auto}\n' +
      'tr.isempty,section.allempty,li.allempty,.emptycount{display:none}\n' +
      '#showEmpty:checked~main tr.isempty{display:table-row}\n' +
      '#showEmpty:checked~main section.allempty{display:block}\n' +
      '#showEmpty:checked~nav li.allempty{display:list-item}\n' +
      '#showEmpty:checked~nav .emptycount{display:inline}\n' +
      'input.opt{margin:16px 6px 0 0;width:16px;height:16px;vertical-align:middle}\n' +
      'label.opt{display:inline-block;margin-top:16px;vertical-align:middle;cursor:pointer;font-weight:600}\n' +
      'td.name.invalid{background:var(--invalid)}\n' +
      'tr.isempty td.name{background:var(--emptyname)}\n' +
      'tr.derived td.name{font-style:italic;padding-left:22px}\n' +
      "sup.n{margin-left:3px;font:10px/1 'Segoe UI',sans-serif;color:var(--muted);vertical-align:super}\n" +
      ".cp{display:block;font:9px/1.2 Consolas,'Courier New',monospace;color:var(--accent);white-space:nowrap}\n" +
      '.cp.inline{display:inline;font-size:11px;margin-left:4px}\n' +
      '.swatch.emptyswatch{background:var(--emptyname)}\n' +
      "pre.rules{margin:0;white-space:pre-wrap;font-family:Consolas,'Courier New',monospace;font-size:.85em}\n" +
      'ol.lines{margin:0;padding-left:2.2em;columns:4 9em;column-gap:1.5em}ol.lines li{margin:2px 0;break-inside:avoid}\n' +
      '.swatch{display:inline-block;width:2.2em;height:1em;vertical-align:middle;background:var(--invalid);border:1px solid var(--chipline);border-radius:2px}\n' +
      'h1{font-size:1.7em;margin:28px 0 2px}\n' +
      'h2{font-size:1.25em;margin:32px 0 10px;padding-bottom:4px;border-bottom:2px solid var(--accent);color:var(--accent)}\n' +
      'nav h2{border:0;margin-top:20px}\n' +
      'nav ul{list-style:none;padding:0;margin:0;columns:3 220px}\n' +
      'nav li{margin:2px 0}\n' +
      'a{color:var(--accent)}\n' +
      '.full{font-size:1.1em;margin:0 0 8px}\n' +
      '.meta,.small,.count,.stored,.note{color:var(--muted);font-size:.86em}\n' +
      '.count{margin-left:4px}\n' +
      '.readonly{border-left:4px solid var(--accent);padding:6px 10px;background:var(--head)}\n' +
      'table{width:100%;border-collapse:collapse;table-layout:fixed}\n' +
      'th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}\n' +
      'th{background:var(--head);font-weight:600}\n' +
      'th.name{width:20%}th.val{width:38%}\n' +
      'td.name code{word-break:break-all}\n' +
      'td.val{overflow-wrap:anywhere}\n' +
      "code{font-family:Consolas,'Courier New',monospace;font-size:.92em}\n" +
      '.v{font-family:' + valueFont + '}\n' +
      '.stored{margin-top:4px}.stored code{overflow-wrap:anywhere}\n' +
      '.empty{color:var(--muted);font-style:italic}\n' +
      '.warn{color:var(--warn);font-size:.86em}\n' +
      '.dim{color:var(--muted)}\n' +
      '.chips{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0}\n' +
      '.chip{display:inline-block;min-width:1.6em;text-align:center;padding:1px 6px;border:1px solid var(--chipline);border-radius:4px;background:var(--chip)}\n' +
      ".chip.book{font-family:Consolas,'Courier New',monospace;font-size:.85em}\n" +
      '.chip.absent{border-style:dashed;border-color:var(--warn);color:var(--warn);background:transparent}\n' +
      '.missing{margin-top:6px}\n' +
      ".badge{display:inline-block;margin:0 1px;padding:0 4px;border-radius:3px;background:var(--badge);color:var(--badgefg);font:11px/1.5 'Segoe UI',sans-serif;vertical-align:middle}\n" +
      '.note{margin-bottom:4px}\n' +
      'table.parts{width:auto;table-layout:auto}table.parts td{border:0;padding:0 12px 0 0}\n' +
      'ul.bar{margin:0;padding-left:18px}\n' +
      '@media (max-width:700px){table,thead,tbody,tr,th,td{display:block;width:auto!important}thead{display:none}tr{border-bottom:1px solid var(--line);padding:6px 0}td{border:0;padding:3px 0}#showEmpty:checked~main tr.isempty{display:block}}\n' +
      '@media print{body{background:#fff;color:#000}nav,.opt{display:none}h2{break-after:avoid}tr{break-inside:avoid}td.name{-webkit-print-color-adjust:exact;print-color-adjust:exact}}\n'
    );
  }

  /**
   * HtmlReport.Build. o = {items, settingsPath, projectName, languageItems (or null), usage, punct,
   * S (strings of one language, with .lang 0/1/2 and .langCode), fontInstalled (or null),
   * now (Date), fileInfo (name -> {exists, length, mtime} | null), version, note (an extra
   * paragraph for Paratext 10, or null)}.
   */
  function build(o) {
    var S = o.S;
    var L = { lang: S.lang };
    var f = new Formatter(S, o.fontInstalled || null);
    var usage = o.usage && o.usage.bookCount > 0 ? o.usage : null;
    var punct = o.punct && o.punct.bookCount > 0 ? o.punct : null;
    var items = o.items;
    var described = items.map((i) => describe(i, L)).filter((d) => isShown(d.group));
    var ldmlFile = null;
    var ldmlExpected = null;
    if (o.languageItems) {
      o.languageItems.forEach(function (it) {
        var d = describe(it, L);
        d.group = 'language';
        d.idPrefix = 'l';
        described.push(d);
        if (it.name === FILE_ROW) ldmlFile = it.value;
      });
      ldmlExpected = fileNameFor(valueOf(items, 'LanguageIsoCode'));
    }
    var ldmlMissing = !!o.languageItems && !ldmlFile;
    var emptyCount = described.filter((d) => !hasValue(d.item)).length;
    var settingCount = described.length;

    var validRow = described.find((d) => d.idPrefix === 's' && d.item.name === 'ValidCharacters');
    var invalidRow = described.find((d) => d.idPrefix === 's' && d.item.name === 'InvalidCharacters');
    var originalValid = validRow ? validRow.item.value : null;
    if (usage && validRow && hasValue(validRow.item)) described.push(splitByUsage(validRow, characterRows(usage, S), S));
    var simple = o.languageItems ? valueOf(o.languageItems, 'sil:simple') : null;
    if (validRow && originalValid && originalValid !== 'NullValue' && simple) described.push(notInLanguageRow(validRow, originalValid, simple, ldmlFile, usage, S));
    if (usage && invalidRow && hasValue(invalidRow.item)) described.push(invalidFoundRow(invalidRow, characterRows(usage, S)));

    var validPunct = described.find((d) => d.idPrefix === 's' && d.item.name === 'ValidPunctuation');
    var invalidPunct = described.find((d) => d.idPrefix === 's' && d.item.name === 'InvalidPunctuation');
    if (punct && validPunct && hasValue(validPunct.item)) described.push(splitByUsage(validPunct, punctuationRows(punct, S), S));
    if (punct && invalidPunct && hasValue(invalidPunct.item)) described.push(invalidFoundRow(invalidPunct, punctuationRows(punct, S)));

    described.push(projectFileRow(o.fileInfo, 'custom.sty', anchor(described, 'StyleSheet', L), S.CustomStyDesc, S));
    described.push(projectFileRow(o.fileInfo, 'custom.vrs', anchor(described, 'Versification', L), S.CustomVrsDesc, S));
    var filesEnd = { group: 'files', order: MAXINT - 1 };
    described.push(projectFileRow(o.fileInfo, 'autocorrect.txt', filesEnd, S.AutoCorrectDesc, S));

    var name = valueOf(items, 'Name');
    if (name === null) name = o.projectName || '';
    var fullName = valueOf(items, 'FullName');
    var font = valueOf(items, 'DefaultFont');
    var rtl = (valueOf(items, 'LeftToRight') || '') === 'F';

    var h = [];
    h.push('<!DOCTYPE html>\n<html lang="' + S.langCode + '">\n<head>\n<meta charset="utf-8">\n');
    h.push('<meta name="viewport" content="width=device-width, initial-scale=1">\n');
    h.push('<title>' + enc(fmt(S.ReportTitle, [name])) + '</title>\n');
    h.push('<style>\n' + css(font) + '</style>\n</head>\n<body>\n<div class="page">\n');
    h.push('<header>\n<h1>' + enc(fmt(S.ReportTitle, [name])) + '</h1>\n');
    if (fullName) h.push('<p class="full">' + enc(fullName) + '</p>\n');
    h.push('<p class="meta">' + enc(S.FileLabel) + ' <code>' + enc(o.settingsPath) + '</code><br>');
    h.push(enc(fmt(S.MadeBy, [S.Title, o.version, stamp(o.now)])));
    h.push(' ' + enc(fmt(S.CountSettings, [settingCount - emptyCount, emptyCount])));
    if (usage) h.push('<br>' + enc(fmt(S.BooksRead, [usage.bookCount])));
    h.push('</p>\n');
    h.push('<p>' + enc(S.Intro) + '</p>\n');
    if (o.note) h.push('<p class="readonly">' + enc(o.note) + '</p>\n');
    h.push('<p class="readonly">' + enc(S.ReadOnlyNote) + '</p>\n');
    if (described.some((d) => isDisapprovedList(d.item.name))) h.push('<p class="meta"><span class="swatch"></span> ' + enc(S.InvalidLegend) + '</p>\n');
    if (emptyCount > 0) h.push('<p class="meta"><span class="swatch emptyswatch"></span> ' + enc(S.EmptyLegend) + '</p>\n');
    h.push('<p class="meta"><span class="chip">\u02BC<span class="cp">U+02BC</span></span> ' + enc(S.LookAlikeLegend) + '</p>\n');
    h.push('</header>\n');
    if (emptyCount > 0) h.push('<input type="checkbox" id="showEmpty" class="opt"><label for="showEmpty" class="opt">' + enc(fmt(S.ShowEmpty, [emptyCount])) + '</label>\n');

    var groups = GROUP_ORDER.map(function (g) {
      return {
        key: g,
        rows: described
          .filter((d) => d.group === g)
          .map((d, i) => [d, i])
          .sort((a, b) => a[0].order - b[0].order || a[1] - b[1])
          .map((x) => x[0]),
      };
    }).filter((g) => g.rows.length > 0);

    h.push('<nav><h2>' + enc(S.Contents) + '</h2>\n<ul>\n');
    groups.forEach(function (g) {
      var filled = g.rows.filter((d) => hasValue(d.item) && d.idPrefix !== 'x').length;
      var empty = g.rows.filter((d) => !hasValue(d.item)).length;
      var hide = filled === 0 && !(g.key === 'language' && ldmlMissing);
      h.push((hide ? '<li class="allempty">' : '<li>') + '<a href="#' + g.key + '">' + enc(groupTitle(S, g.key)) + '</a> <span class="count">' + filled);
      if (empty > 0) h.push(' <span class="emptycount">' + enc(fmt(S.EmptyCount, [empty])) + '</span>');
      h.push('</span></li>\n');
    });
    h.push('</ul>\n</nav>\n<main>\n');

    groups.forEach(function (g) {
      var isLanguage = g.key === 'language';
      var allEmpty = g.rows.every((d) => !hasValue(d.item)) && !(isLanguage && ldmlMissing);
      h.push('<section id="' + g.key + (allEmpty ? '" class="allempty">\n<h2>' : '">\n<h2>') + enc(groupTitle(S, g.key)));
      if (isLanguage && !ldmlMissing) h.push(' <span class="count">(' + enc(ldmlFile) + ')</span>');
      h.push('</h2>\n');
      if (isLanguage && ldmlMissing) h.push('<p class="readonly">' + enc(fmt(S.NoLdml, [ldmlExpected || '?.ldml'])) + '</p>\n');
      h.push('<table>\n<thead><tr><th class="name">' + enc(S.ColSetting) + '</th><th class="val">' + enc(S.ColValue) + '</th><th class="desc">' + enc(S.ColDescription) + '</th></tr></thead>\n<tbody>\n');
      g.rows.forEach(function (d) {
        h.push('<tr id="' + d.idPrefix + '-' + enc(d.item.name) + (hasValue(d.item) ? (d.displayName !== null ? '" class="derived">' : '">') : '" class="isempty">'));
        if (d.displayName !== null) h.push((d.invalid ? '<td class="name invalid">' : '<td class="name">') + enc(d.displayName) + '</td><td class="val"');
        else h.push((isDisapprovedList(d.item.name) ? '<td class="name invalid"><code>' : '<td class="name"><code>') + enc(d.item.name) + '</code></td><td class="val"');
        if (rtl) h.push(' dir="auto"');
        h.push('>' + f.format(d) + '</td><td class="desc">');
        if (d.text !== null) h.push(enc(d.text));
        else h.push('<span class="empty">' + enc(S.NoDescription) + '</span>');
        if (d.note !== null) h.push('<div class="small">' + enc(d.note) + '</div>');
        h.push('</td></tr>\n');
      });
      h.push('</tbody>\n</table>\n</section>\n');
    });
    h.push('</main>\n</div>\n</body>\n</html>\n');
    return h.join('');
  }

  function groupTitle(S, g) {
    return S[GROUP_TITLE[g] || 'GroupOther'];
  }

  // ============================================================ Paratext 10's own settings

  /** [P10 setting key, Settings.xml name, convert(value) -> string or null]. */
  var P10_SETTINGS = [
    ['platform.name', 'Name', str],
    ['platform.fullName', 'FullName', str],
    ['platform.language', 'Language', str],
    ['platform.languageTag', 'LanguageIsoCode', languageTagToIsoCode],
    ['platform.textDirection', 'LeftToRight', function (v) {
      return v === null || v === undefined ? null : String(v).toLowerCase() === 'rtl' ? 'F' : 'T';
    }],
    ['platformScripture.booksPresent', 'BooksPresent', str],
    ['platformScripture.versification', 'Versification', str],
    ['platformScripture.validCharacters', 'ValidCharacters', str],
    ['platformScripture.invalidCharacters', 'InvalidCharacters', str],
    ['platformScripture.allowInvisibleCharacters', 'AllowInvisibleChars', function (v) {
      return v === null || v === undefined ? null : v === true || String(v).toLowerCase() === 'true' ? 'T' : 'F';
    }],
    ['platformScripture.validPunctuation', 'ValidPunctuation', str],
    ['platformScripture.invalidPunctuation', 'InvalidPunctuation', str],
    ['platformScripture.repeatableWords', 'RepeatableWords', str],
    ['platformScripture.nonRepeatableWords', 'NonRepeatableWords', str],
    ['platformScripture.chapterVerseSeparator', 'ChapterVerseSeparator', str],
    ['platformScripture.verseRangeSeparator', 'RangeIndicator', str],
    ['platformScripture.defaultFootnoteCaller', 'DefaultFootnoteCaller', str],
    ['platformScripture.defaultCrossRefCaller', 'DefaultCrossRefCaller', str],
    ['platformScripture.footnoteCallers', 'CallerSequence', str],
    ['platformScripture.copyrightNotice', 'Copyright', copyrightText],
  ];

  function str(v) {
    if (v === null || v === undefined) return null;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }

  /** "es-x-taller" -> "es:::x-taller"; "en-Latn-US" -> "en:Latn:US:" (language:script:region:variant). */
  function languageTagToIsoCode(v) {
    if (!v) return null;
    var parts = String(v).split('-');
    var lang = parts.shift() || '';
    var script = '';
    var region = '';
    if (parts.length && /^[A-Za-z]{4}$/.test(parts[0])) script = parts.shift();
    if (parts.length && /^([A-Za-z]{2}|\d{3})$/.test(parts[0])) region = parts.shift();
    return [lang, script, region, parts.join('-')].join(':');
  }

  function copyrightText(v) {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return String(v);
    if (v.kind === 'none') return '';
    return v.html || v.text || v.notice || JSON.stringify(v);
  }

  /** P10 settings ({key: value}) as Settings.xml items, in the catalog's order of the mapping. */
  function itemsFromP10(values) {
    var items = [];
    P10_SETTINGS.forEach(function (m) {
      if (!Object.prototype.hasOwnProperty.call(values, m[0])) return;
      var v = m[2](values[m[0]]);
      if (v === null) return;
      items.push(item(m[1], v));
    });
    return items;
  }

  // ============================================================ the whole report

  /**
   * The report from texts. o = {settingsXml (or null), ldmlFiles ({name: text}, or null), p10
   * ({key: value}, used when there is no Settings.xml), books ([usfm text]), sty (a Map: the
   * stylesheet), S, now, fileInfo, settingsPath, projectName, version, note, fontInstalled}.
   */
  function report(o) {
    var items = o.settingsXml ? readSettings(o.settingsXml) : itemsFromP10(o.p10 || {});
    var language = null;
    if (o.settingsXml || o.ldmlFiles) {
      try {
        language = readLanguage(o.ldmlFiles || {}, valueOf(items, 'LanguageIsoCode'));
      } catch (e) {
        language = null;
      }
    }
    var usage = null;
    var punct = null;
    if (o.books) {
      var books = o.books.filter((t) => !!t).map((t) => tokenize(t, o.sty));
      usage = new CharacterUsage(books);
      punct = new PunctuationUsage(books, punctuationRules(items, language));
    }
    return build({
      items: items, settingsPath: o.settingsPath, projectName: o.projectName, languageItems: language, usage: usage, punct: punct, S: o.S,
      fontInstalled: o.fontInstalled, now: o.now, fileInfo: o.fileInfo, version: o.version, note: o.note,
    });
  }

  return {
    init: function (c) {
      cfg.settingsTxt = c.settingsTxt || '';
      cfg.usfmSty = c.usfmSty || '';
      catalog = null;
    },
    parseXml: parseXml,
    readSettings: readSettings,
    readLanguage: readLanguage,
    parseStyText: parseStyText,
    mergeSty: mergeSty,
    styFromStyleInfo: styFromStyleInfo,
    builtInSty: builtInSty,
    tokenize: tokenize,
    itemsFromP10: itemsFromP10,
    P10_KEYS: P10_SETTINGS.map((m) => m[0]),
    P10_NAMES: P10_SETTINGS.map((m) => m[1]),
    catalogSize: function () {
      var c = loadCatalog();
      return c.exact.size + c.patterns.length;
    },
    valueOf: valueOf,
    report: report,
    enc: enc,
  };
})();

const PS_STRINGS = {"en": {"Attributes": "Attributes:", "AutoCorrectDesc": "Whether the project folder has an autocorrect.txt file: replacements Paratext makes automatically while you type in this project, one per line (text-->replacement).", "BooksCount": "{0} books:", "BooksMissing": "Missing from GEN to REV ({0} books):", "BooksNone": "No books.", "BooksNoneMissing": "None missing from GEN to REV: all 66 books are present.", "BooksRead": "The text of {0} books was read to count the characters.", "Cancel": "Cancel", "Checking": "Counting the characters and punctuation...", "ChooseFiles": "Choose files...", "CmsOption": "Option \"{0}\" of the custom check \"{1}\".", "CmsOptionChecks": "Also used by: {0}.", "ColDescription": "Description", "ColSetting": "Setting", "ColValue": "Value", "Contents": "Contents", "CountSettings": "{0} settings with a value, {1} empty.", "CustomStyDesc": "Whether the project folder has a custom.sty file: changes to the stylesheet above (new markers or different formatting) for this project only. Paratext applies them on top of the stylesheet.", "CustomVrsDesc": "Whether the project folder has a custom.vrs file: changes to the versification above (different verse counts, mappings, missing verses) for this project only.", "Description": "Shows the project's settings (Settings.xml) as a page in the web browser, with a description of each setting and the characters used in the text. It never changes the project.", "Empty": "(empty)", "EmptyCount": "+{0} empty", "EmptyLegend": "Setting names in yellow are empty (shown when \"Show empty settings\" is ticked).", "Error": "The report could not be made: {0}", "FileAbsent": "No: the project folder has no {0}.", "FileLabel": "File:", "FilePresent": "Yes: {0} bytes, last changed {1}", "FileUnknown": "Not known: Paratext 10 does not let extensions see the project's files. Choose {0} with \"Choose files...\" to include it.", "FolderChooseOther": "Choose another folder...", "FolderChooseRoot": "Choose the Paratext 9 Projects folder...", "FolderChosen": "Folder: {0}", "FolderNoSettings": "This folder has no Settings.xml, so it is not a Paratext project folder: {0}", "FolderNone": "No folder chosen yet.", "FolderNotAllowed": "Paratext 10 did not allow the folder to be read: {0}", "FolderNotInRoot": "The folder {0} has no folder for the project {1}.", "FolderOpenProject": "Open the project folder ({0})", "FolderReadOnly": "The folder can be read but not written to here, so Save will download the file instead.", "FolderRootWhere": "Only once: choose the folder where Paratext 10 keeps its projects, {0}. After that each window finds its project's folder by itself.", "FolderWrongProject": "This is the folder of project {0}, not of the project open here ({1}). Choose the folder {2}.", "FontFeatureList": "features {0}", "FontMissing": "(this font is not installed on this computer)", "FontSize": "size {0}", "GroupBooks": "Books and versification", "GroupCaps": "Capitalization", "GroupChars": "Characters", "GroupCms": "Options of custom checks", "GroupCmsMessages": "Messages of checks", "GroupDisplay": "Fonts and display", "GroupFiles": "Files and encoding", "GroupGeneral": "General", "GroupLanguage": "Language settings", "GroupMarkers": "Markers", "GroupNotes": "Footnotes and cross references", "GroupNumbers": "Numbers", "GroupOther": "Other settings", "GroupPublishing": "Publishing Assistant", "GroupPunct": "Punctuation", "GroupQuotes": "Quotation marks", "GroupRefs": "Scripture references", "GroupStudyBible": "Study Bible", "GroupTerms": "Biblical terms and interlinear", "GroupWords": "Words and wordlist", "Intro": "Each row gives the name of the setting in Settings.xml, its value, and a description. Where it helps, the value is also shown in a more readable form, with the stored text below it.", "InvalidFoundDesc": "Characters of InvalidCharacters that still occur in the text of the {0} books read, with how often each occurs. The checks report them as errors.", "InvalidFoundName": "Disapproved characters found in the text", "InvalidFoundNone": "None: no disapproved character occurs in the text.", "InvalidLegend": "Setting names in orange list disapproved (invalid) items: characters, punctuation, markers or words that the checks report as errors.", "LangLanguage": "Language", "LangRegion": "Region", "LangScript": "Script", "LangVariant": "Variant", "LookAlikeLegend": "Characters that look alike show their Unicode value under them.", "MadeBy": "Made by {0} {1} on {2}.", "MatthewFile": "File of Matthew: {0}", "MenuText": "Project Settings Report...", "No": "No", "NoDescription": "No description is available for this setting.", "NoLdml": "No language settings file named {0} was found in the project folder.", "NoProjectFolder": "The folder of project {0} could not be found.", "NoSettingsFile": "There is no Settings.xml in {0}.", "NotInLanguageDesc": "Letters (and letter combinations) approved in ValidCharacters that are not in the Alphabetic characters list of the language settings ({0}, sil:simple). A capitalized combination such as Ch or CH counts as listed when ch is listed.", "NotInLanguageDescUsed": "Letters (and letter combinations) used in the text and approved in ValidCharacters that are not in the Alphabetic characters list of the language settings ({0}, sil:simple), with how often each occurs. A capitalized combination such as Ch or CH counts as listed when ch is listed.", "NotInLanguageName": "Valid characters not in the language settings", "NotInLanguageNone": "None: every letter in ValidCharacters is in the Alphabetic characters list.", "NotInLanguageNoneUsed": "None: every letter used in the text is in the Alphabetic characters list.", "NotRead": "Not read: {0}", "NotSettings": "This is not a Settings.xml file: {0}", "NoteFiles": "Settings from the files you chose: {0}. The book text is read from Paratext 10.", "NoteP10": "Paratext 10 gives extensions only {0} of the project's settings, shown here. For the full report, click \"Choose files...\" above and pick the project's Settings.xml (and its .ldml language file, custom.sty, custom.vrs and autocorrect.txt) from its folder, for example C:\\My Paratext 9 Projects\\{1}.", "Ok": "OK", "OpenProjectFirst": "Open a project (not a resource) in a Scripture window first, then choose this command from that window's Tools menu.", "Opening": "Opening the project...", "PasteButton": "Paste Settings.xml...", "PasteIntro": "If \"Choose files...\" does not open a file chooser, open the project's Settings.xml in a text editor, copy all of it, and paste it here.", "ProjBasedOn": "Based on", "ProjType": "Type", "ProjectFileName": "{0} file", "PunctFinal": "word-final", "PunctFoundDesc": "Items of InvalidPunctuation that still occur in the text of the {0} books read, with how often each occurs. The checks report them as errors.", "PunctFoundName": "Disapproved punctuation found in the text", "PunctFoundNone": "None: no disapproved punctuation occurs in the text.", "PunctInitial": "word-initial", "PunctIsolated": "isolated", "PunctMedial": "word-medial", "PunctNote": "_ marks a space or the edge of a word: _( = at the start of a word, )_ = at the end of a word, _-_ = between spaces, - = inside a word.", "PunctUnusedDesc": "Approved punctuation (ValidPunctuation) that does not occur in the text of the {0} books read. It may have been approved in the past and no longer be part of this project.", "PunctUnusedNone": "None: every approved item occurs in the text.", "PunctUsedDesc": "Approved punctuation (punctuation inventory, Language settings) that occurs in the text of the {0} books read, with how often each item occurs. Items are formed as Paratext forms them: _ marks a space or the edge of a word. Approved items that are not used are listed below.", "QuoteContinue": "continues with {0}", "QuoteLevel": "Level {0}", "QuoteNarrative": "narrative", "QuoteOpenClose": "{0} \u2026 {1}", "ReadOnlyNote": "This page only shows the settings. To change them, use Paratext (Project properties, Language settings, Quotation rules, or the inventories).", "Reading": "Reading {0} ({1} of {2})...", "ReportTitle": "Settings of {0}", "Rescan": "Read the project again", "SaveHtml": "Save as HTML file...", "ShowEmpty": "Show empty settings ({0})", "SourceFiles": "Showing: {0}", "SourceP10": "Showing: the settings Paratext 10 gives", "Space": "space", "StoredAs": "Stored as:", "Title": "Project Settings Report", "UnusedDesc": "Approved characters (ValidCharacters) that do not occur in the text of the {0} books read. NOTE: this list includes characters that may have been approved in the past and are no longer a part of this project.", "UnusedName": "Approved but not used in the text", "UnusedNone": "None: every approved character occurs in the text.", "UseP10": "Use Paratext 10's settings only", "UsedValidDesc": "Approved characters (character inventory, Language settings) that occur in the text of the {0} books read, with how often each occurs. Approved characters that are not used are listed below.", "VersificationNames": ["Unknown", "Original", "Septuagint", "Vulgate", "English", "Russian Protestant", "Russian Orthodox"], "Writing": "Building the report...", "Yes": "Yes"}, "es": {"Attributes": "Atributos:", "AutoCorrectDesc": "Si la carpeta del proyecto tiene un archivo autocorrect.txt: reemplazos que Paratext hace autom\u00e1ticamente mientras se escribe en este proyecto, uno por l\u00ednea (texto-->reemplazo).", "BooksCount": "{0} libros:", "BooksMissing": "Faltan de GEN a REV ({0} libros):", "BooksNone": "Ning\u00fan libro.", "BooksNoneMissing": "No falta ninguno de GEN a REV: est\u00e1n los 66 libros.", "BooksRead": "Se ley\u00f3 el texto de {0} libros para contar los caracteres.", "Cancel": "Cancelar", "Checking": "Contando los caracteres y la puntuaci\u00f3n...", "ChooseFiles": "Elegir archivos...", "CmsOption": "Opci\u00f3n \"{0}\" de la verificaci\u00f3n personalizada \"{1}\".", "CmsOptionChecks": "Tambi\u00e9n la usa: {0}.", "ColDescription": "Descripci\u00f3n", "ColSetting": "Nombre", "ColValue": "Valor", "Contents": "Contenido", "CountSettings": "{0} valores con contenido, {1} vac\u00edos.", "CustomStyDesc": "Si la carpeta del proyecto tiene un archivo custom.sty: cambios a la hoja de estilo de arriba (marcadores nuevos o formato diferente) solo para este proyecto. Paratext los aplica sobre la hoja de estilo.", "CustomVrsDesc": "Si la carpeta del proyecto tiene un archivo custom.vrs: cambios a la versificaci\u00f3n de arriba (otro n\u00famero de vers\u00edculos, correspondencias, vers\u00edculos que faltan) solo para este proyecto.", "Description": "Muestra la configuraci\u00f3n del proyecto (Settings.xml) como una p\u00e1gina en el navegador web, con una descripci\u00f3n de cada valor y los caracteres usados en el texto. Nunca cambia el proyecto.", "Empty": "(vac\u00edo)", "EmptyCount": "+{0} vac\u00edos", "EmptyLegend": "Los nombres en amarillo est\u00e1n vac\u00edos (se muestran al marcar \"Mostrar los valores vac\u00edos\").", "Error": "No se pudo hacer el informe: {0}", "FileAbsent": "No: la carpeta del proyecto no tiene {0}.", "FileLabel": "Archivo:", "FilePresent": "S\u00ed: {0} bytes, \u00faltimo cambio {1}", "FileUnknown": "No se sabe: Paratext 10 no permite que las extensiones vean los archivos del proyecto. Elija {0} con \u00abElegir archivos...\u00bb para incluirlo.", "FolderChooseOther": "Elegir otra carpeta...", "FolderChooseRoot": "Elegir la carpeta Paratext 9 Projects...", "FolderChosen": "Carpeta: {0}", "FolderNoSettings": "Esta carpeta no tiene Settings.xml, as\u00ed que no es la carpeta de un proyecto de Paratext: {0}", "FolderNone": "Todav\u00eda no se ha elegido una carpeta.", "FolderNotAllowed": "Paratext 10 no permiti\u00f3 leer la carpeta: {0}", "FolderNotInRoot": "La carpeta {0} no tiene una carpeta para el proyecto {1}.", "FolderOpenProject": "Abrir la carpeta del proyecto ({0})", "FolderReadOnly": "La carpeta se puede leer pero aqu\u00ed no se puede escribir en ella, as\u00ed que Guardar descargar\u00e1 el archivo.", "FolderRootWhere": "Solo una vez: elija la carpeta donde Paratext 10 guarda sus proyectos, {0}. Despu\u00e9s cada ventana encuentra sola la carpeta de su proyecto.", "FolderWrongProject": "Esta es la carpeta del proyecto {0}, no del proyecto abierto aqu\u00ed ({1}). Elija la carpeta {2}.", "FontFeatureList": "caracter\u00edsticas {0}", "FontMissing": "(esta fuente no est\u00e1 instalada en este equipo)", "FontSize": "tama\u00f1o {0}", "GroupBooks": "Libros y versificaci\u00f3n", "GroupCaps": "May\u00fasculas", "GroupChars": "Caracteres", "GroupCms": "Opciones de verificaciones personalizadas", "GroupCmsMessages": "Mensajes de verificaciones", "GroupDisplay": "Fuentes y visualizaci\u00f3n", "GroupFiles": "Archivos y codificaci\u00f3n", "GroupGeneral": "General", "GroupLanguage": "Configuraci\u00f3n del idioma", "GroupMarkers": "Marcadores", "GroupNotes": "Notas al pie y referencias cruzadas", "GroupNumbers": "N\u00fameros", "GroupOther": "Otros valores", "GroupPublishing": "Publishing Assistant", "GroupPunct": "Puntuaci\u00f3n", "GroupQuotes": "Comillas", "GroupRefs": "Referencias b\u00edblicas", "GroupStudyBible": "Biblia de estudio", "GroupTerms": "Vocablos b\u00edblicos e interlineal", "GroupWords": "Palabras y lista de palabras", "Intro": "Cada fila da el nombre del valor en Settings.xml, su contenido y una descripci\u00f3n. Cuando ayuda, el contenido se muestra tambi\u00e9n de forma m\u00e1s legible, con el texto guardado debajo.", "InvalidFoundDesc": "Caracteres de InvalidCharacters que todav\u00eda aparecen en el texto de los {0} libros le\u00eddos, con cu\u00e1ntas veces aparece cada uno. Las verificaciones los se\u00f1alan como errores.", "InvalidFoundName": "Caracteres no aprobados que aparecen en el texto", "InvalidFoundNone": "Ninguno: ning\u00fan car\u00e1cter no aprobado aparece en el texto.", "InvalidLegend": "Los nombres en naranja contienen elementos no aprobados (no v\u00e1lidos): caracteres, puntuaci\u00f3n, marcadores o palabras que las verificaciones se\u00f1alan como errores.", "LangLanguage": "Idioma", "LangRegion": "Regi\u00f3n", "LangScript": "Escritura", "LangVariant": "Variante", "LookAlikeLegend": "Los caracteres que se parecen muestran su valor Unicode debajo.", "MadeBy": "Hecho por {0} {1} el {2}.", "MatthewFile": "Archivo de Mateo: {0}", "MenuText": "Informe de la configuraci\u00f3n del proyecto...", "No": "No", "NoDescription": "No hay descripci\u00f3n para este valor.", "NoLdml": "No se encontr\u00f3 en la carpeta del proyecto ning\u00fan archivo de configuraci\u00f3n del idioma llamado {0}.", "NoProjectFolder": "No se encontr\u00f3 la carpeta del proyecto {0}.", "NoSettingsFile": "No hay ning\u00fan Settings.xml en {0}.", "NotInLanguageDesc": "Letras (y combinaciones de letras) aprobadas en ValidCharacters que no est\u00e1n en la lista de Caracteres alfab\u00e9ticos de la configuraci\u00f3n del idioma ({0}, sil:simple). Una combinaci\u00f3n con may\u00fascula, como Ch o CH, cuenta como incluida cuando ch est\u00e1 en la lista.", "NotInLanguageDescUsed": "Letras (y combinaciones de letras) usadas en el texto y aprobadas en ValidCharacters que no est\u00e1n en la lista de Caracteres alfab\u00e9ticos de la configuraci\u00f3n del idioma ({0}, sil:simple), con cu\u00e1ntas veces aparece cada una. Una combinaci\u00f3n con may\u00fascula, como Ch o CH, cuenta como incluida cuando ch est\u00e1 en la lista.", "NotInLanguageName": "Caracteres v\u00e1lidos que no est\u00e1n en la configuraci\u00f3n del idioma", "NotInLanguageNone": "Ninguno: todas las letras de ValidCharacters est\u00e1n en la lista de Caracteres alfab\u00e9ticos.", "NotInLanguageNoneUsed": "Ninguno: todas las letras usadas en el texto est\u00e1n en la lista de Caracteres alfab\u00e9ticos.", "NotRead": "No se ley\u00f3: {0}", "NotSettings": "Este no es un archivo Settings.xml: {0}", "NoteFiles": "Configuraci\u00f3n tomada de los archivos que eligi\u00f3: {0}. El texto de los libros se lee de Paratext 10.", "NoteP10": "Paratext 10 solo da a las extensiones {0} de las configuraciones del proyecto; son las que se muestran aqu\u00ed. Para el informe completo, haga clic arriba en \u00abElegir archivos...\u00bb y elija el Settings.xml del proyecto (y su archivo de idioma .ldml, custom.sty, custom.vrs y autocorrect.txt) en su carpeta, por ejemplo C:\\My Paratext 9 Projects\\{1}.", "Ok": "Aceptar", "OpenProjectFirst": "Primero abra un proyecto (no un recurso) en una ventana de Escritura y luego elija este comando en el men\u00fa Herramientas de esa ventana.", "Opening": "Abriendo el proyecto...", "PasteButton": "Pegar Settings.xml...", "PasteIntro": "Si \u00abElegir archivos...\u00bb no abre una ventana para elegir archivos, abra el Settings.xml del proyecto en un editor de texto, copie todo su contenido y p\u00e9guelo aqu\u00ed.", "ProjBasedOn": "Basado en", "ProjType": "Tipo", "ProjectFileName": "Archivo {0}", "PunctFinal": "final", "PunctFoundDesc": "Elementos de InvalidPunctuation que todav\u00eda aparecen en el texto de los {0} libros le\u00eddos, con cu\u00e1ntas veces aparece cada uno. Las verificaciones los se\u00f1alan como errores.", "PunctFoundName": "Puntuaci\u00f3n no aprobada que aparece en el texto", "PunctFoundNone": "Ninguno: ninguna puntuaci\u00f3n no aprobada aparece en el texto.", "PunctInitial": "inicial", "PunctIsolated": "aislado", "PunctMedial": "en medio", "PunctNote": "_ indica un espacio o el borde de una palabra: _( = al principio de una palabra, )_ = al final de una palabra, _-_ = entre espacios, - = dentro de una palabra.", "PunctUnusedDesc": "Puntuaci\u00f3n aprobada (ValidPunctuation) que no aparece en el texto de los {0} libros le\u00eddos. Puede que se aprobara en el pasado y ya no forme parte de este proyecto.", "PunctUnusedNone": "Ninguno: todos los elementos aprobados aparecen en el texto.", "PunctUsedDesc": "Puntuaci\u00f3n aprobada (inventario de puntuaci\u00f3n, Configuraci\u00f3n del idioma) que aparece en el texto de los {0} libros le\u00eddos, con cu\u00e1ntas veces aparece cada elemento. Los elementos se forman como los forma Paratext: _ indica un espacio o el borde de una palabra. Los elementos aprobados que no se usan se enumeran debajo.", "QuoteContinue": "contin\u00faa con {0}", "QuoteLevel": "Nivel {0}", "QuoteNarrative": "narrativa", "QuoteOpenClose": "{0} \u2026 {1}", "ReadOnlyNote": "Esta p\u00e1gina solo muestra la configuraci\u00f3n. Para cambiarla, use Paratext (Propiedades del proyecto, Configuraci\u00f3n del idioma, Reglas de comillas o los inventarios).", "Reading": "Leyendo {0} ({1} de {2})...", "ReportTitle": "Configuraci\u00f3n de {0}", "Rescan": "Leer el proyecto de nuevo", "SaveHtml": "Guardar como archivo HTML...", "ShowEmpty": "Mostrar los valores vac\u00edos ({0})", "SourceFiles": "Se muestra: {0}", "SourceP10": "Se muestra: la configuraci\u00f3n que da Paratext 10", "Space": "espacio", "StoredAs": "Guardado como:", "Title": "Informe de la configuraci\u00f3n del proyecto", "UnusedDesc": "Caracteres aprobados (ValidCharacters) que no aparecen en el texto de los {0} libros le\u00eddos. NOTA: esta lista incluye caracteres que pueden haberse aprobado en el pasado y que ya no forman parte de este proyecto.", "UnusedName": "Aprobados pero no usados en el texto", "UnusedNone": "Ninguno: todos los caracteres aprobados aparecen en el texto.", "UseP10": "Usar solo la configuraci\u00f3n de Paratext 10", "UsedValidDesc": "Caracteres aprobados (inventario de caracteres, Configuraci\u00f3n del idioma) que aparecen en el texto de los {0} libros le\u00eddos, con cu\u00e1ntas veces aparece cada uno. Los caracteres aprobados que no se usan se enumeran debajo.", "VersificationNames": ["Desconocida", "Original", "Septuaginta", "Vulgata", "Inglesa", "Rusa protestante", "Rusa ortodoxa"], "Writing": "Preparando el informe...", "Yes": "S\u00ed"}, "fr": {"Attributes": "Attributs :", "AutoCorrectDesc": "Si le dossier du projet contient un fichier autocorrect.txt : des remplacements que Paratext fait automatiquement pendant la saisie dans ce projet, un par ligne (texte-->remplacement).", "BooksCount": "{0} livres :", "BooksMissing": "Manquants de GEN \u00e0 REV ({0} livres) :", "BooksNone": "Aucun livre.", "BooksNoneMissing": "Aucun manquant de GEN \u00e0 REV : les 66 livres sont pr\u00e9sents.", "BooksRead": "Le texte de {0} livres a \u00e9t\u00e9 lu pour compter les caract\u00e8res.", "Cancel": "Annuler", "Checking": "Comptage des caract\u00e8res et de la ponctuation...", "ChooseFiles": "Choisir des fichiers...", "CmsOption": "Option \u00ab {0} \u00bb de la v\u00e9rification personnalis\u00e9e \u00ab {1} \u00bb.", "CmsOptionChecks": "Aussi utilis\u00e9e par : {0}.", "ColDescription": "Description", "ColSetting": "Param\u00e8tre", "ColValue": "Valeur", "Contents": "Sommaire", "CountSettings": "{0} param\u00e8tres avec une valeur, {1} vides.", "CustomStyDesc": "Si le dossier du projet contient un fichier custom.sty : des changements \u00e0 la feuille de style ci-dessus (nouveaux marqueurs ou mise en forme diff\u00e9rente) pour ce projet seulement. Paratext les applique par-dessus la feuille de style.", "CustomVrsDesc": "Si le dossier du projet contient un fichier custom.vrs : des changements \u00e0 la versification ci-dessus (autre nombre de versets, correspondances, versets manquants) pour ce projet seulement.", "Description": "Affiche les param\u00e8tres du projet (Settings.xml) dans une page du navigateur web, avec une description de chaque param\u00e8tre et les caract\u00e8res utilis\u00e9s dans le texte. Il ne modifie jamais le projet.", "Empty": "(vide)", "EmptyCount": "+{0} vides", "EmptyLegend": "Les noms en jaune sont vides (affich\u00e9s quand \u00ab Afficher les param\u00e8tres vides \u00bb est coch\u00e9).", "Error": "Le rapport n'a pas pu \u00eatre fait : {0}", "FileAbsent": "Non : le dossier du projet n'a pas de {0}.", "FileLabel": "Fichier :", "FilePresent": "Oui : {0} octets, derni\u00e8re modification le {1}", "FileUnknown": "Inconnu : Paratext 10 ne permet pas aux extensions de voir les fichiers du projet. Choisissez {0} avec \u00ab Choisir des fichiers... \u00bb pour l\u2019inclure.", "FolderChooseOther": "Choisir un autre dossier...", "FolderChooseRoot": "Choisir le dossier Paratext 9 Projects...", "FolderChosen": "Dossier : {0}", "FolderNoSettings": "Ce dossier n\u2019a pas de Settings.xml ; ce n\u2019est donc pas le dossier d\u2019un projet Paratext : {0}", "FolderNone": "Aucun dossier choisi pour l\u2019instant.", "FolderNotAllowed": "Paratext 10 n\u2019a pas permis de lire le dossier : {0}", "FolderNotInRoot": "Le dossier {0} n\u2019a pas de dossier pour le projet {1}.", "FolderOpenProject": "Ouvrir le dossier du projet ({0})", "FolderReadOnly": "Le dossier peut \u00eatre lu, mais pas modifi\u00e9 ici ; Enregistrer t\u00e9l\u00e9chargera donc le fichier.", "FolderRootWhere": "Une seule fois : choisissez le dossier o\u00f9 Paratext 10 garde ses projets, {0}. Ensuite chaque fen\u00eatre trouve seule le dossier de son projet.", "FolderWrongProject": "C\u2019est le dossier du projet {0}, pas celui du projet ouvert ici ({1}). Choisissez le dossier {2}.", "FontFeatureList": "fonctionnalit\u00e9s {0}", "FontMissing": "(cette police n'est pas install\u00e9e sur cet ordinateur)", "FontSize": "taille {0}", "GroupBooks": "Livres et versification", "GroupCaps": "Majuscules", "GroupChars": "Caract\u00e8res", "GroupCms": "Options des v\u00e9rifications personnalis\u00e9es", "GroupCmsMessages": "Messages des v\u00e9rifications", "GroupDisplay": "Polices et affichage", "GroupFiles": "Fichiers et encodage", "GroupGeneral": "G\u00e9n\u00e9ral", "GroupLanguage": "Param\u00e8tres de langue", "GroupMarkers": "Marqueurs", "GroupNotes": "Notes de bas de page et r\u00e9f\u00e9rences crois\u00e9es", "GroupNumbers": "Nombres", "GroupOther": "Autres param\u00e8tres", "GroupPublishing": "Publishing Assistant", "GroupPunct": "Ponctuation", "GroupQuotes": "Guillemets", "GroupRefs": "R\u00e9f\u00e9rences bibliques", "GroupStudyBible": "Bible d'\u00e9tude", "GroupTerms": "Termes bibliques et interlin\u00e9aire", "GroupWords": "Mots et liste de mots", "Intro": "Chaque ligne donne le nom du param\u00e8tre dans Settings.xml, sa valeur et une description. Quand c'est utile, la valeur est aussi pr\u00e9sent\u00e9e sous une forme plus lisible, avec le texte enregistr\u00e9 en dessous.", "InvalidFoundDesc": "Caract\u00e8res de InvalidCharacters qui apparaissent encore dans le texte des {0} livres lus, avec le nombre d'occurrences de chacun. Les v\u00e9rifications les signalent comme des erreurs.", "InvalidFoundName": "Caract\u00e8res non approuv\u00e9s pr\u00e9sents dans le texte", "InvalidFoundNone": "Aucun : aucun caract\u00e8re non approuv\u00e9 n'appara\u00eet dans le texte.", "InvalidLegend": "Les noms en orange contiennent des \u00e9l\u00e9ments non approuv\u00e9s (non valides) : caract\u00e8res, ponctuation, marqueurs ou mots que les v\u00e9rifications signalent comme des erreurs.", "LangLanguage": "Langue", "LangRegion": "R\u00e9gion", "LangScript": "\u00c9criture", "LangVariant": "Variante", "LookAlikeLegend": "Les caract\u00e8res qui se ressemblent affichent leur valeur Unicode en dessous.", "MadeBy": "Fait par {0} {1} le {2}.", "MatthewFile": "Fichier de Matthieu : {0}", "MenuText": "Rapport des param\u00e8tres du projet...", "No": "Non", "NoDescription": "Aucune description n'est disponible pour ce param\u00e8tre.", "NoLdml": "Aucun fichier de param\u00e8tres de langue nomm\u00e9 {0} n'a \u00e9t\u00e9 trouv\u00e9 dans le dossier du projet.", "NoProjectFolder": "Le dossier du projet {0} est introuvable.", "NoSettingsFile": "Il n'y a pas de Settings.xml dans {0}.", "NotInLanguageDesc": "Lettres (et combinaisons de lettres) approuv\u00e9es dans ValidCharacters qui ne figurent pas dans la liste des Caract\u00e8res alphab\u00e9tiques des param\u00e8tres de langue ({0}, sil:simple). Une combinaison avec majuscule, comme Ch ou CH, compte comme pr\u00e9sente quand ch figure dans la liste.", "NotInLanguageDescUsed": "Lettres (et combinaisons de lettres) utilis\u00e9es dans le texte et approuv\u00e9es dans ValidCharacters qui ne figurent pas dans la liste des Caract\u00e8res alphab\u00e9tiques des param\u00e8tres de langue ({0}, sil:simple), avec le nombre d'occurrences de chacune. Une combinaison avec majuscule, comme Ch ou CH, compte comme pr\u00e9sente quand ch figure dans la liste.", "NotInLanguageName": "Caract\u00e8res valides absents des param\u00e8tres de langue", "NotInLanguageNone": "Aucun : toutes les lettres de ValidCharacters figurent dans la liste des Caract\u00e8res alphab\u00e9tiques.", "NotInLanguageNoneUsed": "Aucun : toutes les lettres utilis\u00e9es dans le texte figurent dans la liste des Caract\u00e8res alphab\u00e9tiques.", "NotRead": "Non lu : {0}", "NotSettings": "Ce n\u2019est pas un fichier Settings.xml : {0}", "NoteFiles": "Param\u00e8tres tir\u00e9s des fichiers choisis : {0}. Le texte des livres est lu dans Paratext 10.", "NoteP10": "Paratext 10 ne donne aux extensions que {0} des param\u00e8tres du projet ; ce sont ceux montr\u00e9s ici. Pour le rapport complet, cliquez sur \u00ab Choisir des fichiers... \u00bb ci-dessus et choisissez le Settings.xml du projet (et son fichier de langue .ldml, custom.sty, custom.vrs et autocorrect.txt) dans son dossier, par exemple C:\\My Paratext 9 Projects\\{1}.", "Ok": "OK", "OpenProjectFirst": "Ouvrez d'abord un projet (pas une ressource) dans une fen\u00eatre de texte biblique, puis choisissez cette commande dans le menu Outils de cette fen\u00eatre.", "Opening": "Ouverture du projet...", "PasteButton": "Coller Settings.xml...", "PasteIntro": "Si \u00ab Choisir des fichiers... \u00bb n\u2019ouvre pas de fen\u00eatre de choix, ouvrez le Settings.xml du projet dans un \u00e9diteur de texte, copiez tout son contenu et collez-le ici.", "ProjBasedOn": "Bas\u00e9 sur", "ProjType": "Type", "ProjectFileName": "Fichier {0}", "PunctFinal": "final", "PunctFoundDesc": "\u00c9l\u00e9ments de InvalidPunctuation qui apparaissent encore dans le texte des {0} livres lus, avec le nombre d'occurrences de chacun. Les v\u00e9rifications les signalent comme des erreurs.", "PunctFoundName": "Ponctuation non approuv\u00e9e pr\u00e9sente dans le texte", "PunctFoundNone": "Aucun : aucune ponctuation non approuv\u00e9e n'appara\u00eet dans le texte.", "PunctInitial": "initial", "PunctIsolated": "isol\u00e9", "PunctMedial": "m\u00e9dian", "PunctNote": "_ marque une espace ou le bord d'un mot : _( = au d\u00e9but d'un mot, )_ = \u00e0 la fin d'un mot, _-_ = entre des espaces, - = \u00e0 l'int\u00e9rieur d'un mot.", "PunctUnusedDesc": "Ponctuation approuv\u00e9e (ValidPunctuation) qui n'appara\u00eet pas dans le texte des {0} livres lus. Elle a pu \u00eatre approuv\u00e9e par le pass\u00e9 et ne plus faire partie de ce projet.", "PunctUnusedNone": "Aucun : tous les \u00e9l\u00e9ments approuv\u00e9s apparaissent dans le texte.", "PunctUsedDesc": "Ponctuation approuv\u00e9e (inventaire de ponctuation, Param\u00e8tres de langue) qui appara\u00eet dans le texte des {0} livres lus, avec le nombre d'occurrences de chaque \u00e9l\u00e9ment. Les \u00e9l\u00e9ments sont form\u00e9s comme Paratext les forme : _ marque une espace ou le bord d'un mot. Les \u00e9l\u00e9ments approuv\u00e9s qui ne sont pas utilis\u00e9s sont list\u00e9s en dessous.", "QuoteContinue": "continue avec {0}", "QuoteLevel": "Niveau {0}", "QuoteNarrative": "narrative", "QuoteOpenClose": "{0} \u2026 {1}", "ReadOnlyNote": "Cette page ne fait qu'afficher les param\u00e8tres. Pour les modifier, utilisez Paratext (Propri\u00e9t\u00e9s du projet, Param\u00e8tres de langue, R\u00e8gles des guillemets ou les inventaires).", "Reading": "Lecture de {0} ({1} sur {2})...", "ReportTitle": "Param\u00e8tres de {0}", "Rescan": "Relire le projet", "SaveHtml": "Enregistrer comme fichier HTML...", "ShowEmpty": "Afficher les param\u00e8tres vides ({0})", "SourceFiles": "Affich\u00e9 : {0}", "SourceP10": "Affich\u00e9 : les param\u00e8tres que donne Paratext 10", "Space": "espace", "StoredAs": "Enregistr\u00e9 sous la forme :", "Title": "Rapport des param\u00e8tres du projet", "UnusedDesc": "Caract\u00e8res approuv\u00e9s (ValidCharacters) qui n'apparaissent pas dans le texte des {0} livres lus. REMARQUE : cette liste comprend des caract\u00e8res qui ont pu \u00eatre approuv\u00e9s par le pass\u00e9 et qui ne font plus partie de ce projet.", "UnusedName": "Approuv\u00e9s mais non utilis\u00e9s dans le texte", "UnusedNone": "Aucun : tous les caract\u00e8res approuv\u00e9s apparaissent dans le texte.", "UseP10": "Utiliser seulement les param\u00e8tres de Paratext 10", "UsedValidDesc": "Caract\u00e8res approuv\u00e9s (inventaire de caract\u00e8res, Param\u00e8tres de langue) qui apparaissent dans le texte des {0} livres lus, avec le nombre d'occurrences de chacun. Les caract\u00e8res approuv\u00e9s qui ne sont pas utilis\u00e9s sont list\u00e9s en dessous.", "VersificationNames": ["Inconnue", "Originale", "Septante", "Vulgate", "Anglaise", "Russe protestante", "Russe orthodoxe"], "Writing": "Pr\u00e9paration du rapport...", "Yes": "Oui"}, "version": "2.5"};
const PS_WINDOW_HTML = "<!doctype html>\n<html>\n  <head>\n    <meta charset=\"utf-8\" />\n    <style>\n      \n  :root {\n    --t-bg: #ffffff;\n    --t-fg: #1f2328;\n    --t-muted: #59636e;\n    --t-line: #d0d7de;\n    --t-head: #f3f5f7;\n    --t-sel: #dbeafe;\n    --t-accent: #0b6bcb;\n    --t-warn: #8a1c00;\n    --t-odd: #ffe4b5;\n    --t-usual: #eef6ff;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --t-bg: #1e1f22;\n      --t-fg: #e6e6e6;\n      --t-muted: #a0a6ad;\n      --t-line: #3a3d42;\n      --t-head: #2a2c30;\n      --t-sel: #1e3a5f;\n      --t-accent: #6cb6ff;\n      --t-warn: #fdba74;\n      --t-odd: #5a4320;\n      --t-usual: #1d2b3a;\n    }\n  }\n  html,\n  body {\n    margin: 0;\n    height: 100%;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    font: 13px/1.4 'Segoe UI', system-ui, sans-serif;\n  }\n  body {\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    padding: 8px 12px;\n    box-sizing: border-box;\n  }\n  .row {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 8px;\n  }\n  .grow {\n    flex: 1;\n  }\n  .muted {\n    color: var(--t-muted);\n  }\n  .warn {\n    color: var(--t-warn);\n    font-weight: 600;\n  }\n  button {\n    font: inherit;\n    padding: 3px 12px;\n    border: 1px solid var(--t-line);\n    background: var(--t-head);\n    color: var(--t-fg);\n    border-radius: 4px;\n    cursor: pointer;\n  }\n  button.primary {\n    background: var(--t-accent);\n    border-color: var(--t-accent);\n    color: #fff;\n    font-weight: 600;\n  }\n  button:disabled {\n    opacity: 0.5;\n    cursor: default;\n  }\n  select,\n  input[type='text'] {\n    font: inherit;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 3px;\n    padding: 1px 4px;\n  }\n  .gridbox {\n    flex: 1;\n    min-height: 120px;\n    overflow: auto;\n    border: 1px solid var(--t-line);\n    border-radius: 4px;\n    position: relative;\n  }\n  table.grid {\n    border-collapse: collapse;\n    width: 100%;\n  }\n  table.grid th {\n    position: sticky;\n    top: 0;\n    background: var(--t-head);\n    text-align: left;\n    font-weight: 600;\n    z-index: 1;\n  }\n  table.grid th,\n  table.grid td {\n    border-bottom: 1px solid var(--t-line);\n    padding: 3px 6px;\n    vertical-align: top;\n  }\n  table.grid tr.sel td {\n    background: var(--t-sel);\n  }\n  table.grid tr.oneform td {\n    background: var(--t-head);\n  }\n  textarea.results {\n    font: 12px/1.4 Consolas, 'Cascadia Mono', monospace;\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 4px;\n    height: 90px;\n    resize: vertical;\n    white-space: pre-wrap;\n  }\n  /* the busy panel over a grid */\n  .busy {\n    position: absolute;\n    inset: 0;\n    display: none;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 12px;\n    background: var(--t-bg);\n    z-index: 5;\n  }\n  .spinner {\n    width: 32px;\n    height: 32px;\n    border: 4px solid var(--t-line);\n    border-top-color: var(--t-accent);\n    border-radius: 50%;\n    animation: tspin 0.8s linear infinite;\n  }\n  @keyframes tspin {\n    to {\n      transform: rotate(360deg);\n    }\n  }\n  .track {\n    width: 60%;\n    max-width: 420px;\n    height: 8px;\n    background: var(--t-line);\n    border-radius: 4px;\n    overflow: hidden;\n  }\n  .track > div {\n    height: 100%;\n    width: 0;\n    background: var(--t-accent);\n    transition: width 0.2s;\n  }\n  /* dialogs drawn in the page */\n  .modal {\n    position: fixed;\n    inset: 0;\n    background: rgba(0, 0, 0, 0.35);\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    z-index: 20;\n  }\n  .modal .box {\n    background: var(--t-bg);\n    color: var(--t-fg);\n    border: 1px solid var(--t-line);\n    border-radius: 6px;\n    padding: 14px 16px;\n    max-width: 640px;\n    width: 90%;\n    max-height: 85%;\n    overflow: auto;\n    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);\n  }\n  .modal .text {\n    white-space: pre-wrap;\n    margin-bottom: 12px;\n  }\n  .modal .buttons {\n    display: flex;\n    gap: 8px;\n    justify-content: flex-end;\n    margin-top: 10px;\n  }\n  .bookgrid {\n    display: grid;\n    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));\n    gap: 2px 8px;\n    margin: 8px 0;\n  }\n\n      #reportHost {\n        display: block;\n        min-height: 100%;\n      }\n      textarea.paste {\n        width: 100%;\n        height: 260px;\n        box-sizing: border-box;\n        font: 12px Consolas, 'Cascadia Mono', monospace;\n      }\n    </style>\n  </head>\n  <body>\n    <div class=\"row\">\n      <b id=\"title\"></b><span class=\"muted\" id=\"project\"></span>\n      <span class=\"grow\"></span>\n      <button id=\"choose\"></button>\n      <input type=\"file\" id=\"fileInput\" multiple style=\"display: none\" accept=\".xml,.ldml,.sty,.vrs,.txt\" />\n      <button id=\"paste\"></button>\n      <button id=\"useP10\"></button>\n      <button id=\"save\"></button>\n      <button id=\"rescan\"></button>\n    </div>\n    <div class=\"row\" id=\"folderRow\"></div>\n    <div class=\"row\"><span id=\"source\" class=\"muted\"></span><span id=\"status\" class=\"warn\"></span></div>\n    <div class=\"gridbox\" id=\"gridbox\"><div id=\"reportHost\"></div></div>\n    <script>\n      \n  const BOOT = __BOOT__;\n  const papi = require('@papi/frontend');\n  const S = BOOT.strings;\n  const $ = (id) => document.getElementById(id);\n\n  function fmt(s, ...args) {\n    return String(s).replace(/\\{(\\d+)\\}/g, (m, n) => (args[n] === undefined ? m : String(args[n])));\n  }\n\n  function esc(s) {\n    return String(s === null || s === undefined ? '' : s)\n      .replace(/&/g, '&amp;')\n      .replace(/</g, '&lt;')\n      .replace(/>/g, '&gt;')\n      .replace(/\"/g, '&quot;');\n  }\n\n  function cmd(name, ...args) {\n    return papi.commands.sendCommand(BOOT.id + '.' + name, ...args);\n  }\n\n  /** Shows the busy panel inside box (a .gridbox) with text and a bar (fraction, or null). */\n  function busy(box, text, fraction) {\n    let panel = box.querySelector('.busy');\n    if (!panel) {\n      panel = document.createElement('div');\n      panel.className = 'busy';\n      panel.innerHTML = '<div class=\"spinner\"></div><div class=\"btext\"></div><div class=\"track\"><div></div></div>';\n      box.appendChild(panel);\n    }\n    panel.style.display = text === null ? 'none' : 'flex';\n    if (text === null) return;\n    panel.querySelector('.btext').textContent = text;\n    panel.querySelector('.track').style.visibility = fraction === null || fraction === undefined ? 'hidden' : 'visible';\n    panel.querySelector('.track > div').style.width = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100) + '%';\n  }\n\n  /** The text for a progress record from the backend. */\n  function progressText(p) {\n    if (!p) return null;\n    if (p.phase === 'open') return [S.Opening, 0];\n    if (p.phase === 'read') return [fmt(S.Reading, p.book, p.done + 1, p.total), p.total ? (p.done / p.total) * 0.9 : 0];\n    if (p.phase === 'check') return [S.Checking, 0.95];\n    if (p.phase === 'write') return [fmt(S.Writing, p.book, p.done + 1, p.total), p.total ? p.done / p.total : 0];\n    return null;\n  }\n\n  /**\n   * Runs a backend command (scan or apply) with the busy panel over box, asking for its progress\n   * every 250 ms. args come before the run id.\n   */\n  async function withProgress(box, firstText, name, ...args) {\n    const runId = String(Date.now()) + Math.random();\n    busy(box, firstText, 0);\n    // A poll still on its way when the run ends must not show the busy panel again.\n    let finished = false;\n    const poll = setInterval(() => {\n      cmd('progress', BOOT.projectId, runId)\n        .then((p) => {\n          const t = progressText(p);\n          if (t && !finished) busy(box, t[0], t[1]);\n        })\n        .catch(() => {});\n    }, 250);\n    try {\n      return await cmd(name, BOOT.projectId, ...args, runId);\n    } finally {\n      finished = true;\n      clearInterval(poll);\n      busy(box, null);\n    }\n  }\n\n  /** A dialog in the page: resolves with the value of the button pressed. */\n  function dialog(text, buttons, extra) {\n    return new Promise((resolve) => {\n      const modal = document.createElement('div');\n      modal.className = 'modal';\n      const box = document.createElement('div');\n      box.className = 'box';\n      const t = document.createElement('div');\n      t.className = 'text';\n      t.textContent = text;\n      box.appendChild(t);\n      if (extra) box.appendChild(extra);\n      const row = document.createElement('div');\n      row.className = 'buttons';\n      buttons.forEach((b) => {\n        const btn = document.createElement('button');\n        btn.textContent = b.label;\n        if (b.primary) btn.className = 'primary';\n        btn.addEventListener('click', () => {\n          if (b.check && !b.check()) return;\n          modal.remove();\n          resolve(b.value);\n        });\n        row.appendChild(btn);\n      });\n      box.appendChild(row);\n      modal.appendChild(box);\n      document.body.appendChild(modal);\n      const first = row.querySelector('button.primary') || row.querySelector('button');\n      if (first) first.focus();\n    });\n  }\n\n  function ask(text) {\n    return dialog(text, [\n      { label: S.Yes, value: true, primary: true },\n      { label: S.No, value: false },\n    ]);\n  }\n\n  function tell(text) {\n    return dialog(text, [{ label: S.Ok || 'OK', value: true, primary: true }]);\n  }\n\n  const OTHER_BOOKS = 'FRT BAK OTH INT CNC GLO TDX NDX XXA XXB XXC XXD XXE XXF XXG'.split(' ');\n\n  /** The books chooser (BookChooserForm): books = [{code, num, chosen}]; resolves with the excluded codes, or null. */\n  async function chooseBooks(books) {\n    const wrap = document.createElement('div');\n    const quick = document.createElement('div');\n    quick.className = 'row';\n    const grid = document.createElement('div');\n    grid.className = 'bookgrid';\n    const boxes = books.map((b) => {\n      const label = document.createElement('label');\n      const cb = document.createElement('input');\n      cb.type = 'checkbox';\n      cb.checked = b.chosen;\n      label.append(cb, ' ' + b.code);\n      grid.appendChild(label);\n      return { b, cb };\n    });\n    const groups = [\n      [S.BooksAll, () => true],\n      [S.BooksNone, () => false],\n      [S.BooksBible, (b) => OTHER_BOOKS.indexOf(b.code) < 0],\n      [S.BooksOT, (b) => b.num >= 1 && b.num <= 39],\n      [S.BooksNT, (b) => b.num >= 40 && b.num <= 66],\n      [S.BooksDC, (b) => b.num >= 67 && b.num <= 92],\n      [S.BooksOther, (b) => OTHER_BOOKS.indexOf(b.code) >= 0],\n    ];\n    groups.forEach(([label, test]) => {\n      const btn = document.createElement('button');\n      btn.textContent = label;\n      btn.addEventListener('click', () => boxes.forEach((x) => (x.cb.checked = test(x.b))));\n      quick.appendChild(btn);\n    });\n    const note = document.createElement('div');\n    note.className = 'warn';\n    wrap.append(quick, grid, note);\n    const ok = await dialog(S.BooksIntro, [\n      {\n        label: S.Ok,\n        value: true,\n        primary: true,\n        check: () => {\n          const any = boxes.some((x) => x.cb.checked);\n          note.textContent = any ? '' : S.BooksNoneChosen;\n          return any;\n        },\n      },\n      { label: S.Cancel, value: false },\n    ], wrap);\n    if (!ok) return null;\n    return boxes.filter((x) => !x.cb.checked).map((x) => x.b.code);\n  }\n\n  function booksLabel(books) {\n    return fmt(S.BooksButton, books.filter((b) => b.chosen).length, books.length);\n  }\n\n  /**\n   * The project's folder. Paratext 10 keeps projects in %USERPROFILE%\\.paratext-10-studio\\projects\\\n   * Paratext 9 Projects\\<project>; the extension's backend may not read files, so the window does.\n   * The user picks the \"Paratext 9 Projects\" folder once (showDirectoryPicker): it is remembered in\n   * IndexedDB (key __projectsRoot, for every window and project), and each window then finds its\n   * project's subfolder itself (by name, else by Settings.xml <Guid>): with no click when the\n   * permission is still granted, else with one click. Picking a single project folder also works\n   * (remembered for that project). Without showDirectoryPicker, a webkitdirectory input (read only).\n   * The folder must be this project's: its Settings.xml <Guid> must be Paratext 10's project id.\n   * Tests replace IndexedDB with window.__pcFolderStore = {get(key), put(key, handle)}.\n   */\n  const ProjectFolder = (function () {\n    let handle = null; // FileSystemDirectoryHandle of the project\n    let files = null; // Map lower-case name -> File (from the input)\n    let writable = false;\n    let label = '';\n    const DB = 'philsChecksFolders';\n    const ROOT_KEY = '__projectsRoot';\n    const MAX_FOLDERS = 500;\n\n    function rootWhere() {\n      return '%USERPROFILE%\\\\.paratext-10-studio\\\\projects\\\\Paratext 9 Projects';\n    }\n    function where() {\n      return rootWhere() + '\\\\' + (BOOT.projectName || '?');\n    }\n\n    // ------------------------------------------------ remembering (IndexedDB, or the tests' store)\n    function db() {\n      return new Promise((resolve, reject) => {\n        const req = indexedDB.open(DB, 1);\n        req.onupgradeneeded = () => req.result.createObjectStore('handles');\n        req.onsuccess = () => resolve(req.result);\n        req.onerror = () => reject(req.error);\n      });\n    }\n    function put(key, h) {\n      if (window.__pcFolderStore) return window.__pcFolderStore.put(key, h);\n      // Not waited for: remembering must never hold up using the folder.\n      db()\n        .then((d) => d.transaction('handles', 'readwrite').objectStore('handles').put(h, key))\n        .catch(() => {});\n    }\n    /** A remembered handle, or null; never waits more than a second (IndexedDB may not answer). */\n    function get(key) {\n      if (window.__pcFolderStore) return Promise.resolve(window.__pcFolderStore.get(key) || null);\n      const look = (async () => {\n        try {\n          const d = await db();\n          return await new Promise((resolve) => {\n            const req = d.transaction('handles').objectStore('handles').get(key);\n            req.onsuccess = () => resolve(req.result || null);\n            req.onerror = () => resolve(null);\n          });\n        } catch (e) {\n          return null;\n        }\n      })();\n      return Promise.race([look, new Promise((r) => setTimeout(() => r(null), 1000))]);\n    }\n\n    // ------------------------------------------------ reading\n    function decode(buf) {\n      const b = new Uint8Array(buf);\n      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));\n      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));\n      if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));\n      return new TextDecoder('utf-8').decode(b);\n    }\n\n    async function fileIn(dir, name) {\n      for await (const entry of dir.values()) if (entry.kind === 'file' && entry.name.toLowerCase() === name.toLowerCase()) return entry.getFile();\n      return null;\n    }\n\n    async function file(name) {\n      if (files) return files.get(name.toLowerCase()) || null;\n      return handle ? fileIn(handle, name) : null;\n    }\n\n    async function names() {\n      if (files) return Array.from(files.values()).map((f) => f.name);\n      const out = [];\n      if (handle) for await (const entry of handle.values()) if (entry.kind === 'file') out.push(entry.name);\n      return out;\n    }\n\n    function identity(xml, fallbackName) {\n      return {\n        guid: (/<Guid>\\s*([^<\\s]*)\\s*<\\/Guid>/.exec(xml) || [])[1] || '',\n        name: (/<Name>([^<]*)<\\/Name>/.exec(xml) || [])[1] || fallbackName,\n      };\n    }\n\n    /** Whether a Settings.xml text is this project's (the Guid; the name when the id is not a Guid). */\n    function isThisProject(xml, fallbackName) {\n      const who = identity(xml, fallbackName);\n      const id = String(BOOT.projectId || '').toLowerCase();\n      if (who.guid && /^[0-9a-f]{20,}$/.test(id)) return who.guid.toLowerCase() === id;\n      return !!BOOT.projectName && who.name === BOOT.projectName;\n    }\n\n    /** Checks the chosen folder is this project's; throws a message for the user when it is not. */\n    async function verify() {\n      const f = await file('Settings.xml');\n      if (!f) throw new Error(fmt(S.FolderNoSettings, label));\n      const xml = decode(await f.arrayBuffer());\n      if (!isThisProject(xml, label)) throw new Error(fmt(S.FolderWrongProject, identity(xml, label).name, BOOT.projectName || BOOT.projectId, where()));\n    }\n\n    async function settingsOf(dir) {\n      try {\n        const f = await fileIn(dir, 'Settings.xml');\n        return f ? decode(await f.arrayBuffer()) : null;\n      } catch (e) {\n        return null;\n      }\n    }\n\n    /**\n     * The project's folder inside a picked folder: the folder itself when it holds a Settings.xml;\n     * otherwise its subfolder named like the project, else the subfolder whose Settings.xml is this\n     * project's. A \"projects\" folder holding \"Paratext 9 Projects\" is looked into. null = not found.\n     */\n    async function findProject(dir) {\n      if (await settingsOf(dir)) return dir;\n      let base = dir;\n      try {\n        base = await dir.getDirectoryHandle('Paratext 9 Projects');\n      } catch (e) {\n        base = dir;\n      }\n      if (BOOT.projectName) {\n        try {\n          const d = await base.getDirectoryHandle(BOOT.projectName);\n          const xml = await settingsOf(d);\n          if (xml && isThisProject(xml, d.name)) return d;\n        } catch (e) {\n          // not by that name\n        }\n      }\n      let n = 0;\n      for await (const entry of base.values()) {\n        if (entry.kind !== 'directory') continue;\n        if (++n > MAX_FOLDERS) break;\n        const xml = await settingsOf(entry);\n        if (xml && isThisProject(xml, entry.name)) return entry;\n      }\n      return null;\n    }\n\n    function use(dir, mode) {\n      handle = dir;\n      files = null;\n      label = dir.name;\n      writable = mode === 'readwrite';\n    }\n\n    // ------------------------------------------------ choosing\n    /** Lets the user pick the projects folder (or a project folder). Resolves true when the project is found. */\n    async function choose(mode) {\n      if (window.showDirectoryPicker) {\n        let h = null;\n        let blocked = false;\n        const remembered = await get(ROOT_KEY);\n        const options = { id: 'philsChecksProjects', mode: mode || 'read', startIn: remembered || 'documents' };\n        try {\n          h = await window.showDirectoryPicker(options);\n        } catch (e) {\n          if (e && e.name === 'AbortError') return false;\n          try {\n            delete options.startIn; // an old or unusable remembered folder\n            h = await window.showDirectoryPicker(options);\n          } catch (e2) {\n            if (e2 && e2.name === 'AbortError') return false;\n            blocked = true; // not allowed here: the input below\n          }\n        }\n        if (!blocked && h) {\n          const project = await findProject(h);\n          if (!project) throw new Error(fmt(S.FolderNotInRoot, h.name, BOOT.projectName || BOOT.projectId));\n          use(project, mode);\n          await verify();\n          put(project === h ? BOOT.projectId : ROOT_KEY, h);\n          return true;\n        }\n      }\n      const list = await new Promise((resolve) => {\n        const input = document.createElement('input');\n        input.type = 'file';\n        input.webkitdirectory = true;\n        input.style.display = 'none';\n        input.addEventListener('change', () => resolve(input.files));\n        document.body.appendChild(input);\n        input.click();\n        setTimeout(() => input.remove(), 60000);\n      });\n      if (!list || list.length === 0) return false;\n      files = new Map();\n      handle = null;\n      writable = false;\n      Array.from(list).forEach((f) => {\n        const parts = (f.webkitRelativePath || f.name).split('/');\n        if (parts.length <= 2) {\n          files.set(f.name.toLowerCase(), f);\n          label = parts.length === 2 ? parts[0] : label;\n        }\n      });\n      await verify();\n      return true;\n    }\n\n    /** What is remembered: {handle, isRoot}, the projects folder first; or null. */\n    async function remembered() {\n      const root = await get(ROOT_KEY);\n      if (root) return { handle: root, isRoot: true };\n      const own = await get(BOOT.projectId);\n      return own ? { handle: own, isRoot: false } : null;\n    }\n\n    /**\n     * Opens the project's folder from what is remembered. ask = false: only when the permission is\n     * still granted (no prompt, no click needed); ask = true: asks for it (needs the user's click).\n     */\n    async function openRemembered(mode, ask) {\n      const r = await remembered();\n      if (!r) return false;\n      const opts = { mode: mode || 'read' };\n      let state = r.handle.queryPermission ? await r.handle.queryPermission(opts) : 'prompt';\n      if (state !== 'granted') {\n        if (!ask) return false;\n        state = await r.handle.requestPermission(opts);\n        if (state !== 'granted') return false;\n      }\n      const project = r.isRoot ? await findProject(r.handle) : r.handle;\n      if (!project) throw new Error(fmt(S.FolderNotInRoot, r.handle.name, BOOT.projectName || BOOT.projectId));\n      use(project, mode);\n      await verify();\n      return true;\n    }\n\n    return {\n      where,\n      rootWhere,\n      choose,\n      remembered,\n      openRemembered,\n      decode,\n      names,\n      chosen: () => !!(handle || files),\n      label: () => label,\n      canWrite: () => !!handle && writable,\n      async has(name) {\n        return !!(await file(name));\n      },\n      /** The file's text (BOM-aware), or null when it is not there. */\n      async readText(name) {\n        const f = await file(name);\n        return f ? decode(await f.arrayBuffer()) : null;\n      },\n      async readBytes(name) {\n        const f = await file(name);\n        return f ? new Uint8Array(await f.arrayBuffer()) : null;\n      },\n      /** {length, mtime} of a file, or null. */\n      async info(name) {\n        const f = await file(name);\n        return f ? { length: f.size, mtime: f.lastModified } : null;\n      },\n      async writeBytes(name, bytes) {\n        if (!handle || !writable) throw new Error(S.FolderReadOnly);\n        const fh = await handle.getFileHandle(name, { create: true });\n        const w = await fh.createWritable();\n        await w.write(bytes);\n        await w.close();\n      },\n    };\n  })();\n\n  /**\n   * The folder row of a window. First time: \"Choose the Paratext 9 Projects folder...\" with where\n   * it is. Afterwards the project's folder opens by itself when the permission is still granted,\n   * else \"Open the project folder (PDT15)\" does it in one click; \"Choose another folder...\" picks\n   * again. onChosen() runs once the project's folder is open.\n   */\n  async function folderBar(container, mode, onChosen) {\n    container.innerHTML = '';\n    const main = document.createElement('button');\n    main.className = 'primary';\n    const other = document.createElement('button');\n    other.textContent = S.FolderChooseOther;\n    other.style.display = 'none';\n    const status = document.createElement('span');\n    status.className = 'muted';\n    container.append(main, other, status);\n    let busyNow = false;\n    async function run(fn) {\n      if (busyNow) return;\n      busyNow = true;\n      try {\n        if (await fn()) {\n          status.textContent = fmt(S.FolderChosen, ProjectFolder.label()) + (mode === 'readwrite' && !ProjectFolder.canWrite() ? ' ' + S.FolderReadOnly : '');\n          status.className = 'muted';\n          main.textContent = fmt(S.FolderOpenProject, BOOT.projectName || ProjectFolder.label());\n          main.onclick = () => run(() => ProjectFolder.openRemembered(mode, true));\n          other.style.display = '';\n          await onChosen();\n        }\n      } catch (e) {\n        status.textContent = e && e.message ? e.message : String(e);\n        status.className = 'warn';\n      } finally {\n        busyNow = false;\n      }\n    }\n    other.addEventListener('click', () => run(() => ProjectFolder.choose(mode)));\n    const r = await ProjectFolder.remembered().catch(() => null);\n    if (r) {\n      main.textContent = fmt(S.FolderOpenProject, BOOT.projectName || r.handle.name);\n      main.onclick = () => run(() => ProjectFolder.openRemembered(mode, true));\n      other.style.display = '';\n      // No click needed while Paratext 10 still grants the permission. Resolves true when the\n      // folder opened by itself (onChosen then runs), so the window need not scan a second time;\n      // after 3 s without an answer it resolves false and the window goes on without the folder.\n      const opened = await Promise.race([\n        ProjectFolder.openRemembered(mode, false).catch(() => false),\n        new Promise((res) => setTimeout(() => res(false), 3000)),\n      ]);\n      if (opened && ProjectFolder.chosen()) {\n        run(async () => true);\n        return true;\n      }\n      return false;\n    }\n    main.textContent = S.FolderChooseRoot;\n    main.onclick = () => run(() => ProjectFolder.choose(mode));\n    status.textContent = fmt(S.FolderRootWhere, ProjectFolder.rootWhere());\n    return false;\n  }\n\n    </script>\n    <script>\n      let lastHtml = '';\n      const host = $('reportHost');\n      const shadow = host.attachShadow({ mode: 'open' });\n\n      /**\n       * The report is a whole page: its CSS goes into the shadow root with :root as :host (so\n       * its colours are its own, not Paratext's theme) and body as a wrapper element.\n       */\n      function show(html) {\n        lastHtml = html;\n        const style = (html.split('<style>')[1] || '').split('</style>')[0];\n        const body = (html.split('<body>')[1] || '').split('</body>')[0];\n        const css = style.split(':root{').join(':host{').split('body{').join('.ps-body{');\n        shadow.innerHTML = '<style>' + css + ':host{display:block}</style><div class=\"ps-body\">' + body + '</div>';\n      }\n\n      // In-page links (the Contents list) cannot move to an id inside a shadow root by themselves.\n      shadow.addEventListener('click', (ev) => {\n        const a = ev.target.closest ? ev.target.closest('a[href^=\"#\"]') : null;\n        if (!a) return;\n        ev.preventDefault();\n        const target = shadow.getElementById(a.getAttribute('href').substring(1));\n        if (target) target.scrollIntoView({ block: 'start' });\n      });\n\n      function showResult(res) {\n        show(res.html);\n        $('source').textContent = res.source === 'files' ? fmt(S.SourceFiles, res.files.join(', ')) : S.SourceP10;\n        $('status').textContent = res.failed && res.failed.length > 0 ? ' ' + fmt(S.NotRead, res.failed.join('; ')) : '';\n        $('useP10').disabled = res.source !== 'files';\n      }\n\n      async function scan() {\n        try {\n          showResult(await withProgress($('gridbox'), S.Opening, 'scan'));\n        } catch (e) {\n          $('status').textContent = String(e && e.message ? e.message : e);\n        }\n      }\n\n      async function useFiles(files, meta) {\n        try {\n          showResult(await withProgress($('gridbox'), S.Writing, 'apply', { files, meta }));\n        } catch (e) {\n          await tell(String(e && e.message ? e.message : e));\n        }\n      }\n\n      function readAll(list) {\n        return Promise.all(\n          Array.from(list).map(\n            (f) =>\n              new Promise((resolve, reject) => {\n                const r = new FileReader();\n                r.onload = () => resolve({ name: f.name, text: r.result, length: f.size, mtime: f.lastModified });\n                r.onerror = () => reject(r.error);\n                r.readAsText(f);\n              }),\n          ),\n        );\n      }\n\n      $('fileInput').addEventListener('change', async () => {\n        const chosen = await readAll($('fileInput').files);\n        $('fileInput').value = '';\n        if (chosen.length === 0) return;\n        const files = {};\n        const meta = {};\n        chosen.forEach((f) => {\n          files[f.name] = f.text.replace(/^\ufeff/, '');\n          meta[f.name] = { length: f.length, mtime: f.mtime };\n        });\n        await useFiles(files, meta);\n      });\n\n      /** The project folder: Settings.xml, its .ldml files and the files the report looks for. */\n      async function fromFolder() {\n        const wanted = ['Settings.xml', 'custom.sty', 'custom.vrs', 'autocorrect.txt'].concat(\n          (await ProjectFolder.names()).filter((n) => /\\.ldml$/i.test(n)),\n        );\n        const files = {};\n        const meta = { __folder: true };\n        for (const n of wanted) {\n          const text = await ProjectFolder.readText(n);\n          if (text === null) continue;\n          files[n] = text;\n          meta[n] = await ProjectFolder.info(n);\n        }\n        await useFiles(files, meta);\n      }\n\n      async function paste() {\n        const box = document.createElement('textarea');\n        box.className = 'paste';\n        const ok = await dialog(S.PasteIntro, [\n          { label: S.Ok, value: true, primary: true },\n          { label: S.Cancel, value: false },\n        ], box);\n        if (!ok || box.value.trim().length === 0) return;\n        await useFiles({ 'Settings.xml': box.value.replace(/^\ufeff/, '') }, {});\n      }\n\n      function save() {\n        if (!lastHtml) return;\n        const a = document.createElement('a');\n        a.href = URL.createObjectURL(new Blob([lastHtml], { type: 'text/html' }));\n        a.download = 'SettingsReport.html';\n        document.body.appendChild(a);\n        a.click();\n        setTimeout(() => {\n          URL.revokeObjectURL(a.href);\n          a.remove();\n        }, 1000);\n      }\n\n      $('title').textContent = S.Title + ' ' + (BOOT.version || '');\n      $('project').textContent = BOOT.projectName ? ' - ' + BOOT.projectName : '';\n      $('choose').textContent = S.ChooseFiles;\n      $('paste').textContent = S.PasteButton;\n      $('useP10').textContent = S.UseP10;\n      $('save').textContent = S.SaveHtml;\n      $('rescan').textContent = S.Rescan;\n      $('useP10').disabled = true;\n      $('choose').addEventListener('click', () => $('fileInput').click());\n      $('paste').addEventListener('click', paste);\n      $('useP10').addEventListener('click', () => useFiles({}, {}));\n      $('save').addEventListener('click', save);\n      $('rescan').addEventListener('click', scan);\n      // One report at start: from the folder when it opens by itself, otherwise from Paratext 10.\n      folderBar($('folderRow'), 'read', fromFolder).then((opened) => {\n        if (!opened) scan();\n      });\n    </script>\n  </body>\n</html>\n";
const PS_SETTINGS_TXT = "# Descriptions of the elements of a Paratext Settings.xml, embedded in the plugin.\n# One line per element: name | group | decoder | English | Spanish | French\n# A '*' in the name matches any text (prefix*, *suffix); '{0}' in a description is the matched text.\n# Exact names are looked up first, then the custom checks' .cms options, then the patterns.\n# Groups and decoders: see SettingCatalog.cs. Empty decoder = plain text.\n#\n# ---------------------------------------------------------------- general\nName|general|text|Short name of the project. It is also the name of the project's folder.|Nombre abreviado del proyecto. Tambi\u00e9n es el nombre de la carpeta del proyecto.|Nom abr\u00e9g\u00e9 du projet. C'est aussi le nom du dossier du projet.\nFullName|general|text|Full name of the project (\"Full name\", Project properties, General tab).|Nombre completo del proyecto (\"Nombre completo\", Propiedades del proyecto, pesta\u00f1a General).|Nom complet du projet (\u00ab Nom complet \u00bb, Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral).\nLanguage|general|text|Name of the project's language (\"Language\", Project properties, General tab). Its letters, punctuation and other details are set in Language settings.|Nombre del idioma del proyecto (\"Idioma\", Propiedades del proyecto, pesta\u00f1a General). Sus letras, puntuaci\u00f3n y otros detalles se definen en Configuraci\u00f3n del idioma.|Nom de la langue du projet (\u00ab Langue \u00bb, Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral). Ses lettres, sa ponctuation et d'autres d\u00e9tails se r\u00e8glent dans Param\u00e8tres de langue.\nLanguageIsoCode|general|langcode|Code of the language: the ISO 639 language code, then the script, region and variant codes, separated by colons. An empty part means none was given.|C\u00f3digo del idioma: el c\u00f3digo ISO 639 del idioma y luego los c\u00f3digos de escritura, regi\u00f3n y variante, separados por dos puntos. Una parte vac\u00eda significa que no se indic\u00f3.|Code de la langue : le code ISO 639 de la langue, puis les codes d'\u00e9criture, de r\u00e9gion et de variante, s\u00e9par\u00e9s par des deux-points. Une partie vide signifie qu'elle n'a pas \u00e9t\u00e9 indiqu\u00e9e.\nEthnologueCode|general|text|Ethnologue (ISO 639-3) code of the language, kept from older versions of Paratext.|C\u00f3digo del Ethnologue (ISO 639-3) del idioma, de versiones antiguas de Paratext.|Code Ethnologue (ISO 639-3) de la langue, conserv\u00e9 des anciennes versions de Paratext.\nTranslationInfo|general|projtype|Project type (\"Project type\", Project properties, General tab). For a derived project (back translation, daughter, study Bible...) it also gives the name and identifier of the project it is based on.|Tipo de proyecto (\"Tipo de proyecto\", Propiedades del proyecto, pesta\u00f1a General). Para un proyecto derivado (traducci\u00f3n inversa, proyecto hijo, Biblia de estudio...) da tambi\u00e9n el nombre y el identificador del proyecto en el que se basa.|Type de projet (\u00ab Type de projet \u00bb, Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral). Pour un projet d\u00e9riv\u00e9 (traduction de retour, projet fille, Bible d'\u00e9tude...), il donne aussi le nom et l'identifiant du projet sur lequel il est bas\u00e9.\nCopyright|general|html|Copyright notice of the project (\"Copyright\", Project properties, General tab). Paratext stores it as HTML.|Aviso de copyright del proyecto (\"Copyright\", Propiedades del proyecto, pesta\u00f1a General). Paratext lo guarda como HTML.|Mention de copyright du projet (\u00ab Copyright \u00bb, Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral). Paratext l'enregistre en HTML.\nGuid|general|text|Unique identifier of the project. Paratext uses it to recognize the project, for example in Send/Receive. It never changes.|Identificador \u00fanico del proyecto. Paratext lo usa para reconocer el proyecto, por ejemplo en Enviar/Recibir. Nunca cambia.|Identifiant unique du projet. Paratext s'en sert pour reconna\u00eetre le projet, par exemple lors d'Envoyer/Recevoir. Il ne change jamais.\nParatextRegistryId|general|text|Identifier of the project's entry in the Paratext Registry.|Identificador de la entrada del proyecto en el Registro de Paratext.|Identifiant de l'entr\u00e9e du projet dans le registre de Paratext.\nVisibility|general|text|How Paratext classes the project, for example Public, or Test for a project used for testing or training.|C\u00f3mo clasifica Paratext el proyecto, por ejemplo Public (p\u00fablico) o Test (un proyecto de prueba o de capacitaci\u00f3n).|Comment Paratext classe le projet, par exemple Public, ou Test pour un projet d'essai ou de formation.\nEditable|general|bool|\"Editing enabled\" (Project properties, Advanced tab): whether the project's text can be edited.|\"Edici\u00f3n habilitada\" (Propiedades del proyecto, pesta\u00f1a Avanzado): si se puede editar el texto del proyecto.|\u00ab \u00c9dition autoris\u00e9e \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9) : si le texte du projet peut \u00eatre modifi\u00e9.\nMinParatextVersion|general|text|\"Required version\" (Project properties, General tab): the oldest version of Paratext that may open the project.|\"Versi\u00f3n requerida\" (Propiedades del proyecto, pesta\u00f1a General): la versi\u00f3n m\u00e1s antigua de Paratext que puede abrir el proyecto.|\u00ab Version requise \u00bb (Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral) : la plus ancienne version de Paratext qui peut ouvrir le projet.\nUsfmVersion|general|text|\"USFM version\" (Project properties, Advanced tab). 3 means USFM 3.|\"Versi\u00f3n USFM\" (Propiedades del proyecto, pesta\u00f1a Avanzado). 3 significa USFM 3.|\u00ab Version USFM \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9). 3 signifie USFM 3.\nAllowReadAccess|general|bool|\"Allow other Paratext users to access this project as a translation resource\" (Project properties, Advanced tab).|\"Permitir que otros usuarios de Paratext accedan a este proyecto como recurso de traducci\u00f3n\" (Propiedades del proyecto, pesta\u00f1a Avanzado).|\u00ab Autoriser les autres utilisateurs Paratext \u00e0 acc\u00e9der \u00e0 ce projet comme une ressource de traduction \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9).\nAllowSharingWithSLDR|general|bool|\"Share language information with the SIL Locale Data Repository\" (Project properties, Advanced tab).|\"Compartir informaci\u00f3n sobre idiomas con el SIL Locale Data Repository\" (Propiedades del proyecto, pesta\u00f1a Avanzado).|\u00ab Partager les informations de langues avec le d\u00e9p\u00f4t de donn\u00e9es locales SIL \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9).\nAllowDerivedProjectRegistration|general|bool|For a derived project: \"Create a separate registration (i.e., to upload to DBL or publish separately)\" (Project properties, General tab).|Para un proyecto derivado: \"Crear un registro separado (es decir, para cargar en DBL o publicar por separado)\" (Propiedades del proyecto, pesta\u00f1a General).|Pour un projet d\u00e9riv\u00e9 : \u00ab Cr\u00e9er une inscription s\u00e9par\u00e9e (par exemple pour t\u00e9l\u00e9transmettre \u00e0 la BBN ou publier s\u00e9par\u00e9ment) \u00bb (Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral).\nDBLId|general|text|Identifier of the project's entry in the Digital Bible Library (DBL).|Identificador de la entrada del proyecto en la Digital Bible Library (DBL).|Identifiant de l'entr\u00e9e du projet dans la Digital Bible Library (DBL, Biblioth\u00e8que biblique num\u00e9rique).\nDBLIncludeFonts|general|bool|Whether the project's fonts are included when it is uploaded to the Digital Bible Library.|Si las fuentes del proyecto se incluyen al cargarlo en la Digital Bible Library.|Si les polices du projet sont incluses lors de son envoi \u00e0 la Digital Bible Library.\nGBCId|general|text|Identifier of the project's entry in the Global Bible Catalog.|Identificador de la entrada del proyecto en el Global Bible Catalog.|Identifiant de l'entr\u00e9e du projet dans le Global Bible Catalog.\nGBCSummary|general|text|Summary of the project's entry in the Global Bible Catalog.|Resumen de la entrada del proyecto en el Global Bible Catalog.|R\u00e9sum\u00e9 de l'entr\u00e9e du projet dans le Global Bible Catalog.\nDateArchived|general|text|Date and time when the project was archived.|Fecha y hora en que se archiv\u00f3 el proyecto.|Date et heure de l'archivage du projet.\nCreatedWithPTW6|general|bool|The project was created with Paratext 6.|El proyecto se cre\u00f3 con Paratext 6.|Le projet a \u00e9t\u00e9 cr\u00e9\u00e9 avec Paratext 6.\nNeverShowBackupReminder|general|bool|Do not remind the user to back up the project.|No recordar al usuario que haga una copia de seguridad del proyecto.|Ne pas rappeler \u00e0 l'utilisateur de sauvegarder le projet.\n# ---------------------------------------------------------------- files\nStyleSheet|files|text|\"Stylesheet\" (Project properties, Advanced tab): the file that defines the markers. Changes for this project only are in custom.sty in the project folder.|\"Hoja de estilo\" (Propiedades del proyecto, pesta\u00f1a Avanzado): el archivo que define los marcadores. Los cambios solo para este proyecto est\u00e1n en custom.sty, en la carpeta del proyecto.|\u00ab Feuille de style \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9) : le fichier qui d\u00e9finit les marqueurs. Les changements propres \u00e0 ce projet se trouvent dans custom.sty, dans le dossier du projet.\nEncoding|files|encoding|\"Encoding\" (Project properties, Advanced tab): the code page of the book files. 65001 is UTF-8 (Unicode).|\"Codificaci\u00f3n\" (Propiedades del proyecto, pesta\u00f1a Avanzado): la p\u00e1gina de c\u00f3digos de los archivos de los libros. 65001 es UTF-8 (Unicode).|\u00ab Encodage \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9) : la page de codes des fichiers des livres. 65001 est UTF-8 (Unicode).\nEncodingConverter|files|text|\"Encoding converter\" (Project properties, General tab): a converter that is only used for projects of type \"Transliteration by encoding converter\".|\"Convertidor de codificaci\u00f3n\" (Propiedades del proyecto, pesta\u00f1a General): un convertidor que solo se usa en los proyectos de tipo \"Transliteraci\u00f3n (usando convertidor de codificaci\u00f3n)\".|\u00ab Convertisseur de codage \u00bb (Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral) : un convertisseur qui n'est utilis\u00e9 que pour les projets de type \u00ab Translitt\u00e9ration (en utilisant le convertisseur de codage) \u00bb.\nNormalizationForm|files|text|\"Normalization\" (Project properties, Advanced tab): how accented letters are stored. NFC = composed (\u00e9 is one character), NFD = decomposed (e followed by a combining accent).|\"Normalizaci\u00f3n\" (Propiedades del proyecto, pesta\u00f1a Avanzado): c\u00f3mo se guardan las letras con acento. NFC = compuesta (\u00e9 es un solo car\u00e1cter), NFD = descompuesta (e seguida de un acento combinado).|\u00ab Normalisation \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9) : comment les lettres accentu\u00e9es sont enregistr\u00e9es. NFC = compos\u00e9e (\u00e9 est un seul caract\u00e8re), NFD = d\u00e9compos\u00e9e (e suivi d'un accent combinant).\nFileNamePrePart|files|text|Text at the start of each book file name, before the book number or code (\"Typical file name\", Project properties, Advanced tab).|Texto al principio del nombre de archivo de cada libro, antes del n\u00famero o c\u00f3digo del libro (\"Nombre de archivo t\u00edpico\", Propiedades del proyecto, pesta\u00f1a Avanzado).|Texte au d\u00e9but du nom de fichier de chaque livre, avant le num\u00e9ro ou le code du livre (\u00ab Nom de fichier typique \u00bb, Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9).\nFileNamePostPart|files|text|Text at the end of each book file name, after the book number or code, including the extension (\"Typical file name\").|Texto al final del nombre de archivo de cada libro, despu\u00e9s del n\u00famero o c\u00f3digo del libro, con la extensi\u00f3n (\"Nombre de archivo t\u00edpico\").|Texte \u00e0 la fin du nom de fichier de chaque livre, apr\u00e8s le num\u00e9ro ou le code du livre, avec l'extension (\u00ab Nom de fichier typique \u00bb).\nFileNameBookNameForm|files|text|How the book appears in its file name: 41MAT = number and code, MAT = code only, 41 = number only.|C\u00f3mo aparece el libro en el nombre de su archivo: 41MAT = n\u00famero y c\u00f3digo, MAT = solo el c\u00f3digo, 41 = solo el n\u00famero.|Comment le livre appara\u00eet dans le nom de son fichier : 41MAT = num\u00e9ro et code, MAT = code seul, 41 = num\u00e9ro seul.\nFileNameForm|files|text|How the book appears in its file name (an older form of FileNameBookNameForm): 41MAT = number and code, MAT = code only.|C\u00f3mo aparece el libro en el nombre de su archivo (forma antigua de FileNameBookNameForm): 41MAT = n\u00famero y c\u00f3digo, MAT = solo el c\u00f3digo.|Comment le livre appara\u00eet dans le nom de son fichier (ancienne forme de FileNameBookNameForm) : 41MAT = num\u00e9ro et code, MAT = code seul.\nNaming|files|naming|The book file names again, as attributes: PrePart + book (BookNameForm) + PostPart. Below is the file name of Matthew.|Los nombres de archivo de los libros otra vez, como atributos: PrePart + libro (BookNameForm) + PostPart. Abajo est\u00e1 el nombre del archivo de Mateo.|Les noms de fichier des livres, \u00e0 nouveau, sous forme d'attributs : PrePart + livre (BookNameForm) + PostPart. Ci-dessous, le nom du fichier de Matthieu.\nInitialImportBooksDirectory|files|text|Folder from which books were imported into the project.|Carpeta desde la que se importaron libros al proyecto.|Dossier \u00e0 partir duquel des livres ont \u00e9t\u00e9 import\u00e9s dans le projet.\nBibleModuleAssociations|files|bar|Bible modules linked to the extra books (XXA to XXG), as book:file, separated by \\| (Project > Advanced > Bible module).|M\u00f3dulos b\u00edblicos vinculados a los libros adicionales (XXA a XXG), como libro:archivo, separados por \\| (Proyecto > Avanzado > M\u00f3dulo B\u00edblico).|Modules bibliques li\u00e9s aux livres suppl\u00e9mentaires (XXA \u00e0 XXG), sous la forme livre:fichier, s\u00e9par\u00e9s par \\| (Projet > Avanc\u00e9 > Module biblique).\nSSFFileName|files|text|Name of the project's settings file (.ssf) in Paratext 6 and 7, before the project was converted.|Nombre del archivo de configuraci\u00f3n del proyecto (.ssf) en Paratext 6 y 7, antes de que se convirtiera el proyecto.|Nom du fichier de param\u00e8tres du projet (.ssf) dans Paratext 6 et 7, avant la conversion du projet.\nPTXExtensionsConvertedToSFM|files|bool|Book files with the old .PTX extension have been renamed to .SFM.|Los archivos de libros con la antigua extensi\u00f3n .PTX se cambiaron a .SFM.|Les fichiers de livres \u00e0 l'ancienne extension .PTX ont \u00e9t\u00e9 renomm\u00e9s en .SFM.\n# ---------------------------------------------------------------- books\nBooksPresent|books|books|Books in the project: one digit per book, in Paratext's standard order (GEN to REV, then the deuterocanonical and other books). 1 = the book is present.|Libros del proyecto: un d\u00edgito por libro, en el orden est\u00e1ndar de Paratext (GEN a REV, luego los deuterocan\u00f3nicos y otros libros). 1 = el libro est\u00e1 presente.|Livres du projet : un chiffre par livre, dans l'ordre standard de Paratext (GEN \u00e0 REV, puis les deut\u00e9rocanoniques et les autres livres). 1 = le livre est pr\u00e9sent.\nVersification|books|vrs|\"Versification\" (Project properties, General tab): the chapter and verse numbering. Changes for this project only are in custom.vrs in the project folder.|\"Versificaci\u00f3n\" (Propiedades del proyecto, pesta\u00f1a General): la numeraci\u00f3n de cap\u00edtulos y vers\u00edculos. Los cambios solo para este proyecto est\u00e1n en custom.vrs, en la carpeta del proyecto.|\u00ab Versification \u00bb (Propri\u00e9t\u00e9s du projet, onglet G\u00e9n\u00e9ral) : la num\u00e9rotation des chapitres et des versets. Les changements propres \u00e0 ce projet se trouvent dans custom.vrs, dans le dossier du projet.\nParallelPassagesBooks|hidden|books|Books selected for parallel passages checking, one digit per book in Paratext's standard order. 1 = selected.|Libros seleccionados para la verificaci\u00f3n de pasajes paralelos, un d\u00edgito por libro en el orden est\u00e1ndar de Paratext. 1 = seleccionado.|Livres s\u00e9lectionn\u00e9s pour la v\u00e9rification des passages parall\u00e8les, un chiffre par livre dans l'ordre standard de Paratext. 1 = s\u00e9lectionn\u00e9.\nSegmentOrder|refs|text|Letters used, in order, for parts of verses (5a, 5b...).|Letras que se usan, en orden, para las partes de los vers\u00edculos (5a, 5b...).|Lettres utilis\u00e9es, dans l'ordre, pour les parties de versets (5a, 5b...).\n# ---------------------------------------------------------------- display\nDefaultFont|display|font|Font of the project's text.|Fuente del texto del proyecto.|Police du texte du projet.\nDefaultFontSize|display|text|Font size of the project's text, in points.|Tama\u00f1o de la fuente del texto del proyecto, en puntos.|Taille de la police du texte du projet, en points.\nFontFeatures|display|text|Font features (Graphite or OpenType) used with the font, for example litr=1.|Caracter\u00edsticas de la fuente (Graphite u OpenType) que se usan con ella, por ejemplo litr=1.|Fonctionnalit\u00e9s de police (Graphite ou OpenType) utilis\u00e9es avec la police, par exemple litr=1.\nHtmlLanguage|display|text|Language code put in HTML views of the text, so that the right language features of the font are used.|C\u00f3digo de idioma que se pone en las vistas HTML del texto, para que se usen las caracter\u00edsticas de idioma correctas de la fuente.|Code de langue plac\u00e9 dans les affichages HTML du texte, pour que les bonnes fonctionnalit\u00e9s de langue de la police soient utilis\u00e9es.\nLeftToRight|display|bool|Whether the language is written from left to right (No = right to left).|Si el idioma se escribe de izquierda a derecha (No = de derecha a izquierda).|Si la langue s'\u00e9crit de gauche \u00e0 droite (Non = de droite \u00e0 gauche).\nAutoKeyboardSwitching|display|bool|Switch the keyboard automatically when typing in this project.|Cambiar el teclado autom\u00e1ticamente al escribir en este proyecto.|Changer de clavier automatiquement lors de la saisie dans ce projet.\n# ---------------------------------------------------------------- language settings (the project's .ldml file, see LdmlFile.cs)\nldml|language|text|File that holds the project's language settings (Project > Project settings > Language settings...). Its name comes from LanguageIsoCode.|Archivo que contiene la configuraci\u00f3n del idioma del proyecto (Proyecto > Configuraci\u00f3n del proyecto > Configuraci\u00f3n del idioma...). Su nombre viene de LanguageIsoCode.|Fichier qui contient les param\u00e8tres de langue du projet (Projet > Param\u00e8tres du projet > Param\u00e8tres de langue...). Son nom vient de LanguageIsoCode.\nldml-others|language|list|Other language settings files in the project folder. They are not used here, because their names do not match LanguageIsoCode.|Otros archivos de configuraci\u00f3n del idioma en la carpeta del proyecto. No se usan aqu\u00ed, porque sus nombres no coinciden con LanguageIsoCode.|Autres fichiers de param\u00e8tres de langue dans le dossier du projet. Ils ne sont pas utilis\u00e9s ici, car leur nom ne correspond pas \u00e0 LanguageIsoCode.\nidentity|language|langcode|Language, script, region and variant that the language settings file is for.|Idioma, escritura, regi\u00f3n y variante para los que es el archivo de configuraci\u00f3n del idioma.|Langue, \u00e9criture, r\u00e9gion et variante auxquelles correspond le fichier de param\u00e8tres de langue.\nexemplarCharacters|language|uset|Letters of the language: the characters of the Alphabetic characters tab, upper and lower case.|Letras del idioma: los caracteres de la pesta\u00f1a Caracteres alfab\u00e9ticos, en may\u00fascula y min\u00fascula.|Lettres de la langue : les caract\u00e8res de l'onglet Caract\u00e8res alphab\u00e9tiques, en majuscule et en minuscule.\nexemplarCharacters[auxiliary]|language|uset|Auxiliary letters: letters used only in borrowed words or names.|Letras auxiliares: letras que solo se usan en pr\u00e9stamos o nombres.|Lettres auxiliaires : lettres utilis\u00e9es seulement dans des emprunts ou des noms.\nexemplarCharacters[index]|language|uset|Index letters: the letters that head the sections of an alphabetical index.|Letras de \u00edndice: las letras que encabezan las secciones de un \u00edndice alfab\u00e9tico.|Lettres d'index : les lettres qui ouvrent les sections d'un index alphab\u00e9tique.\nexemplarCharacters[punctuation]|language|uset|Punctuation of the language.|Puntuaci\u00f3n del idioma.|Ponctuation de la langue.\nsil:exemplarCharacters[wordFormingPunctuation]|language|uset|\"Word medial punctuation\" (Other characters tab): punctuation that can be part of a word, such as a hyphen or an apostrophe.|\"Puntuaci\u00f3n en medio de palabra\" (pesta\u00f1a Otros caracteres): puntuaci\u00f3n que puede formar parte de una palabra, como un guion o un ap\u00f3strofo.|\u00ab Ponctuation \u00e0 l'int\u00e9rieur d'un mot \u00bb (onglet Autres caract\u00e8res) : ponctuation qui peut faire partie d'un mot, comme un trait d'union ou une apostrophe.\nsil:exemplarCharacters[footnotes]|language|uset|\"Footnote caller sequence\" (Other characters tab): the callers given to footnotes in turn.|\"Secuencia de llamadores de notas al pie\" (pesta\u00f1a Otros caracteres): las llamadas que se dan por turno a las notas al pie.|\u00ab Ordre des rappels des notes de bas de page \u00bb (onglet Autres caract\u00e8res) : les appels donn\u00e9s tour \u00e0 tour aux notes de bas de page.\nsil:exemplarCharacters[crossrefs]|language|uset|\"Cross reference caller sequence\" (Other characters tab): the callers given to cross references in turn.|\"Secuencia de llamadores de referencias cruzadas\" (pesta\u00f1a Otros caracteres): las llamadas que se dan por turno a las referencias cruzadas.|\u00ab Ordre des rappels des renvois \u00bb (onglet Autres caract\u00e8res) : les appels donn\u00e9s tour \u00e0 tour aux renvois.\nsil:exemplarCharacters[verseSegments]|language|uset|\"Verse segment characters\" (Other characters tab): the letters used for parts of verses (5a, 5b...).|\"Caracteres del segmento de vers\u00edculo\" (pesta\u00f1a Otros caracteres): las letras que se usan para las partes de los vers\u00edculos (5a, 5b...).|\u00ab Caract\u00e8res de segment de verset \u00bb (onglet Autres caract\u00e8res) : les lettres utilis\u00e9es pour les parties de versets (5a, 5b...).\nsil:exemplarCharacters[diacritics]|language|uset|\"Non-standard diacritics\" (Other characters tab).|\"Diacr\u00edticos no est\u00e1ndar\" (pesta\u00f1a Otros caracteres).|\u00ab Signes diacritiques non standards \u00bb (onglet Autres caract\u00e8res).\nsil:exemplarCharacters[wordBreaks]|language|uset|\"Word break characters\" (Other characters tab): characters other than spaces that separate words.|\"Caracteres de separaci\u00f3n de palabras\" (pesta\u00f1a Otros caracteres): caracteres, aparte de los espacios, que separan palabras.|\u00ab Caract\u00e8res de coupure de mot \u00bb (onglet Autres caract\u00e8res) : caract\u00e8res, autres que les espaces, qui s\u00e9parent les mots.\nsil:exemplarCharacters[numbers]|language|uset|Digits of the language.|Cifras del idioma.|Chiffres de la langue.\nsil:simple|language|lines|\"Alphabetic characters\" tab: the letters in alphabetical order, one line per letter, its forms separated by / (a/A). Letters on the same line sort as one letter.|Pesta\u00f1a \"Caracteres alfab\u00e9ticos\": las letras en orden alfab\u00e9tico, una l\u00ednea por letra, con sus formas separadas por / (a/A). Las letras de una misma l\u00ednea se ordenan como una sola letra.|Onglet \u00ab Caract\u00e8res alphab\u00e9tiques \u00bb : les lettres dans l'ordre alphab\u00e9tique, une ligne par lettre, ses formes s\u00e9par\u00e9es par / (a/A). Les lettres d'une m\u00eame ligne sont class\u00e9es comme une seule lettre.\ncollation[*]|language|code|Rules of the alphabetical order (ICU sort rules, sort type {0}).|Reglas del orden alfab\u00e9tico (reglas de ordenaci\u00f3n ICU, tipo {0}).|R\u00e8gles de l'ordre alphab\u00e9tique (r\u00e8gles de tri ICU, type {0}).\nsil:matched-pairs|language|pairs|Matched pairs of punctuation (opening/closing), used by the matched pairs check.|Pares de puntuaci\u00f3n que se corresponden (apertura/cierre), que usa la verificaci\u00f3n de pares.|Paires de ponctuation qui se correspondent (ouvrant/fermant), utilis\u00e9es par la v\u00e9rification des paires.\nsil:matched-pair[paraClose]|language|pairs|Matched pairs that the end of a paragraph closes.|Pares que se cierran al final del p\u00e1rrafo.|Paires que la fin du paragraphe ferme.\nsil:punctuation-patterns|language|punct|Punctuation approved in the language settings, with its place in a word.|Puntuaci\u00f3n aprobada en la configuraci\u00f3n del idioma, con su posici\u00f3n en la palabra.|Ponctuation approuv\u00e9e dans les param\u00e8tres de langue, avec sa place dans le mot.\nquotationStart|language|text|Opening quotation mark, first level.|Comilla de apertura, primer nivel.|Guillemet ouvrant, premier niveau.\nquotationEnd|language|text|Closing quotation mark, first level.|Comilla de cierre, primer nivel.|Guillemet fermant, premier niveau.\nalternateQuotationStart|language|text|Opening quotation mark, second level (a quotation inside a quotation).|Comilla de apertura, segundo nivel (una cita dentro de una cita).|Guillemet ouvrant, deuxi\u00e8me niveau (une citation dans une citation).\nalternateQuotationEnd|language|text|Closing quotation mark, second level.|Comilla de cierre, segundo nivel.|Guillemet fermant, deuxi\u00e8me niveau.\nsil:quotation-marks[paraContinueType]|language|text|Which quotation levels are marked again at the start of a paragraph when a quotation continues: all, outermost, innermost or none.|Qu\u00e9 niveles de cita se marcan de nuevo al principio de un p\u00e1rrafo cuando una cita contin\u00faa: all (todos), outermost (el exterior), innermost (el interior) o none (ninguno).|Quels niveaux de citation sont marqu\u00e9s \u00e0 nouveau au d\u00e9but d'un paragraphe quand une citation continue : all (tous), outermost (le plus ext\u00e9rieur), innermost (le plus int\u00e9rieur) ou none (aucun).\nsil:quotationContinue|language|text|Quotation mark that continues a first-level quotation in a new paragraph.|Comilla que contin\u00faa una cita de primer nivel en un nuevo p\u00e1rrafo.|Guillemet qui continue une citation du premier niveau dans un nouveau paragraphe.\nsil:alternateQuotationContinue|language|text|Quotation mark that continues a second-level quotation in a new paragraph.|Comilla que contin\u00faa una cita de segundo nivel en un nuevo p\u00e1rrafo.|Guillemet qui continue une citation du deuxi\u00e8me niveau dans un nouveau paragraphe.\nsil:quotation|language|quotes|More quotation marks: the third level and beyond, and the continuers of narrative quotations.|M\u00e1s comillas: el tercer nivel y los siguientes, y las comillas de continuaci\u00f3n de las citas narrativas.|Autres guillemets : le troisi\u00e8me niveau et au-del\u00e0, et les guillemets de continuation des citations narratives.\ncharacterOrder|language|text|Writing direction: left-to-right, or right-to-left (\"Right to left script\", Font tab).|Direcci\u00f3n de la escritura: left-to-right (de izquierda a derecha) o right-to-left (\"Escritura de derecha a izquierda\", pesta\u00f1a Fuente).|Sens de l'\u00e9criture : left-to-right (de gauche \u00e0 droite) ou right-to-left (\u00ab Texte de droite \u00e0 gauche \u00bb, onglet Police).\nnumberingSystem[digits]|language|text|Digits used to write numbers.|Cifras que se usan para escribir los n\u00fameros.|Chiffres utilis\u00e9s pour \u00e9crire les nombres.\nsil:font|language|fonts|Fonts for the language (\"Font\" tab): name, use, size compared with normal text, and font features.|Fuentes para el idioma (pesta\u00f1a \"Fuente\"): nombre, uso, tama\u00f1o respecto al texto normal y caracter\u00edsticas de la fuente.|Polices pour la langue (onglet \u00ab Police \u00bb) : nom, usage, taille par rapport au texte normal et fonctionnalit\u00e9s de la police.\nsil:kbd|language|lines|Keyboards for the language.|Teclados para el idioma.|Claviers pour la langue.\n# ---------------------------------------------------------------- quotation marks\nQuotes|quotes|list|Opening and closing quotation marks of the first level (\"Quotes\", Quotation rules).|Comillas de apertura y de cierre del primer nivel (\"Citas\", Reglas de comillas).|Guillemets ouvrant et fermant du premier niveau (\u00ab Citations \u00bb, R\u00e8gles des guillemets).\nInnerQuotes|quotes|list|Opening and closing quotation marks of the second level, a quotation inside a quotation (\"Quotes in quotes\", Quotation rules).|Comillas de apertura y de cierre del segundo nivel, una cita dentro de una cita (\"Citas en citas\", Reglas de comillas).|Guillemets ouvrant et fermant du deuxi\u00e8me niveau, une citation dans une citation (\u00ab Citations dans des citations \u00bb, R\u00e8gles des guillemets).\nInnerInnerQuotes|quotes|list|Opening and closing quotation marks of the third level (\"Quotes in quotes in quotes\", Quotation rules).|Comillas de apertura y de cierre del tercer nivel (\"Citas en citas en citas\", Reglas de comillas).|Guillemets ouvrant et fermant du troisi\u00e8me niveau (\u00ab Citations dans des citations dans des citations \u00bb, R\u00e8gles des guillemets).\nContinuer|quotes|text|Quotation mark at the start of a new paragraph when a first-level quotation continues from the paragraph before.|Comilla al principio de un nuevo p\u00e1rrafo cuando una cita de primer nivel contin\u00faa desde el p\u00e1rrafo anterior.|Guillemet au d\u00e9but d'un nouveau paragraphe quand une citation du premier niveau continue depuis le paragraphe pr\u00e9c\u00e9dent.\nInnerContinuer|quotes|text|Quotation mark at the start of a new paragraph when a second-level quotation continues.|Comilla al principio de un nuevo p\u00e1rrafo cuando contin\u00faa una cita de segundo nivel.|Guillemet au d\u00e9but d'un nouveau paragraphe quand une citation du deuxi\u00e8me niveau continue.\nInnerInnerContinuer|quotes|text|Quotation mark at the start of a new paragraph when a third-level quotation continues.|Comilla al principio de un nuevo p\u00e1rrafo cuando contin\u00faa una cita de tercer nivel.|Guillemet au d\u00e9but d'un nouveau paragraphe quand une citation du troisi\u00e8me niveau continue.\nContinueQuotes|quotes|bool|Whether a first-level quotation that goes on into a new paragraph must be marked again there with the continuer.|Si una cita de primer nivel que sigue en un nuevo p\u00e1rrafo debe marcarse de nuevo all\u00ed con la comilla de continuaci\u00f3n.|Si une citation du premier niveau qui se poursuit dans un nouveau paragraphe doit y \u00eatre marqu\u00e9e \u00e0 nouveau par le guillemet de continuation.\nContinueInnerQuotes|quotes|bool|The same for second-level quotations.|Lo mismo para las citas de segundo nivel.|La m\u00eame chose pour les citations du deuxi\u00e8me niveau.\nVerboseQuotes|quotes|bool|Whether a continuing paragraph repeats the continuers of all the quotation levels still open.|Si un p\u00e1rrafo que contin\u00faa repite las comillas de continuaci\u00f3n de todos los niveles de cita que siguen abiertos.|Si un paragraphe qui continue r\u00e9p\u00e8te les guillemets de continuation de tous les niveaux de citation encore ouverts.\nQuoteClosesAllQuoteLevels|quotes|bool|\"Closing quotation mark closes all inner level quotations\" (Quotation rules).|\"Las comillas de cierre cierran todas las comillas de nivel interior\" (Reglas de comillas).|\u00ab Le guillemet fermant ferme toutes les citations de niveau int\u00e9rieur \u00bb (R\u00e8gles des guillemets).\nContinueAt|quotes|list|\"Continuation required at\" (Quotation rules): the paragraph markers where an open quotation must be continued. A pair such as b/q1 means a \\q1 after a \\b.|\"Continuaci\u00f3n requerida en\" (Reglas de comillas): los marcadores de p\u00e1rrafo donde una cita abierta debe continuarse. Un par como b/q1 significa un \\q1 despu\u00e9s de un \\b.|\u00ab Continuation requise \u00e0 \u00bb (R\u00e8gles des guillemets) : les marqueurs de paragraphe o\u00f9 une citation ouverte doit \u00eatre continu\u00e9e. Une paire comme b/q1 signifie un \\q1 apr\u00e8s un \\b.\nQuotationTypesOption|quotes|text|\"Quotation types\" tab of Quotation rules: Recommended = \"Use recommended settings\", Custom = \"Custom settings\".|Pesta\u00f1a \"Tipos de cita\" de Reglas de comillas: Recommended = \"Utilice la configuraci\u00f3n recomendada\", Custom = \"Configuraci\u00f3n personalizada\".|Onglet \u00ab Types de citation \u00bb des R\u00e8gles des guillemets : Recommended = param\u00e8tres recommand\u00e9s, Custom = param\u00e8tres personnalis\u00e9s.\nExpectedQuoteTypes|quotes|list|Kinds of speech that should have quotation marks (Quotation rules, Quotation types tab).|Tipos de habla que deben llevar comillas (Reglas de comillas, pesta\u00f1a Tipos de cita).|Types de discours qui doivent avoir des guillemets (R\u00e8gles des guillemets, onglet Types de citation).\nUnexpectedQuoteTypes|quotes|list|Kinds of speech that should not have quotation marks (Quotation rules, Quotation types tab).|Tipos de habla que no deben llevar comillas (Reglas de comillas, pesta\u00f1a Tipos de cita).|Types de discours qui ne doivent pas avoir de guillemets (R\u00e8gles des guillemets, onglet Types de citation).\nQuoteTypesCheckEnabled|quotes|bool|\"Enable the Quotation types check box in Run basic checks\" (Quotation rules).|\"Active la casilla Tipos de cita en Ejecutar Verificaciones B\u00e1sicas\" (Reglas de comillas).|Activer la case Types de citation dans Effectuer les v\u00e9rifications de base (R\u00e8gles des guillemets).\nReportMissingExpectedQuotes|quotes|bool|Report speech that should have quotation marks but has none.|Informar del habla que deber\u00eda llevar comillas y no las lleva.|Signaler les paroles qui devraient avoir des guillemets et n'en ont pas.\nReportUnexpectedQuotes|quotes|bool|Report quotation marks around speech that should not have them.|Informar de comillas alrededor de habla que no deber\u00eda llevarlas.|Signaler les guillemets autour de paroles qui ne devraient pas en avoir.\nApplyQuoteRulesInFootnoteCitations|quotes|bool|Apply the quotation rules to the quoted words in footnotes.|Aplicar las reglas de comillas a las palabras citadas en las notas al pie.|Appliquer les r\u00e8gles des guillemets aux mots cit\u00e9s dans les notes de bas de page.\n# ---------------------------------------------------------------- characters\nValidCharacters|chars|chars|Approved characters (character inventory, Language settings): the letters and other characters that may appear in the text. NOTE: this list includes characters that may have been approved in the past and are no longer a part of this project.|Caracteres aprobados (inventario de caracteres, Configuraci\u00f3n del idioma): las letras y otros caracteres que pueden aparecer en el texto. NOTA: esta lista incluye caracteres que pueden haberse aprobado en el pasado y que ya no forman parte de este proyecto.|Caract\u00e8res approuv\u00e9s (inventaire de caract\u00e8res, Param\u00e8tres de langue) : les lettres et autres caract\u00e8res qui peuvent appara\u00eetre dans le texte. REMARQUE : cette liste comprend des caract\u00e8res qui ont pu \u00eatre approuv\u00e9s par le pass\u00e9 et qui ne font plus partie de ce projet.\nInvalidCharacters|chars|chars|Disapproved characters (character inventory): characters that are reported as errors.|Caracteres no aprobados (inventario de caracteres): los que se se\u00f1alan como errores.|Caract\u00e8res non approuv\u00e9s (inventaire de caract\u00e8res) : ceux qui sont signal\u00e9s comme des erreurs.\nCharacterCheckSetSeparately|chars|bool|Whether a separate set of approved characters is kept (the _NonText settings).|Si se mantiene un conjunto separado de caracteres aprobados (la configuraci\u00f3n _NonText).|Si un ensemble s\u00e9par\u00e9 de caract\u00e8res approuv\u00e9s est tenu (les param\u00e8tres _NonText).\nValidCharacters_NonText|chars|chars|Approved characters of the non-verse text, used when the character inventory is set to show them separately (\"Set verse and non-verse status separately\"; see CharacterCheckSetSeparately).|Caracteres aprobados del texto que no es de vers\u00edculos, usados cuando el inventario de caracteres est\u00e1 configurado para mostrarlos por separado (\"Mostrar el estado de los vers\u00edculos y el de los no vers\u00edculos por separado\"; ver CharacterCheckSetSeparately).|Caract\u00e8res approuv\u00e9s du texte hors versets, utilis\u00e9s quand l'inventaire de caract\u00e8res est r\u00e9gl\u00e9 pour les afficher s\u00e9par\u00e9ment (\u00ab Set verse and non-verse status separately \u00bb ; voir CharacterCheckSetSeparately).\nInvalidCharacters_NonText|chars|chars|Disapproved characters of the separate character inventory.|Caracteres no aprobados del inventario de caracteres separado.|Caract\u00e8res non approuv\u00e9s de l'inventaire de caract\u00e8res s\u00e9par\u00e9.\nValidCharacters_StudyBible|chars|chars|Approved characters of the study Bible's own character inventory.|Caracteres aprobados del inventario de caracteres propio de la Biblia de estudio.|Caract\u00e8res approuv\u00e9s de l'inventaire de caract\u00e8res propre \u00e0 la Bible d'\u00e9tude.\nInvalidCharacters_StudyBible|chars|chars|Disapproved characters of the study Bible's own character inventory.|Caracteres no aprobados del inventario de caracteres propio de la Biblia de estudio.|Caract\u00e8res non approuv\u00e9s de l'inventaire de caract\u00e8res propre \u00e0 la Bible d'\u00e9tude.\nAllowInvisibleChars|chars|bool|\"Allow whitespace and invisible characters\" (Project properties, Advanced tab).|\"Permitir espacios en blanco y caracteres invisibles\" (Propiedades del proyecto, pesta\u00f1a Avanzado).|\u00ab Autoriser les caract\u00e8res invisibles \u00bb (Propri\u00e9t\u00e9s du projet, onglet Avanc\u00e9).\nAlreadyAppliedDefaultChars|chars|bool|Paratext has already added the language's default characters to the character inventory.|Paratext ya agreg\u00f3 los caracteres predeterminados del idioma al inventario de caracteres.|Paratext a d\u00e9j\u00e0 ajout\u00e9 les caract\u00e8res par d\u00e9faut de la langue \u00e0 l'inventaire de caract\u00e8res.\nCharacterAdvancedView|chars|bool|Whether the character inventory opens in its advanced view (showing combined characters).|Si el inventario de caracteres se abre en su vista avanzada (que muestra los caracteres combinados).|Si l'inventaire de caract\u00e8res s'ouvre dans sa vue avanc\u00e9e (qui affiche les caract\u00e8res combin\u00e9s).\n# ---------------------------------------------------------------- punctuation\nValidPunctuation|punct|punct|Approved punctuation (punctuation inventory, Language settings). Each item shows its place in a word.|Puntuaci\u00f3n aprobada (inventario de puntuaci\u00f3n, Configuraci\u00f3n del idioma). Cada elemento muestra su posici\u00f3n en la palabra.|Ponctuation approuv\u00e9e (inventaire de ponctuation, Param\u00e8tres de langue). Chaque \u00e9l\u00e9ment montre sa place dans le mot.\nInvalidPunctuation|punct|punct|Disapproved punctuation (punctuation inventory): items reported as errors.|Puntuaci\u00f3n no aprobada (inventario de puntuaci\u00f3n): elementos que se se\u00f1alan como errores.|Ponctuation non approuv\u00e9e (inventaire de ponctuation) : \u00e9l\u00e9ments signal\u00e9s comme des erreurs.\nPunctuationCheckSetSeparately|punct|bool|Whether a separate set of approved punctuation is kept (the _NonText settings).|Si se mantiene un conjunto separado de puntuaci\u00f3n aprobada (la configuraci\u00f3n _NonText).|Si un ensemble s\u00e9par\u00e9 de ponctuation approuv\u00e9e est tenu (les param\u00e8tres _NonText).\nValidPunctuation_NonText|punct|punct|Approved punctuation of the separate punctuation inventory (see PunctuationCheckSetSeparately).|Puntuaci\u00f3n aprobada del inventario de puntuaci\u00f3n separado (ver PunctuationCheckSetSeparately).|Ponctuation approuv\u00e9e de l'inventaire de ponctuation s\u00e9par\u00e9 (voir PunctuationCheckSetSeparately).\nInvalidPunctuation_NonText|punct|punct|Disapproved punctuation of the separate punctuation inventory.|Puntuaci\u00f3n no aprobada del inventario de puntuaci\u00f3n separado.|Ponctuation non approuv\u00e9e de l'inventaire de ponctuation s\u00e9par\u00e9.\nPairs|punct|pairs|Matching pairs of punctuation, opening/closing, used by the matched pairs check, for example (/) for parentheses.|Pares de puntuaci\u00f3n que se corresponden, apertura/cierre, que usa la verificaci\u00f3n de pares, por ejemplo (/) para los par\u00e9ntesis.|Paires de ponctuation qui se correspondent, ouvrant/fermant, utilis\u00e9es par la v\u00e9rification des paires, par exemple (/) pour les parenth\u00e8ses.\nClosedByParagraph|punct|bool|Whether a matched pair must be closed before the end of the paragraph.|Si un par debe cerrarse antes del final del p\u00e1rrafo.|Si une paire doit \u00eatre ferm\u00e9e avant la fin du paragraphe.\nMatchedPairingCharacters|punct|list|Approved items of the unmatched pairs of punctuation inventory.|Elementos aprobados del inventario de puntuaci\u00f3n sin par coincidente.|\u00c9l\u00e9ments approuv\u00e9s de l'inventaire d'erreurs de ponctuation en paires correspondantes.\nUnmatchedPairingCharacters|punct|list|Disapproved items of the unmatched pairs of punctuation inventory.|Elementos no aprobados del inventario de puntuaci\u00f3n sin par coincidente.|\u00c9l\u00e9ments non approuv\u00e9s de l'inventaire d'erreurs de ponctuation en paires correspondantes.\nMatchedPairingCharacters_NonText|punct|list|Approved items of the separate unmatched pairs inventory.|Elementos aprobados del inventario separado de puntuaci\u00f3n sin par coincidente.|\u00c9l\u00e9ments approuv\u00e9s de l'inventaire s\u00e9par\u00e9 des paires correspondantes.\nUnmatchedPairingCharacters_NonText|punct|list|Disapproved items of the separate unmatched pairs inventory.|Elementos no aprobados del inventario separado de puntuaci\u00f3n sin par coincidente.|\u00c9l\u00e9ments non approuv\u00e9s de l'inventaire s\u00e9par\u00e9 des paires correspondantes.\nMatchedPairsCheckSetSeparately|punct|bool|Whether a separate set of approved matched pairs is kept (the _NonText settings).|Si se mantiene un conjunto separado de pares aprobados (la configuraci\u00f3n _NonText).|Si un ensemble s\u00e9par\u00e9 de paires approuv\u00e9es est tenu (les param\u00e8tres _NonText).\nSentenceFinalPunctuation|punct|list|Punctuation that ends a sentence.|Puntuaci\u00f3n que termina una oraci\u00f3n.|Ponctuation qui termine une phrase.\nCheckFinalPunctuationInFootnotes|punct|bool|Also check final punctuation in footnotes.|Verificar tambi\u00e9n la puntuaci\u00f3n final en las notas al pie.|V\u00e9rifier aussi la ponctuation finale dans les notes de bas de page.\nCheckFinalPunctuationInCrossRefs|punct|bool|Also check final punctuation in cross references.|Verificar tambi\u00e9n la puntuaci\u00f3n final en las referencias cruzadas.|V\u00e9rifier aussi la ponctuation finale dans les r\u00e9f\u00e9rences crois\u00e9es.\nCheckFinalPunctuationInFigures|punct|bool|Also check final punctuation in figure captions.|Verificar tambi\u00e9n la puntuaci\u00f3n final en los pies de ilustraciones.|V\u00e9rifier aussi la ponctuation finale dans les l\u00e9gendes d'illustrations.\nValidParagraphFinalPunctuationItems|punct|list|Approved paragraph endings: marker_punctuation, for example p_. = a \\p paragraph that ends with a period. A marker alone means that paragraph may end without punctuation.|Finales de p\u00e1rrafo aprobados: marcador_puntuaci\u00f3n, por ejemplo p_. = un p\u00e1rrafo \\p que termina con punto. Un marcador solo significa que ese p\u00e1rrafo puede terminar sin puntuaci\u00f3n.|Fins de paragraphe approuv\u00e9es : marqueur_ponctuation, par exemple p_. = un paragraphe \\p qui se termine par un point. Un marqueur seul signifie que ce paragraphe peut se terminer sans ponctuation.\nInvalidParagraphFinalPunctuationItems|punct|list|Disapproved paragraph endings, written the same way.|Finales de p\u00e1rrafo no aprobados, escritos de la misma manera.|Fins de paragraphe non approuv\u00e9es, \u00e9crites de la m\u00eame mani\u00e8re.\nAdvancedView|punct|bool|Whether the punctuation inventory opens in its advanced view.|Si el inventario de puntuaci\u00f3n se abre en su vista avanzada.|Si l'inventaire de ponctuation s'ouvre dans sa vue avanc\u00e9e.\n# ---------------------------------------------------------------- capitalization\nValidMixedCapitalization|caps|list|Approved words of the mixed capitalization inventory (words with capitals inside them).|Palabras aprobadas del inventario de combinaci\u00f3n de may\u00fasculas y min\u00fasculas (palabras con may\u00fasculas en medio).|Mots approuv\u00e9s de l'inventaire de mise en majuscules mixte (mots avec des majuscules \u00e0 l'int\u00e9rieur).\nInvalidMixedCapitalization|caps|list|Disapproved words of the mixed capitalization inventory.|Palabras no aprobadas del inventario de combinaci\u00f3n de may\u00fasculas y min\u00fasculas.|Mots non approuv\u00e9s de l'inventaire de mise en majuscules mixte.\nValidSentenceFinalPunctCapitalization|caps|list|Approved items of the \"Punctuation followed by a lower case letter\" inventory. \\0020 stands for a space.|Elementos aprobados del inventario \"Puntuaci\u00f3n seguida de una letra min\u00fascula\". \\0020 representa un espacio.|\u00c9l\u00e9ments approuv\u00e9s de l'\u00ab Inventaire des signes de ponctuation suivis d'une minuscule \u00bb. \\0020 repr\u00e9sente une espace.\nInvalidSentenceFinalPunctCapitalization|caps|list|Disapproved items of the \"Punctuation followed by a lower case letter\" inventory.|Elementos no aprobados del inventario \"Puntuaci\u00f3n seguida de una letra min\u00fascula\".|\u00c9l\u00e9ments non approuv\u00e9s de l'\u00ab Inventaire des signes de ponctuation suivis d'une minuscule \u00bb.\nAbbreviations|caps|list|Abbreviations (Punctuation followed by lower case / options): words whose final period does not end the sentence.|Abreviaturas (Puntuaci\u00f3n seguida de una letra min\u00fascula / opciones): palabras cuyo punto final no termina la oraci\u00f3n.|Abr\u00e9viations (Inventaire des signes de ponctuation suivis d'une minuscule / options) : mots dont le point final ne termine pas la phrase.\nCapitalizedPrefixes|caps|list|Prefixes that may come before the capital letter of a word, used by the capitalization check.|Prefijos que pueden ir antes de la may\u00fascula de una palabra; los usa la verificaci\u00f3n de may\u00fasculas.|Pr\u00e9fixes qui peuvent pr\u00e9c\u00e9der la majuscule d'un mot ; utilis\u00e9s par la v\u00e9rification des majuscules.\nUncapitalizedPrefixes|caps|list|Prefixes that stay in lower case before a capitalized word, used by the capitalization check.|Prefijos que quedan en min\u00fascula delante de una palabra con may\u00fascula; los usa la verificaci\u00f3n de may\u00fasculas.|Pr\u00e9fixes qui restent en minuscule devant un mot avec majuscule ; utilis\u00e9s par la v\u00e9rification des majuscules.\nCapitalizedSuffixes|caps|list|Suffixes taken into account by the capitalization check.|Sufijos que tiene en cuenta la verificaci\u00f3n de may\u00fasculas.|Suffixes pris en compte par la v\u00e9rification des majuscules.\nSentenceFinalAdvancedView|caps|bool|Whether the inventory of punctuation followed by a lower case letter opens in its advanced view.|Si el inventario de puntuaci\u00f3n seguida de una letra min\u00fascula se abre en su vista avanzada.|Si l'inventaire des signes de ponctuation suivis d'une minuscule s'ouvre dans sa vue avanc\u00e9e.\n# ---------------------------------------------------------------- markers\nPoeticStyles|markers|list|Markers of poetry lines.|Marcadores de versos de poes\u00eda.|Marqueurs des lignes de po\u00e9sie.\nIntroductionOutlineStyles|markers|list|Markers of the entries of an introduction outline.|Marcadores de las entradas del esquema de una introducci\u00f3n.|Marqueurs des entr\u00e9es du plan d'une introduction.\nValidUncapitalizedStyles|markers|list|Approved items of the \"Markers followed by lower case\" inventory: markers whose text may start with a lower case letter.|Elementos aprobados del inventario \"Marcadores seguidos de min\u00fasculas\": marcadores cuyo texto puede empezar con min\u00fascula.|\u00c9l\u00e9ments approuv\u00e9s de l'\u00ab Inventaire des marqueurs suivis d'une minuscule \u00bb : marqueurs dont le texte peut commencer par une minuscule.\nInvalidUncapitalizedStyles|markers|list|Disapproved items of the \"Markers followed by lower case\" inventory.|Elementos no aprobados del inventario \"Marcadores seguidos de min\u00fasculas\".|\u00c9l\u00e9ments non approuv\u00e9s de l'\u00ab Inventaire des marqueurs suivis d'une minuscule \u00bb.\nMarkersCheckedForFinalPunctuation|markers|list|Paragraph markers whose paragraphs are checked for final punctuation.|Marcadores de p\u00e1rrafo cuyos p\u00e1rrafos se verifican en cuanto a la puntuaci\u00f3n final.|Marqueurs de paragraphe dont les paragraphes sont v\u00e9rifi\u00e9s pour la ponctuation finale.\nMarkersStartingNewSentencesForFinalPunctuation|markers|list|Markers that start a new sentence, so that what comes before them must end with final punctuation.|Marcadores que comienzan una nueva oraci\u00f3n, de modo que lo que va antes debe terminar con puntuaci\u00f3n final.|Marqueurs qui commencent une nouvelle phrase, si bien que ce qui les pr\u00e9c\u00e8de doit se terminer par une ponctuation finale.\nMarkersSkippedForFinalPunctuation|markers|list|Markers skipped by the final punctuation check.|Marcadores que la verificaci\u00f3n de puntuaci\u00f3n final pasa por alto.|Marqueurs ignor\u00e9s par la v\u00e9rification de la ponctuation finale.\nMarkersRequiringSentenceFinalPunctuation|markers|list|Paragraph markers whose paragraphs must end with sentence-final punctuation.|Marcadores de p\u00e1rrafo cuyos p\u00e1rrafos deben terminar con puntuaci\u00f3n final de oraci\u00f3n.|Marqueurs de paragraphe dont les paragraphes doivent se terminer par une ponctuation de fin de phrase.\nIgnoreWhenFollowedByFinalPunctuationParameter|markers|list|Pairs of markers (this paragraph/next paragraph) where a missing final punctuation is not reported, for example q1/q2 for poetry lines that go on.|Pares de marcadores (este p\u00e1rrafo/p\u00e1rrafo siguiente) donde no se informa de la falta de puntuaci\u00f3n final, por ejemplo q1/q2 para versos que contin\u00faan.|Paires de marqueurs (ce paragraphe/paragraphe suivant) o\u00f9 une ponctuation finale manquante n'est pas signal\u00e9e, par exemple q1/q2 pour des lignes de po\u00e9sie qui continuent.\nFlagDeprecatedMarkers|markers|bool|Report deprecated markers.|Se\u00f1alar los marcadores obsoletos.|Signaler les marqueurs d\u00e9pr\u00e9ci\u00e9s.\nplatformScripture.validMarkers|hidden|list|Approved markers of the marker inventory in Platform.Bible.|Marcadores aprobados del inventario de marcadores en Platform.Bible.|Marqueurs approuv\u00e9s de l'inventaire de marqueurs dans Platform.Bible.\nplatformScripture.invalidMarkers|hidden|list|Disapproved markers of the marker inventory in Platform.Bible.|Marcadores no aprobados del inventario de marcadores en Platform.Bible.|Marqueurs non approuv\u00e9s de l'inventaire de marqueurs dans Platform.Bible.\nMarkerAdvancedView|markers|bool|Whether the marker inventory opens in its advanced view.|Si el inventario de marcadores se abre en su vista avanzada.|Si l'inventaire de marqueurs s'ouvre dans sa vue avanc\u00e9e.\n# ---------------------------------------------------------------- words\nRepeatableWords|words|list|Approved items of the repeated words inventory: words that may be written twice in a row.|Elementos aprobados del inventario de palabras repetidas: palabras que pueden escribirse dos veces seguidas.|\u00c9l\u00e9ments approuv\u00e9s de l'inventaire de mots r\u00e9p\u00e9t\u00e9s : mots qui peuvent \u00eatre \u00e9crits deux fois de suite.\nNonRepeatableWords|words|list|Disapproved items of the repeated words inventory.|Elementos no aprobados del inventario de palabras repetidas.|\u00c9l\u00e9ments non approuv\u00e9s de l'inventaire de mots r\u00e9p\u00e9t\u00e9s.\nWordPrefixes|words|list|Prefixes of the language (Language settings), used to find the stems of words.|Prefijos del idioma (Configuraci\u00f3n del idioma), que se usan para hallar las ra\u00edces de las palabras.|Pr\u00e9fixes de la langue (Param\u00e8tres de langue), utilis\u00e9s pour trouver les radicaux des mots.\nWordSuffixes|words|list|Suffixes of the language (Language settings), used to find the stems of words.|Sufijos del idioma (Configuraci\u00f3n del idioma), que se usan para hallar las ra\u00edces de las palabras.|Suffixes de la langue (Param\u00e8tres de langue), utilis\u00e9s pour trouver les radicaux des mots.\nWordlistRefreshBooksPresent|words|books|Books whose words were in the wordlist when it was last refreshed, one digit per book.|Libros cuyas palabras estaban en la lista de palabras la \u00faltima vez que se actualiz\u00f3, un d\u00edgito por libro.|Livres dont les mots figuraient dans la liste de mots lors de sa derni\u00e8re mise \u00e0 jour, un chiffre par livre.\nWordlistSelectedBookString|words|books|Books chosen for the wordlist, one digit per book.|Libros elegidos para la lista de palabras, un d\u00edgito por libro.|Livres choisis pour la liste de mots, un chiffre par livre.\nWordlistTimeLastRetrievedSelectedBookString|words|text|When the wordlist last read the chosen books.|Cu\u00e1ndo la lista de palabras ley\u00f3 por \u00faltima vez los libros elegidos.|Quand la liste de mots a lu pour la derni\u00e8re fois les livres choisis.\n# ---------------------------------------------------------------- numbers\nNumberDecimalPoint|numbers|text|\"Decimal point\" (Number settings).|\"Punto decimal\" (Configuraci\u00f3n de n\u00fameros).|S\u00e9parateur d\u00e9cimal (Param\u00e8tres de chiffres).\nNumberThousandsSeparator|numbers|text|\"Thousands separator\" (Number settings).|\"Separador de miles\" (Configuraci\u00f3n de n\u00fameros).|S\u00e9parateur des milliers (Param\u00e8tres de chiffres).\nNumberOrdinals|numbers|list|\"Ordinal\" (Number settings): letters that may follow (or precede) a number, as in 1st.|\"Ordinal\" (Configuraci\u00f3n de n\u00fameros): letras que pueden seguir (o preceder) a un n\u00famero, como en 1.\u00ba.|Ordinal (Param\u00e8tres de chiffres) : lettres qui peuvent suivre (ou pr\u00e9c\u00e9der) un nombre, comme dans 1er.\nNumberOrdinalType|numbers|text|Whether the ordinal letters are a suffix or a prefix (Number settings).|Si las letras ordinales son un sufijo o un prefijo (Configuraci\u00f3n de n\u00fameros).|Si les lettres ordinales sont un suffixe ou un pr\u00e9fixe (Param\u00e8tres de chiffres).\nNumberInitialPunctuation|numbers|text|\"Initial punctuation\" (Number settings): characters approved just before a number.|\"Puntuaci\u00f3n inicial\" (Configuraci\u00f3n de n\u00fameros): caracteres aprobados justo antes de un n\u00famero.|Ponctuation initiale (Param\u00e8tres de chiffres) : caract\u00e8res approuv\u00e9s juste avant un nombre.\nNumberMedialPunctuation|numbers|text|\"Medial punctuation\" (Number settings): characters approved between digits.|\"Puntuaci\u00f3n en medio\" (Configuraci\u00f3n de n\u00fameros): caracteres aprobados entre cifras.|Ponctuation m\u00e9diane (Param\u00e8tres de chiffres) : caract\u00e8res approuv\u00e9s entre des chiffres.\nNumberFinalPunctuation|numbers|text|\"Final punctuation\" (Number settings): characters approved just after a number.|\"Puntuaci\u00f3n final\" (Configuraci\u00f3n de n\u00fameros): caracteres aprobados justo despu\u00e9s de un n\u00famero.|Ponctuation finale (Param\u00e8tres de chiffres) : caract\u00e8res approuv\u00e9s juste apr\u00e8s un nombre.\nHindiUrduNumberGrouping|numbers|bool|\"Number grouping\" (Number settings): Yes = 12,34,56,789, No = 123,456,789.|\"Agrupaci\u00f3n de n\u00fameros\" (Configuraci\u00f3n de n\u00fameros): S\u00ed = 12,34,56,789, No = 123,456,789.|Groupement des chiffres (Param\u00e8tres de chiffres) : Oui = 12,34,56,789, Non = 123,456,789.\nNumberSpacing|numbers|text|\"Space before numbers\" and \"Space after numbers\" (Number settings), for example bothRequired.|\"Espacio antes de los n\u00fameros\" y \"Espacio despu\u00e9s de los n\u00fameros\" (Configuraci\u00f3n de n\u00fameros), por ejemplo bothRequired (ambos obligatorios).|Espace avant et apr\u00e8s les nombres (Param\u00e8tres de chiffres), par exemple bothRequired (les deux obligatoires).\nNumberSettingsHaveBeenReviewed|numbers|bool|The number settings have been reviewed.|La configuraci\u00f3n de n\u00fameros ya se revis\u00f3.|Les param\u00e8tres de chiffres ont \u00e9t\u00e9 v\u00e9rifi\u00e9s.\n# ---------------------------------------------------------------- scripture references\nChapterVerseSeparator|refs|text|\"Chapter/Verse\" (Scripture reference settings, Reference format tab): between chapter and verse, as in 3:16.|\"Cap\u00edtulo/Vers\u00edculo\" (Configuraci\u00f3n de referencias b\u00edblicas, pesta\u00f1a Formato de referencias): entre cap\u00edtulo y vers\u00edculo, como en 3:16.|\u00ab Chapitre/verset \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques, onglet Format de r\u00e9f\u00e9rence) : entre chapitre et verset, comme dans 3:16.\nRangeIndicator|refs|text|\"Verse range\" (Scripture reference settings): between the first and the last verse of a range, as in 3:16-18.|\"Rango de vers\u00edculos\" (Configuraci\u00f3n de referencias b\u00edblicas): entre el primer y el \u00faltimo vers\u00edculo de un rango, como en 3:16-18.|\u00ab Plage de versets \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : entre le premier et le dernier verset d'une plage, comme dans 3:16-18.\nSequenceIndicator|refs|text|\"Verse sequence\" (Scripture reference settings): between the verses of a list, as in 3:16, 18.|\"Lista de vers\u00edculos\" (Configuraci\u00f3n de referencias b\u00edblicas): entre los vers\u00edculos de una lista, como en 3:16, 18.|\u00ab Liste de versets \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : entre les versets d'une liste, comme dans 3:16, 18.\nChapterRangeSeparator|refs|text|\"Chapter or book range\" (Scripture reference settings): in a range that crosses chapters, as in 3:16\u20134:2.|\"Rango de cap\u00edtulos o libros\" (Configuraci\u00f3n de referencias b\u00edblicas): en un rango que pasa de un cap\u00edtulo a otro, como en 3:16\u20134:2.|Plage de chapitres ou de livres (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : dans une plage qui passe d'un chapitre \u00e0 l'autre, comme dans 3:16\u20134:2.\nChapterNumberSeparator|refs|text|\"Chapter sequence\" (Scripture reference settings): between references to different chapters of the same book, as in 3:16; 4:2.|\"Lista de cap\u00edtulos\" (Configuraci\u00f3n de referencias b\u00edblicas): entre referencias a cap\u00edtulos distintos del mismo libro, como en 3:16; 4:2.|\u00ab Liste des chapitres \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : entre des r\u00e9f\u00e9rences \u00e0 des chapitres diff\u00e9rents du m\u00eame livre, comme dans 3:16; 4:2.\nBookSequenceSeparator|refs|text|\"Book sequence\" (Scripture reference settings): between references to different books. Several choices are separated by \\|.|\"Lista de libros\" (Configuraci\u00f3n de referencias b\u00edblicas): entre referencias a libros distintos. Varias opciones se separan con \\|.|\u00ab Liste des livres \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : entre des r\u00e9f\u00e9rences \u00e0 des livres diff\u00e9rents. Plusieurs choix sont s\u00e9par\u00e9s par \\|.\nBookChapterSeparator|refs|text|\"Book/Chapter\" (Scripture reference settings): between the book name and the chapter number.|\"Libro/Cap\u00edtulo\" (Configuraci\u00f3n de referencias b\u00edblicas): entre el nombre del libro y el n\u00famero del cap\u00edtulo.|\u00ab Livre/Chapitre \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : entre le nom du livre et le num\u00e9ro du chapitre.\nNoSpaceBetweenBookAndChapter|refs|bool|No space between the book name and the chapter number.|Sin espacio entre el nombre del libro y el n\u00famero del cap\u00edtulo.|Pas d'espace entre le nom du livre et le num\u00e9ro du chapitre.\nReferenceFinalPunctuation|refs|text|\"Final punctuation\" (Scripture reference settings): punctuation at the end of a list of references.|\"Puntuaci\u00f3n final\" (Configuraci\u00f3n de referencias b\u00edblicas): puntuaci\u00f3n al final de una lista de referencias.|\u00ab Ponctuation finale \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : ponctuation \u00e0 la fin d'une liste de r\u00e9f\u00e9rences.\nReferenceExtraMaterial|refs|text|\"Extra material\" (Scripture reference settings): extra words allowed in references, separated by \\|, for example (LXX).|\"Material extra\" (Configuraci\u00f3n de referencias b\u00edblicas): palabras adicionales permitidas en las referencias, separadas por \\|, por ejemplo (LXX).|\u00ab Mat\u00e9riel suppl\u00e9mentaire \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques) : mots suppl\u00e9mentaires autoris\u00e9s dans les r\u00e9f\u00e9rences, s\u00e9par\u00e9s par \\|, par exemple (LXX).\nBookSourceForMarkerXt|refs|text|\"Cross references (\\xt) use\" (Scripture reference settings, Book names tab): which book name is used in \\xt references: Abbreviation, ShortName or LongName.|\"Referencias cruzadas (\\xt) utilice\" (Configuraci\u00f3n de referencias b\u00edblicas, pesta\u00f1a Nombres de libros): qu\u00e9 nombre de libro se usa en las referencias \\xt: Abbreviation (abreviatura), ShortName (nombre corto) o LongName (nombre largo).|\u00ab Utilisation des renvois (\\xt) \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques, onglet Noms de livre) : quel nom de livre est utilis\u00e9 dans les r\u00e9f\u00e9rences \\xt : Abbreviation (abr\u00e9viation), ShortName (nom court) ou LongName (nom long).\nBookSourceForMarkerR|refs|text|Book names tab of Scripture reference settings: which book name is used in parallel passage references (\\r): Abbreviation, ShortName or LongName.|Pesta\u00f1a Nombres de libros de Configuraci\u00f3n de referencias b\u00edblicas: qu\u00e9 nombre de libro se usa en las referencias de pasajes paralelos (\\r): Abbreviation, ShortName o LongName.|Onglet Noms de livre des Param\u00e8tres des r\u00e9f\u00e9rences bibliques : quel nom de livre est utilis\u00e9 dans les r\u00e9f\u00e9rences de passages parall\u00e8les (\\r) : Abbreviation, ShortName ou LongName.\nOriginRangeOption|refs|text|Origin options tab of Scripture reference settings: where a note whose \\fr or \\xo gives a verse range must be placed: in the first verse of the range, the last verse, any verse (NoteInAnyVerse), or only where the reference matches the verse exactly (MatchVerseExactly).|Pesta\u00f1a Opciones de origen de Configuraci\u00f3n de referencias b\u00edblicas: d\u00f3nde debe ponerse una nota cuyo \\fr o \\xo da un rango de vers\u00edculos: en el primer vers\u00edculo del rango, en el \u00faltimo, en cualquiera (NoteInAnyVerse), o solo donde la referencia coincide exactamente con el vers\u00edculo (MatchVerseExactly).|Onglet Options d'origine des Param\u00e8tres des r\u00e9f\u00e9rences bibliques : o\u00f9 doit se trouver une note dont le \\fr ou le \\xo donne une plage de versets : dans le premier verset de la plage, le dernier, n'importe lequel (NoteInAnyVerse), ou seulement l\u00e0 o\u00f9 la r\u00e9f\u00e9rence correspond exactement au verset (MatchVerseExactly).\nRefsMustMatchVerseSegments|refs|bool|\"Referenced verse segments must be in text\" (Scripture reference settings).|\"Los segmentos del vers\u00edculos referenciados deben estar en texto\" (Configuraci\u00f3n de referencias b\u00edblicas).|\u00ab Les segments de verset r\u00e9f\u00e9renc\u00e9s doivent \u00eatre dans le texte \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques).\nSegmentsMustHaveFinalPunctuation|refs|bool|\"Final punctuation must end each \\xt section in all cross references\" (Scripture reference settings).|\"Puntuaci\u00f3n final debe terminar cada secci\u00f3n \\xt en todas las referencias cruzadas\" (Configuraci\u00f3n de referencias b\u00edblicas).|\u00ab Une ponctuation finale doit terminer chaque section \\xt dans tous les renvois \u00bb (Param\u00e8tres des r\u00e9f\u00e9rences bibliques).\nCrossReferenceSettingsHaveBeenReviewed|refs|bool|The Scripture reference settings have been reviewed.|La configuraci\u00f3n de referencias b\u00edblicas ya se revis\u00f3.|Les param\u00e8tres des r\u00e9f\u00e9rences bibliques ont \u00e9t\u00e9 v\u00e9rifi\u00e9s.\nNoteReferenceSeparator|refs|text|Between chapter and verse in the origin reference of notes.|Entre cap\u00edtulo y vers\u00edculo en la referencia de origen de las notas.|Entre chapitre et verset dans la r\u00e9f\u00e9rence d'origine des notes.\n# ---------------------------------------------------------------- footnotes and cross references\nDefaultFootnoteCaller|notes|text|Caller of new footnotes: + = letters chosen automatically, - = no caller, or a fixed character.|Llamada de las nuevas notas al pie: + = letras autom\u00e1ticas, - = sin llamada, o un car\u00e1cter fijo.|Appel des nouvelles notes de bas de page : + = lettres automatiques, - = pas d'appel, ou un caract\u00e8re fixe.\nDefaultCrossRefCaller|notes|text|Caller of new cross references: + = automatic, - = no caller, or a fixed character.|Llamada de las nuevas referencias cruzadas: + = autom\u00e1tica, - = sin llamada, o un car\u00e1cter fijo.|Appel des nouvelles r\u00e9f\u00e9rences crois\u00e9es : + = automatique, - = pas d'appel, ou un caract\u00e8re fixe.\nCallerSequence|notes|list|Characters used in turn as automatic note callers.|Caracteres que se usan por turno como llamadas autom\u00e1ticas de notas.|Caract\u00e8res utilis\u00e9s \u00e0 tour de r\u00f4le comme appels de notes automatiques.\n# ---------------------------------------------------------------- biblical terms and interlinear\nBiblicalTermsListSetting|terms|text|\"Biblical terms list\" (Project properties, Associations tab), as type:project:file. Major::BiblicalTerms.xml is the standard major terms list.|\"Lista de vocablos b\u00edblicos\" (Propiedades del proyecto, pesta\u00f1a Asociaciones), como tipo:proyecto:archivo. Major::BiblicalTerms.xml es la lista est\u00e1ndar de vocablos principales.|\u00ab Liste des termes bibliques \u00bb (Propri\u00e9t\u00e9s du projet, onglet Associations), sous la forme type:projet:fichier. Major::BiblicalTerms.xml est la liste standard des termes principaux.\nMatchBasedOnStems|terms|bool|\"Match based on stems\" (Project properties, Associations tab): renderings of biblical terms are found by word stems.|\"Relacionar basado en ra\u00edces\" (Propiedades del proyecto, pesta\u00f1a Asociaciones): las traducciones de vocablos b\u00edblicos se buscan por ra\u00edces.|\u00ab Correspondance bas\u00e9e sur les radicaux \u00bb (Propri\u00e9t\u00e9s du projet, onglet Associations) : les rendus des termes bibliques sont trouv\u00e9s par les radicaux.\nAssociatedLexicalProject|terms|text|\"Associated lexical project (FLEx)\" (Project properties, Associations tab).|\"Proyecto l\u00e9xico asociado (FLEx)\" (Propiedades del proyecto, pesta\u00f1a Asociaciones).|Projet de lexique associ\u00e9 (FLEx) (Propri\u00e9t\u00e9s du projet, onglet Associations).\nFlexIntegrationMode|terms|text|How the interlinearizer uses the associated lexical project (Project properties, Associations tab).|C\u00f3mo usa el interlineal el proyecto l\u00e9xico asociado (Propiedades del proyecto, pesta\u00f1a Asociaciones).|Comment l'interlin\u00e9aire utilise le projet de lexique associ\u00e9 (Propri\u00e9t\u00e9s du projet, onglet Associations).\nP6TermsImported|terms|bool|The biblical terms renderings from Paratext 6 have been imported.|Se importaron las traducciones de vocablos b\u00edblicos de Paratext 6.|Les rendus des termes bibliques de Paratext 6 ont \u00e9t\u00e9 import\u00e9s.\nInterlinearModelText|terms|text|Model text used by the interlinearizer.|Texto modelo que usa el interlineal.|Texte mod\u00e8le utilis\u00e9 par l'interlin\u00e9aire.\nInterlinearModelTextId|terms|text|Identifier of the interlinearizer's model text.|Identificador del texto modelo del interlineal.|Identifiant du texte mod\u00e8le de l'interlin\u00e9aire.\nGuessTranslationsDestinationText|terms|text|Text last chosen to receive guessed translations from the interlinearizer.|Texto elegido por \u00faltima vez para recibir las traducciones adivinadas del interlineal.|Texte choisi en dernier pour recevoir les traductions devin\u00e9es de l'interlin\u00e9aire.\nInterlinearConversionCompletedBy|terms|text|User who converted the project's interlinear data.|Usuario que convirti\u00f3 los datos interlineales del proyecto.|Utilisateur qui a converti les donn\u00e9es interlin\u00e9aires du projet.\nInterlinearRelatedLanguages.*|terms|bool|Interlinearizer with the model text {0}: whether the two languages are related.|Interlineal con el texto modelo {0}: si los dos idiomas est\u00e1n relacionados.|Interlin\u00e9aire avec le texte mod\u00e8le {0} : si les deux langues sont apparent\u00e9es.\nInterlinearExportText.*|terms|text|Interlinearizer with the model text {0}: the text into which approved glosses are exported.|Interlineal con el texto modelo {0}: el texto al que se exportan las glosas aprobadas.|Interlin\u00e9aire avec le texte mod\u00e8le {0} : le texte dans lequel les gloses approuv\u00e9es sont export\u00e9es.\nInterlinearExportTextId.*|terms|text|Interlinearizer with the model text {0}: identifier of the export text.|Interlineal con el texto modelo {0}: identificador del texto de exportaci\u00f3n.|Interlin\u00e9aire avec le texte mod\u00e8le {0} : identifiant du texte d'exportation.\nInterlinearExportOnApprove.*|terms|bool|Interlinearizer with the model text {0}: export each gloss as soon as it is approved.|Interlineal con el texto modelo {0}: exportar cada glosa en cuanto se aprueba.|Interlin\u00e9aire avec le texte mod\u00e8le {0} : exporter chaque glose d\u00e8s qu'elle est approuv\u00e9e.\n# ---------------------------------------------------------------- study Bible\nSBCategories|studybible|list|Categories of the study Bible's notes (\"Categories\", Project properties, Study Bible tab).|Categor\u00edas de las notas de la Biblia de estudio (\"Categor\u00edas\", Propiedades del proyecto, pesta\u00f1a Biblia de estudio).|Cat\u00e9gories des notes de la Bible d'\u00e9tude (\u00ab Cat\u00e9gories \u00bb, Propri\u00e9t\u00e9s du projet, onglet Bible d'\u00e9tude).\nSBSidebarOnlyCategories|studybible|list|Categories shown only in sidebars.|Categor\u00edas que solo se muestran en barras laterales.|Cat\u00e9gories affich\u00e9es seulement dans les encadr\u00e9s.\nSBFootnoteOnlyCategories|studybible|list|Categories shown only in footnotes.|Categor\u00edas que solo se muestran en notas al pie.|Cat\u00e9gories affich\u00e9es seulement dans les notes de bas de page.\nSBEmptyCategories|studybible|list|Categories that are not used yet.|Categor\u00edas que todav\u00eda no se usan.|Cat\u00e9gories qui ne sont pas encore utilis\u00e9es.\nSBSourceAdditionsProjectId|studybible|text|Identifier of the study Bible's additions project (\"Additions\" tab).|Identificador del proyecto de adiciones de la Biblia de estudio (pesta\u00f1a \"Adiciones\").|Identifiant du projet d'annexes de la Bible d'\u00e9tude (onglet \u00ab Annexes \u00bb).\n# ---------------------------------------------------------------- Publishing Assistant\nPaOriginalStylesheetName|publishing|text|Stylesheet that Publishing Assistant started from.|Hoja de estilo de la que parti\u00f3 Publishing Assistant.|Feuille de style dont Publishing Assistant est parti.\npp*|publishing|text|Publishing Assistant layout setting: {0}.|Configuraci\u00f3n de dise\u00f1o de Publishing Assistant: {0}.|Param\u00e8tre de mise en page de Publishing Assistant : {0}.\n# ---------------------------------------------------------------- custom checks (after the .cms options)\n*.cms_parameter1|cms|text|Value last entered for the custom check {0}.|\u00daltimo valor introducido para la verificaci\u00f3n personalizada {0}.|Derni\u00e8re valeur saisie pour la v\u00e9rification personnalis\u00e9e {0}.\nErr_*|cmsmsg|text|Text of a check's message ({0}): the words shown in the results.|Texto de un mensaje de una verificaci\u00f3n ({0}): las palabras que se muestran en los resultados.|Texte d'un message d'une v\u00e9rification ({0}) : les mots affich\u00e9s dans les r\u00e9sultats.\n";
const PS_USFM_STY = "# Version=3.0.11\n# ********************************************************************\n# * usfm.sty is the default stylesheet for Paratext projects         *\n# *   using USFM markup.                                             *\n# * Latest documentation and stylesheets are maintained at:          *\n# *   http://markups.paratext.org/usfm                               *\n# ********************************************************************\n\n# File Identification\n\n\\Marker id\n\\Name id - File - Identification\n\\Description File identification information (BOOKID, FILENAME, EDITOR, MODIFICATION DATE)\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular book\n\\FontSize 12\n\n\\Marker usfm\n\\Name usfm - File - USFM Version ID\n\\Description File markup version information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n\\Marker ide\n\\Name ide - File - Encoding\n\\Description File encoding information\n\\OccursUnder id\n\\Rank 1\n\\StyleType Paragraph\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\FontSize 12\n\n# Headers\n\n\\Marker h\n\\Name h - File - Header\n\\Description Running header text for a book (basic)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h1\n\\Name DEPRECATED h1 - File - Header\n\\Description Running header text\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h2\n\\Name DEPRECATED h2 - File - Left Header\n\\Description Running header text, left side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker h3\n\\Name DEPRECATED h3 - File - Right Header\n\\Description Running header text, right side of page\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker toc1\n\\Name toc1 - File - Long Table of Contents Text\n\\Description Long table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Bold\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc2\n\\Name toc2 - File - Short Table of Contents Text\n\\Description Short table of contents text\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Color 16384\n#!\\ColorName highcon green\n\n\\Marker toc3\n\\Name toc3 - File - Book Abbreviation\n\\Description Book Abbreviation\n\\OccursUnder h h1 h2 h3 id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Italic\n\\Color 128\n#!\\ColorName lowcon red\n\n\\Marker toca1\n\\Name toca1 - File - Alternative Language Long Table of Contents Text\n\\Description Alternative language long table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca2\n\\Name toca2 - File - Alternative Language Short Table of Contents Text\n\\Description Alternative language short table of contents text\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n\\Marker toca3\n\\Name toca3 - File - Alternative Language Book Abbreviation\n\\Description Alternative language book Abbreviation\n\\OccursUnder h h1 h2 h3\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 10\n\\Italic\n\\Color 8421504\n#!\\ColorName gray\n\n# Remarks and Comments\n\n\\Marker rem\n\\Name rem - File - Remark\n\\Description Comments and remarks\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker sts\n\\Name sts - File - Status\n\\Description Status of this file\n\\OccursUnder id ide c\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker restore\n\\Name restore - File - Restore Information\n\\Description Project restore information\n\\OccursUnder id\n\\Rank 99\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Introduction\n\n\\Marker imt\n\\Name imt - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt1\n\\Name imt1 - Introduction - Major Title Level 1\n\\Description Introduction major title, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imt2\n\\Name imt2 - Introduction - Major Title Level 2\n\\Description Introduction major title, level 2\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType other\n\\StyleType Paragraph\n\\FontSize 13\n\\Italic\n\\Justification Center\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker imt3\n\\Name imt3 - Introduction - Major Title Level 3\n\\Description Introduction major title, level 3\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker imt4\n\\Name imt4 - Introduction - Major Title Level 4\n\\Description Introduction major title, level 4 (usually within parenthesis)\n\\OccursUnder id\n\\Rank 5\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Other\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n \n\\Marker imte\n\\Name imte - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte1\n\\Name imte1 - Introduction - [Uncommon] Major Title at Introduction End Level 1\n\\Description Introduction major title at introduction end, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker imte2\n\\Name imte2 - Introduction - [Uncommon] Major Title at Introduction End Level 2\n\\Description Introduction major title at introduction end, level 2\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Other\n\\OccursUnder id\n\\Rank 7\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2 \n\n\\Marker is\n\\Name is - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if single level) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is1 \n\\Name is1 - Introduction - Section Heading Level 1\n\\Description Introduction section heading, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker is2\n\\Name is2 - Introduction - Section Heading Level 2\n\\Description Introduction section heading, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker iot \n\\Name iot - Introduction - Outline Title\n\\Description Introduction outline title (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker io\n\\Name io - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io1\n\\Name io1 - Introduction - Outline Level 1\n\\Description Introduction outline text, level 1 (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\n\\Marker io2\n\\Name io2 - Introduction - Outline Level 2\n\\Description Introduction outline text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\n\\Marker io3\n\\Name io3 - Introduction - Outline Level 3\n\\Description Introduction outline text, level 3 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\n\\Marker io4\n\\Name io4 - Introduction - Outline Level 4\n\\Description Introduction outline text, level 4 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\n\\Marker ior\n\\Endmarker ior*\n\\Name ior...ior* - Introduction - Outline References Range\n\\Description Introduction references range for outline entry; for marking references separately\n\\OccursUnder id io io1 io2 io3 io4 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ip\n\\Name ip - Introduction - Paragraph\n\\Description Introduction prose paragraph (basic)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker im\n\\Name im - Introduction - Paragraph - no first line indent\n\\Description Introduction prose paragraph, with no first line indent (may occur after poetry)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker ipi\n\\Name ipi - Introduction - Indented Para - first line indent\n\\Description Introduction prose paragraph, indented, with first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker imi\n\\Name imi - Introduction - Indented Para - no first line indent\n\\Description Introduction prose paragraph text, indented, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker ili\n\\Name ili - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili1\n\\Name ili1 - Introduction - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker ili2\n\\Name ili2 - Introduction - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker ipq\n\\Name ipq - Introduction - Paragraph - quote from text\n\\Description Introduction prose paragraph, quote from the body text\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\Italic\n\n\\Marker imq\n\\Name imq - Introduction - Paragraph - quote from text - no first line indent\n\\Description Introduction prose paragraph, quote from the body text, with no first line indent\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Italic\n\n\\Marker ipr\n\\Name ipr - Introduction - Paragraph - right aligned\n\\Description Introduction prose paragraph, right aligned\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\\Justification Right\n\\Italic\n\n\\Marker ib\n\\Name ib - Introduction - Blank Line\n\\Description Introduction blank line\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker iq\n\\Name iq - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if single level)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq1\n\\Name iq1 - Introduction - Poetry Level 1\n\\Description Introduction poetry text, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq2\n\\Name iq2 - Introduction - Poetry Level 2\n\\Description Introduction poetry text, level 2 \n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iq3\n\\Name iq3 - Introduction - Poetry Level 3\n\\Description Introduction poetry text, level 3\n\\OccursUnder id\n\\Rank 6\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\\Italic\n\n\\Marker iex\n\\Name iex - Introduction - Explanatory or Bridge Text\n\\Description Introduction explanatory or bridge text (e.g. explanation of missing book in Short Old Testament)\n\\OccursUnder id c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker iqt\n\\Endmarker iqt*\n\\Name iqt...iqt* - Special Text - Quoted Scripture Text in Introduction\n\\Description For quoted scripture text appearing in the introduction\n\\OccursUnder imt imt1 imt2 imt3 imt4 ib ie ili ili1 ili2 im imi imq io io1 io2 io3 io4 iot ip ipi ipq ipr iq iq1 iq2 iq3 is is1 is2 imte imte1 imte2 iex\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ie\n\\Name ie - Introduction - End Marker\n\\Description Introduction ending marker\n\\OccursUnder id\n\\Rank 6\n\\TextProperties paragraph publishable vernacular\n\\TextType Other\n\\FontSize 10\n\\StyleType paragraph\n\n# Chapters and Verses\n\n\\Marker c\n\\Name c - Chapter Number\n\\Description Chapter number (necessary for normal Paratext operation)\n\\OccursUnder id\n\\Rank 8\n\\TextType ChapterNumber\n\\TextProperties chapter\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker ca\n\\Endmarker ca*\n\\Name ca...ca* - Chapter Number - Alternate\n\\Description Second (alternate) chapter number (for coding dual versification; useful for places where different traditions of chapter breaks need to be supported in the same translation)\n\\OccursUnder c \n\\TextType Other\n\\StyleType Character\n\\Italic\n\\FontSize 16\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker cp\n\\Name cp - Chapter Number - Publishing Alternate\n\\Description Published chapter number (chapter string that should appear in the published text)\n\\OccursUnder c \n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker cl\n\\Name cl - Chapter - Publishing Label\n\\Description Chapter label used for translations that add a word such as \"Chapter\" before chapter numbers (e.g. Psalms). The subsequent text is the chapter label.\n\\OccursUnder id c ms ms1 ms2 ms3 mr\n\\TextType Other\n\\TextProperties paragraph\n\\StyleType Paragraph\n\\Bold\n\\FontSize 18\n\\SpaceBefore 8\n\\SpaceAfter 4\n\\Justification Center\n\n\\Marker cd\n\\Name cd - Chapter - Description\n\\Description Chapter Description (Publishing option D, e.g. in Russian Bibles)\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 11\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker v\n\\Name v - Verse Number\n\\Description A verse number (Necessary for normal paratext operation) (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType VerseNumber\n\\TextProperties verse\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker va\n\\Endmarker va*\n\\Name va...va* - Verse Number - Alternate\n\\Description Second (alternate) verse number (for coding dual numeration in Psalms; see also NRSV Exo 22.1-4)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 2263842\n#!\\ColorName green\n\n\\Marker vp\n\\Endmarker vp*\n\\Name vp...vp* - Verse Number - Publishing Alternate\n\\Description Published verse marker (verse string that should appear in the published text)\n\\OccursUnder cd lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 s3 d sp\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Paragraphs\n\n\\Marker p\n\\Name p - Paragraph - Normal - First Line Indent\n\\Description Paragraph text, with first line indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker m\n\\Name m - Paragraph - Margin - No First Line Indent\n\\Description Paragraph text, with no first line indent (may occur after poetry) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker po\n\\Name po - Paragraph - Letter Opening\n\\Description Letter opening\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker pr\n\\Name pr - Paragraph - Text Refrain (right aligned)\n\\Description Text refrain (paragraph text, right aligned)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\n\\Marker cls\n\\Name cls - Paragraph - Letter Closing\n\\Description Letter Closing\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker pmo\n\\Name pmo - Paragraph - Embedded Text Opening\n\\Description Embedded text opening\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pm\n\\Name pm - Paragraph - Embedded Text\n\\Description Embedded text paragraph\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po psi q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmc\n\\Name pmc - Paragraph - Embedded Text Closing\n\\Description Embedded text closing\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pmr\n\\Name pmr - Paragraph - Embedded Text Refrain\n\\Description Embedded text refrain (e.g. Then all the people shall say, \"Amen!\")\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr b s1 s2 s3 s4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi\n\\Name pi - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if single level), with first line indent; often used for discourse (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi1\n\\Name pi1 - Paragraph - Indented - Level 1 - First Line Indent\n\\Description Paragraph text, level 1 indent (if multiple levels), with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker pi2\n\\Name pi2 - Paragraph - Indented - Level 2 - First Line Indent\n\\Description Paragraph text, level 2 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .5\n\\RightMargin .25\n\n\\Marker pi3\n\\Name pi3 - Paragraph - Indented - Level 3 - First Line Indent\n\\Description Paragraph text, level 3 indent, with first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .75\n\\RightMargin .25\n\n\\Marker pc\n\\Name pc - Paragraph - Centered (for Inscription)\n\\Description Paragraph text, centered (for Inscription)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Center\n\\FontSize 12\n\n\\Marker mi\n\\Name mi - Paragraph - Indented - No First Line Indent\n\\Description Paragraph text, indented, with no first line indent; often used for discourse\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .25\n\\RightMargin .25\n\n\\Marker nb\n\\Name nb - Paragraph - No Break with Previous Paragraph\n\\Description Paragraph text, with no break from previous paragraph text (at chapter boundary) (basic)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n# Poetry\n\n\\Marker q\n\\Name q - Poetry - Indent Level 1 - Single Level Only\n\\Description Poetry text, level 1 indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q1\n\\Name q1 - Poetry - Indent Level 1\n\\Description Poetry text, level 1 indent (if multiple levels) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.5  # 1/8 inch indent, 3/4 inch wrap\n\n\\Marker q2\n\\Name q2 - Poetry - Indent Level 2\n\\Description Poetry text, level 2 indent (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.375  # 1/4 inch indent, 3/4 inch wrap\n\n\\Marker q3\n\\Name q3 - Poetry - Indent Level 3\n\\Description Poetry text, level 3 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.25 # 3/8 inch indent, 3/4 inch wrap\n\n\\Marker q4\n\\Name q4 - Poetry - Indent Level 4\n\\Description Poetry text, level 4 indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 0.75\n\\FirstLineIndent -0.125 # 1/2 inch indent, 3/4 inch wrap\n\n\\Marker qc\n\\Name qc - Poetry - Centered\n\\Description Poetry text, centered\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\n\\Marker qr\n\\Name qr - Poetry - Right Aligned\n\\Description Poetry text, Right Aligned\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Right\n\n\\Marker qs\n\\Endmarker qs*\n\\Name qs...qs* - Poetry Text - Selah\n\\Description Poetry text, Selah\n\\OccursUnder q q1 q2 q3 q4 qc qr qd NEST\n\\Rank 4\n\\TextType VerseText\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qa\n\\Name qa - Poetry - Acrostic Heading/Marker\n\\Description Poetry text, Acrostic marker/heading\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\n\\Marker qac\n\\Endmarker qac*\n\\Name qac...qac* - Poetry Text - Acrostic Letter\n\\Description Poetry text, Acrostic markup of the first character of a line of acrostic poetry\n\\OccursUnder q q1 q2 q3 q4 qc qr  NEST\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable vernacular poetic\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker qm\n\\Name qm - Poetry - Embedded Text - Indent Level 1 - Single Level Only\n\\Description Poetry text, embedded, level 1 indent (if single level)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm1\n\\Name qm1 - Poetry - Embedded Text - Indent Level 1\n\\Description Poetry text, embedded, level 1 indent (if multiple levels)\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.75  # 1/4 inch indent, 1 inch wrap\n\n\\Marker qm2\n\\Name qm2 - Poetry - Embedded Text - Indent Level 2\n\\Description Poetry text, embedded, level 2 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.5  # 1/2 inch indent, 1 inch wrap\n\n\\Marker qm3\n\\Name qm3 - Poetry - Embedded Text - Indent Level 3\n\\Description Poetry text, embedded, level 3 indent\n\\OccursUnder m mi nb p pc ph phi pi pi1 pi2 pi3 pr q q1 q2 q3 q4 qc qr b\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.25 # 3/4 inch indent, 1 inch wrap\n\n\\Marker qd\n\\Name qd - Poetry - Hebrew Note\n\\Description A Hebrew musical performance annotation, similar in content to Hebrew descriptive title.\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular poetic\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\LeftMargin .25\n\n\\Marker b\n\\Name b - Poetry - Stanza Break (Blank Line)\n\\Description Poetry text stanza break (e.g. stanza break) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n# Titles & Headings\n\n\\Marker mt\n\\Name mt - Title - Major Title Level 1\n\\Description The main title of the book (if single level)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mt1\n\\Name mt1 - Title - Major Title Level 1\n\\Description The main title of the book (if multiple levels) (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 4\n\n\\Marker mt2\n\\Name mt2 - Title - Major Title Level 2\n\\Description A secondary title usually occurring before the main title (basic)\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker mt3\n\\Name mt3 - Title - Major Title Level 3\n\\Description A secondary title occurring after the main title\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_3\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 16\n\\Bold\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mt4\n\\Name mt4 - Title - Major Title level 4\n\\Description A small secondary title sometimes occurring within parentheses\n\\OccursUnder id\n\\Rank 3\n\\TextProperties paragraph publishable vernacular level_4\n\\TextType Title\n\\StyleType Paragraph\n\\FontSize 12\n\\Justification Center\n\\SpaceBefore 2\n\\SpaceAfter 2\n\n\\Marker mte\n\\Name mte - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if single level)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder c\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker mte1\n\\Name mte1 - Title - [Uncommon] Major Title Ending Level 1\n\\Description The main title of the book repeated at the end of the book, level 1 (if multiple levels)\n\\TextProperties paragraph publishable vernacular level_1\n\\TextType Title\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tc1 tc2 tc3 tc4 s3 d\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 20\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n \n\\Marker mte2\n\\Name mte2 - Title - [Uncommon] Major Title Ending Level 2\n\\Description A secondary title occurring before or after the 'ending' main title\n\\TextProperties paragraph publishable vernacular level_2\n\\TextType Title\n\\OccursUnder mte1\n\\Rank 2\n\\StyleType Paragraph\n\\FontSize 16\n\\Italic\n\\Justification Center\n\\SpaceAfter 2\n\n\\Marker ms\n\\Name ms - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms1\n\\Name ms1 - Heading - Major Section Level 1\n\\Description A major section division heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms2\n\\Name ms2 - Heading - Major Section Level 2\n\\Description A major section division heading, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker ms3\n\\Name ms3 - Heading - Major Section Level 3\n\\Description A major section division heading, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 14\n\\Italic\n\\Justification Center\n\\SpaceBefore 16\n\\SpaceAfter 4\n\n\\Marker mr\n\\Name mr - Heading - Major Section Range References\n\\Description A major section division references range heading (basic)\n\\OccursUnder ms ms1 ms2 ms3\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker s\n\\Name s - Heading - Section Level 1\n\\Description A section heading, level 1 (if single level) (basic)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s1\n\\Name s1 - Heading - Section Level 1\n\\Description A section heading, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s2\n\\Name s2 - Heading - Section Level 2\n\\Description A section heading, level 2 (e.g. Proverbs 22-24)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker s3\n\\Name s3 - Heading - Section Level 3\n\\Description A section heading, level 3 (e.g. Genesis \"The First Day\")\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker s4\n\\Name s4 - Heading - Section Level 4\n\\Description A section heading, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 6\n\\SpaceAfter 3\n\n\\Marker sr\n\\Name sr - Heading - Section Range References\n\\Description A section division references range heading\n\\OccursUnder s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Bold\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker r\n\\Name r - Heading - Parallel References\n\\Description Parallel reference(s) (basic)\n\\OccursUnder c s s1 s2 s3 s4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceAfter 4\n\n\\Marker sp\n\\Name sp - Label - Speaker\n\\Description A heading, to identify the speaker (e.g. Job)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Left\n\\SpaceBefore 8\n\\SpaceAfter 4\n\n\\Marker d\n\\Name d - Label - Descriptive Title - Hebrew Subtitle\n\\Description A Hebrew text heading, to provide description (e.g. Psalms)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\FontSize 12\n\\Italic\n\\Justification Center\n\\SpaceBefore 4\n\\SpaceAfter 4\n\n\\Marker sd\n\\Name sd - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd1\n\\Name sd1 - Label - Semantic Division Location - Level 1\n\\Description Vertical space used to divide the text into sections, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType Paragraph\n\\SpaceBefore 24\n\\SpaceAfter 24\n\n\\Marker sd2\n\\Name sd2 - Label - Semantic Division Location - Level 2\n\\Description Vertical space used to divide the text into sections, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType Paragraph\n\\SpaceBefore 18\n\\SpaceAfter 18\n\n\\Marker sd3\n\\Name sd3 - Label - Semantic Division Location - Level 3\n\\Description Vertical space used to divide the text into sections, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType Paragraph\n\\SpaceBefore 12\n\\SpaceAfter 12\n\n\\Marker sd4\n\\Name sd4 - Label - Semantic Division Location - Level 4\n\\Description Vertical space used to divide the text into sections, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType Section\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType Paragraph\n\\SpaceBefore 8\n\\SpaceAfter 8\n\n# Tables\n\n\\Marker tr\n\\Name tr - Table - Row\n\\Description A new table row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker th1 \n\\Name th1 - Table - Column 1 Heading\n\\Description A table heading, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th2\n\\Name th2 - Table - Column 2 Heading\n\\Description A table heading, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th3\n\\Name th3 - Table - Column 3 Heading\n\\Description A table heading, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th4\n\\Name th4 - Table - Column 4 Heading\n\\Description A table heading, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th5\n\\Name th5 - Table - Column 5 Heading\n\\Description A table heading, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th6\n\\Name th6 - Table - Column 6 Heading\n\\Description A table heading, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th7\n\\Name th7 - Table - Column 7 Heading\n\\Description A table heading, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th8\n\\Name th8 - Table - Column 8 Heading\n\\Description A table heading, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th9\n\\Name th9 - Table - Column 9 Heading\n\\Description A table heading, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th10\n\\Name th10 - Table - Column 10 Heading\n\\Description A table heading, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th11\n\\Name th11 - Table - Column 11 Heading\n\\Description A table heading, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker th12\n\\Name th12 - Table - Column 12 Heading\n\\Description A table heading, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker tc1\n\\Name tc1 - Table - Column 1 Cell\n\\Description A table cell item, column 1\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc2\n\\Name tc2 - Table - Column 2 Cell\n\\Description A table cell item, column 2\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc3\n\\Name tc3 - Table - Column 3 Cell\n\\Description A table cell item, column 3\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc4\n\\Name tc4 - Table - Column 4 Cell\n\\Description A table cell item, column 4\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc5\n\\Name tc5 - Table - Column 5 Cell\n\\Description A table cell item, column 5\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc6\n\\Name tc6 - Table - Column 6 Cell\n\\Description A table cell item, column 6\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc7\n\\Name tc7 - Table - Column 7 Cell\n\\Description A table cell item, column 7\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc8\n\\Name tc8 - Table - Column 8 Cell\n\\Description A table cell item, column 8\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc9\n\\Name tc9 - Table - Column 9 Cell\n\\Description A table cell item, column 9\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc10\n\\Name tc10 - Table - Column 10 Cell\n\\Description A table cell item, column 10\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc11\n\\Name tc11 - Table - Column 11 Cell\n\\Description A table cell item, column 11\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker tc12\n\\Name tc12 - Table - Column 12 Cell\n\\Description A table cell item, column 12\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Center Aligned Table Heads and Columns\n\n\\Marker thc1 \n\\Name thc1 - Table - Column 1 Heading - Center Aligned\n\\Description A table heading, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc2\n\\Name thc2 - Table - Column 2 Heading - Center Aligned\n\\Description A table heading, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc3\n\\Name thc3 - Table - Column 3 Heading - Center Aligned\n\\Description A table heading, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc4\n\\Name thc4 - Table - Column 4 Heading - Center Aligned\n\\Description A table heading, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc5\n\\Name thc5 - Table - Column 5 Heading - Center Aligned\n\\Description A table heading, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc6\n\\Name thc6 - Table - Column 6 Heading - Center Aligned\n\\Description A table heading, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc7\n\\Name thc7 - Table - Column 7 Heading - Center Aligned\n\\Description A table heading, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc8\n\\Name thc8 - Table - Column 8 Heading - Center Aligned\n\\Description A table heading, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc9\n\\Name thc9 - Table - Column 9 Heading - Center Aligned\n\\Description A table heading, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc10\n\\Name thc10 - Table - Column 10 Heading - Center Aligned\n\\Description A table heading, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc11\n\\Name thc11 - Table - Column 11 Heading - Center Aligned\n\\Description A table heading, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker thc12\n\\Name thc12 - Table - Column 12 Heading - Center Aligned\n\\Description A table heading, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Center\n\n\\Marker tcc1\n\\Name tcc1 - Table - Column 1 Cell - Center Aligned\n\\Description A table cell item, column 1, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc2\n\\Name tcc2 - Table - Column 2 Cell - Center Aligned\n\\Description A table cell item, column 2, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc3\n\\Name tcc3 - Table - Column 3 Cell - Center Aligned\n\\Description A table cell item, column 3, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc4\n\\Name tcc4 - Table - Column 4 Cell - Center Aligned\n\\Description A table cell item, column 4, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc5\n\\Name tcc5 - Table - Column 5 Cell - Center Aligned\n\\Description A table cell item, column 5, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc6\n\\Name tcc6 - Table - Column 6 Cell - Center Aligned\n\\Description A table cell item, column 6, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc7\n\\Name tcc7 - Table - Column 7 Cell - Center Aligned\n\\Description A table cell item, column 7, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc8\n\\Name tcc8 - Table - Column 8 Cell - Center Aligned\n\\Description A table cell item, column 8, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc9\n\\Name tcc9 - Table - Column 9 Cell - Center Aligned\n\\Description A table cell item, column 9, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc10\n\\Name tcc10 - Table - Column 10 Cell - Center Aligned\n\\Description A table cell item, column 10, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc11\n\\Name tcc11 - Table - Column 11 Cell - Center Aligned\n\\Description A table cell item, column 11, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n\\Marker tcc12\n\\Name tcc12 - Table - Column 12 Cell - Center Aligned\n\\Description A table cell item, column 12, center aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Center\n\n# Right Aligned Table Heads and Columns\n\n\\Marker thr1 \n\\Name thr1 - Table - Column 1 Heading - Right Aligned\n\\Description A table heading, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr2\n\\Name thr2 - Table - Column 2 Heading - Right Aligned\n\\Description A table heading, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr3\n\\Name thr3 - Table - Column 3 Heading - Right Aligned\n\\Description A table heading, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr4\n\\Name thr4 - Table - Column 4 Heading - Right Aligned\n\\Description A table heading, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr5\n\\Name thr5 - Table - Column 5 Heading - Right Aligned\n\\Description A table heading, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification Right\n\n\\Marker thr6\n\\Name thr6 - Table - Column 6 Heading - Right Aligned\n\\Description A table heading, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr7\n\\Name thr7 - Table - Column 7 Heading - Right Aligned\n\\Description A table heading, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr8\n\\Name thr8 - Table - Column 8 Heading - Right Aligned\n\\Description A table heading, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr9\n\\Name thr9 - Table - Column 9 Heading - Right Aligned\n\\Description A table heading, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr10\n\\Name thr10 - Table - Column 10 Heading - Right Aligned\n\\Description A table heading, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr11\n\\Name thr11 - Table - Column 11 Heading - Right Aligned\n\\Description A table heading, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker thr12\n\\Name thr12 - Table - Column 12 Heading - Right Aligned\n\\Description A table heading, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Justification right\n\n\\Marker tcr1 \n\\Name tcr1 - Table - Column 1 Cell - Right Aligned\n\\Description A table cell item, column 1, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr2\n\\Name tcr2 - Table - Column 2 Cell - Right Aligned\n\\Description A table cell item, column 2, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr3\n\\Name tcr3 - Table - Column 3 Cell - Right Aligned\n\\Description A table cell item, column 3, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr4\n\\Name tcr4 - Table - Column 4 Cell - Right Aligned\n\\Description A table cell item, column 4, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr5\n\\Name tcr5 - Table - Column 5 Cell - Right Aligned\n\\Description A table cell item, column 5, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification Right\n\n\\Marker tcr6\n\\Name tcr6 - Table - Column 6 Cell - Right Aligned\n\\Description A table cell item, column 6, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr7\n\\Name tcr7 - Table - Column 7 Cell - Right Aligned\n\\Description A table cell item, column 7, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr8\n\\Name tcr8 - Table - Column 8 Cell - Right Aligned\n\\Description A table cell item, column 8, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr9\n\\Name tcr9 - Table - Column 9 Cell - Right Aligned\n\\Description A table cell item, column 9, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr10\n\\Name tcr10 - Table - Column 10 Cell - Right Aligned\n\\Description A table cell item, column 10, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr11\n\\Name tcr11 - Table - Column 11 Cell - Right Aligned\n\\Description A table cell item, column 11, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n\\Marker tcr12\n\\Name tcr12 - Table - Column 12 Cell - Right Aligned\n\\Description A table cell item, column 12, right aligned\n\\OccursUnder tr\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Justification right\n\n# Lists\n\n\\Marker lh\n\\Name lh - List Header\n\\Description List header (introductory remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker li\n\\Name li - List Entry - Level 1\n\\Description A list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li1\n\\Name li1 - List Entry - Level 1\n\\Description A list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.375 # 1/8 inch indent, 1/2 inch wrap\n\n\\Marker li2\n\\Name li2 - List Entry - Level 2\n\\Description A list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\n\\Marker li3\n\\Name li3 - List Entry - Level 3\n\\Description A list entry, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker li4\n\\Name li4 - List Entry - Level 4\n\\Description A list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lf\n\\Name lf - List Footer\n\\Description List footer (concluding remark)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker lim\n\\Name lim - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim1\n\\Name lim1 - Embedded List Entry - Level 1\n\\Description An embedded list entry, level 1 (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_1\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.375\n\\RightMargin .25\n\n\\Marker lim2\n\\Name lim2 - Embedded List Entry - Level 2\n\\Description An embedded list entry, level 2\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_2\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1\n\\FirstLineIndent -.375\n\n\\Marker lim3\n\\Name lim3 - Embedded List Item - Level 3\n\\Description An embedded list item, level 3\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_3\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.25\n\\FirstLineIndent -.375\n\n\\Marker lim4\n\\Name lim4 - Embedded List Entry - Level 4\n\\Description An embedded list entry, level 4\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular level_4\n\\StyleType paragraph\n\\FontSize 12\n\\LeftMargin 1.5\n\\FirstLineIndent -.375\n\n\\Marker litl\n\\Endmarker litl*\n\\Name litl...litl* - List Entry - Total\n\\Description List entry total text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker lik\n\\Endmarker lik*\n\\Name lik...lik* - Structured List Entry - Key\n\\Description Structured list entry key text\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker liv\n\\Endmarker liv*\n\\Name liv...liv* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if single value)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv1\n\\Endmarker liv1*\n\\Name liv1...liv1* - Structured List Entry - Value 1\n\\Description Structured list entry value 1 content (if multiple values)\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv2\n\\Endmarker liv2*\n\\Name liv2...liv2* - Structured List Entry - Value 2\n\\Description Structured list entry value 2 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv3\n\\Endmarker liv3*\n\\Name liv3...liv3* - Structured List Entry - Value 3\n\\Description Structured list entry value 3 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv4\n\\Endmarker liv4*\n\\Name liv4...liv4* - Structured List Entry - Value 4\n\\Description Structured list entry value 4 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker liv5\n\\Endmarker liv5*\n\\Name liv5...liv5* - Structured List Entry - Value 5\n\\Description Structured list entry value 5 content\n\\OccursUnder li li1 li2 li3 li4 lim lim1 lim2 lim3 lim4 NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Footnotes\n\n\\Marker f\n\\Endmarker f*\n\\Name f...f* - Footnote \n\\Description A Footnote text item (basic)\n\\OccursUnder c cp lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fe\n\\Endmarker fe*\n\\Name fe...fe* - Endnote\n\\Description An Endnote text item\n\\OccursUnder c lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 ms3 s s1 s2 s3 d ip\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker fr\n\\Endmarker fr*\n\\Name fr - Footnote - Reference\n\\Description The origin reference for the footnote (basic)\n\\OccursUnder f fe\n\\TextType NoteText\n\\TextProperties publishable vernacular note\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker ft\n\\Endmarker ft*\n\\Name ft - Footnote - Text\n\\Description Footnote text, Protocanon (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fk\n\\Endmarker fk*\n\\Name fk - Footnote - Keyword\n\\Description A footnote keyword (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker fq\n\\Endmarker fq*\n\\Name fq - Footnote - Quotation or Alternate Rendering\n\\Description A footnote scripture quote or alternate rendering (basic)\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fqa\n\\Endmarker fqa*\n\\Name fqa - Footnote - Alternate Translation Rendering\n\\Description A footnote alternate rendering for a portion of scripture text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker fl\n\\Endmarker fl*\n\\Name fl - Footnote - Label Text\n\\Description A footnote label text item, for marking or \"labelling\" the type or alternate translation being provided in the note.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker fw\n\\Endmarker fw*\n\\Name fw - Footnote - Witness List\n\\Description A footnote witness list, for distinguishing a list of sigla representing witnesses in critical editions.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fp\n\\Endmarker fp*\n\\Name fp - Footnote Paragraph Mark\n\\Description A Footnote additional paragraph marker\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fv\n\\Endmarker fv*\n\\Name fv...fv* - Footnote - Embedded Verse Number\n\\Description A verse number within the footnote text\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker fdc\n\\Endmarker fdc*\n\\Name DEPRECATED fdc...fdc* - Footnote - DC text\n\\Description Footnote text, applies to Deuterocanon only\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker fm\n\\Endmarker fm*\n\\Name fm - Footnote - Additional Caller to Previous Note\n\\Description An additional footnote marker location for a previous footnote \n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tc1 tc2 tc3 tc4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Cross References\n\n\\Marker x\n\\Endmarker x*\n\\Name x...x* - Cross Reference\n\\Description A list of cross references (basic)\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 qs sp tc1 tc2 tc3 tc4 mt mt1 mt2 mt3 ms ms1 ms2 s s1 s2 s3 d\n\\TextProperties publishable vernacular note crossreference\n\\TextType NoteText\n\\StyleType Note\n\\FontSize 12\n\n\\Marker xo\n\\Endmarker xo*\n\\Name xo - Cross Reference - Origin Reference\n\\Description The cross reference origin reference (basic)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker xop\n\\Endmarker xop*\n\\Name xop - Cross Reference - Origin Reference Publishing Alternate\n\\Description Published cross reference origin reference (origin reference that should appear in the published text)\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xt\n\\Endmarker xt*\n\\Name xt - Cross Reference - Target References\n\\Description The cross reference target reference(s), protocanon only (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x ef ex NEST\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?link-href\n\n\\Marker xta\n\\Endmarker xta*\n\\Name xta - Cross Reference - Target References Added Text\n\\Description Cross reference target references added text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xk\n\\Endmarker xk*\n\\Name xk - Cross Reference - Keyword\n\\Description A cross reference keyword\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xq\n\\Endmarker xq*\n\\Name xq - Cross Reference - Quotation\n\\Description A cross-reference quotation from the scripture text\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker xot\n\\Endmarker xot*\n\\Name xot...xot* - Cross Reference - OT Target Refs (optional)\n\\Description Cross-reference target reference(s), Old Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xnt\n\\Endmarker xnt*\n\\Name xnt...xnt* - Cross Reference - NT Target Refs (optional)\n\\Description Cross-reference target reference(s), New Testament only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker xdc\n\\Endmarker xdc*\n\\Name DEPRECATED xdc...xdc* - Cross Reference - DC Target Refs\n\\Description Cross-reference target reference(s), Deuterocanon only\n\\OccursUnder x\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\n\\Marker rq\n\\Endmarker rq*\n\\Name rq...rq* - Cross Reference - Inline Quotation References\n\\Description A cross-reference indicating the source text for the preceding quotation.\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 NEST\n\\TextType Other\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 10\n\\Italic\n\n# Other Special Text\n\n\\Marker qt\n\\Endmarker qt*\n\\Name qt...qt* - Special Text - Quoted Text - OT in NT\n\\Description For Old Testament quoted text appearing in the New Testament (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker nd\n\\Endmarker nd*\n\\Name nd...nd* - Special Text - Name of Deity\n\\Description For name of deity (basic)\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker tl\n\\Endmarker tl*\n\\Name tl...tl* - Special Text - Transliterated Word\n\\Description For transliterated words\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable nonvernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker dc\n\\Endmarker dc*\n\\Name dc...dc* - Special Text - Deuterocanonical/LXX Additions\n\\Description Deuterocanonical/LXX additions or insertions in the Protocanonical text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\Italic\n\n\\Marker bk\n\\Endmarker bk*\n\\Name bk...bk* - Special Text - Quoted book title\n\\Description For the quoted name of a book\n\\OccursUnder imt imt1 imt2 imt3 imt4 imte imte1 imte2 is is1 is2 ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sig\n\\Endmarker sig*\n\\Name sig...sig* - Special Text - Author's Signature (Epistles)\n\\Description For the signature of the author of an Epistle\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker pn\n\\Endmarker pn*\n\\Name pn...pn* - Special Text - Proper Name\n\\Description For a proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Underline\n\n\\Marker png\n\\Endmarker png*\n\\Name png...png* - Special Text - Geographic Proper Name\n\\Description For a geographic proper name\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Underline\n\n\\Marker addpn\n\\Endmarker addpn*\n\\Name DEPRECATED addpn...addpn* - Special Text for Chinese\n\\Description For chinese words to be dot underline & underline\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\\Underline\n\n\\Marker wj\n\\Endmarker wj*\n\\Name wj...wj* - Special Text - Words of Jesus\n\\Description For marking the words of Jesus\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Color 255\n#!\\ColorName highcon red\n\n\\Marker k\n\\Endmarker k*\n\\Name k...k* - Special Text - Keyword\n\\Description For a keyword\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Bold\n\n\\Marker sls\n\\Endmarker sls*\n\\Name sls...sls* - Special Text - Secondary Language or Text Source\n\\Description To represent where the original text is in a secondary language or from an alternate text source\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker ord\n\\Endmarker ord*\n\\Name ord...ord* - Special Text - Ordinal number text portion\n\\Description For the text portion of an ordinal number\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n\\Marker add\n\\Endmarker add*\n\\Name add...add* - Special Text - Translational Addition\n\\Description For a translational addition to the text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 cls tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#\\Color 2263842\n##!\\ColorName green\n\\Bold\n\\Italic\n\n\\Marker lit\n\\Name lit - Special Text - Liturgical note\n\\Description For a comment or note inserted for liturgical use\n\\OccursUnder c\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\Justification Right\n\\FontSize 12\n\\Bold\n\n# Character Styling\n\n\\Marker no\n\\Endmarker no*\n\\Name no...no* - Character - Normal Text\n\\Description A character style, use normal text\n\\OccursUnder is ip ipi im imi ili ili1 ili2 imq ipq iex iq iot io1 io2 io3 io4 s s1 s2 s3 NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker it\n\\Endmarker it*\n\\Name it...it* - Character - Italic Text\n\\Description A character style, use italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker bd\n\\Endmarker bd*\n\\Name bd...bd* - Character - Bold Text\n\\Description A character style, use bold text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker bdit\n\\Endmarker bdit*\n\\Name bdit...bdit* - Character - BoldItalic Text\n\\Description A character style, use bold + italic text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\\Italic\n\n\\Marker em\n\\Endmarker em*\n\\Name em...em* - Character - Emphasized Text\n\\Description A character style, use emphasized text style\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker sc\n\\Endmarker sc*\n\\Name sc...sc* - Character - Small Caps\n\\Description A character style, for small capitalization text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Smallcaps\n\n\\Marker sup\n\\Endmarker sup*\n\\Name sup...sup* - Character - Superscript\n\\Description A character style, for superscript text. Typically for use in critical edition footnotes.\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Superscript\n\n# Breaks\n\n\\Marker pb\n\\Name pb - Break - Page Break\n\\Description Page Break used for new reader portions and children's bibles where content is controlled by the page\n\\OccursUnder c\n\\Rank 4\n\\TextType Other\n\\TextProperties publishable\n\\StyleType Paragraph\n\\FontSize 12\n\n# Special Features\n\n\\Marker fig\n\\Endmarker fig*\n\\Name fig...fig* - Auxiliary - Figure/Illustration/Map\n\\Description Illustration [Columns to span, height, filename, caption text]\n\\OccursUnder lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes src size ref ?alt ?loc ?copy\n\n\\Marker jmp\n\\Endmarker jmp*\n\\Name jmp...jmp* - Link text\n\\Description For associating linking attributes to a span of text\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType Other\n\\StyleType Character\n\\Color 16711680\n#!\\ColorName highcon blue\n\\Underline\n#!\\Attributes ?link-href ?link-id ?link-title\n\n\\Marker pro\n\\Endmarker pro*\n\\Name DEPRECATED pro...pro* - Special Text - CJK Pronunciation\n\\Description For indicating pronunciation in CJK texts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType Other\n\\TextProperties Nonpublishable\n\\StyleType Character\n\\FontSize 10\n\n\\Marker rb\n\\Endmarker rb*\n\\Name rb...rb* - Special Text - Ruby Glossing\n\\Description Most often used to provide a reading / pronunciation guide in ideographic scripts\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 sp tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 ms ms1 ms2 s s1 s2 s3 d ip f fe NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n#!\\Attributes gloss\n\n# Peripheral References\n\n\\Marker w\n\\Endmarker w*\n\\Name w...w* - Peripheral Ref - Wordlist Entry\n\\Description A wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n#!\\Attributes ?lemma ?strong ?srcloc\n\n\\Marker wh\n\\Endmarker wh*\n\\Name wh...wh* - Peripheral Ref - Hebrew Wordlist Entry\n\\Description A Hebrew wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wg\n\\Endmarker wg*\n\\Name wg...wg* - Peripheral Ref - Greek Wordlist Entry\n\\Description A Greek Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker wa\n\\Endmarker wa*\n\\Name wa...wa* - Peripheral Ref - Aramaic Wordlist Entry\n\\Description An Aramaic Wordlist text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker ndx\n\\Endmarker ndx*\n\\Name ndx...ndx* - Peripheral Ref - Subject Index Entry \n\\Description A subject index text item\n\\OccursUnder ip im ipi imi ipq imq ipr iq iq1 iq2 iq3 ili ili1 ili2 io io1 io2 io3 io4 ms ms1 ms2 s s1 s2 s3 s4 cd sp d lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr pmo pm pmc pmr po q q1 q2 q3 q4 qc qr qd qm qm1 qm2 qm3 tr th1 th2 th3 th4 thr1 thr2 thr3 thr4 tc1 tc2 tc3 tc4 tcr1 tcr2 tcr3 tcr4 f fe x NEST\n\\TextType VerseText\n\\TextProperties publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n# Peripheral Materials\n# Content Division Marker\n\n\\Marker periph\n\\Name periph - Peripherals - Content Division Marker\n\\Description Peripheral content division marker which should be followed by an additional division argument/title.\n\\TextType Section\n\\TextProperties paragraph nonpublishable vernacular\n\\StyleType Paragraph\n\\FontSize 14\n\\Bold\n\\SpaceBefore 16\n\\SpaceAfter 4\n\\Color 33023\n#!\\ColorName orange\n\n# Additional peripheral material extensions to existing USFM markup.\n\n\\Marker p1\n\\Name p1 - Periph - Front/Back Matter Paragraph Level 1\n\\Description Front or back matter text paragraph, level 1 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker p2\n\\Name p2 - Periph - Front/Back Matter Paragraph Level 2\n\\Description Front or back matter text paragraph, level 2 (if multiple levels)\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/4 inch first line indent\n\\LeftMargin .125\n\n\\Marker k1\n\\Name k1 - Periph - Concordance Keyword Level 1\n\\Description Concordance main entry text or keyword, level 1\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker k2\n\\Name k2 - Periph - Concordance Keyword Level 2\n\\Description Concordance main entry text or keyword, level 2\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\n\\Marker xtSee\n\\Endmarker xtSee*\n\\Name xtSee - Concordance and Names Index - Alternate Entry Target Reference\n\\Description Concordance and Names Index markup for an alternate entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n\\Marker xtSeeAlso\n\\Endmarker xtSeeAlso*\n\\Name xtSeeAlso - Concordance and Names Index - Additional Entry Target Reference\n\\Description Concordance and Names Index markup for an additional entry target reference.\n\\OccursUnder p\n\\TextProperties publishable vernacular\n\\TextType Other\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Milestones - these are not compatible with USFM2, so whole entries are preceded with #!\n\n#!\\Marker qt-s\n#!\\Endmarker qt-e\n#!\\Name Quotation start/end milestone\n#!\\Description Quotation start/end milestone, level 1 (if single level)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt1-s\n#!\\Endmarker qt1-e\n#!\\Name Quotation start/end milestone - Level 1\n#!\\Description Quotation start/end milestone, level 1 (if multiple levels)\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt2-s\n#!\\Endmarker qt2-e\n#!\\Name Quotation start/end milestone - Level 2\n#!\\Description Quotation start/end milestone, level 2\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt3-s\n#!\\Endmarker qt3-e\n#!\\Name Quotation start/end milestone - Level 3\n#!\\Description Quotation start/end milestone, level 3\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt4-s\n#!\\Endmarker qt4-e\n#!\\Name Quotation start/end milestone - Level 4\n#!\\Description Quotation start/end milestone, level 4\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker qt5-s\n#!\\Endmarker qt5-e\n#!\\Name Quotation start/end milestone - Level 5\n#!\\Description Quotation start/end milestone, level 5\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?who ?sid ?eid\n\n#!\\Marker ts-s\n#!\\Endmarker ts-e\n#!\\Name Translator's section start/end milestone\n#!\\Description Translator's section start/end milestone\n#!\\OccursUnder id\n#!\\StyleType Milestone\n#!\\Attributes ?sid ?eid\n\n# Other special text elements specified in USFM\n#   ~ = fixed (no-break) space\n#   // = discretionary line break\n\n# Obsolete, deprecated, or no longer officially part of USFM.\n# These markers may have existed in earlier resource and stylesheet revisions.\n\n\\Marker ph\n\\Name DEPRECATED ph - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if single level)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph1\n\\Name DEPRECATED ph1 - Paragraph - Hanging Indent - Level 1\n\\Description Paragraph text, with level 1 hanging indent (if multiple levels)\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 1/4 inch indent, 1/2 inch wrap\n\\FontSize 12\n\n\\Marker ph2\n\\Name DEPRECATED ph2 - Paragraph - Hanging Indent - Level 2\n\\Description Paragraph text, with level 2 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 1/2 inch indent, 3/4 inch wrap\n\\FontSize 12\n\n\\Marker ph3\n\\Name DEPRECATED ph3 - Paragraph - Hanging Indent - Level 3\n\\Description Paragraph text, with level 3 hanging indent\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\\FirstLineIndent -.25  # 3/4 inch indent, 1 inch wrap\n\\FontSize 12\n\n\\Marker phi\n\\Name DEPRECATED phi - Paragraph - Indented - Hanging Indent\n\\Description Paragraph text, indented with hanging indent\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\LeftMargin 1\n\n\\Marker tr1\n\\Name DEPRECATED tr1 - Table - Row - Level 1\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .5\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker tr2\n\\Name DEPRECATED tr2 - Table - Row - Level 2\n\\Description A table Row\n\\OccursUnder c\n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\LeftMargin .75\n\\FirstLineIndent -.25  # 6/16 inch\n\n\\Marker ps\n\\Name DEPRECATED ps - Paragraph - No Break with Next Paragraph\n\\Description Paragraph text, no break with next paragraph text at chapter boundary\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\n\\Marker psi\n\\Name DEPRECATED psi - Paragraph - Indented - No Break with Next\n\\Description Paragraph text, indented, with no break with next paragraph text (at chapter boundary)\n\\OccursUnder c \n\\Rank 4\n\\TextType VerseText\n\\TextProperties paragraph publishable vernacular\n\\StyleType Paragraph\n\\FirstLineIndent .125   # 1/8 inch first line indent\n\\LeftMargin .25\n\\RightMargin .25\n\\FontSize 12\n\n\\Marker fs\n\\Endmarker fs*\n\\Name DEPRECATED fs - Footnote - Footnote Summary\n\\Description A summary text for the concept/idea/quotation from the scripture translation for which the note is being provided.\n\\OccursUnder f fe\n\\TextProperties publishable vernacular note\n\\TextType NoteText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n\\Marker wr\n\\Endmarker wr*\n\\Name DEPRECATED wr...wr* - Auxiliary - Wordlist/Glossary Reference \n\\Description A Wordlist text item\n\\OccursUnder ms s lh li li1 li2 li3 li4 lf lim lim1 lim2 lim3 lim4 m mi nb p pc ph phi pi pi1 pi2 pi3 pr po q q1 q2 q3 q4 qc qr qd tc1 tc2 tc3 tc4 f fe NEST\n\\TextProperties publishable vernacular\n\\TextType VerseText\n\\StyleType Character\n\\FontSize 12\n\\Italic\n\n# 2.0x peripheral markup (replaced with \\periph + Content Division Title/Argument)\n\n\\Marker pub\n\\Name DEPRECATED pub Peripherals - Front Matter Publication Data\n\\Description Front matter publication data\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker toc\n\\Name DEPRECATED toc Peripherals - Front Matter Table of Contents\n\\Description Front matter table of contents\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pref\n\\Name DEPRECATED pref Peripherals - Front Matter Preface\n\\Description Front matter preface\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker intro\n\\Name DEPRECATED intro Peripherals - Front Matter Introduction\n\\Description Front matter introduction\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker conc\n\\Name DEPRECATED conc Peripherals - Back Matter Concordance\n\\Description Back matter concordance\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker glo\n\\Name DEPRECATED glo Peripherals - Back Matter Glossary\n\\Description Back matter glossary\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker idx\n\\Name DEPRECATED idx Peripherals - Back Matter Index\n\\Description Back matter index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker maps\n\\Name DEPRECATED maps Peripherals - Back Matter Map Index\n\\Description Back matter map index\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker cov\n\\Name DEPRECATED cov Peripherals - Other - Cover\n\\Description Other peripheral materials - cover\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker spine\n\\Name DEPRECATED spine Peripherals - Other - Spine\n\\Description Other peripheral materials - spine\n\\OccursUnder id\n\\Rank 4\n\\TextProperties paragraph publishable vernacular poetic\n\\TextType VerseText\n\\FontSize 10\n\\StyleType paragraph\n\n\\Marker pubinfo\n\\Name DEPRECATED pubinfo - Publication - Information\n\\Description Publication information - Lang,Credit,Version,Copies,Publisher,Id,Logo\n\\OccursUnder id ide\n\\TextType Other\n\\TextProperties paragraph nonpublishable nonvernacular\n\\StyleType Paragraph\n\\FontSize 12\n\\Color 16711680\n#!\\ColorName highcon blue\n\n# Concordance/Names Index Tools - special sfms for use in Publishing Assistant\n\n\\Marker zpa-xb\n\\Endmarker zpa-xb*\n\\Name zpa-xb - Periph - Book\n\\Description Book Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-xc\n\\Endmarker zpa-xc*\n\\Name zpa-xc - Periph - Chapter\n\\Description Chapter Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\\Bold\n\n\\Marker zpa-xv\n\\Endmarker zpa-xv*\n\\Name zpa-xv - Periph - Verse\n\\Description Verse Ref\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n\n\\Marker zpa-d\n\\Endmarker zpa-d*\n\\Name zpa-d - Periph - Description\n\\Description Description\n\\OccursUnder id\n\\Rank 1\n\\TextType Other\n\\TextProperties paragraph publishable vernacular\n\\StyleType Character\n\\FontSize 12\n";
// ProjectSettings backend (src/tools/project-settings/backend.js), in its own scope.
const ProjectSettings = (function () {
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

})();
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
/* global PC, PCX_WEB_VIEW_HTML, PCX_USFM_STY, PCX_VERSION, MarkerSpaces, NumberedMarkers, NumberedBookTitles, NM_STRINGS, NBT_STRINGS, ProjectSettings, PS_STRINGS */
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
  logger.info(`Phils Checks is finished activating (${PC.checks.size} checks + Marker Spaces)`);
}

async function deactivate() {
  await MarkerSpaces.deactivate();
  return true;
}

exports.activate = activate;
exports.deactivate = deactivate;

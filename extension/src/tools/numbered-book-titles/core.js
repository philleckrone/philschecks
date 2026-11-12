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

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

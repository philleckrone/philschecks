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

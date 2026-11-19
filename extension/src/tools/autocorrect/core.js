// AutoCorrect Editor core: a port of AutoCorrect\AutoCorrectEditor (Services\AutoCorrectFileService.cs,
// Models\AutoCorrectEntry.cs, Services\UnicodeBlockService.cs). No papi, no files: bytes in, bytes out.
//   ACCore.read(bytes) -> {headerLines, entries: [{pattern, replacement}]}
//   ACCore.write(headerLines, entries) -> Uint8Array (UTF-16 LE with BOM, CRLF), as the editor saves
var ACCore = (function () {
  'use strict';

  var blocks = null;

  /** UnicodeBlockService.Blocks, read from its C# source (the build embeds it). */
  function init(blockServiceCs) {
    blocks = [];
    var re = /Name\s*=\s*"([^"]*)"\s*,\s*Start\s*=\s*0x([0-9A-Fa-f]+)\s*,\s*End\s*=\s*0x([0-9A-Fa-f]+)/g;
    var m;
    while ((m = re.exec(blockServiceCs || '')) !== null) blocks.push({ name: m[1], start: parseInt(m[2], 16), end: parseInt(m[3], 16) });
  }

  // .NET char.IsWhiteSpace
  var WHITE = /^[\t-\r\x85\p{Z}]$/u;

  function isNullOrWhiteSpace(s) {
    for (var i = 0; i < s.length; i++) if (!WHITE.test(s[i])) return false;
    return true;
  }

  function trimStart(s) {
    var i = 0;
    while (i < s.length && WHITE.test(s[i])) i++;
    return s.substring(i);
  }

  /** DetectEncoding + StreamReader: the text of the file. */
  function decode(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
    return new TextDecoder('utf-8').decode(b);
  }

  /** StreamReader.ReadLine: lines split on CR, LF or CRLF; no empty line after a final line break. */
  function lines(text) {
    var out = [];
    var start = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (c === '\r' || c === '\n') {
        out.push(text.substring(start, i));
        if (c === '\r' && text[i + 1] === '\n') i++;
        start = i + 1;
      }
    }
    if (start < text.length) out.push(text.substring(start));
    return out;
  }

  function isHex4(t, start) {
    if (start + 4 > t.length) return false;
    return /^[0-9a-fA-F]{4}$/.test(t.substr(start, 4));
  }

  /** AutoCorrectEntry.DecodeUnicodeEscapes: \uXXXX (or \UXXXX) becomes the character. */
  function decodeEscapes(text) {
    if (!text || text.indexOf('\\') < 0) return text || '';
    var out = '';
    var i = 0;
    while (i < text.length) {
      if (text[i] === '\\' && i + 6 <= text.length && (text[i + 1] === 'u' || text[i + 1] === 'U') && isHex4(text, i + 2)) {
        out += String.fromCharCode(parseInt(text.substr(i + 2, 4), 16));
        i += 6;
      } else {
        out += text[i];
        i += 1;
      }
    }
    return out;
  }

  /** AutoCorrectEntry.FormatUnicodeValues: "0061 0331". */
  function unicodeValues(text) {
    if (!text) return '';
    var parts = [];
    for (var i = 0; i < text.length; i++) {
      var cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        cp = text.codePointAt(i);
        i++;
      }
      var h = cp.toString(16).toUpperCase();
      while (h.length < 4) h = '0' + h;
      parts.push(h);
    }
    return parts.join(' ');
  }

  function entry(pattern, replacement) {
    return { pattern: decodeEscapes(pattern), replacement: decodeEscapes(replacement) };
  }

  /** AutoCorrectFileService.Read */
  function read(bytes) {
    var headerLines = [];
    var entries = [];
    var pastHeader = false;
    lines(decode(bytes)).forEach(function (line) {
      if (!pastHeader && (isNullOrWhiteSpace(line) || trimStart(line).indexOf('#') === 0)) {
        headerLines.push(line);
        return;
      }
      var idx = line.indexOf('-->');
      if (idx >= 0) {
        pastHeader = true;
        entries.push(entry(line.substring(0, idx), line.substring(idx + 3)));
      } else if (!isNullOrWhiteSpace(line)) pastHeader = true;
    });
    return { headerLines: headerLines, entries: entries };
  }

  /** AutoCorrectFileService.Write: UTF-16 LE with its BOM, every line ending in CRLF. */
  function write(headerLines, entries) {
    var text = '';
    (headerLines || []).forEach(function (h) {
      text += h + '\r\n';
    });
    entries.forEach(function (e) {
      text += e.pattern + '-->' + e.replacement + '\r\n';
    });
    var out = new Uint8Array(2 + text.length * 2);
    out[0] = 0xff;
    out[1] = 0xfe;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      out[2 + i * 2] = c & 0xff;
      out[3 + i * 2] = c >> 8;
    }
    return out;
  }

  // ------------------------------------------------------------ the character browser

  var SKIP = /^[\p{Cn}\p{Cs}\p{Co}]$/u;
  var MARK = /^[\p{Mn}\p{Me}\p{Mc}]$/u;
  var CTRL = /^[\p{Cc}\p{Cf}]$/u;

  function hex(cp, n) {
    var h = cp.toString(16).toUpperCase();
    while (h.length < n) h = '0' + h;
    return h;
  }

  /** The characters of a block (BMP only), as the browser shows them: {ch, display, tip}. */
  function blockItems(block) {
    var items = [];
    for (var cp = block.start; cp <= block.end; cp++) {
      if (cp > 0xffff) continue;
      var ch = String.fromCharCode(cp);
      if (SKIP.test(ch)) continue;
      var display = MARK.test(ch) ? '\u25CC' + ch : CTRL.test(ch) ? '[' + hex(cp, 2) + ']' : ch;
      items.push({ ch: ch, display: display, tip: 'U+' + hex(cp, 4), cp: cp, block: block });
    }
    return items;
  }

  /** ApplySearch: characters equal to the text, or whose U+ code holds it; at most max (+1 to tell). */
  function search(text, max) {
    var upper = text.toUpperCase();
    var found = [];
    for (var b = 0; b < blocks.length && found.length <= max; b++) {
      var items = blockItems(blocks[b]);
      for (var i = 0; i < items.length && found.length <= max; i++)
        if (items[i].ch.indexOf(text) >= 0 || items[i].tip.indexOf(upper) >= 0) found.push(items[i]);
    }
    return found;
  }

  return {
    init: init,
    blocks: function () {
      return blocks || [];
    },
    read: read,
    write: write,
    decode: decode,
    decodeEscapes: decodeEscapes,
    unicodeValues: unicodeValues,
    entry: entry,
    blockItems: blockItems,
    search: search,
  };
})();

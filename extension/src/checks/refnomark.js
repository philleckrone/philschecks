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

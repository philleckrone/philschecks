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

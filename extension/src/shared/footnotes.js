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

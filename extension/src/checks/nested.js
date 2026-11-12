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

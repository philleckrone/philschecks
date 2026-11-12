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

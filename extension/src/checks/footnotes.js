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

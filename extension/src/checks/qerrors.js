// q Errors: a port of Project_Checker\ProjectChecker\Checks\QErrorsCheck.cs (CMS/q_errors/q_error.py).
// Flags poetry lines (\q, \q1, \q2..., with Project Checker's approved fixes) with final punctuation
// followed by more text (p1a/p1b), two verses on one line (p2a/p2b), text before the verse marker
// (p3) and, optionally, a line ending in non-final punctuation plus one hanging word (p4). One
// finding per match start: the first pattern (p1a..p4) to match there wins.
(function () {
  'use strict';
  var R = PC.re;
  var T = PC.text;
  var U = PC.usfm;
  var esc = PC.report.esc;

  // Notes, cross-references, \qs...\qs* and \fig on one line, plus any closing marker.
  var INLINE_RE = R.compile(
    '\\\\f\\s[^\\r\\n]*?\\\\f\\*|\\\\x\\s[^\\r\\n]*?\\\\x\\*|\\\\qs\\s[^\\r\\n]*?\\\\qs\\*|\\\\fig\\s[^\\r\\n]*?\\\\fig\\*|\\\\[a-z]+\\*',
    R.UNICODE,
  );
  var Q_VERSE_RE = R.compile('\\\\q\\d?[ \\t]+\\\\v[ \\t]+(\\d+)');
  var DIGITS_RE = R.compile('\\d+', R.UNICODE);
  var Q_MARK_RE = R.compile('\\\\q\\d?[ \\t\\r\\n]+', R.UNICODE);
  var NEWLINE_RE = R.compile('\\r?\\n', R.UNICODE);
  var H_WS_RE = R.compile('[ \\t]*', R.UNICODE);
  var VERSE_START_RE = R.compile('\\\\v\\s', R.UNICODE);
  var WS_RUN_RE = R.compile('[ \\t]+', R.UNICODE);
  // _display_parts: the line without note/xref/\qs/\fig spans and without character markers that
  // open and close on it; a closing marker also takes a |attribute part before it.
  var DISPLAY_DROP_RE = R.compile(
    '\\\\f\\s[^\\r\\n]*?\\\\f\\*|\\\\x\\s[^\\r\\n]*?\\\\x\\*|\\\\qs\\s[^\\r\\n]*?\\\\qs\\*|\\\\fig\\s[^\\r\\n]*?\\\\fig\\*' +
      '|(?:\\|[^\\\\\\r\\n]*)?\\\\\\+?([A-Za-z]+\\d*)\\*',
    R.UNICODE,
  );
  var DISPLAY_OPEN_RE = R.compile('\\\\\\+?([A-Za-z]+\\d*)[ ]', R.UNICODE);

  var MSG_FINAL = 'Final punctuation in q';
  var MSG_VERSE = 'Verse in q';
  var MSG_MULTI = 'Poetry line spans multiple verses';
  var MSG_HANGING = 'Single word after punctuation';
  var MSG_ORDER = [MSG_FINAL, MSG_VERSE, MSG_MULTI, MSG_HANGING];

  /** make_char_class: \ ] ^ - escaped inside [...]. */
  function makeCharClass(chars) {
    var s = '[';
    for (var i = 0; i < chars.length; i++) {
      if ('\\]^-'.indexOf(chars[i]) >= 0) s += '\\';
      s += chars[i];
    }
    return s + ']';
  }

  function collapseWs(s) {
    return R.sub(WS_RUN_RE, s.replace(/\r/g, '').replace(/\n/g, ' '), ' ');
  }

  /** _line_end: one line at a time from the \q, going on only when the next line opens with \v. */
  function lineEnd(processed, lineStart) {
    var n = processed.length;
    var qm = R.matchAt(Q_MARK_RE, processed, lineStart);
    var pos = lineStart + (qm ? qm[0].length : 0);
    for (;;) {
      var nl = R.search(NEWLINE_RE, processed, pos);
      if (!nl) return n;
      var after = nl.index + nl[0].length;
      var ws = R.matchAt(H_WS_RE, processed, after);
      var afterWs = after + (ws ? ws[0].length : 0);
      if (R.matchAt(VERSE_START_RE, processed, afterWs)) {
        pos = afterWs;
        continue;
      }
      return nl.index;
    }
  }

  function keepUndropped(text, drop, origin, a, b) {
    var out = '';
    for (var i = a; i < b; i++) {
      var k = i - origin;
      if (k >= 0 && k < drop.length && drop[k]) continue;
      out += text[i];
    }
    return out;
  }

  /** _display_parts: before the trigger, the trigger, and after it (to lineEnd). */
  function displayParts(text, start, trigStart, trigEnd, end) {
    var seg = text.substring(start, start + Math.max(0, end - start));
    var drop = new Array(seg.length);
    R.findAll(DISPLAY_DROP_RE, seg).forEach(function (m) {
      for (var i = m.index; i < m.index + m[0].length; i++) drop[i] = true;
      if (m[1] === undefined) return;
      var name = m[1].toLowerCase();
      var opener = null;
      R.findAll(DISPLAY_OPEN_RE, seg.substring(0, m.index)).forEach(function (o) {
        if (o[1].toLowerCase() === name) opener = o;
      });
      if (opener) for (var j = opener.index; j < opener.index + opener[0].length; j++) drop[j] = true;
    });
    return [
      keepUndropped(text, drop, start, start, trigStart),
      keepUndropped(text, drop, start, trigStart, trigEnd),
      keepUndropped(text, drop, start, trigEnd, Math.max(trigEnd, end)),
    ];
  }

  function catOf(msg) {
    return msg === MSG_FINAL ? 'final' : msg === MSG_MULTI ? 'multi' : msg === MSG_HANGING ? 'hanging' : 'verse';
  }

  function report(run, ch, text, processed, reported, m, msg, cat) {
    var start = m.index;
    var end = m.index + m[0].length;
    if (reported.has(start)) return;
    reported.add(start);
    // Patterns end on the space after \v: take in the verse number.
    var take = Math.min(6, text.length - end);
    var vm = R.matchAt(DIGITS_RE, text.substring(end, end + take), 0);
    var ext = vm ? vm[0].length : 0;
    var f = run.emit(ch, start, end + ext, msg, cat);
    f.localize = function (L) {
      return L.str('Msg_qerrors_' + cat);
    };

    // _ReorderOutput: text beginning "\q \v N" was reported at the previous verse; use N.
    var shown = f.text.replace(/\r/g, '').replace(/\n/g, ' ');
    var qv = R.matchAt(Q_VERSE_RE, shown, 0);
    if (qv && /^[0-9]+$/.test(f.verse)) f.verse = qv[1];
    var ref = f.bookCode + ' ' + f.chapter + ':' + f.verse;

    var trigStart = m.indices[1][0];
    var trigEnd = m.indices[1][1];
    var te = trigEnd === end ? trigEnd + ext : trigEnd;
    var parts = displayParts(text, start, trigStart, te, lineEnd(processed, start));
    var trig = parts[1];
    run.state.rows.push({
      ref: ref,
      linkRef: f.bookCode + ' ' + f.chapter + ':' + f.verse,
      msg: msg,
      before: esc(collapseWs(parts[0])),
      period: msg === MSG_FINAL && trig === '.',
      trigger: esc(collapseWs(trig)),
      after: esc(collapseWs(parts[2])),
    });
    f.context = collapseWs(parts[0] + parts[1] + parts[2]);
  }

  function lineHtml(r, err, errPeriod) {
    return r.before + '<span class="' + (r.period ? err + ' ' + errPeriod : err) + '">' + r.trigger + '</span>' + r.after;
  }

  function grouped(d) {
    var byMsg = new Map();
    d.rows.forEach(function (r) {
      if (!byMsg.has(r.msg)) byMsg.set(r.msg, []);
      byMsg.get(r.msg).push(r);
    });
    return MSG_ORDER.filter(function (m) {
      return byMsg.has(m);
    }).map(function (m) {
      return [m, byMsg.get(m)];
    });
  }

  /** Compiled with the 'd' flag, so match.indices gives group 1's place. */
  function compileD(p, flags) {
    var re = R.compile(p, flags);
    var d = new RegExp(re.source, re.flags + 'd');
    d.pySource = p;
    return d;
  }

  PC.define({
    id: 'qerrors',
    cssPrefix: 'qe',
    original: 'q_errors/q_error.py',
    kind: 'report',
    options: [
      { name: 'FinalPunctuation', type: 'text', def: '.!?' },
      { name: 'MinCharsBeforePunct', type: 'int', def: '0' },
      { name: 'NonFinalPunctuation', type: 'text', def: ',;:' },
      { name: 'CheckFinalPunct', type: 'bool', def: 'Yes' },
      { name: 'CheckDoubleVerse', type: 'bool', def: 'Yes' },
      { name: 'CheckTextBeforeVerse', type: 'bool', def: 'Yes' },
      { name: 'CheckHangingWord', type: 'bool', def: 'No' },
    ],
    reportCss: '.qe-err{color:#c00;font-weight:bold}.qe-err-period{font-size:calc(1em + 2pt)}',

    beginRun: function (run) {
      var s = (run.state = { rows: [], compiled: false });
      var final = run.opt('FinalPunctuation');
      var nonFinal = run.opt('NonFinalPunctuation');
      var checkFinal = T.isYes(run.opt('CheckFinalPunct'));
      var checkDouble = T.isYes(run.opt('CheckDoubleVerse'));
      var checkBefore = T.isYes(run.opt('CheckTextBeforeVerse'));
      var checkHanging = T.isYes(run.opt('CheckHangingWord'));
      if (checkFinal && final.length === 0) {
        run.addNote('Rpt_qerrors_EmptyFinal');
        return;
      }
      if (checkHanging && nonFinal.length === 0) {
        run.addNote('Rpt_qerrors_EmptyNonFinal');
        return;
      }
      var mc = T.strip(run.opt('MinCharsBeforePunct'));
      var minChars = /^[+-]?\d+$/.test(mc) ? parseInt(mc, 10) : 0;
      if (minChars < 0) minChars = 0;

      // [ \t\r\n]+: the poetry marker may stand on its own line (\q3 and deeper count too).
      var q = '\\\\q\\d?[ \\t\\r\\n]+';
      var eol = '[ \\t]*\\r?\\n[ \\t]*';
      var beforePunct = '[^\\r\\n]{' + minChars + ',}?';
      var f = R.UNICODE | R.MULTILINE;
      if (checkFinal) {
        var punct = makeCharClass(final);
        s.p1a = compileD(q + beforePunct + '(' + punct + ')' + '(?=[^\\r\\n]*\\w)', f);
        s.p1b = compileD(q + beforePunct + punct + eol + '(' + '\\\\v\\s' + ')', f);
      }
      if (checkDouble) {
        s.p2a = compileD(q + '[^\\r\\n]*\\\\v\\s+\\d+[^\\r\\n]*(' + '\\\\v\\s' + ')', f);
        s.p2b = compileD(q + '[^\\r\\n]*\\\\v\\s+\\d+[^\\r\\n]*' + eol + '(' + '\\\\v\\s' + ')', f);
      }
      if (checkBefore) s.p3 = compileD(q + '(' + '[ \\t]*[^ \\t\\r\\n\\\\][^\\r\\n]*(?:\\r?\\n[ \\t]*)?' + ')' + '\\\\v\\s', f);
      if (checkHanging)
        s.p4 = compileD(q + '[^\\r\\n]*(' + makeCharClass(nonFinal) + '[ \\t]+\\w+' + ')' + '[ \\t]*(?=\\r?$|\\\\q)', f);
      s.compiled = true;
    },

    checkChapter: function (run, ch) {
      var s = run.state;
      if (!s.compiled) return;
      var text = ch.text;
      var processed = U.blank(INLINE_RE, text);
      var reported = new Set();
      function each(re, src, msg, cat) {
        if (!re) return;
        R.findAll(re, src).forEach(function (m) {
          report(run, ch, text, processed, reported, m, msg, cat);
        });
      }
      each(s.p1a, processed, MSG_FINAL, 'final');
      each(s.p1b, processed, MSG_VERSE, 'verse');
      // Approved fix: the later patterns also run on the blanked text (offsets are the same).
      each(s.p2a, processed, MSG_MULTI, 'multi');
      each(s.p2b, processed, MSG_VERSE, 'verse');
      each(s.p3, processed, MSG_VERSE, 'verse');
      each(s.p4, processed, MSG_HANGING, 'hanging');
    },

    endRun: function (run) {
      run.result.reportData = run.state;
    },

    renderReport: function (w, result, L) {
      var d = result.reportData;
      if (!d || !d.compiled) return;
      if (d.rows.length === 0) {
        w.line('<p><i>' + esc(L.str('Rpt_nested_NoIssues')) + '</i></p>');
        return;
      }
      grouped(d).forEach(function (g) {
        w.line('<details class="pc-group" open><summary>' + esc(L.str('Msg_qerrors_' + catOf(g[0]))) + ' (' + g[1].length + ')</summary>');
        w.line('<table><tr><th>' + esc(L.str('Rpt_Reference')) + '</th><th>' + esc(L.str('Rpt_qerrors_QLine')) + '</th></tr>');
        g[1].forEach(function (r) {
          w.line('<tr><td><b>' + PC.report.refLink(r.linkRef, esc(r.ref)) + '</b></td><td>' + lineHtml(r, 'qe-err', 'qe-err-period') + '</td></tr>');
        });
        w.line('</table></details>');
      });
    },

    diffData: function (result) {
      var d = result.reportData;
      if (!d || !d.compiled) return null;
      var rows = [];
      grouped(d).forEach(function (g) {
        g[1].forEach(function (r) {
          rows.push([g[0] + ' (' + g[1].length + ')', esc(r.ref), lineHtml(r, 'err', 'err-period')]);
        });
      });
      return { rows: rows };
    },
  });

})();

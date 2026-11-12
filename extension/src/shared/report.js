// Phils Checks core, part 6: the report.
// A port of Project_Checker\ProjectChecker\Services\ReportRenderer.cs (ReportWriter and one check's
// section). The section is an HTML fragment shown inside the extension's window, so its CSS is
// scoped to .pc-report. References are links (a.pc-go with data-ref "BOOK C:V") that the window
// turns into "go to this verse".
PC.report = (function () {
  'use strict';

  var BASE_CSS =
    '{font-family:"Segoe UI",Arial,sans-serif;color:#222;background:#fff}' +
    ' h2{font-size:1.25em;margin:4px 0 8px;border-bottom:2px solid #446;padding-bottom:3px}' +
    ' h3{font-size:1.05em;margin:14px 0 6px}' +
    ' details.pc-opts{margin:6px 0 10px;font-size:.9em}' +
    ' details.pc-opts table{margin-top:4px}' +
    ' .pc-mod{font-weight:bold;color:#7a3c00}' +
    ' .pc-note{background:#fff7d6;border:1px solid #e5cf7a;padding:4px 8px;margin:6px 0}' +
    ' .pc-fail{background:#fde2e2;border:1px solid #d99;padding:4px 8px;margin:6px 0}' +
    ' details.pc-group{margin:6px 0}' +
    ' details.pc-group>summary{cursor:pointer;font-weight:bold;padding:2px 0}' +
    ' table{border-collapse:collapse;margin:4px 0}' +
    ' th,td{border:1px solid #bbb;padding:3px 8px;vertical-align:top;text-align:left}' +
    ' th{background:#eef}' +
    ' a.pc-go{color:#0b5cad;text-decoration:none;cursor:pointer}' +
    ' a.pc-go:hover{text-decoration:underline}';

  /** Prefixes every selector of a CSS text with ".pc-report ". */
  function scope(css) {
    return css
      .split('}')
      .filter(function (rule) {
        return rule.trim().length > 0;
      })
      .map(function (rule) {
        var brace = rule.indexOf('{');
        var selectors = rule.substring(0, brace).split(',');
        return (
          selectors
            .map(function (s) {
              return '.pc-report ' + s.trim();
            })
            .join(',') +
          rule.substring(brace) +
          '}'
        );
      })
      .join('\n');
  }

  /** The CSS for a check's report section. */
  function css(def) {
    return '.pc-report' + BASE_CSS.split('}')[0] + '}\n' + scope(BASE_CSS.substring(BASE_CSS.indexOf('}') + 1)) + '\n' + scope(def.reportCss || defaultCss(def.cssPrefix));
  }

  function defaultCss(p) {
    return '.' + p + '-hl{color:#c00;font-weight:bold}.' + p + '-ref{white-space:nowrap}';
  }

  /** PyText.HtmlEscape: & < > only. */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Escaped for an attribute value. */
  function attr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }

  /** string.Format with {0} {1}... */
  function format(template, args) {
    return String(template).replace(/\{(\d+)\}/g, function (m, n) {
      var v = args[parseInt(n, 10)];
      return v === undefined ? m : String(v);
    });
  }

  /** The strings of one language: str(key) falls back to English, then to the key itself. */
  function lang(code) {
    var table = PC.strings[code] || PC.strings.en;
    function str(key) {
      if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
      if (Object.prototype.hasOwnProperty.call(PC.strings.en, key)) return PC.strings.en[key];
      return key;
    }
    return {
      code: PC.strings[code] ? code : 'en',
      str: str,
      fmt: function (key) {
        return format(str(key), Array.prototype.slice.call(arguments, 1));
      },
    };
  }

  /** A link that goes to a verse ("MAT 5:3"; a bare book code goes to its start). */
  function refLink(ref, html) {
    return '<a class="pc-go" data-ref="' + attr(ref) + '">' + (html === undefined ? esc(ref) : html) + '</a>';
  }

  function Writer() {
    this.parts = [];
  }
  Writer.prototype.line = function (html) {
    this.parts.push(html + '\n');
    return this;
  };
  Writer.prototype.toString = function () {
    return this.parts.join('');
  };

  /** CheckBase.RenderReport: one collapsible group per category, Reference | Text | Message. */
  function defaultReport(def, w, result, L) {
    if (result.findings.length === 0) {
      w.line('<p>' + esc(L.str('Rpt_NoFindings')) + '</p>');
      return;
    }
    var order = [];
    var groups = new Map();
    result.findings.forEach(function (f) {
      var cat = f.category || '';
      if (!groups.has(cat)) {
        groups.set(cat, []);
        order.push(cat);
      }
      groups.get(cat).push(f);
    });
    order.forEach(function (cat) {
      var title = L.str('Cat_' + def.id + '_' + cat);
      if (title.indexOf('Cat_') === 0) title = cat;
      var list = groups.get(cat);
      w.line('<details class="pc-group" open><summary>' + esc(title) + ' (' + list.length + ')</summary>');
      w.line(
        '<table><tr><th>' + esc(L.str('Rpt_Reference')) + '</th><th>' + esc(L.str('Rpt_Text')) + '</th><th>' +
          esc(L.str('Rpt_Message')) + '</th></tr>',
      );
      list.forEach(function (f) {
        var ref = f.inList ? f.bookCode + ' ' + f.chapter + ':' + f.verse : f.bookCode;
        w.line(
          '<tr><td class="' + def.cssPrefix + '-ref">' + refLink(ref) + '</td><td>' + esc(f.context || '') + '</td><td>' +
            esc(f.localize ? f.localize(L) : f.message || '') + '</td></tr>',
        );
      });
      w.line('</table></details>');
    });
  }

  /** ReportRenderer.AppendOptions */
  function options(def, result, L) {
    if (def.options.length === 0) return '';
    var html =
      '<details class="pc-opts"><summary>' + esc(L.str('Rpt_OptionsUsed')) + '</summary><table><tr><th>' +
      esc(L.str('Rpt_Option')) + '</th><th>' + esc(L.str('Rpt_Value')) + '</th></tr>';
    def.options.forEach(function (d) {
      var v = result.optionsUsed[d.name];
      if (v === undefined) v = d.def;
      var label = L.str('Opt_' + def.id + '_' + d.name + '_Label');
      if (label.indexOf('Opt_') === 0) label = d.name;
      html +=
        '<tr><td>' + esc(label) + ' <code>' + esc(d.name) + '</code></td><td' + (v !== d.def ? ' class="pc-mod"' : '') + '>' +
        esc(v.length === 0 ? '(' + L.str('Rpt_Empty') + ')' : v) + '</td></tr>';
    });
    return html + '</table></details>\n';
  }

  /** One check's section: heading, options used, notes, then the check's own report. */
  function section(def, result, langCode) {
    var L = lang(langCode);
    var parts = [];
    parts.push('<section class="' + def.cssPrefix + '-section">\n');
    parts.push('<h2>' + esc(L.str('Check_' + def.id + '_Name')) + '</h2>\n');
    parts.push(options(def, result, L));
    result.notes.forEach(function (n) {
      parts.push('<p class="pc-note">' + esc(L.fmt.apply(null, [n.key].concat(n.args))) + '</p>\n');
    });
    var w = new Writer();
    if (def.renderReport) def.renderReport(w, result, L);
    else defaultReport(def, w, result, L);
    parts.push(w.toString());
    parts.push('</section>\n');
    return parts.join('');
  }

  return {
    css: css,
    esc: esc,
    attr: attr,
    format: format,
    lang: lang,
    refLink: refLink,
    Writer: Writer,
    section: section,
  };
})();

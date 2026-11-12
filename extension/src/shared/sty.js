// Phils Checks core, part 3: the stylesheet.
// A port of Project_Checker\ProjectChecker\Services\StylesheetService.cs (the _parse_sty /
// _merge_sty / _flag_on / _color_css / _marker_css shared by the report checks).
// A stylesheet is a Map: marker -> Map(lowercased field name -> value).
// In Paratext 10 it comes from platformScripture.StyleInfo (fromStyleInfo); the built-in usfm.sty
// and the tests use parse + merge.
PC.sty = (function () {
  'use strict';

  var T = PC.text;

  /** ParseStyText: a \Marker line opens an entry; other \Field lines set a field on it. */
  function parse(text) {
    var entries = new Map();
    var current = null;
    T.splitLines(text || '').forEach(function (raw) {
      var stripped = T.strip(raw);
      if (stripped.length === 0 || stripped[0] === '#' || stripped[0] !== '\\') return;
      var parts = T.split(stripped.substring(1), 1);
      if (parts.length === 0) return;
      var field = parts[0];
      var value = parts.length > 1 ? T.strip(parts[1]) : '';
      if (field === 'Marker') {
        current = entries.get(value);
        if (!current) {
          current = new Map();
          entries.set(value, current);
        }
      } else if (current) current.set(T.lower(field), value);
    });
    return entries;
  }

  /** usfm.sty with custom.sty laid over it, field by field. */
  function merge(base, custom) {
    var markers = new Map();
    base.forEach(function (fields, key) {
      markers.set(key, new Map(fields));
    });
    custom.forEach(function (fields, key) {
      var target = markers.get(key);
      if (!target) {
        target = new Map();
        markers.set(key, target);
      }
      fields.forEach(function (v, f) {
        target.set(f, v);
      });
    });
    return markers;
  }

  /**
   * The same table from Paratext 10's StyleInfo (merged usfm.sty + custom.sty, already resolved:
   * \Regular, \Color/\ColorName...). Its color is "#RRGGBB", kept as field "colorcss".
   */
  function fromStyleInfo(info) {
    var markers = new Map();
    var all = (info && info.markers) || {};
    Object.keys(all).forEach(function (key) {
      var s = all[key] || {};
      var f = new Map();
      if (s.styleType) f.set('styletype', String(s.styleType));
      if (s.endMarker) f.set('endmarker', String(s.endMarker));
      if (s.bold) f.set('bold', '');
      if (s.italic) f.set('italic', '');
      if (s.superscript) f.set('superscript', '');
      if (s.smallCaps) f.set('smallcaps', '');
      if (s.underline) f.set('underline', '');
      if (s.color && /^#[0-9a-fA-F]{6}$/.test(s.color)) f.set('colorcss', s.color);
      markers.set(s.marker || key, f);
    });
    return markers;
  }

  /** _flag_on: the field is present and not no/off/false/0. */
  function flagOn(fields, name) {
    if (!fields || !fields.has(name)) return false;
    var v = T.lower(T.strip(fields.get(name) || ''));
    return v !== 'no' && v !== 'off' && v !== 'false' && v !== '0';
  }

  /** _color_css: \Color is a Windows COLORREF decimal (R = low byte, B = high byte). */
  function colorCss(value) {
    if (value === null || value === undefined) return null;
    var v = T.strip(value);
    if (!/^[+-]?\d+$/.test(v)) return null;
    var n = parseInt(v, 10);
    if (!isFinite(n)) return null;
    // long arithmetic: & on a 64-bit value; JavaScript's & works on 32 bits, enough for 3 bytes.
    var r = n & 0xff;
    var g = (n >> 8) & 0xff;
    var b = (n >> 16) & 0xff;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /** _marker_css */
  function markerCss(fields) {
    if (!fields || fields.size === 0) return '';
    var parts = [];
    if (flagOn(fields, 'bold')) parts.push('font-weight:bold');
    if (flagOn(fields, 'italic')) parts.push('font-style:italic');
    if (flagOn(fields, 'superscript')) parts.push('vertical-align:super;font-size:smaller');
    if (flagOn(fields, 'smallcaps')) parts.push('font-variant:small-caps');
    if (flagOn(fields, 'underline')) parts.push('text-decoration:underline');
    if (fields.has('colorcss')) parts.push('color:' + fields.get('colorcss'));
    else if (fields.get('color')) {
      var css = colorCss(fields.get('color'));
      if (css) parts.push('color:' + css);
    }
    return parts.join(';');
  }

  /** Markers whose \StyleType is "character" (case-insensitive). */
  function characterStyles(sty) {
    var set = new Set();
    sty.forEach(function (fields, key) {
      var t = fields.get('styletype');
      if (t !== undefined && T.lower(T.strip(t)) === 'character') set.add(key);
    });
    return set;
  }

  return {
    parse: parse,
    merge: merge,
    fromStyleInfo: fromStyleInfo,
    flagOn: flagOn,
    colorCss: colorCss,
    markerCss: markerCss,
    characterStyles: characterStyles,
  };
})();

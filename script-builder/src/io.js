/* ==========================================================================
   JanitorAI Script Builder: import / export formats
   Detects what a file or pasted text is, turns it into project data, and
   writes every export format.  Pure functions; runs in the browser and in
   Node (for tests).  No network.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./generator.js'), require('acorn'), require('acorn-walk'));
  else root.JSBIO = factory(root.JSB, root.acorn, root.acorn && root.acorn.walk);
})(typeof self !== 'undefined' ? self : this, function (J, acorn, walk) {
  'use strict';

  var CODE_PREFIX = 'JSB1:';
  var EMBED_OPEN = '/* JSB-PROJECT:', EMBED_CLOSE = ' */';

  /* ---------- text helpers ---------- */
  function s(v) { return v === undefined || v === null ? '' : String(v); }
  function trim(v) { return s(v).replace(/^\s+|\s+$/g, ''); }
  function utf8Encode(str) { return new TextEncoder().encode(str); }
  function utf8Decode(bytes) { return new TextDecoder('utf-8').decode(bytes); }
  function bytesToB64(bytes) {
    var bin = '', i, CH = 0x8000;
    for (i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = atob(String(b64).replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64EncodeText(str) { return bytesToB64(utf8Encode(str)); }
  function b64DecodeText(b64) { return utf8Decode(b64ToBytes(b64)); }
  function stripBom(t) { return s(t).replace(/^\ufeff/, ''); }

  /* ---------- project codes and script embeds ---------- */
  function cleanProject(p) { return JSON.parse(JSON.stringify(J.normalize(p))); }
  function projectJSON(p) { return JSON.stringify(cleanProject(p), null, 2); }
  function projectCode(p) { return CODE_PREFIX + b64EncodeText(JSON.stringify(cleanProject(p))); }
  function parseProjectCode(text) {
    var t = trim(text).replace(/\s+/g, '');
    if (t.indexOf(CODE_PREFIX) !== 0) return null;
    return JSON.parse(b64DecodeText(t.slice(CODE_PREFIX.length)));
  }
  function embedComment(p) { return '\n' + EMBED_OPEN + b64EncodeText(JSON.stringify(cleanProject(p))) + EMBED_CLOSE + '\n'; }
  function scriptText(p, compiled, opts) {
    opts = opts || {};
    var c = compiled || J.compile(p);
    var parts = opts.index !== undefined && c.scripts[opts.index] ? [c.scripts[opts.index].code] : [c.code];
    var code = parts.join('\n');
    if (opts.embed) code = code.replace(/\s*$/, '\n') + embedComment(p);
    return code;
  }
  function findEmbed(text) {
    var i = text.lastIndexOf(EMBED_OPEN);
    if (i === -1) return null;
    var j = text.indexOf(EMBED_CLOSE, i + EMBED_OPEN.length);
    if (j === -1) return null;
    return JSON.parse(b64DecodeText(text.slice(i + EMBED_OPEN.length, j)));
  }

  /* ---------- PNG character cards ---------- */
  var PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  function isPng(bytes) { if (!bytes || bytes.length < 8) return false; for (var i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false; return true; }
  function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function latin1(bytes) { var t = ''; for (var i = 0; i < bytes.length; i++) t += String.fromCharCode(bytes[i]); return t; }
  /* Returns {keyword: text} for tEXt and uncompressed iTXt chunks. */
  function pngTextChunks(bytes) {
    var out = {}, o = 8;
    while (o + 8 <= bytes.length) {
      var len = u32(bytes, o), type = latin1(bytes.subarray(o + 4, o + 8)), data = bytes.subarray(o + 8, o + 8 + len);
      if (type === 'tEXt') {
        var z = Array.prototype.indexOf.call(data, 0);
        if (z > 0) out[latin1(data.subarray(0, z)).toLowerCase()] = latin1(data.subarray(z + 1));
      } else if (type === 'iTXt') {
        var z2 = Array.prototype.indexOf.call(data, 0);
        if (z2 > 0 && data[z2 + 1] === 0) {
          var k = latin1(data.subarray(0, z2)).toLowerCase(), p = z2 + 3;
          var l1 = Array.prototype.indexOf.call(data, 0, p); var l2 = Array.prototype.indexOf.call(data, 0, l1 + 1);
          if (l1 !== -1 && l2 !== -1) out[k] = utf8Decode(data.subarray(l2 + 1));
        }
      }
      if (type === 'IEND') break;
      o += 12 + len;
    }
    return out;
  }
  function cardFromPng(bytes) {
    var t = pngTextChunks(bytes), raw = t.ccv3 || t.chara;
    if (!raw) throw new Error('This PNG has no character card data inside (no "chara" or "ccv3" text chunk). It may be a plain image, or the site stripped the data.');
    var txt = /^\s*[{[]/.test(raw) ? raw : b64DecodeText(raw);
    return JSON.parse(txt);
  }
  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) { CRC_TABLE = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    var out = new Uint8Array(12 + data.length), i;
    var len = data.length;
    out[0] = len >>> 24; out[1] = (len >>> 16) & 255; out[2] = (len >>> 8) & 255; out[3] = len & 255;
    for (i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    var c = crc32(out.subarray(4, 8 + len));
    out[8 + len] = c >>> 24; out[9 + len] = (c >>> 16) & 255; out[10 + len] = (c >>> 8) & 255; out[11 + len] = c & 255;
    return out;
  }
  function textChunk(keyword, text) {
    var data = new Uint8Array(keyword.length + 1 + text.length), i;
    for (i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i);
    data[keyword.length] = 0;
    for (i = 0; i < text.length; i++) data[keyword.length + 1 + i] = text.charCodeAt(i) & 255;
    return chunk('tEXt', data);
  }
  /* Adds chara (V2) and ccv3 (V3) chunks before IEND, replacing old ones. */
  function pngWithCard(pngBytes, v2, v3) {
    if (!isPng(pngBytes)) throw new Error('Not a PNG');
    var parts = [pngBytes.subarray(0, 8)], o = 8, iend = null;
    while (o + 8 <= pngBytes.length) {
      var len = u32(pngBytes, o), type = latin1(pngBytes.subarray(o + 4, o + 8)), whole = pngBytes.subarray(o, o + 12 + len);
      if (type === 'IEND') { iend = whole; break; }
      var skip = false;
      if (type === 'tEXt' || type === 'iTXt') { var d = pngBytes.subarray(o + 8, o + 8 + len); var z = Array.prototype.indexOf.call(d, 0); var k = latin1(d.subarray(0, z)).toLowerCase(); skip = k === 'chara' || k === 'ccv3'; }
      if (!skip) parts.push(whole);
      o += 12 + len;
    }
    parts.push(textChunk('chara', b64EncodeText(JSON.stringify(v2))));
    if (v3) parts.push(textChunk('ccv3', b64EncodeText(JSON.stringify(v3))));
    parts.push(iend || chunk('IEND', new Uint8Array(0)));
    var total = 0; parts.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- character cards ---------- */
  function isCard(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return false;
    if (typeof d.spec === 'string' && /chara_card/.test(d.spec)) return true;
    return typeof d.name === 'string' && (d.first_mes !== undefined || d.description !== undefined || d.char_persona !== undefined) && !d.modules;
  }
  function cardInfo(d) {
    var c = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d;
    var book = c.character_book || null;
    var entries = [];
    if (book) { try { entries = J.importLorebook(book); } catch (e) { entries = []; } }
    return {
      spec: d.spec || 'chara_card_v1', name: s(c.name || c.char_name), description: s(c.description || c.char_persona),
      personality: s(c.personality), scenario: s(c.scenario || c.world_scenario), first_mes: s(c.first_mes || c.char_greeting),
      creator_notes: s(c.creator_notes), tags: Array.isArray(c.tags) ? c.tags : [], bookName: book ? s(book.name) : '', entries: entries
    };
  }
  /* opts: {fields, lore, replaceLore} */
  function applyCard(project, info, opts) {
    opts = opts || {};
    var p = J.normalize(project);
    if (opts.fields !== false) {
      if (info.name) { p.card.name = info.name; p.meta.character = info.name; if (!p.meta.title || p.meta.title === 'My Janitor Script') p.meta.title = info.name; }
      if (info.personality) p.card.psych = info.personality;
      if (info.scenario) p.card.sceneNotes = info.scenario;
      var notes = [];
      if (info.description) notes.push('Imported description:\n' + info.description);
      if (info.first_mes) notes.push('First message:\n' + info.first_mes);
      if (notes.length) p.meta.notes = trim((p.meta.notes ? p.meta.notes + '\n\n' : '') + notes.join('\n\n')).slice(0, 20000);
    }
    if (opts.lore !== false && info.entries.length) p = mergeLore(p, info.entries, opts.replaceLore ? 'replace' : 'append');
    return p;
  }
  function mergeLore(project, entries, mode) {
    var p = J.normalize(project), lb = p.modules.lorebook;
    if (mode === 'replace') lb.entries = [];
    var used = {};
    lb.entries.forEach(function (e) { used[e.id] = true; });
    entries.forEach(function (e) {
      var base = e.id || J.slug(e.name || 'entry'), id = base, n = 2;
      while (used[id]) id = base + '_' + (n++);
      used[id] = true; e.id = id;
      lb.entries.push(e);
    });
    if (entries.length) lb.enabled = true;
    return p;
  }

  /* ---------- CSV ---------- */
  var CSV_COLS = ['name', 'keys', 'text', 'secondary', 'logic', 'group', 'weight', 'prob', 'minMsg', 'maxMsg', 'depth', 'always', 'target', 'prio', 'cs', 'ww', 'enabled', 'id', 'comment'];
  function csvCell(v) { v = s(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function loreCSV(p) {
    var rows = [CSV_COLS.join(',')];
    J.normalize(p).modules.lorebook.entries.forEach(function (e) {
      rows.push(CSV_COLS.map(function (c) { var v = e[c]; if (typeof v === 'boolean') v = v ? 'yes' : 'no'; return csvCell(v); }).join(','));
    });
    return rows.join('\r\n') + '\r\n';
  }
  function parseCSV(text) {
    text = stripBom(text);
    var first = text.split(/\r?\n/)[0] || '';
    var delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    var rows = [], row = [], cell = '', q = false, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text.charAt(i + 1) === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return trim(c) !== ''; }); });
  }
  var CSV_ALIASES = { name: 'name', title: 'name', comment: 'comment', memo: 'comment', keys: 'keys', key: 'keys', keywords: 'keys', triggers: 'keys', trigger: 'keys', text: 'text', content: 'text', entry: 'text', lore: 'text', description: 'text', secondary: 'secondary', secondary_keys: 'secondary', keysecondary: 'secondary', logic: 'logic', group: 'group', weight: 'weight', groupweight: 'weight', prob: 'prob', probability: 'prob', chance: 'prob', minmsg: 'minMsg', min_messages: 'minMsg', minmessages: 'minMsg', maxmsg: 'maxMsg', depth: 'depth', always: 'always', constant: 'always', target: 'target', prio: 'prio', priority: 'prio', order: 'prio', cs: 'cs', case_sensitive: 'cs', ww: 'ww', whole_words: 'ww', enabled: 'enabled', id: 'id' };
  function yes(v) { return /^(1|y|yes|true|on|x)$/i.test(trim(v)); }
  function loreFromCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) throw new Error('The CSV needs a header row and at least one entry.');
    var head = rows[0].map(function (h) { return CSV_ALIASES[trim(h).toLowerCase().replace(/[\s-]+/g, '_')] || CSV_ALIASES[trim(h).toLowerCase().replace(/[\s_-]+/g, '')] || null; });
    if (head.indexOf('text') === -1) throw new Error('The CSV needs a "text" (or "content") column. Found: ' + rows[0].join(', '));
    return rows.slice(1).map(function (r, n) {
      var o = {};
      head.forEach(function (k, i) { if (k && r[i] !== undefined) o[k] = r[i]; });
      ['weight', 'prob', 'minMsg', 'maxMsg', 'depth', 'prio'].forEach(function (k) { if (o[k] !== undefined) { var x = parseFloat(o[k]); if (isNaN(x)) delete o[k]; else o[k] = x; } });
      ['always', 'cs', 'enabled'].forEach(function (k) { if (o[k] !== undefined) o[k] = yes(o[k]); });
      if (o.ww !== undefined) o.ww = trim(o.ww) === '' ? true : yes(o.ww);
      if (o.logic) o.logic = trim(o.logic).toUpperCase().replace(/\s+/g, '_');
      if (o.target) o.target = /pers/i.test(o.target) ? 'personality' : 'scenario';
      if (!o.name) o.name = trim(o.keys).split(',')[0] || 'Entry ' + (n + 1);
      if (!o.id) o.id = J.slug(o.name);
      return J.newLore(o);
    }).filter(function (e) { return trim(e.text); });
  }

  /* ---------- plain text ---------- */
  /* Two layouts:
       ## Name            (or [Name])
       Keys: a, b
       Text lines...
     or paragraphs separated by blank lines, where "Name: text" makes Name the key. */
  function loreText(p) {
    return J.normalize(p).modules.lorebook.entries.map(function (e) {
      var lines = ['## ' + (trim(e.name) || e.id)];
      if (e.always) lines.push('Always: yes'); else lines.push('Keys: ' + trim(e.keys));
      if (trim(e.secondary)) lines.push('Secondary: ' + trim(e.secondary));
      if (trim(e.group)) lines.push('Group: ' + trim(e.group));
      if (e.target === 'personality') lines.push('Target: personality');
      if (e.minMsg) lines.push('Min messages: ' + e.minMsg);
      if (e.prob !== undefined && e.prob < 100) lines.push('Probability: ' + e.prob);
      lines.push(trim(e.text));
      return lines.join('\n');
    }).join('\n\n');
  }
  var TXT_FIELDS = { keys: 'keys', key: 'keys', keywords: 'keys', triggers: 'keys', trigger: 'keys', secondary: 'secondary', group: 'group', target: 'target', always: 'always', constant: 'always', 'min messages': 'minMsg', minmsg: 'minMsg', probability: 'prob', chance: 'prob', priority: 'prio', id: 'id' };
  function loreFromText(text) {
    text = stripBom(text).replace(/\r\n?/g, '\n');
    var lines = text.split('\n');
    var headed = lines.some(function (l) { return /^\s*(#{1,3}\s+\S|\[[^\]]+\]\s*$)/.test(l); });
    var out = [];
    function finish(cur) {
      if (!cur) return;
      var body = trim(cur.body.join('\n'));
      if (!body) return;
      var o = { name: cur.name, text: body };
      Object.keys(cur.f).forEach(function (k) { o[k] = cur.f[k]; });
      if (o.always !== undefined) o.always = yes(o.always);
      if (o.target) o.target = /pers/i.test(o.target) ? 'personality' : 'scenario';
      ['minMsg', 'prob', 'prio'].forEach(function (k) { if (o[k] !== undefined) o[k] = parseFloat(o[k]) || 0; });
      if (!o.keys && !o.always) o.keys = cur.name.toLowerCase();
      o.id = o.id || J.slug(cur.name);
      out.push(J.newLore(o));
    }
    if (headed) {
      var cur = null;
      lines.forEach(function (l) {
        var m = /^\s*#{1,3}\s+(.+?)\s*$/.exec(l) || /^\s*\[([^\]]+)\]\s*$/.exec(l);
        if (m) { finish(cur); cur = { name: trim(m[1]), f: {}, body: [] }; return; }
        if (!cur) return;
        var f = /^\s*([A-Za-z][A-Za-z ]{1,14}):\s*(.*)$/.exec(l);
        if (f && !cur.body.length && TXT_FIELDS[f[1].toLowerCase()]) { cur.f[TXT_FIELDS[f[1].toLowerCase()]] = trim(f[2]); return; }
        cur.body.push(l);
      });
      finish(cur);
    } else {
      text.split(/\n\s*\n/).forEach(function (para) {
        para = trim(para); if (!para) return;
        var m = /^([^:\n]{2,40}):\s+([\s\S]+)$/.exec(para);
        var name = m ? trim(m[1]) : para.split(/\s+/).slice(0, 3).join(' ');
        finish({ name: name, f: m ? {} : { keys: '' }, body: [m ? m[2] : para] });
      });
      out.forEach(function (e) { if (!trim(e.keys)) e.keys = e.name.toLowerCase(); });
    }
    return out;
  }

  /* ---------- Markdown notes with front matter (Obsidian vaults) ----------
     One or more notes pasted together, each like:
       ---
       keys: [sword, blade]      (or keywords / triggers / aliases)
       priority: 5
       ---
       # Title
       Body text, [[wiki links]] become plain words. */
  function fmList(v) {
    v = trim(v);
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1);
    return v.split(',').map(function (x) { return trim(x).replace(/^["']|["']$/g, ''); }).filter(Boolean);
  }
  function loreFromNotes(text) {
    text = stripBom(text).replace(/\r\n?/g, '\n');
    if (!/^---\n/.test(text)) return [];
    var out = [], parts = text.split(/^---[ \t]*$/m), i;
    /* parts: '', fm1, body1, fm2, body2 ... (a body may hold the next note's opening ---) */
    for (i = 1; i + 1 < parts.length; i += 2) {
      var fm = {}, lastKey = null, body = parts[i + 1];
      parts[i].split('\n').forEach(function (l) {
        var m = /^([A-Za-z_][\w -]*):\s*(.*)$/.exec(l), li = /^\s+-\s+(.+)$/.exec(l);
        if (m) { lastKey = m[1].toLowerCase().replace(/[\s-]+/g, '_'); fm[lastKey] = trim(m[2]); }
        else if (li && lastKey) { fm[lastKey] = (fm[lastKey] && fm[lastKey] !== '[]' ? fm[lastKey].replace(/^\[|\]$/g, '') + ', ' : '') + trim(li[1]); }
      });
      var hm = /^\s*#\s+(.+?)\s*$/m.exec(body);
      var name = trim(fm.title || fm.name || (hm ? hm[1] : '') || 'Note ' + ((i + 1) / 2));
      if (hm) body = body.replace(hm[0], '');
      body = trim(body.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1'));
      if (!body) continue;
      var keys = fmList(fm.keys || fm.keywords || fm.triggers || fm.key || '');
      if (!keys.length) keys = [name.toLowerCase()];
      keys = keys.concat(fmList(fm.aliases || ''));
      if (/^(true|yes|1)$/i.test(trim(fm.enabled || 'yes')) === false) continue;
      var o = { name: name, text: body, keys: keys.length ? keys.join(', ') : name.toLowerCase() };
      if (/^(true|yes|1)$/i.test(trim(fm.constant || fm.always || ''))) o.always = true;
      if (fm.priority !== undefined && !isNaN(parseFloat(fm.priority))) o.prio = parseFloat(fm.priority);
      if (fm.group) o.group = trim(fm.group);
      if (fm.secondary || fm.secondary_keys) o.secondary = fmList(fm.secondary || fm.secondary_keys).join(', ');
      if (fm.target) o.target = /pers/i.test(fm.target) ? 'personality' : 'scenario';
      if (fm.probability !== undefined && !isNaN(parseFloat(fm.probability))) o.prob = parseFloat(fm.probability);
      o.id = J.slug(name);
      out.push(J.newLore(o));
    }
    return out;
  }

  /* ---------- lore from an existing Janitor script ---------- */
  var KEY_PROPS = { keys: 1, keywords: 1, key: 1, triggers: 1, trigger: 1, words: 1, tags: 1, match: 1 };
  var TEXT_PROPS = { text: 'scenario', content: 'scenario', entry: 'scenario', lore: 'scenario', info: 'scenario', scenario: 'scenario', personality: 'personality', response: 'scenario', inject: 'scenario', description: 'scenario', value: 'scenario' };
  function literal(n) {
    if (!n) return undefined;
    if (n.type === 'Literal') return n.value;
    if (n.type === 'TemplateLiteral' && !n.expressions.length) return n.quasis[0].value.cooked;
    if (n.type === 'BinaryExpression' && n.operator === '+') { var a = literal(n.left), b = literal(n.right); return typeof a === 'string' && typeof b === 'string' ? a + b : undefined; }
    if (n.type === 'ArrayExpression') { var arr = n.elements.map(literal); return arr.every(function (x) { return typeof x === 'string'; }) ? arr : undefined; }
    if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal') return -n.argument.value;
    return undefined;
  }
  function propName(pr) { return pr.key.type === 'Identifier' ? pr.key.name : s(pr.key.value); }
  function loreFromScript(code) {
    if (!acorn) return [];
    var ast;
    try { ast = acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true }); } catch (e) { return []; }
    var out = [], seen = {};
    walk.full(ast, function (n) {
      if (n.type !== 'ObjectExpression') return;
      var keys = null, texts = [], o = {};
      n.properties.forEach(function (pr) {
        if (pr.type !== 'Property' || pr.computed) return;
        var k = propName(pr), lk = k.toLowerCase(), v = literal(pr.value);
        if (KEY_PROPS[lk] && (Array.isArray(v) || typeof v === 'string')) keys = Array.isArray(v) ? v : J.splitKeys(v);
        else if (TEXT_PROPS[lk] && typeof v === 'string' && trim(v)) texts.push({ target: TEXT_PROPS[lk], text: v });
        else if (/^(name|title|comment|id|label)$/.test(lk) && typeof v === 'string') o.name = o.name || v;
        else if (/^(minmsg|minmessages|min_messages|min)$/.test(lk) && typeof v === 'number') o.minMsg = v;
        else if (/^(probability|prob|chance)$/.test(lk) && typeof v === 'number') o.prob = v <= 1 && v > 0 ? Math.round(v * 100) : v;
        else if (/^(priority|prio|order)$/.test(lk) && typeof v === 'number') o.prio = v;
        else if (lk === 'group' && typeof v === 'string') o.group = v;
      });
      if (!keys || !keys.length || !texts.length) return;
      texts.forEach(function (t, i) {
        var sig = keys.join(',') + '|' + t.text;
        if (seen[sig]) return; seen[sig] = true;
        var name = o.name || keys[0];
        out.push(J.newLore({ name: name + (texts.length > 1 ? ' (' + t.target + ')' : ''), id: J.slug(name) + (texts.length > 1 ? '_' + t.target.slice(0, 4) : ''), keys: keys.join(', '), text: t.text, target: t.target, minMsg: o.minMsg || 0, prob: o.prob === undefined ? 100 : o.prob, prio: o.prio === undefined ? 10 : o.prio, group: o.group || '' }));
      });
    });
    return out;
  }

  /* ---------- exports ---------- */
  function stWorldInfo(p) {
    var list = J.exportLorebook(p), entries = {};
    list.forEach(function (e, i) {
      entries[i] = Object.assign({ uid: i, key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: false, selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false, probability: 100, useProbability: true, depth: 4, group: '', groupOverride: false, groupWeight: 100, scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: null, sticky: 0, cooldown: 0, delay: 0, displayIndex: i }, e);
      entries[i].useProbability = true;
    });
    return { entries: entries, name: J.normalize(p).meta.title || 'Lorebook' };
  }
  function v2Book(p) {
    var P = J.normalize(p);
    return {
      name: P.meta.title || 'Lorebook', description: '', scan_depth: P.modules.lorebook.depth || 3, token_budget: P.settings.maxChars || 2500, recursive_scanning: false, extensions: {},
      entries: P.modules.lorebook.entries.map(function (e, i) {
        return {
          keys: J.splitKeys(e.keys), content: trim(e.text), extensions: { position: 0, probability: e.prob, useProbability: e.prob < 100, depth: e.depth || 4, selectiveLogic: { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 }[e.logic] || 0, group: trim(e.group), group_weight: e.weight, match_whole_words: e.ww !== false, case_sensitive: !!e.cs },
          enabled: e.enabled !== false, insertion_order: e.prio, case_sensitive: !!e.cs, name: trim(e.name) || e.id, priority: e.prio, id: i, comment: trim(e.name) || e.id,
          selective: J.splitKeys(e.secondary).length > 0, secondary_keys: J.splitKeys(e.secondary), constant: !!e.always, position: 'before_char'
        };
      })
    };
  }
  /* V2 card: card blocks become personality / scenario, the lorebook rides along. */
  function v2Card(p) {
    var P = J.normalize(p), b = J.cardBlocks(P), c = P.card;
    var data = {
      name: trim(c.name) || trim(P.meta.character) || trim(P.meta.title) || 'Character',
      description: [trim(c.role), trim(c.appearance)].filter(Boolean).join('\n'),
      personality: b.personality, scenario: b.scenario, first_mes: '', mes_example: '',
      creator_notes: trim(P.meta.notes) ? 'Builder notes: ' + trim(P.meta.notes).slice(0, 2000) : 'Made with JanitorAI Script Builder ' + J.VERSION + '.',
      system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1.0',
      extensions: { jsb_project: cleanProject(P) }
    };
    if (P.modules.lorebook.entries.length) data.character_book = v2Book(P);
    return { spec: 'chara_card_v2', spec_version: '2.0', data: data };
  }
  function v3Card(p) {
    var v2 = v2Card(p), d = JSON.parse(JSON.stringify(v2.data));
    d.group_only_greetings = []; d.assets = [];
    if (d.character_book) d.character_book.entries.forEach(function (e) { e.use_regex = e.keys.some(function (k) { return /^\/.+\/[a-z]*$/.test(k); }); });
    return { spec: 'chara_card_v3', spec_version: '3.0', data: d };
  }
  function cardBlocksText(p) { var b = J.cardBlocks(p); return '=== PERSONALITY FIELD ===\n\n' + b.personality + '\n\n=== SCENARIO FIELD ===\n\n' + b.scenario + '\n'; }

  /* ---------- detection ---------- */
  function lorebookShape(d) {
    if (!d || typeof d !== 'object') return false;
    var e = Array.isArray(d) ? d : d.entries || (Array.isArray(d.data) ? d.data : null);
    if (!e || typeof e !== 'object') return false;
    var list = Array.isArray(e) ? e : Object.keys(e).map(function (k) { return e[k]; });
    return list.length > 0 && list.some(function (x) { return x && typeof x === 'object' && (x.content !== undefined || x.entry !== undefined || x.text !== undefined || x.value !== undefined); });
  }
  /* input: {text} or {bytes, name}.  Returns a plan the UI can show and apply. */
  function detect(input) {
    var name = s(input.name), bytes = input.bytes, text = input.text;
    try {
      if (bytes && isPng(bytes)) {
        var card = cardFromPng(bytes);
        return planCard(card, 'PNG character card');
      }
      if (bytes && !text) text = utf8Decode(bytes);
      text = stripBom(text);
      var t = trim(text);
      if (!t) return { kind: 'none', error: 'There is nothing to import.' };
      if (t.replace(/\s+/g, '').indexOf(CODE_PREFIX) === 0) return { kind: 'project', label: 'Project code', project: J.normalize(parseProjectCode(t)) };
      if (/^data:image\/png;base64,/.test(t)) return detect({ bytes: b64ToBytes(t.split(',')[1]), name: name });
      var json = null;
      if (/^[{[]/.test(t)) { try { json = JSON.parse(t); } catch (e) { if (/\.json$/i.test(name) || t.charAt(0) === '{' || !/^\[[^\]\n]+\]\s*\n/.test(t)) return { kind: 'none', error: 'This looks like JSON but it has a mistake in it (' + e.message + '). Check that you copied the whole thing, from the first { or [ to the last } or ].' }; } }
      if (json !== null) {
        if (json && typeof json === 'object' && !Array.isArray(json) && (json.modules || json.jsb)) return { kind: 'project', label: 'Builder project' + (json.meta && json.meta.title ? ': ' + json.meta.title : ''), project: J.normalize(json) };
        if (json && json.data && json.data.extensions && json.data.extensions.jsb_project) return { kind: 'project', label: 'Builder card with project data: ' + s(json.data.name), project: J.normalize(json.data.extensions.jsb_project), card: cardInfo(json) };
        if (isCard(json)) return planCard(json, 'Character card (' + (json.spec || 'V1') + ')');
        if (lorebookShape(json) || (json.character_book && lorebookShape(json.character_book))) {
          var entries = J.importLorebook(json);
          var kind = json.lorebookVersion ? 'NovelAI lorebook' : json.kind === 'memory' ? 'Agnai memory book' : json.type === 'risu' ? 'RisuAI lorebook' : Array.isArray(json) ? 'Lorebook entries list' : json.entries && !Array.isArray(json.entries) ? 'SillyTavern World Info' : 'Lorebook';
          return { kind: 'lorebook', label: kind, entries: entries };
        }
        return { kind: 'none', error: 'This JSON is not a project, character card or lorebook the builder knows. Expected keys like "modules", "spec"/"data", or "entries".' };
      }
      var embed = null;
      try { embed = findEmbed(t); } catch (e) { embed = null; }
      if (embed) return { kind: 'project', label: 'Script with builder project data inside', project: J.normalize(embed) };
      var looksJs = /\.js$/i.test(name) || /context\s*\.\s*(chat|character)/.test(t) || /^\s*(\/\*|\/\/|var |function |\(function|const |let )/.test(t);
      if (looksJs) {
        var lore = loreFromScript(t);
        return { kind: 'script', label: 'Janitor script' + (lore.length ? ' with ' + lore.length + ' lore-style entries found' : ''), code: t, entries: lore };
      }
      var firstLine = t.split(/\r?\n/)[0];
      if (/\.(csv|tsv)$/i.test(name) || (/(^|[,;\t])\s*"?(text|content|entry)"?\s*([,;\t]|$)/i.test(firstLine) && /[,;\t]/.test(firstLine))) {
        return { kind: 'lorebook', label: 'Lorebook spreadsheet (CSV)', entries: loreFromCSV(t) };
      }
      var notes = loreFromNotes(t);
      if (notes.length) return { kind: 'lorebook', label: 'Markdown notes (Obsidian style)', entries: notes };
      var tl = loreFromText(t);
      if (tl.length) return { kind: 'lorebook', label: 'Plain-text lore', entries: tl };
      return { kind: 'none', error: 'Could not recognise this text.' };
    } catch (e) {
      return { kind: 'none', error: e && e.message ? e.message : String(e) };
    }
  }
  function planCard(json, label) {
    var info = cardInfo(json);
    if (json.data && json.data.extensions && json.data.extensions.jsb_project) return { kind: 'project', label: label + ' made with this builder', project: J.normalize(json.data.extensions.jsb_project), card: info };
    return { kind: 'card', label: label + ': ' + (info.name || 'unnamed'), card: info, entries: info.entries };
  }

  return {
    CODE_PREFIX: CODE_PREFIX,
    projectJSON: projectJSON, projectCode: projectCode, parseProjectCode: parseProjectCode,
    scriptText: scriptText, findEmbed: findEmbed,
    isPng: isPng, pngTextChunks: pngTextChunks, cardFromPng: cardFromPng, pngWithCard: pngWithCard, crc32: crc32,
    cardInfo: cardInfo, applyCard: applyCard, mergeLore: mergeLore,
    loreCSV: loreCSV, loreFromCSV: loreFromCSV, parseCSV: parseCSV,
    loreText: loreText, loreFromText: loreFromText, loreFromNotes: loreFromNotes, loreFromScript: loreFromScript,
    stWorldInfo: stWorldInfo, v2Book: v2Book, v2Card: v2Card, v3Card: v3Card, cardBlocksText: cardBlocksText,
    detect: detect, b64EncodeText: b64EncodeText, b64DecodeText: b64DecodeText, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes
  };
});

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


  /* ---------- whole projects back from scripts ---------- */
  function parseJs(code) {
    if (!acorn) return null;
    try { return acorn.parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowHashBang: true, locations: false }); } catch (e) { return null; }
  }
  /* Evaluate a literal-only expression (objects, arrays, strings, numbers). */
  var NOPE = {};
  function value(n) {
    if (!n) return NOPE;
    switch (n.type) {
      case 'Literal': return n.regex ? '/' + n.regex.pattern + '/' + n.regex.flags : n.value;
      case 'TemplateLiteral': return n.expressions.length ? NOPE : n.quasis[0].value.cooked;
      case 'Identifier': return n.name === 'undefined' ? null : NOPE;
      case 'UnaryExpression':
        var a = value(n.argument);
        if (a === NOPE) return NOPE;
        if (n.operator === '-') return -a; if (n.operator === '+') return +a; if (n.operator === '!') return !a;
        return NOPE;
      case 'BinaryExpression':
        var l = value(n.left), r = value(n.right);
        if (l === NOPE || r === NOPE || n.operator !== '+') return NOPE;
        return l + r;
      case 'ArrayExpression':
        var arr = [], i, v;
        for (i = 0; i < n.elements.length; i++) { v = value(n.elements[i]); if (v === NOPE) return NOPE; arr.push(v); }
        return arr;
      case 'ObjectExpression':
        var o = {}, j, pr, pv;
        for (j = 0; j < n.properties.length; j++) {
          pr = n.properties[j];
          if (pr.type !== 'Property' || pr.computed) return NOPE;
          pv = value(pr.value); if (pv === NOPE) return NOPE;
          o[propName(pr)] = pv;
        }
        return o;
    }
    return NOPE;
  }
  function iifeBodies(ast) {
    var out = [];
    ast.body.forEach(function (st) {
      if (st.type !== 'ExpressionStatement') return;
      var e = st.expression;
      if (e.type === 'UnaryExpression') e = e.argument;
      if (e.type === 'CallExpression' && (e.callee.type === 'FunctionExpression' || e.callee.type === 'ArrowFunctionExpression') && e.callee.body.type === 'BlockStatement') out.push(e.callee.body.body);
    });
    return out;
  }
  var BUILDER_VARS = { DEBUG: 1, MAX_CHARS: 1, UTC_OFFSET: 1, RANDOM_MODE: 1, LEAD_P: 1, LEAD_S: 1, JOIN: 1, SCRIPT_TAG: 1, TIME: 1, MEMORY: 1, EMOTIONS: 1, STATES: 1, METERS: 1, STATS: 1, STYLE: 1, ENSEMBLE: 1, CAST: 1, LORE: 1, LOREBOOK: 1, PACING: 1, RANDOM: 1, AMBIENT: 1, RULES: 1 };
  function isBuilderScript(code) { return /Made with JanitorAI Script Builder/.test(s(code)) && /\bsafe\(\s*["']flush["']/.test(s(code)); }

  function keysText(v) { return Array.isArray(v) ? v.map(s).join(', ') : s(v); }
  function weightedText(list) { return (list || []).map(function (w) { return w.weight === 1 || w.weight === undefined ? s(w.word) : w.word + ':' + w.weight; }).join(', '); }
  function outcomesText(list) { return (list || []).map(function (o) { return s(o.text) + ' | ' + (o.weight === undefined ? 1 : o.weight); }).join('\n'); }
  function tgt(v) { return v === 'personality' ? 'personality' : 'scenario'; }

  /* A script this builder made: read its data back into every feature. */
  function projectFromBuilderScript(code) {
    var ast = parseJs(code);
    if (!ast) return null;
    var V = {}, ids = [], bodies = iifeBodies(ast);
    if (!bodies.length) bodies = [ast.body];
    bodies.forEach(function (body) {
      body.forEach(function (st) {
        if (st.type === 'VariableDeclaration') st.declarations.forEach(function (d) {
          if (d.id.type !== 'Identifier' || !BUILDER_VARS[d.id.name] || V[d.id.name] !== undefined) return;
          var v = value(d.init); if (v !== NOPE) V[d.id.name] = v;
        });
        if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression' && st.expression.callee.type === 'Identifier' && st.expression.callee.name === 'safe') {
          var a0 = st.expression.arguments[0];
          if (a0 && a0.type === 'Literal' && J.MODULE_IDS.indexOf(a0.value) !== -1 && ids.indexOf(a0.value) === -1) ids.push(a0.value);
        }
      });
    });
    if (!ids.length) return null;
    var p = J.defaultProject(), M = p.modules, S = p.settings, x;
    var title = null;
    s(code).split(/\n/).slice(0, 4).some(function (line) { var mm = /^\/\*\s+(.*?)\s*\*\/\s*$/.exec(line); if (mm && mm[1] && !/^=+$/.test(mm[1])) { title = mm[1]; return true; } return false; });
    if (title) p.meta.title = bodies.length > 1 ? title.replace(/ - [^-]+$/, '') : title;
    var ch = /^\s*Character:\s*(.+)$/m.exec(s(code).slice(0, 2000));
    if (ch) p.meta.character = trim(ch[1]);
    if (V.DEBUG !== undefined) S.debug = !!V.DEBUG;
    if (typeof V.MAX_CHARS === 'number') S.maxChars = V.MAX_CHARS;
    if (typeof V.UTC_OFFSET === 'number') S.utcOffset = V.UTC_OFFSET;
    if (V.RANDOM_MODE) S.randomMode = V.RANDOM_MODE === 'stable' ? 'stable' : 'random';
    if (typeof V.LEAD_P === 'string') S.leadPersonality = V.LEAD_P;
    if (typeof V.LEAD_S === 'string') S.leadScenario = V.LEAD_S;
    if (typeof V.JOIN === 'string') S.join = V.JOIN;
    if (typeof V.SCRIPT_TAG === 'string') S.tag = V.SCRIPT_TAG;
    S.engine = /Compact engine\./.test(code) ? 'compact' : 'readable';
    S.split = bodies.length > 1;

    if ((x = V.TIME)) {
      Object.assign(M.time, { target: tgt(x.target), prio: x.prio, clock: !!x.clock, southern: !!x.southern, periods: (x.periods || []).map(function (q) { var o = { name: q.name, from: q.from, to: q.to, text: q.text }; if (q.target) o.target = q.target; return o; }), days: x.days || {}, seasons: x.seasons || {} });
    }
    if ((x = V.MEMORY)) {
      Object.assign(M.memory, { target: tgt(x.target), prio: x.prio, depth: x.depth, maxItems: x.maxItems, captureName: !!x.captureName, namePhrases: keysText(x.namePhrases), nameTemplate: s(x.nameTemplate), capturePrefs: !!x.capturePrefs, likePhrases: keysText(x.likePhrases), dislikePhrases: keysText(x.dislikePhrases), fearPhrases: keysText(x.fearPhrases),
        facts: (x.facts || []).map(function (f) { return { label: f.label, phrases: keysText(f.phrases), words: f.words, template: f.template }; }), recapEvery: x.recapEvery || 0 });
      if (x.recapText) M.memory.recapText = x.recapText;
    }
    if ((x = V.EMOTIONS)) {
      var extra = {};
      J.EMOTIONS.forEach(function (e) { var base = J.LEXICON[e] || []; extra[e] = ((x.lexicon && x.lexicon[e]) || []).filter(function (w) { return base.indexOf(w) === -1; }).join(', '); });
      Object.assign(M.emotions, { target: x.target === 'scenario' ? 'scenario' : 'personality', prio: x.prio, depth: x.depth, threshold: x.threshold, strongAt: x.strongAt, announce: !!x.announce, extra: extra, reactions: Object.assign({}, M.emotions.reactions, x.reactions || {}) });
    }
    if ((x = V.STATES)) {
      Object.assign(M.states, { target: tgt(x.target), prio: x.prio, depth: x.depth, fallbackName: x.fallbackName || 'neutral', fallback: s(x.fallback),
        list: (x.list || []).map(function (q) { return { name: q.name, keys: keysText(q.keys), text: q.text, prio: q.prio || 0, cs: !!q.cs, ww: q.ww !== false, escalated: s(q.escalated), escalateAt: q.escalateAt || 3, minMsg: q.minMsg || 0, maxMsg: q.maxMsg || 0, enabled: true }; }) });
    }
    if ((x = V.METERS)) {
      M.scoring.meters = x.map(function (q) { return { name: q.name, start: q.start, min: q.min, max: q.max, growth: q.growth, depth: q.depth, up: weightedText(q.up), down: weightedText(q.down), target: tgt(q.target), prio: q.prio, carry: !!q.carry, show: !!q.show, enabled: true, tiers: (q.tiers || []).map(function (t) { return { name: t.name, from: t.from, to: t.to, text: t.text }; }) }; });
    }
    if ((x = V.STATS)) {
      Object.assign(M.stats, { target: tgt(x.target), prio: x.prio, depth: x.depth, instruct: !!x.instruct, label: s(x.label),
        list: (x.list || []).map(function (q) { return { name: q.name, start: q.start, changes: weightedText(q.changes), min: q.min === undefined ? '' : q.min, max: q.max === undefined ? '' : q.max, showMax: !!q.showMax, low: q.low === undefined ? '' : q.low, lowText: s(q.lowText), high: q.high === undefined ? '' : q.high, highText: s(q.highText), enabled: true }; }) });
    }
    if ((x = V.STYLE)) Object.assign(M.style, { target: x.target === 'scenario' ? 'scenario' : 'personality', prio: x.prio, rules: s(x.rules), phrases: keysText(x.phrases), perTurn: x.perTurn, echo: !!x.echo, depth: x.depth });
    if ((x = V.ENSEMBLE)) Object.assign(M.ensemble, { prio: x.prio, depth: x.depth, maxActive: x.maxActive, budget: x.budget, direction: s(x.direction) });
    if ((x = V.CAST)) {
      M.ensemble.cast = x.map(function (a) {
        var cues = {};
        J.EMOTIONS.forEach(function (e) { cues[e] = s(a.cues && a.cues[e]); });
        return J.newActor({ id: a.id, name: a.name, aliases: keysText(a.aliases), presence: a.presence === 'always' ? 'always' : 'mentioned', snapshot: s(a.snapshot), traitsExtra: s(a.traits).replace(/\.$/, ''), speech: { tone: 'Neutral', pacing: 'Medium', verbosity: 'Balanced', diction: 'Plain', notes: s(a.speech) }, quirks: (a.quirks || []).slice(), cues: cues, focus: a.focus, cs: !!a.cs,
          relations: Object.keys(a.relations || {}).map(function (k) { var r = J.newRelation(k, 'custom'); r.raw = s(a.relations[k]); return r; }) });
      });
    }
    if ((x = V.LORE)) Object.assign(M.lorebook, { prio: x.prio, depth: x.depth, limit: x.limit, groupMode: x.groupMode === 'hits' ? 'hits' : 'weight' });
    if ((x = V.LOREBOOK)) {
      M.lorebook.forms = x.some(function (e) { return e.forms; });
      M.lorebook.entries = x.map(function (e) {
        return J.newLore({ id: e.id, name: s(e.name), keys: keysText(e.keys), text: e.text, target: tgt(e.target), prio: e.prio, always: !!e.always, secondary: keysText(e.secondary || []), logic: e.logic || 'AND_ANY', cs: !!e.cs, ww: e.ww !== false, minMsg: e.minMsg || 0, maxMsg: e.maxMsg || 0, prob: e.prob === undefined ? 100 : e.prob, group: s(e.group), weight: e.weight === undefined ? 100 : e.weight, depth: e.depth || 0, unlocks: keysText(e.unlocks || []) });
      });
    }
    if ((x = V.PACING)) Object.assign(M.pacing, { prio: x.prio, window: x.window, phases: x.phases || [], beats: x.beats || [], recurring: x.recurring || [], foreshadow: x.foreshadow || [] });
    if ((x = V.RANDOM)) {
      Object.assign(M.random, { prio: x.prio, depth: x.depth, encounterChance: x.encounterChance || 0, encounterMin: x.encounterMin || 0, encounters: outcomesText(x.encounters), diceTags: !!x.diceTags,
        pool: (x.pool || []).map(function (d) { return d.dice + ' x' + d.count; }).join(', '),
        triggers: (x.triggers || []).map(function (t) { return { keys: keysText(t.keys), chance: t.chance, target: tgt(t.target), minMsg: t.minMsg || 0, outcomes: outcomesText(t.outcomes), cs: !!t.cs, ww: t.ww !== false, enabled: true }; }) });
    }
    if ((x = V.AMBIENT)) Object.assign(M.ambient, { prio: x.prio, chance: x.chance, minMsg: x.minMsg, list: (x.list || []).map(function (a) { return { text: a.text, weight: a.weight, periods: keysText(a.periods || []) }; }) });
    if ((x = V.RULES)) {
      M.rules.list = x.map(function (r) {
        return { name: r.name, match: r.match === 'any' ? 'any' : 'all', target: tgt(r.target), prio: r.prio, text: r.text, enabled: true, conds: (r.conds || []).map(function (c) {
          var o = Object.assign({}, c);
          if (o.keys) o.keys = keysText(o.keys);
          if (o.values) o.values = keysText(o.values);
          return o;
        }) };
      });
    }
    ids.forEach(function (id) { M[id].enabled = true; });
    if (ids.indexOf('ensemble') !== -1 || V.CAST) M.ensemble.enabled = ids.indexOf('ensemble') !== -1;
    return J.normalize(p);
  }

  /* ---------- a script made somewhere else: find what it does ---------- */
  var MATCH_FNS = /^(indexOf|includes|search|match|test|startsWith|endsWith|contains)$/;
  function uniq(list) { return list.filter(function (k, i) { return list.indexOf(k) === i; }); }
  function srcOf(code, n) { return code.slice(n.start, n.end); }
  function mentions(code, n, rx) { return rx.test(srcOf(code, n)); }
  function strList(n) { var v = value(n); if (typeof v === 'string') return [v]; if (Array.isArray(v) && v.every(function (q) { return typeof q === 'string'; })) return v; return null; }
  function regexKeys(pattern) {
    /* /\b(cat|dog)s?\b/ -> cat, dog when the regex is a plain word list; otherwise keep it as a /regex/ key. */
    var p = pattern.replace(/\\b/g, '').replace(/^\^|\$$/g, '');
    var m = /^\((?:\?:)?([^()]+)\)s?\??$/.exec(p) || /^()([^()]+)$/.exec(p);
    var body = m ? (m[1] || m[2]) : null;
    if (body && /^[\w '\-|]+$/.test(body)) return body.split('|').map(trim).filter(Boolean);
    return null;
  }
  /* One condition atom -> {kind, ...} or null. */
  function atom(code, n, vars) {
    var c, a, num, side, op;
    if (n.type === 'UnaryExpression' && n.operator === '!') { var inner = atom(code, n.argument, vars); return inner && inner.kind === 'kw' ? { kind: 'not', keys: inner.keys } : null; }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed) {
      var fn = n.callee.property.name;
      if (fn === 'test' && n.callee.object.type === 'Literal' && n.callee.object.regex) {
        var rx = n.callee.object.regex, k = regexKeys(rx.pattern);
        return { kind: 'kw', keys: k || ['/' + rx.pattern + '/' + rx.flags.replace(/[gy]/g, '')] };
      }
      if (MATCH_FNS.test(fn) && n.arguments[0]) {
        if (n.arguments[0].type === 'Literal' && n.arguments[0].regex) { var rr = n.arguments[0].regex; return { kind: 'kw', keys: regexKeys(rr.pattern) || ['/' + rr.pattern + '/' + rr.flags.replace(/[gy]/g, '')] }; }
        var sl = strList(n.arguments[0]);
        if (sl) return { kind: 'kw', keys: sl };
        /* list.some(function (w) { return text.indexOf(w) ... }) is handled by the array branch below. */
      }
      if ((fn === 'some' || fn === 'every') && (a = strList(n.callee.object))) return { kind: 'kw', keys: a };
    }
    if (n.type === 'CallExpression') {
      /* helper(text, ["a", "b"]) or helper("a") */
      for (var i = 0; i < n.arguments.length; i++) { var l2 = strList(n.arguments[i]); if (l2 && l2.length && l2.every(function (w) { return w.length <= 40; })) return { kind: 'kw', keys: l2 }; }
      if (n.callee.type === 'MemberExpression' && mentions(code, n.callee, /^Math\.random$/)) return null;
    }
    if (n.type === 'BinaryExpression') {
      op = n.operator;
      /* text.indexOf("x") !== -1 and friends */
      var l = n.left, r = n.right;
      if (l.type === 'CallExpression' && /indexOf|search/.test(srcOf(code, l.callee))) { var inner2 = atom(code, l, vars); if (inner2) return /^(===|==)$/.test(op) && value(r) === -1 || op === '<' && value(r) === 0 ? { kind: 'not', keys: inner2.keys } : inner2; }
      if (/^(<|<=|>|>=|===|==)$/.test(op)) {
        num = value(r); side = l;
        if (typeof num !== 'number') { num = value(l); side = r; op = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '===': '===', '==': '==' }[op]; }
        if (typeof num === 'number') {
          var ss = srcOf(code, side);
          var lo = op === '>' ? num + 1 : op === '>=' ? num : op === '===' || op === '==' ? num : null;
          var hi = op === '<' ? num - 1 : op === '<=' ? num : op === '===' || op === '==' ? num : null;
          if (/Math\.random\(\)/.test(ss) && (op === '<' || op === '<=')) return { kind: 'chance', pct: Math.round(num <= 1 ? num * 100 : num) };
          if (/getHours|getUTCHours|\bhour/i.test(ss)) return { kind: 'hour', min: lo === null ? 0 : lo, max: hi === null ? 24 : hi + 1 };
          if (/message_count|\bcount\b|turn|msg|messages/i.test(ss)) return { kind: 'msgs', min: lo === null ? 0 : lo, max: hi === null ? 0 : hi };
        }
        var sv = value(r), sideId = l;
        if (typeof sv !== 'string') { sv = value(l); sideId = r; }
        if (typeof sv === 'string' && /^(===|==)$/.test(op) && sideId.type === 'Identifier' && vars[sideId.name] && vars[sideId.name][sv]) return { kind: 'state', name: sv, keys: vars[sideId.name][sv] };
        if (typeof sv === 'string' && /^(===|==)$/.test(op) && sideId.type === 'Identifier') return { kind: 'var', name: sideId.name, value: sv };
      }
    }
    return null;
  }
  function conditions(code, test, vars) {
    var out = { all: [], any: false, unknown: 0 };
    function add(n, mode) {
      if (n.type === 'LogicalExpression' && n.operator === '&&') { add(n.left, 'all'); add(n.right, 'all'); return; }
      if (n.type === 'LogicalExpression' && n.operator === '||') {
        var parts = [], ok = true;
        (function flat(m) { if (m.type === 'LogicalExpression' && m.operator === '||') { flat(m.left); flat(m.right); } else parts.push(m); })(n);
        var keys = [], hours = [];
        parts.forEach(function (pt) { var a = atom(code, pt, vars); if (a && a.kind === 'kw') keys = keys.concat(a.keys); else if (a && a.kind === 'hour') hours.push(a); else ok = false; });
        if (ok && keys.length && !hours.length) out.all.push({ kind: 'kw', keys: uniq(keys) });
        /* hour >= 22 || hour < 5  ->  22 to 5, wrapping past midnight */
        else if (ok && hours.length === 2 && !keys.length && hours.some(function (q) { return q.max === 24; }) && hours.some(function (q) { return q.min === 0; })) {
          var late = hours.filter(function (q) { return q.max === 24; })[0], early = hours.filter(function (q) { return q.min === 0; })[0];
          out.all.push({ kind: 'hour', min: late.min, max: early.max });
        } else out.unknown++;
        return;
      }
      var a = atom(code, n, vars);
      if (a) out.all.push(a); else out.unknown++;
    }
    add(test, 'all');
    /* count > 30 && count <= 60 -> one range */
    ['msgs', 'hour'].forEach(function (kind) {
      var list = out.all.filter(function (c) { return c.kind === kind; });
      if (list.length < 2) return;
      var m = { kind: kind, min: 0, max: kind === 'hour' ? 24 : 0 };
      list.forEach(function (c) {
        m.min = Math.max(m.min, c.min);
        if (kind === 'hour') m.max = Math.min(m.max, c.max); else if (c.max) m.max = m.max ? Math.min(m.max, c.max) : c.max;
      });
      out.all = out.all.filter(function (c) { return c.kind !== kind; }).concat([m]);
    });
    return out;
  }
  /* Text that a statement adds to the personality or scenario. */
  function addedText(code, n) {
    var target = null, expr = null;
    if (n.type === 'AssignmentExpression' && (n.operator === '+=' || n.operator === '=')) {
      var lhs = srcOf(code, n.left);
      if (/personality/i.test(lhs)) target = 'personality';
      else if (/scenario/i.test(lhs)) target = 'scenario';
      expr = n.right;
      if (n.operator === '=' && expr.type === 'BinaryExpression' && srcOf(code, expr.left) === lhs) expr = expr.right;
    } else if (n.type === 'CallExpression' && n.arguments.length) {
      var callee = srcOf(code, n.callee);
      if (/(^|\.)(indexOf|includes|test|match|search|log|replace|split|join|warn|error|slice|substring|toLowerCase|parseInt)$/.test(callee)) return null;
      target = /personality|persona|char(acter)?_?note/i.test(callee) ? 'personality' : /scenario|scene|lore|world/i.test(callee) ? 'scenario' : null;
      for (var i = 0; i < n.arguments.length; i++) { if (looseText(code, n.arguments[i]).length >= 20) { expr = n.arguments[i]; break; } }
      if (expr && !target) target = 'scenario';
    }
    if (!target || !expr) return null;
    var t = looseText(code, expr);
    t = t.replace(/^[\s\n]+|[\s\n]+$/g, '').replace(/^\[|\]$/g, '').replace(/^[\s\n]+|[\s\n]+$/g, '');
    return t.length >= 8 ? { target: target, text: t } : null;
  }
  /* The string parts of an expression, with anything worked out at run time dropped. */
  function looseText(code, n) {
    var v = value(n);
    if (typeof v === 'string') return v;
    if (n.type === 'BinaryExpression' && n.operator === '+') return (looseText(code, n.left) + looseText(code, n.right)).replace(/ {2,}/g, ' ');
    if (n.type === 'TemplateLiteral') return n.quasis.map(function (q) { return q.value.cooked; }).join('');
    if (n.type === 'ArrayExpression') { var a = n.elements.map(function (e) { return e ? looseText(code, e) : ''; }).filter(Boolean); return a.join(' '); }
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.name === 'join') return looseText(code, n.callee.object);
    return '';
  }
  function projectFromForeignScript(code) {
    var ast = parseJs(code);
    if (!ast) return null;
    var p = J.defaultProject(), M = p.modules;
    var found = { lore: 0, always: 0, phases: 0, rules: 0, states: 0, stats: 0, skipped: 0 };
    var vars = {}, byText = {}, pendingVar = [];
    M.lorebook.entries = []; M.states.list = []; M.rules.list = []; M.pacing.phases = []; M.stats.list = [];

    function place(conds, piece, unknown) {
      var key = piece.target + '|' + piece.text;
      var kws = conds.filter(function (c) { return c.kind === 'kw'; });
      var nots = conds.filter(function (c) { return c.kind === 'not'; });
      var msgs = conds.filter(function (c) { return c.kind === 'msgs'; })[0];
      var chance = conds.filter(function (c) { return c.kind === 'chance'; })[0];
      var others = conds.filter(function (c) { return c.kind === 'hour' || c.kind === 'state' || c.kind === 'var'; });
      var state = conds.filter(function (c) { return c.kind === 'state'; })[0];
      if (byText[key]) {
        /* Same text from another branch: widen its keywords. */
        var e = byText[key];
        if (e.keys !== undefined && kws.length) e.keys = J.splitKeys(e.keys).concat(kws[0].keys).filter(function (k, i, arr) { return arr.indexOf(k) === i; }).join(', ');
        return;
      }
      if (!conds.length && !unknown) {
        var al = J.newLore({ id: 'always_' + (found.always + 1), name: 'Always on ' + (found.always + 1), keys: '', always: true, text: piece.text, target: piece.target, category: 'other' });
        M.lorebook.entries.push(al); byText[key] = al; found.always++; return;
      }
      if (state && conds.length === 1) {
        var st = { name: state.name, keys: uniq(state.keys).join(', '), text: piece.text, prio: 0, cs: false, ww: true, escalated: '', escalateAt: 3, minMsg: 0, maxMsg: 0, enabled: true };
        M.states.list.push(st); byText[key] = st; found.states++; return;
      }
      if (kws.length === 1 && !others.length) {
        var le = J.newLore({ id: J.slug(kws[0].keys[0]) + '_' + (found.lore + 1), name: kws[0].keys[0], keys: kws[0].keys.join(', '), secondary: nots.length ? nots[0].keys.join(', ') : '', logic: nots.length ? 'NOT_ANY' : 'AND_ANY', text: piece.text, target: piece.target, minMsg: msgs ? msgs.min : 0, maxMsg: msgs ? msgs.max : 0, prob: chance ? Math.max(1, Math.min(100, chance.pct)) : 100, category: 'other' });
        M.lorebook.entries.push(le); byText[key] = le; found.lore++; return;
      }
      if (msgs && conds.length === 1) {
        var ph = { from: msgs.min, to: msgs.max, target: piece.target, text: piece.text };
        M.pacing.phases.push(ph); byText[key] = ph; found.phases++; return;
      }
      var rc = [];
      conds.forEach(function (c) {
        if (c.kind === 'kw') rc.push({ type: 'keyword', keys: c.keys.join(', '), mode: 'any', depth: 1 });
        else if (c.kind === 'msgs') rc.push({ type: 'messages', min: c.min, max: c.max });
        else if (c.kind === 'hour') rc.push({ type: 'hour', min: c.min, max: c.max });
        else if (c.kind === 'chance') rc.push({ type: 'chance', pct: c.pct });
        else if (c.kind === 'state') rc.push({ type: 'state', values: J.slug(c.name) });
      });
      if (!rc.length) { found.skipped++; return; }
      var rule = { name: 'imported_' + (found.rules + 1), match: 'all', conds: rc, text: piece.text, target: piece.target, prio: 75, enabled: true };
      M.rules.list.push(rule); byText[key] = rule; found.rules++;
    }

    function stmts(list, conds, unknown) { (list || []).forEach(function (st) { stmt(st, conds, unknown); }); }
    function stmt(st, conds, unknown) {
      if (!st) return;
      switch (st.type) {
        case 'BlockStatement': stmts(st.body, conds, unknown); return;
        case 'IfStatement':
          var c = conditions(code, st.test, vars);
          stmt(st.consequent, conds.concat(c.all), unknown + c.unknown);
          /* else-if chains keep their own test; a plain else only runs when nothing matched, which the builder cannot say, so it is only kept when it is a fallback for keyword branches */
          if (st.alternate) stmt(st.alternate, conds, unknown + (st.alternate.type === 'IfStatement' ? 0 : 1));
          return;
        case 'ExpressionStatement': expr(st.expression, conds, unknown); return;
        case 'VariableDeclaration': st.declarations.forEach(function (d) { if (d.init) expr(d.init, conds, unknown, d.id); }); return;
        case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'WhileStatement': case 'DoWhileStatement': stmt(st.body, conds, unknown + 1); return;
        case 'TryStatement': stmt(st.block, conds, unknown); return;
        case 'SwitchStatement':
          st.cases.forEach(function (cs) { stmts(cs.consequent, conds, unknown + 1); }); return;
        case 'FunctionDeclaration': stmts(st.body.body, [], 1); return;
        case 'ReturnStatement': if (st.argument) expr(st.argument, conds, unknown); return;
      }
    }
    function expr(n, conds, unknown, declId) {
      if (!n) return;
      if (n.type === 'SequenceExpression') { n.expressions.forEach(function (e) { expr(e, conds, unknown); }); return; }
      if (n.type === 'CallExpression' && (n.callee.type === 'FunctionExpression' || n.callee.type === 'ArrowFunctionExpression')) { if (n.callee.body.type === 'BlockStatement') stmts(n.callee.body.body, conds, unknown); return; }
      if (n.type === 'UnaryExpression' && n.argument.type === 'CallExpression') { expr(n.argument, conds, unknown); return; }
      if (n.type === 'LogicalExpression' && n.operator === '&&') { var c = conditions(code, n.left, vars); expr(n.right, conds.concat(c.all), unknown + c.unknown); return; }
      if (n.type === 'ConditionalExpression') return;
      /* mood = "angry" inside a keyword check: remember it as a state */
      if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier' && typeof value(n.right) === 'string' && value(n.right).length <= 30) {
        var kw = conds.filter(function (q) { return q.kind === 'kw'; });
        if (kw.length) { vars[n.left.name] = vars[n.left.name] || {}; vars[n.left.name][value(n.right)] = uniq((vars[n.left.name][value(n.right)] || []).concat(kw[0].keys)); }
        return;
      }
      var piece = addedText(code, n);
      if (piece) place(conds, piece, unknown);
    }
    /* Two passes: the first learns mood/state variables, the second places text. */
    stmts(ast.body, [], 0);
    M.lorebook.entries = []; M.states.list = []; M.rules.list = []; M.pacing.phases = []; byText = {};
    found = { lore: 0, always: 0, phases: 0, rules: 0, states: 0, stats: 0, skipped: 0 };
    stmts(ast.body, [], 0);

    /* Lore kept as data: [{keys:[...], text:"..."}] */
    loreFromScript(code).forEach(function (e) {
      if (byText['scenario|' + e.text] || byText['personality|' + e.text]) return;
      M.lorebook.entries.push(e); byText[e.target + '|' + e.text] = e; found.lore++;
    });

    /* Status lines read back from the chat: /HP:\s*(\d+)/ */
    var seenStat = {};
    walk.full(ast, function (n) {
      if (n.type !== 'Literal' || !n.regex) return;
      var m = /^\\?b?\(?\??:?([A-Za-z][A-Za-z ]{0,18}?)\)?\s*(?:\\s\*)?[:=](?:\\s\*|\s\*|\s|\\s\+)*\(?(?:\\d|\[0-9\])/.exec(n.regex.pattern);
      if (!m) return;
      var nm = trim(m[1]);
      if (!nm || seenStat[nm.toLowerCase()]) return;
      seenStat[nm.toLowerCase()] = true;
      M.stats.list.push({ name: nm, start: 0, changes: '', min: '', max: '', showMax: false, low: '', lowText: '', high: '', highText: '', enabled: true });
      found.stats++;
    });

    var src = s(code);
    var memory = /my name is|call me|i'?m called|user'?s name/i.test(src);
    var time = /getHours|getUTCHours|getDay\(|new Date\(/.test(src);
    var mood = /\b(mood|emotion|feeling)s?\b/i.test(src) && !found.states;
    var rec = /\brecap|summary|summari[sz]e/i.test(src);

    if (M.lorebook.entries.length) M.lorebook.enabled = true;
    if (M.states.list.length) M.states.enabled = true;
    if (M.rules.list.length) M.rules.enabled = true;
    if (M.pacing.phases.length) M.pacing.enabled = true;
    if (M.stats.list.length) M.stats.enabled = true;
    if (memory) M.memory.enabled = true;
    if (rec) { M.memory.enabled = true; M.memory.recapEvery = 20; }
    if (time || M.rules.list.some(function (r) { return r.conds.some(function (c) { return c.type === 'hour'; }); })) M.time.enabled = true;
    if (mood) M.emotions.enabled = true;
    found.memory = memory; found.time = M.time.enabled; found.mood = mood; found.recap = rec;
    var any = J.MODULE_IDS.some(function (id) { return M[id].enabled; });
    if (!any) return null;
    var t = /^\s*\/[*\/]+\s*=*\s*([^\n*=][^\n*]{2,60}?)\s*=*\s*(\*\/)?\s*$/m.exec(src.slice(0, 400));
    p.meta.title = t ? trim(t[1]) : 'Imported script';
    p.meta.notes = 'Converted from a script made elsewhere. Check each feature: the builder rebuilt what it could read, and the original logic may have done more.';
    return { project: J.normalize(p), found: found };
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
        if (isBuilderScript(t)) {
          var bp = projectFromBuilderScript(t);
          if (bp) return { kind: 'project', label: 'Script made with this builder' + (bp.meta.title ? ': ' + bp.meta.title : ''), project: bp, fromScript: true, code: t };
        }
        var conv = projectFromForeignScript(t);
        if (conv) return { kind: 'script', label: 'Janitor script', code: t, entries: conv.project.modules.lorebook.entries, project: conv.project, found: conv.found };
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
    loreText: loreText, loreFromText: loreFromText, loreFromNotes: loreFromNotes, loreFromScript: loreFromScript, projectFromBuilderScript: projectFromBuilderScript, projectFromForeignScript: projectFromForeignScript, isBuilderScript: isBuilderScript,
    stWorldInfo: stWorldInfo, v2Book: v2Book, v2Card: v2Card, v3Card: v3Card, cardBlocksText: cardBlocksText,
    detect: detect, b64EncodeText: b64EncodeText, b64DecodeText: b64DecodeText, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes
  };
});

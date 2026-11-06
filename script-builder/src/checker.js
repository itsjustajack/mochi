/* ==========================================================================
   JanitorAI Script Builder: ES5 checker and auto-fixer
   Parses any script with acorn, explains what Janitor may reject, and
   rewrites the common modern constructs into ES5.  No network.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('acorn'), require('acorn-walk'));
  else root.JSBCheck = factory(root.acorn, root.acorn && root.acorn.walk);
})(typeof self !== 'undefined' ? self : this, function (acorn, walk) {
  'use strict';

  var BANNED_GLOBALS = {
    fetch: 'Network calls are blocked in Janitor scripts.', XMLHttpRequest: 'Network calls are blocked in Janitor scripts.', WebSocket: 'Network calls are blocked in Janitor scripts.',
    setTimeout: 'Timers do not exist: the script runs once, synchronously.', setInterval: 'Timers do not exist: the script runs once, synchronously.', requestAnimationFrame: 'There is no browser frame loop in the sandbox.',
    Promise: 'Async code is not supported; nothing waits for a Promise.', require: 'There are no modules in Janitor scripts.', eval: 'eval is blocked and fails silently.',
    localStorage: 'There is no storage; scripts are stateless.', sessionStorage: 'There is no storage; scripts are stateless.', indexedDB: 'There is no storage; scripts are stateless.',
    window: 'There is no browser window in the sandbox.', document: 'There is no DOM in the sandbox.', navigator: 'There is no browser in the sandbox.', alert: 'There is no browser in the sandbox.'
  };
  var RISKY_GLOBALS = { Map: 'ES6 Map: untested in Janitor. Use a plain object.', Set: 'ES6 Set: untested in Janitor. Use a plain object or array.', Symbol: 'ES6 Symbol: avoid.', Reflect: 'ES6 Reflect: avoid.', Proxy: 'ES6 Proxy: avoid.', WeakMap: 'ES6 WeakMap: avoid.' };
  var MODERN_METHODS = {
    includes: 'ES2016 .includes(): use .indexOf(x) !== -1', startsWith: 'ES6 .startsWith(): use .indexOf(x) === 0', endsWith: 'ES6 .endsWith(): use s.slice(s.length - x.length) === x',
    padStart: 'ES2017 .padStart(): build the padding with a loop', padEnd: 'ES2017 .padEnd(): build the padding with a loop', repeat: 'ES6 .repeat(): use a loop or new Array(n + 1).join(s)',
    replaceAll: 'ES2021 .replaceAll(): use .replace(/x/g, y)', find: 'ES6 .find(): use a for loop', findIndex: 'ES6 .findIndex(): use a for loop', findLast: 'ES2023 .findLast(): use a for loop',
    flat: 'ES2019 .flat(): use concat in a loop', flatMap: 'ES2019 .flatMap(): use map then concat', at: 'ES2022 .at(): use [i] or [length - 1]', trimStart: 'ES2019 .trimStart(): use .replace(/^\\s+/, "")', trimEnd: 'ES2019 .trimEnd(): use .replace(/\\s+$/, "")',
    fill: 'ES6 .fill(): use a loop'
  };
  var MODERN_STATICS = { 'Object.entries': 'use Object.keys and index into the object', 'Object.values': 'use Object.keys and index into the object', 'Object.assign': 'copy keys in a for...in loop', 'Object.fromEntries': 'build the object in a loop', 'Array.from': 'use a for loop or Array.prototype.slice.call', 'Array.of': 'use an array literal', 'Number.isInteger': 'use Math.floor(x) === x', 'Number.isNaN': 'use isNaN(x)', 'Number.parseFloat': 'use parseFloat', 'Number.parseInt': 'use parseInt', 'String.raw': 'use a normal string' };

  function locOf(code, pos) {
    var line = 1, col = 0, i;
    for (i = 0; i < pos && i < code.length; i++) { if (code.charCodeAt(i) === 10) { line++; col = 0; } else col++; }
    return { line: line, col: col + 1 };
  }

  function explainSyntax(msg, code, pos) {
    var m = String(msg).replace(/\s*\(\d+:\d+\)$/, '');
    var near = code.slice(Math.max(0, pos - 20), pos + 20).replace(/\n/g, ' ');
    if (/Unterminated string/.test(m)) return 'A string is missing its closing quote.';
    if (/Unterminated template/.test(m)) return 'A `template string` is missing its closing backtick.';
    if (/Unterminated regular expression/.test(m)) return 'A /regex/ is missing its closing slash.';
    if (/Unterminated comment/.test(m)) return 'A /* comment is never closed with */.';
    if (/Unexpected token/.test(m)) {
      if (/[)\]}]/.test(code.charAt(pos))) return 'There is an extra or misplaced closing bracket here, or something before it is missing a comma.';
      return 'Something here does not fit. Often a missing comma between list items, a missing ) or }, or a stray character. Near: "' + near + '"';
    }
    if (/Unexpected character/.test(m)) return 'There is a character JavaScript does not understand here. Curly \u201csmart quotes\u201d pasted from a document are the usual cause.';
    if (/Identifier .* has already been declared/.test(m)) return 'A let/const name is declared twice in the same block.';
    if (/'return' outside of function/.test(m)) return 'return can only be used inside a function. Wrap the script in (function () { ... })();';
    if (/Unexpected end of input|Unexpected token \(\d+/.test(m) || pos >= code.length - 1) return 'The script ends too early: a ( { or [ is never closed.';
    if (/Assigning to rvalue/.test(m)) return 'The left side of = is not something you can assign to.';
    return m;
  }

  function memberName(n) {
    if (!n) return '';
    if (n.type === 'Identifier') return n.name;
    if (n.type === 'ThisExpression') return 'this';
    if (n.type === 'MemberExpression' && !n.computed) { var o = memberName(n.object); return o ? o + '.' + n.property.name : ''; }
    if (n.type === 'MemberExpression' && n.computed && n.property.type === 'Literal') { var o2 = memberName(n.object); return o2 ? o2 + '.' + n.property.value : ''; }
    return '';
  }

  function usesThisOrArguments(fnNode) {
    var found = false;
    walk.full(fnNode.body, function (n) {
      if (n.type === 'ThisExpression') found = true;
      if (n.type === 'Identifier' && n.name === 'arguments') found = true;
    });
    /* walk.full also enters nested normal functions; that over-reports, which is the safe direction. */
    return found;
  }

  function parseLoose(code) {
    return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true, locations: true });
  }

  /* ---------- analysis ---------- */
  function check(code) {
    var res = { es5: false, syntaxError: null, issues: [], fixable: 0, stats: { chars: code.length, lines: code.split('\n').length } };
    function issue(sev, node, rule, msg, fix) {
      var at = typeof node === 'number' ? node : node.start;
      var l = locOf(code, at);
      res.issues.push({ severity: sev, rule: rule, line: l.line, col: l.col, start: at, end: typeof node === 'number' ? at : node.end, message: msg, fixable: !!fix });
      if (fix) res.fixable++;
    }
    try { acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' }); res.es5 = true; } catch (e5) { res.es5Error = { message: e5.message, pos: e5.pos }; }
    var ast;
    try { ast = parseLoose(code); }
    catch (e) {
      var l = locOf(code, e.pos || 0);
      res.syntaxError = { message: e.message, line: l.line, col: l.col, pos: e.pos, plain: explainSyntax(e.message, code, e.pos || 0) };
      issue('error', e.pos || 0, 'syntax', 'Syntax error: ' + res.syntaxError.plain);
      return res;
    }

    var writesPS = false, readsCtx = false;
    walk.fullAncestor(ast, function (n, ancestors) {
      var parent = ancestors[ancestors.length - 2];
      switch (n.type) {
        case 'VariableDeclaration':
          if (n.kind !== 'var') issue('error', n, 'let-const', n.kind + ' is ES6. Janitor\'s own template says to use var.', true);
          break;
        case 'ArrowFunctionExpression':
          issue('error', n, 'arrow', 'Arrow function (=>) is ES6. Use function () { ... }.', arrowFixable(n));
          break;
        case 'TemplateLiteral':
          if (!parent || parent.type !== 'TaggedTemplateExpression') issue('error', n, 'template', 'Template string (`...${}`) is ES6. Use "text" + value.', true);
          break;
        case 'TaggedTemplateExpression': issue('error', n, 'tagged-template', 'Tagged template is ES6.'); break;
        case 'ClassDeclaration': case 'ClassExpression': issue('error', n, 'class', 'class is ES6. Use a constructor function or plain objects.'); break;
        case 'ForOfStatement': issue('error', n, 'for-of', 'for...of is ES6. Use a for loop with an index.', forOfFixable(n)); break;
        case 'SpreadElement':
          issue('error', n, 'spread', 'Spread (...) is ES6. Use .concat() or .apply().', parent && parent.type === 'ArrayExpression');
          break;
        case 'RestElement': issue('error', n, 'rest', 'Rest parameters (...args) are ES6. Use the arguments object.'); break;
        case 'ObjectPattern': case 'ArrayPattern': issue('error', n, 'destructuring', 'Destructuring is ES6. Read each property: var a = obj.a;'); break;
        case 'AssignmentPattern':
          issue('error', n, 'default-param', 'Default parameter values are ES6. Use if (x === undefined) { x = ...; }', defaultFixable(n, parent));
          break;
        case 'AwaitExpression': issue('error', n, 'await', 'await is not available: nothing in a Janitor script can wait.'); break;
        case 'YieldExpression': issue('error', n, 'generator', 'Generators are ES6.'); break;
        case 'ChainExpression': issue('error', n, 'optional-chain', 'Optional chaining (?.) is ES2020 and untested in Janitor. Use (a && a.b).'); break;
        case 'ImportExpression': case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration': issue('error', n, 'module', 'import/export do not exist in Janitor scripts.'); break;
        case 'MetaProperty': issue('error', n, 'meta', n.meta.name + '.' + n.property.name + ' is ES6.'); break;
        case 'LogicalExpression': if (n.operator === '??') issue('error', n, 'nullish', '?? is ES2020 and untested in Janitor. Use (x === undefined || x === null) ? fallback : x.'); break;
        case 'BinaryExpression':
          if (n.operator === '**') issue('error', n, 'exponent', '** is ES2016. Use Math.pow(a, b).');
          if ((n.operator === '==' || n.operator === '!=') && !(n.right.type === 'Literal' && n.right.value === null)) issue('info', n, 'loose-equality', n.operator + ' converts types before comparing ("1" == 1 is true). Use ' + n.operator + '= unless that is what you want.');
          break;
        case 'AssignmentExpression':
          if (n.operator === '**=' || n.operator === '??=' || n.operator === '||=' || n.operator === '&&=') issue('error', n, 'assign-op', n.operator + ' is newer than ES5.');
          var tgt = memberName(n.left);
          if (/^context\.character\.(personality|scenario)$/.test(tgt)) {
            writesPS = true;
            if (n.operator === '=' && !selfAppend(n)) issue('warn', n, 'overwrite', 'This replaces ' + tgt.split('.')[2] + ' instead of adding to it, so the character\'s own text is thrown away. Use +=.', true);
          } else if (/^context\.character\.(name|description|first_message|chat_name)$/.test(tgt)) {
            issue('info', n, 'ignored-write', 'Changes to ' + tgt + ' are reported to be ignored by the model. Only personality and scenario reliably reach it.');
          } else if (/^context\.chat\./.test(tgt)) {
            issue('info', n, 'ignored-write', 'Writing to ' + tgt + ' does nothing; chat fields are read-only.');
          }
          break;
        case 'FunctionDeclaration': case 'FunctionExpression':
          if (n.async) issue('error', n, 'async', 'async functions are not supported.');
          if (n.generator) issue('error', n, 'generator', 'Generator functions are ES6.');
          break;
        case 'Property':
          if (parent && parent.type === 'ObjectExpression') {
            if (n.shorthand) issue('error', n, 'shorthand', 'Shorthand property { ' + n.key.name + ' } is ES6. Write { ' + n.key.name + ': ' + n.key.name + ' }.', true);
            else if (n.method) issue('error', n, 'method', 'Method shorthand is ES6. Write name: function () { ... }.', true);
            else if (n.computed) issue('error', n, 'computed-key', 'Computed keys ([expr]: value) are ES6.');
            if (n.kind === 'get' || n.kind === 'set') issue('warn', n, 'accessor', 'Getters and setters are untested in Janitor.');
          }
          break;
        case 'Literal':
          if (n.bigint) issue('error', n, 'bigint', 'BigInt is ES2020.');
          if (n.regex) {
            if (/[uysd]/.test(n.regex.flags)) issue('error', n, 'regex-flag', 'Regex flag "' + n.regex.flags + '" is newer than ES5. Use only g, i, m.');
            if (/\(\?<[=!]/.test(n.regex.pattern)) issue('warn', n, 'lookbehind', 'Regex lookbehind is not supported by older engines.');
            if (/\(\?<[A-Za-z]/.test(n.regex.pattern)) issue('warn', n, 'named-group', 'Named capture groups are ES2018.');
          }
          if (typeof n.raw === 'string' && /^\d[\d_]*_\d/.test(n.raw)) issue('error', n, 'numeric-sep', 'Numeric separators (1_000) are ES2021.');
          break;
        case 'CatchClause':
          if (!n.param) issue('error', n, 'catch-binding', 'catch without (e) is ES2019. Write catch (e).');
          if (n.body && n.body.body && !n.body.body.length) issue('info', n, 'silent-catch', 'This catch block is empty, so errors disappear without a trace. Add console.log(e.message) so the debug panel shows what went wrong.');
          break;

        case 'CallExpression':
        case 'NewExpression':
          var callee = memberName(n.callee);
          if (n.callee.type === 'MemberExpression' && !n.callee.computed) {
            var prop = n.callee.property.name;
            if (own(MODERN_STATICS, callee)) issue('warn', n, 'modern-static', callee + ' is newer than ES5: ' + MODERN_STATICS[callee] + '.');
            else if (own(MODERN_METHODS, prop)) issue('warn', n, 'modern-method', MODERN_METHODS[prop] + '.', (prop === 'includes' || prop === 'startsWith') && n.arguments.length === 1 && n.arguments[0].type !== 'SpreadElement');
            if (prop === 'indexOf' && n.arguments.length === 1 && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string' && /^[a-z]{3,}$/i.test(n.arguments[0].value)) {
              issue('info', n, 'substring-match', 'indexOf("' + n.arguments[0].value + '") also matches inside longer words (like "' + n.arguments[0].value + 'ary" or "un' + n.arguments[0].value + '"). Match whole words with /\\b' + n.arguments[0].value + '\\b/i.test(text) or pad both sides with spaces.');
            }
            if (prop === 'toLowerCase' || prop === 'toUpperCase' || prop === 'indexOf' || prop === 'split' || prop === 'match' || prop === 'replace') {
              if (/^context\.chat\.last_message$/.test(memberName(n.callee.object))) issue('warn', n, 'unguarded', 'context.chat.last_message is used directly. If it is ever missing this line throws and the whole script stops. Read it once with var msg = context.chat.last_message || "";');
            }
          }
          if (n.type === 'NewExpression' && callee === 'Function') issue('error', n, 'new-function', 'new Function is blocked like eval.');
          break;
        case 'Identifier':
          if (n.name === 'context') readsCtx = true;
          if (own(BANNED_GLOBALS, n.name) && isGlobalRef(n, parent)) issue('error', n, 'banned', n.name + ': ' + BANNED_GLOBALS[n.name]);
          else if (own(RISKY_GLOBALS, n.name) && isGlobalRef(n, parent)) issue('warn', n, 'risky', RISKY_GLOBALS[n.name]);
          break;
        case 'ReturnStatement':
          if (!ancestors.some(function (a) { return /Function/.test(a.type); })) issue('warn', n, 'top-return', 'return at the top level is not reliably supported. Wrap the script in (function () { ... })(); and return inside it.');
          break;
        case 'WhileStatement':
          if (n.test.type === 'Literal' && n.test.value === true && !containsBreak(n.body)) issue('warn', n, 'infinite-loop', 'while (true) with no break never ends and will hang the reply.');
          break;
        case 'ForStatement':
          if (!n.test && !containsBreak(n.body)) issue('warn', n, 'infinite-loop', 'for (;;) with no break never ends.');
          break;
      }
    });
    if (!readsCtx) issue('warn', 0, 'no-context', 'The script never touches context, so it cannot change the character.');
    else if (!writesPS) issue('warn', 0, 'no-writes', 'The script never writes to context.character.personality or .scenario, the only fields that reach the model.');
    var order = { error: 0, warn: 1, info: 2 };
    res.issues.sort(function (a, b) { return order[a.severity] - order[b.severity] || a.start - b.start; });
    return res;
  }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function selfAppend(n) {
    /* x = x + "..." is an append, not an overwrite. */
    /* x = "" inside a typeof guard is the standard initialisation, not an overwrite. */
    if (n.right.type === 'Literal' && n.right.value === '') return true;
    if (n.right.type === 'BinaryExpression' && n.right.operator === '+' && memberName(n.right.left) === memberName(n.left)) return true;
    /* x = edit(x) or x = x.replace(...) rewrites the text in place; it keeps it. */
    if (n.right.type === 'CallExpression') {
      var target = memberName(n.left);
      if (n.right.arguments.some(function (a) { return memberName(a) === target; })) return true;
      if (n.right.callee.type === 'MemberExpression' && memberName(n.right.callee.object) === target) return true;
    }
    return false;
  }
  function containsBreak(body) {
    var found = false;
    walk.full(body, function (x) { if (x.type === 'BreakStatement' || x.type === 'ReturnStatement' || x.type === 'ThrowStatement') found = true; });
    return found;
  }
  function isGlobalRef(n, parent) {
    if (!parent) return true;
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return false;
    if (parent.type === 'Property' && parent.key === n && !parent.computed) return false;
    if ((parent.type === 'VariableDeclarator' && parent.id === n) || (/Function/.test(parent.type) && parent.params && parent.params.indexOf(n) !== -1)) return false;
    return true;
  }
  function arrowFixable(n) {
    return n.params.every(function (p) { return p.type === 'Identifier' || (p.type === 'AssignmentPattern' && p.left.type === 'Identifier'); }) && !n.async && !usesThisOrArguments(n);
  }
  function forOfFixable(n) {
    return n.left.type === 'VariableDeclaration' && n.left.declarations.length === 1 && n.left.declarations[0].id.type === 'Identifier' && !n.await;
  }
  function defaultFixable(n, parent) {
    if (!(n.left.type === 'Identifier' && parent && /Function/.test(parent.type) && parent.params.indexOf(n) !== -1)) return false;
    return parent.body.type === 'BlockStatement' || (parent.type === 'ArrowFunctionExpression' && arrowFixable(parent));
  }

  /* ---------- auto-fix ---------- */
  /* Each pass collects non-overlapping edits from the innermost outward,
     applies them, and re-parses.  Nested constructs get fixed over passes. */
  function fix(code) {
    var passes = 0, applied = 0, current = code, log = [];
    while (passes < 8) {
      passes++;
      var ast;
      try { ast = parseLoose(current); } catch (e) { break; }
      var edits = collectEdits(current, ast);
      if (!edits.length) break;
      edits.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
      /* Keep innermost edits: drop any edit that contains another edit. */
      var chosen = [];
      edits.forEach(function (e) {
        var contains = edits.some(function (o) { return o !== e && o.start >= e.start && o.end <= e.end && (o.start !== e.start || o.end !== e.end); });
        var overlaps = chosen.some(function (o) { return e.start < o.end && o.start < e.end; });
        if (!contains && !overlaps) chosen.push(e);
      });
      if (!chosen.length) break;
      chosen.sort(function (a, b) { return b.start - a.start; });
      chosen.forEach(function (e) { current = current.slice(0, e.start) + e.text + current.slice(e.end); log.push(e.rule); });
      applied += chosen.length;
    }
    var counts = {};
    log.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    return { code: current, applied: applied, counts: counts, after: check(current) };
  }

  function collectEdits(code, ast) {
    var E = [], tmp = 0;
    function src(n) { return code.slice(n.start, n.end); }
    function edit(start, end, text, rule) { E.push({ start: start, end: end, text: text, rule: rule }); }
    walk.fullAncestor(ast, function (n, anc) {
      var parent = anc[anc.length - 2];
      switch (n.type) {
        case 'VariableDeclaration':
          if (n.kind !== 'var') edit(n.start, n.start + n.kind.length, 'var', 'let/const -> var');
          break;
        case 'ArrowFunctionExpression':
          if (!arrowFixable(n)) break;
          var params = '(' + n.params.map(src).join(', ') + ')';
          var body = n.expression ? '{ return ' + src(n.body) + '; }' : src(n.body);
          edit(n.start, n.end, 'function ' + params + ' ' + body, 'arrow -> function');
          break;
        case 'TemplateLiteral':
          if (parent && parent.type === 'TaggedTemplateExpression') break;
          var parts = [], i;
          for (i = 0; i < n.quasis.length; i++) {
            var cooked = n.quasis[i].value.cooked;
            if (cooked) parts.push(JSON.stringify(cooked).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
            if (i < n.expressions.length) parts.push('(' + src(n.expressions[i]) + ')');
          }
          if (!parts.length) parts.push('""');
          if (parts[0].charAt(0) !== '"') parts.unshift('""');
          var joined = parts.join(' + ');
          edit(n.start, n.end, parts.length > 1 ? '(' + joined + ')' : joined, 'template -> concatenation');
          break;
        case 'Property':
          if (parent && parent.type === 'ObjectExpression' && n.shorthand && n.key.type === 'Identifier' && n.value.type === 'Identifier') edit(n.start, n.end, n.key.name + ': ' + n.key.name, 'shorthand property');
          else if (parent && parent.type === 'ObjectExpression' && n.method && !n.computed && n.value.type === 'FunctionExpression' && !n.value.async && !n.value.generator) {
            var fnSrc = code.slice(n.value.start, n.value.end);
            edit(n.start, n.end, src(n.key) + ': function ' + fnSrc, 'method shorthand');
          }
          break;
        case 'CallExpression':
          if (n.callee.type === 'MemberExpression' && !n.callee.computed && n.arguments.length === 1 && n.arguments[0].type !== 'SpreadElement' && !n.optional && n.callee.object.type !== 'Super') {
            var p = n.callee.property.name, obj = src(n.callee.object), arg = src(n.arguments[0]);
            if (p === 'includes') edit(n.start, n.end, '(' + obj + '.indexOf(' + arg + ') !== -1)', '.includes -> .indexOf');
            if (p === 'startsWith') edit(n.start, n.end, '(' + obj + '.indexOf(' + arg + ') === 0)', '.startsWith -> .indexOf');
          }
          break;
        case 'AssignmentExpression':
          if (n.operator === '=' && /^context\.character\.(personality|scenario)$/.test(memberName(n.left)) && !selfAppend(n)) {
            edit(n.left.end, n.right.start, code.slice(n.left.end, n.right.start).replace('=', '+='), '= -> +=');
          }
          break;
        case 'ArrayExpression':
          if (n.elements.some(function (e) { return e && e.type === 'SpreadElement'; }) && n.elements.every(function (e) { return e; })) {
            var bits = n.elements.map(function (e) { return e.type === 'SpreadElement' ? src(e.argument) : '[' + src(e) + ']'; });
            edit(n.start, n.end, '[].concat(' + bits.join(', ') + ')', 'array spread -> concat');
          }
          break;
        case 'ForOfStatement':
          if (!forOfFixable(n)) break;
          tmp++;
          var name = n.left.declarations[0].id.name, iv = '_i' + tmp, av = '_list' + tmp;
          var bodySrc = n.body.type === 'BlockStatement' ? src(n.body).slice(1, -1) : ' ' + src(n.body) + ' ';
          edit(n.start, n.end, 'for (var ' + iv + ' = 0, ' + av + ' = ' + src(n.right) + '; ' + iv + ' < ' + av + '.length; ' + iv + '++) { var ' + name + ' = ' + av + '[' + iv + '];' + bodySrc + '}', 'for...of -> for');
          break;
        case 'FunctionDeclaration': case 'FunctionExpression':
          var defs = n.params.filter(function (pp) { return pp.type === 'AssignmentPattern' && pp.left.type === 'Identifier'; });
          if (!defs.length || n.body.type !== 'BlockStatement' || n.params.some(function (pp) { return pp.type === 'AssignmentPattern' && pp.left.type !== 'Identifier'; })) break;
          defs.forEach(function (d) { edit(d.start, d.end, d.left.name, 'default parameter'); });
          var inits = defs.map(function (d) { return ' if (' + d.left.name + ' === undefined) { ' + d.left.name + ' = ' + src(d.right) + '; }'; }).join('');
          edit(n.body.start + 1, n.body.start + 1, inits, 'default parameter');
          break;
      }
    });
    return E;
  }

  return { check: check, fix: fix, locOf: locOf };
});

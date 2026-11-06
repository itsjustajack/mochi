/* Builds two self-contained files with no external requests:
   dist/janitor-script-builder.html  (open from disk, works offline)
   dist/artifact.html                (same app, without the document skeleton) */
'use strict';
var fs = require('fs'), path = require('path');
function rd(p) { return fs.readFileSync(path.join(__dirname, p), 'utf8'); }
function safeJs(s) { return s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--'); }
var css = rd('src/style.css');
var js = [
  rd('node_modules/acorn/dist/acorn.js'),
  rd('node_modules/acorn-walk/dist/walk.js'),
  'window.JSB_RUNTIME_SOURCE = ' + JSON.stringify(rd('src/runtime.es5.js')).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';',
  rd('src/generator.js'), rd('src/presets.js'), rd('src/checker.js'), rd('src/io.js'), rd('src/tester.js'),
  rd('src/app-core.js'), rd('src/app-forms.js'), rd('src/app-tools.js'), rd('src/app-io.js'), rd('src/app-easy.js'),
  'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", App.boot); else App.boot();'
].map(safeJs).join('\n;\n');
var head = '<title>JanitorAI Script Builder</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="description" content="Offline builder for Janitor AI Advanced scripts: lorebook, memory, emotions, meters, ensemble cast, pacing, random events and rules, compiled to strict ES5.">\n<style>\n' + css + '\n</style>\n';
var body = rd('src/body.html');
var script = '<script>\n' + js + '\n</script>\n';
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
var art = head + body + script.replace('<script>\n', '<script>\nwindow.JSB_HOSTED = true;\n');
fs.writeFileSync(path.join(__dirname, 'dist/artifact.html'), art);
var full = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head + '</head>\n<body>\n' + body + script + '</body>\n</html>\n';
fs.writeFileSync(path.join(__dirname, 'dist/janitor-script-builder.html'), full);
console.log('built', (full.length / 1000).toFixed(1) + ' KB');

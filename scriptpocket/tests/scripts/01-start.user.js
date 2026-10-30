// ==UserScript==
// @name         Start runner
// @namespace    test
// @version      1.0
// @match        https://test.example/*
// @run-at       document-start
// @grant        GM_setValue
// ==/UserScript==
var leaked = 'should stay inside';
window.results.start = {
  readyState: document.readyState,
  bodyExists: !!document.body,
  seesBridgeToken: typeof TOKEN !== 'undefined' || typeof B !== 'undefined' || typeof META !== 'undefined',
  unsafeIsWindow: unsafeWindow === window,
  thisIsWindow: this === window,
  info: GM_info.script.name + '|' + GM_info.script.version + '|' + GM_info.scriptHandler
};
GM_setValue('count', { n: 1, list: [1, 2] });
GM_setValue('flag', true);
window.results.start.get = GM_getValue('count');
window.results.start.missing = GM_getValue('nope', 'default');
window.results.start.list = GM_listValues().sort();
GM_deleteValue('flag');
window.results.start.afterDelete = GM_listValues();
var heard = [];
GM_addValueChangeListener('count', function (k, o, n) { heard.push([k, o && o.n, n.n]); });
GM_setValue('count', { n: 2 });
window.results.start.heard = heard;
GM_addStyle('#box { color: rgb(255, 0, 0); }');

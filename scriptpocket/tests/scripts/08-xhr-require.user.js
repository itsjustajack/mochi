// ==UserScript==
// @name         Network and libs
// @match        https://test.example/*
// @require      https://cdn.example/lib.js
// @resource     greeting https://cdn.example/greeting.txt
// @grant        GM_xmlhttpRequest
// ==/UserScript==
window.results.require = requiredLib.answer;
GM_xmlhttpRequest({
  method: 'POST', url: '/api', data: 'hello', headers: { 'X-Test': '1' }, responseType: 'json',
  onload: function (r) { window.results.xhr = { status: r.status, body: r.response, finalUrl: r.finalUrl, ctx: r.context }; },
  context: 'ctx1'
});
GM_xmlhttpRequest({ url: 'https://fail.example/', onerror: function (r) { window.results.xhrError = r.error; } });
GM.xmlHttpRequest({ url: 'https://test.example/bin', responseType: 'arraybuffer' }).then(function (r) {
  window.results.bin = Array.prototype.slice.call(new Uint8Array(r.response));
});
GM.getValue('count', 0).then(function (v) { window.results.promiseGet = v; });
var id = GM_registerMenuCommand('Say hi', function () { window.results.menu = 'clicked'; });
window.results.menuId = id;

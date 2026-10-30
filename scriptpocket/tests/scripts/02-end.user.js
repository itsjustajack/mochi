// ==UserScript==
// @name         End runner
// @namespace    test
// @match        *://*.example/*
// @run-at       document-end
// ==/UserScript==
window.results.end = { readyState: document.readyState, box: !!document.getElementById('box'), resource: GM_getResourceText('greeting'), resUrl: GM_getResourceURL('greeting').slice(0, 23) };
// trailing comment with no newline at the end
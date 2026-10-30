// ==UserScript==
// @name         Idle runner
// @include      https://test.example/page*
// ==/UserScript==
window.results.idle = { readyState: document.readyState, color: getComputedStyle(document.getElementById('box')).color, required: typeof requiredLib };

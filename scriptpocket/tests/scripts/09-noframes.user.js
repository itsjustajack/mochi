// ==UserScript==
// @name         Frames check
// @match        https://test.example/*
// @noframes
// ==/UserScript==
(window.results || (window.results = {})).frames = (window.results.frames || 0) + 1;

/* ============================================================
   SafePass v2 - Theme Manager
   Loaded in <head> so the theme is set before the page paints.
   The stored choice can be 'dark', 'light' or 'system' (follow the OS);
   data-theme on <html> always holds the resolved 'dark' / 'light'.
   ============================================================ */

window.SafePassTheme = (function () {
    'use strict';

    const STORAGE_KEY = 'sp-theme';
    const DEFAULT_THEME = 'dark';
    const CHOICES = ['dark', 'light', 'system'];
    const systemQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    let choice = DEFAULT_THEME;

    function read() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    }

    function write(value) {
        try { localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* storage blocked: keep it for this page only */ }
    }

    function resolve(value) {
        if (value === 'system') return systemQuery && systemQuery.matches ? 'light' : 'dark';
        return value;
    }

    function applyTheme(value) {
        choice = CHOICES.indexOf(value) !== -1 ? value : DEFAULT_THEME;
        const theme = resolve(choice);
        document.documentElement.setAttribute('data-theme', theme);
        write(choice);
        window.dispatchEvent(new CustomEvent('sp-theme-changed', { detail: { theme: theme, choice: choice } }));
    }

    // The resolved theme ('dark' / 'light')
    function getTheme() {
        return resolve(choice);
    }

    // What the user picked, including 'system'
    function getChoice() {
        return choice;
    }

    function setTheme(value) {
        applyTheme(value);
    }

    // The topbar button flips between explicit dark and light
    function toggleTheme() {
        applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    }

    if (systemQuery) {
        const follow = function () { if (choice === 'system') applyTheme('system'); };
        if (systemQuery.addEventListener) systemQuery.addEventListener('change', follow);
        else if (systemQuery.addListener) systemQuery.addListener(follow);
    }

    applyTheme(read() || DEFAULT_THEME);

    return {
        getTheme,
        getChoice,
        setTheme,
        toggleTheme
    };
})();

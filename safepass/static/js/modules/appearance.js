/* ============================================================
   SafePass v2 - Appearance preferences (layout settings panel)
   Loaded in <head>: every preference becomes a data-* attribute on
   <html> before the page paints, and the CSS does the rest.
   Stored per browser; nothing here is sent to the server.
   ============================================================ */

window.SafePassAppearance = (function () {
    'use strict';

    const STORAGE_KEY = 'sp-appearance';

    // Allowed values; the first one is the default
    const OPTIONS = {
        accent: ['purple', 'emerald', 'indigo', 'pink', 'amber'],
        sidebar: ['expanded', 'compact'],
        fontSize: ['md', 'sm', 'lg'],
        radius: ['soft', 'sharp', 'round'],
        transition: ['fadeUp', 'fade', 'zoom', 'none'],
        glass: [true, false],
        boxed: [false, true],
        privacy: [false, true],
    };

    // data-* attribute for each preference
    const ATTRIBUTES = {
        accent: 'data-accent', sidebar: 'data-sidebar', fontSize: 'data-font-size', radius: 'data-radius',
        transition: 'data-transition', glass: 'data-glass', boxed: 'data-boxed', privacy: 'data-privacy',
    };

    function defaults() {
        const out = {};
        Object.keys(OPTIONS).forEach(function (key) { out[key] = OPTIONS[key][0]; });
        return out;
    }

    function clean(stored) {
        const prefs = defaults();
        Object.keys(OPTIONS).forEach(function (key) {
            if (stored && OPTIONS[key].indexOf(stored[key]) !== -1) prefs[key] = stored[key];
        });
        return prefs;
    }

    function read() {
        try { return clean(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch (e) { return defaults(); }
    }

    function write(value) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (e) { /* storage blocked: this page only */ }
    }

    let prefs = read();

    function apply() {
        const root = document.documentElement;
        Object.keys(ATTRIBUTES).forEach(function (key) {
            root.setAttribute(ATTRIBUTES[key], String(prefs[key]));
        });
        // Page transition "none" also turns off decorative motion (counters etc.)
        root.setAttribute('data-motion', prefs.transition === 'none' ? 'off' : 'on');
        window.dispatchEvent(new CustomEvent('sp-appearance-changed', { detail: get() }));
    }

    function get() {
        return Object.assign({}, prefs);
    }

    function set(key, value) {
        if (!OPTIONS[key] || OPTIONS[key].indexOf(value) === -1) return;
        prefs[key] = value;
        write(prefs);
        apply();
    }

    function reset() {
        prefs = defaults();
        write(prefs);
        apply();
    }

    apply();

    return { get, set, reset, options: OPTIONS };
})();

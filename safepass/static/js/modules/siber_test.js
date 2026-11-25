/* Cyber test page: plays an attack against a password with Lokki as the attacker.
   The numbers come from SafePassAttack (attack_sim.js); this file only animates them.
   The password is typed here or handed over by the generator in this tab's sessionStorage;
   it is analysed in the browser and never sent, saved or kept after the page closes. */
(function () {
    'use strict';

    const Attack = window.SafePassAttack;
    const HANDOFF_KEY = 'sp-siber-test';
    const HANDOFF_MAX_AGE = 2 * 60 * 1000;
    // How much each test searches when it finds nothing (shown on the counter)
    const SEARCH_SIZE = [Attack.LEAKED_COUNT, 2e9, 1e7, 1e6, null];
    const COMMANDS = [
        () => '$ crack --wordlist leaked-top-' + Attack.LEAKED_COUNT,
        () => '$ crack --wordlist words --rules case,leet,affix',
        () => '$ crack --patterns keyboard,sequence,repeat',
        () => '$ crack --masks dates,pins',
        (s) => '$ crack --brute --charset ' + s.pool + ' --length ' + s.length
    ];
    const SUPERSCRIPT = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

    const $ = (id) => document.getElementById(id);
    const arena = $('simArena');
    const terminal = $('simTerminal');
    const counter = $('simCounter');
    const lokki = document.querySelector('.sim-lokki-svg');
    const input = $('simPassword');

    let generatorPassword = null;   // the password the generator sent, if any
    let generatorOptions = null;    // the generator settings it was made with
    let summary = null;
    let runId = 0;
    let running = false;

    function t(key, params) {
        return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
    }

    function lang() {
        return window.SafePassI18n ? window.SafePassI18n.getLang() : 'tr';
    }

    function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // Text that follows the language switch: data-i18n + params, then the current text
    function setText(el, key, params) {
        el.setAttribute('data-i18n', key);
        if (params) el.setAttribute('data-i18n-params', JSON.stringify(params));
        else el.removeAttribute('data-i18n-params');
        el.textContent = t(key, params);
    }

    // 1234567 → "1.234.567", 4.4e31 → "4,4×10³¹"
    function big(n) {
        if (!isFinite(n)) return '∞';
        if (n < 1e6) return Math.round(n).toLocaleString(lang());
        const exp = Math.floor(Math.log10(n));
        const mantissa = n / Math.pow(10, exp);
        const head = mantissa >= 9.95 ? '10' : mantissa.toLocaleString(lang(), { maximumFractionDigits: 1 });
        const power = String(mantissa >= 9.95 ? exp + 1 : exp).replace(/./g, (c) => SUPERSCRIPT[c] || c);
        return head === '1' ? '10' + power : head + '×10' + power;
    }

    function duration(seconds) {
        const year = 365 * 24 * 3600;
        if (seconds < 1) return t('siber.time.instant');
        if (seconds < 60) return t('siber.time.seconds', { n: Math.round(seconds) });
        if (seconds < 3600) return t('siber.time.minutes', { n: Math.round(seconds / 60) });
        if (seconds < 86400) return t('siber.time.hours', { n: Math.round(seconds / 3600) });
        if (seconds < year) return t('siber.time.days', { n: Math.round(seconds / 86400) });
        const years = seconds / year;
        if (years > 1.38e10) return t('siber.time.universe');
        return t('siber.time.years', { n: big(years) });
    }

    function sleep(ms, id) {
        return new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms))
            .then(() => { if (id !== runId) throw new Error('stopped'); });
    }

    function setMood(mood) {
        if (!lokki) return;
        lokki.setAttribute('data-mood', 'idle');
        void lokki.getBoundingClientRect();
        lokki.setAttribute('data-mood', mood);
    }

    function say(key, params) {
        setText($('simSay'), key, params);
    }

    // ── Target ─────────────────────────────────────────────────────────────
    // Generator settings come along when the password came from the generator: the attacker
    // is assumed to know them (worst case). A typed password gets its pool from its characters.
    function buildSummary() {
        const password = input.value;
        if (!password) return null;
        const options = generatorOptions && password === generatorPassword ? generatorOptions : null;
        return Attack.analyze(password, options, options ? 'generator' : 'sample');
    }

    function renderSummary() {
        const el = $('simSummary');
        el.hidden = !summary;
        if (!summary) return;
        if (summary.pin) {
            setText(el, 'siber.summary_pin', { length: summary.length, n: big(Math.pow(10, summary.length)) });
        } else {
            const bits = Math.round(summary.length * Math.log2(summary.pool));
            setText(el, 'siber.summary', { length: summary.length, pool: summary.pool, bits });
        }
    }

    function targetChanged() {
        runId += 1;   // stops a running simulation
        running = false;
        const fromGenerator = generatorPassword !== null && input.value === generatorPassword;
        setText($('simPasswordLabel'), fromGenerator ? 'siber.input_label_generator' : 'siber.input_label');
        summary = buildSummary();
        renderSummary();
        reset();
    }

    // The generator page leaves the password and its settings in this tab's sessionStorage;
    // read once and removed right away, so a reload or another tab never sees it
    function readHandoff() {
        let raw = null;
        try {
            raw = sessionStorage.getItem(HANDOFF_KEY);
            sessionStorage.removeItem(HANDOFF_KEY);
        } catch (e) {
            return null;
        }
        if (!raw) return null;
        try {
            const data = JSON.parse(raw);
            if (!data || typeof data.at !== 'number' || Date.now() - data.at > HANDOFF_MAX_AGE) return null;
            if (typeof data.password !== 'string' || !data.password || data.password.length > 64) return null;
            const o = data.options;
            const options = o && typeof o === 'object' ? {
                uppercase: !!o.uppercase, lowercase: !!o.lowercase, numbers: !!o.numbers, symbols: !!o.symbols
            } : null;
            const valid = options && (options.uppercase || options.lowercase || options.numbers || options.symbols);
            return { password: data.password, options: valid ? options : null };
        } catch (e) {
            return null;
        }
    }

    // ── Arena ──────────────────────────────────────────────────────────────
    function testItems() {
        return Array.from(document.querySelectorAll('#simTests .sim-test'));
    }

    function setStatus(item, status) {
        item.setAttribute('data-status', status);
        setText(item.querySelector('.sim-test-status'), 'siber.status.' + status);
    }

    function reset() {
        arena.setAttribute('data-state', 'ready');
        terminal.textContent = '';
        counter.textContent = '';
        testItems().forEach((item) => {
            setStatus(item, 'waiting');
            const log = item.querySelector('.sim-test-log');
            log.textContent = '';
            log.removeAttribute('data-i18n');
        });
        $('simOutcome').hidden = true;
        setText($('simShieldState'), 'siber.defense');
        setMood('idle');
        say('siber.say.ready');
    }

    function line(text, kind, key, params) {
        const row = document.createElement('div');
        row.className = 'sim-line' + (kind ? ' is-' + kind : '');
        if (key) setText(row, key, params);
        else row.textContent = text;
        terminal.appendChild(row);
        terminal.scrollTop = terminal.scrollHeight;
        return row;
    }

    // Counter climbs to the number of candidates the test goes through
    function countTo(target, ms, id) {
        if (reducedMotion() || ms <= 0) {
            setText(counter, 'siber.counter', { n: big(target) });
            return Promise.resolve();
        }
        const start = performance.now();
        return new Promise((resolve) => {
            const step = (now) => {
                if (id !== runId) { resolve(); return; }
                const p = Math.min(1, (now - start) / ms);
                // Exponential climb: huge counts still look like counting
                const value = p >= 1 ? target : Math.pow(Math.max(target, 1), p * (2 - p));
                setText(counter, 'siber.counter', { n: big(value) });
                if (p < 1) requestAnimationFrame(step); else resolve();
            };
            requestAnimationFrame(step);
        });
    }

    function logKey(test, result) {
        if (test.status === 'skipped') return ['siber.log.skipped'];
        if (test.code === 'brute') {
            const params = { space: big(test.space), bits: Math.round(result.bits) };
            return [test.status === 'broken' ? 'siber.log.brute_broken' : 'siber.log.brute_held', params];
        }
        if (test.code === 'random') return ['siber.log.random'];
        if (test.code === 'no_match') return ['siber.log.no_match'];
        if (test.code === 'leaked') return ['siber.log.leaked', { rank: test.rank }];
        const far = test.status === 'broken' ? '' : '_far';
        return ['siber.log.' + test.code + far, { guesses: big(test.g) }];
    }

    async function run() {
        if (running || !summary) return;
        const id = ++runId;
        running = true;
        reset();
        const result = Attack.evaluate(summary);
        const budget = Attack.SPEEDS.md5 * Attack.BUDGET_SECONDS;

        arena.setAttribute('data-state', 'running');
        setMood('thinking');

        try {
            await sleep(500, id);
            setMood('typing');
            const items = testItems();
            for (const test of result.tests) {
                const item = items[test.index];
                if (test.status === 'skipped') {
                    setStatus(item, 'skipped');
                    setText(item.querySelector('.sim-test-log'), 'siber.log.skipped');
                    continue;
                }
                setStatus(item, 'running');
                item.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                say('siber.say.t' + (test.index + 1));
                line(COMMANDS[test.index](summary), 'cmd');
                const searched = test.status === 'broken' ? test.g
                    : (test.index === 4 ? Math.min(test.space, budget) : Math.max(SEARCH_SIZE[test.index], test.g || 0));
                await countTo(searched, test.index === 4 ? 2200 : 1300, id);
                await sleep(200, id);

                const [key, params] = logKey(test, result);
                line('', test.status === 'broken' ? 'hit' : 'miss', key, params);
                setText(item.querySelector('.sim-test-log'), key, params);
                setStatus(item, test.status);
                if (test.status === 'broken') {
                    arena.setAttribute('data-state', 'broken');
                    setText($('simShieldState'), 'siber.shield.broken');
                    setMood('cheer');
                    say('siber.say.broken', { n: test.index + 1 });
                    await sleep(600, id);
                }
            }
            if (result.brokenAt < 0) {
                arena.setAttribute('data-state', 'held');
                setText($('simShieldState'), 'siber.shield.held');
                setMood('sad');
                say('siber.say.held');
            }
            showOutcome(result);
        } catch (e) {
            // Stopped because the target changed
        } finally {
            if (id === runId) running = false;
        }
    }

    let lastResult = null;

    function showOutcome(result) {
        lastResult = result;
        const s = result.scenarios;
        if (result.brokenAt >= 0) {
            const n = result.brokenAt + 1;
            setText($('simVerdictTitle'), 'siber.result.broken_title', { n, name: t('siber.test.' + n + '.name') });
            setText($('simVerdictTime'), 'siber.result.broken_time', { time: duration(s.md5.seconds) });
            if (summary && summary.pin) setText($('simTip'), 'siber.tip.pin');
            else if (result.brokenAt === 4) setText($('simTip'), 'siber.tip.length', { n: result.saferLength });
            else setText($('simTip'), 'siber.tip.pattern');
        } else {
            setText($('simVerdictTitle'), 'siber.result.held_title');
            setText($('simVerdictTime'), 'siber.result.held_time', { time: duration(s.md5.seconds) });
            setText($('simTip'), 'siber.tip.keep');
        }
        $('simVerdict').classList.toggle('is-broken', result.brokenAt >= 0);

        ['online', 'md5', 'bcrypt'].forEach((name) => {
            const card = document.querySelector('.sim-scn[data-scn="' + name + '"]');
            const verdict = card.querySelector('.sim-scn-verdict');
            setText(verdict, s[name].falls ? 'siber.verdict.falls' : 'siber.verdict.holds', { time: duration(s[name].seconds) });
            card.setAttribute('data-falls', s[name].falls ? '1' : '0');
            card.removeAttribute('data-na');
        });
        const pinCard = document.querySelector('.sim-scn[data-scn="pin"]');
        const pinVerdict = pinCard.querySelector('.sim-scn-verdict');
        if (!s.pin.applies) {
            setText(pinVerdict, 'siber.verdict.na');
            pinCard.setAttribute('data-na', '1');
            pinCard.removeAttribute('data-falls');
        } else {
            pinCard.removeAttribute('data-na');
            pinCard.setAttribute('data-falls', s.pin.falls ? '1' : '0');
            const p = (s.pin.chance * 100).toLocaleString(lang(), { maximumSignificantDigits: 2 });
            setText(pinVerdict, s.pin.falls ? 'siber.verdict.pin_falls' : 'siber.verdict.pin_holds', { p });
        }
        $('simOutcome').hidden = false;
    }

    // ── Wiring ─────────────────────────────────────────────────────────────
    // No start button: the run starts when the user stops typing, or right away on Enter
    let typingTimer = 0;
    function startNow() {
        clearTimeout(typingTimer);
        targetChanged();
        run();
    }
    input.addEventListener('input', () => {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(startNow, 700);
    });
    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        startNow();
    });
    // Test names and durations are built into the texts: rebuild them in the new language
    window.addEventListener('sp-lang-changed', () => {
        renderSummary();
        if (!$('simOutcome').hidden && lastResult) showOutcome(lastResult);
    });

    const handoff = readHandoff();
    if (handoff) {
        generatorPassword = handoff.password;
        generatorOptions = handoff.options;
        input.value = handoff.password;
    }
    if (handoff) startNow(); else targetChanged();
})();

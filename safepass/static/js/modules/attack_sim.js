/* Cyber test engine: estimates how an offline password cracker would fare against a password.
   Nothing here tries a real password against anything, stores guesses or touches the network.

   analyze(password, options) runs the test families in the browser and returns a summary that
   holds numbers only (length, pool, guess counts).
   evaluate(summary) turns a summary into test verdicts and scenario times.

   The model follows how real crackers order their work: leaked lists first, then dictionary
   words bent by rules, keyboard/sequence patterns, dates and PINs, and finally the full mask
   (the attacker is assumed to know the generator settings, the worst case). */
window.SafePassAttack = (function () {
    'use strict';

    // Attacker speeds in guesses per second, rounded from public hashcat figures
    // (RTX 4090: MD5 ~164 GH/s, bcrypt cost 10 ~6 kH/s; the rig has 8 of them).
    const SPEEDS = {
        online: 100 / 3600,   // a site that allows ~100 tries an hour
        md5: 1e12,
        bcrypt: 5e4
    };
    const PIN_TRIES = 3;                       // a card or phone locks after 3 wrong PINs
    const BUDGET_SECONDS = 365 * 24 * 3600;    // the attacker's patience: one year on the MD5 rig
    const POOL_SIZES = { uppercase: 26, lowercase: 26, numbers: 10, symbols: 32 };  // = generator

    // Most common passwords from public breach studies, most common first (rank = index + 1)
    const LEAKED = [
        '123456', 'password', '123456789', '12345678', '12345', 'qwerty', '1234567', '111111',
        '1234567890', '123123', 'abc123', '1234', 'password1', 'iloveyou', '1q2w3e4r', '000000',
        'qwerty123', 'zaq12wsx', 'dragon', 'sunshine', 'princess', 'letmein', '654321', 'monkey',
        '1qaz2wsx', '123321', 'qwertyuiop', 'superman', 'asdfghjkl', 'football', 'baseball',
        'welcome', 'admin', 'master', '666666', '121212', '112233', 'shadow', 'michael', 'jordan',
        'hunter', 'charlie', 'killer', 'trustno1', '7777777', '888888', '123qwe', 'qazwsx',
        'passw0rd', 'starwars', 'whatever', 'freedom', 'hello', 'login', 'access', 'flower',
        'lovely', 'mustang', 'batman', 'soccer', 'hockey', 'ranger', 'buster', 'thomas', 'tigger',
        'robert', 'daniel', 'andrew', 'jessica', 'pepper', 'ginger', 'cheese', 'summer', 'ashley',
        'nicole', 'chelsea', 'matrix', 'secret', 'computer', 'internet', 'google', 'samsung',
        'admin123', 'root', 'test', 'test123', 'guest', 'qwe123', 'asd123', 'aa123456', 'a123456',
        '123456a', 'abcd1234', 'q1w2e3r4', '1q2w3e', 'zxcvbnm', 'asdfgh', '987654321', '11111111',
        '00000000', '159753', '147258369', '123654', '121314', '696969', 'love', 'iloveu',
        'galatasaray', 'fenerbahce', 'besiktas', 'trabzonspor', 'sifre', 'sifre123', 'parola',
        'parola123', 'ankara', 'istanbul', 'turkiye', 'askim', 'canim', 'bebegim', 'sevgilim',
        'galatasaray1905', 'fenerbahce1907', 'besiktas1903', '1905', '1907', '1903', 'cimbom',
        'qwertyu', 'qwer1234', 'pass123', 'password123', 'welcome1', 'p@ssw0rd', 'changeme',
        'default', 'temp123', 'senha', 'contrasena', 'passwort', 'hallo', 'schatz', 'parol',
        'qwerty12', 'kalinka', 'privet', 'maria', 'alexander', 'natasha'
    ];

    // Base words that rules (case, leet, digits and symbols around them) are applied to
    const WORDS = [
        'password', 'pass', 'admin', 'welcome', 'dragon', 'monkey', 'master', 'shadow', 'sunshine',
        'princess', 'football', 'baseball', 'soccer', 'superman', 'batman', 'starwars', 'freedom',
        'whatever', 'hello', 'secret', 'login', 'letmein', 'iloveyou', 'love', 'summer', 'winter',
        'spring', 'autumn', 'january', 'february', 'march', 'april', 'june', 'july', 'august',
        'september', 'october', 'november', 'december', 'monday', 'friday', 'sunday', 'computer',
        'internet', 'google', 'facebook', 'instagram', 'samsung', 'apple', 'iphone', 'android',
        'windows', 'microsoft', 'qwerty', 'michael', 'jordan', 'charlie', 'thomas', 'daniel',
        'andrew', 'robert', 'jessica', 'ashley', 'nicole', 'maria', 'anna', 'alex', 'alexander',
        'galatasaray', 'fenerbahce', 'besiktas', 'trabzonspor', 'cimbom', 'sifre', 'parola',
        'ankara', 'istanbul', 'izmir', 'turkiye', 'turkey', 'askim', 'canim', 'bebegim', 'sevgilim',
        'aslan', 'kartal', 'kanarya', 'mehmet', 'ahmet', 'mustafa', 'ayse', 'fatma', 'zeynep',
        'elif', 'emre', 'burak', 'murat', 'deniz', 'yildiz', 'gunes', 'kedi', 'kopek', 'bilgisayar',
        'merhaba', 'tamam', 'senha', 'contrasena', 'hola', 'madrid', 'barcelona', 'passwort',
        'hallo', 'schatz', 'berlin', 'bayern', 'parol', 'privet', 'moskva', 'natasha', 'spartak'
    ];

    // Most used PINs; dates are caught by the date rules
    const COMMON_PINS = [
        '1234', '1111', '0000', '1212', '7777', '1004', '2000', '4444', '2222', '6969', '9999',
        '3333', '5555', '6666', '1122', '1313', '8888', '4321', '2001', '1010', '123456', '111111',
        '000000', '654321', '121212', '123123', '666666', '112233', '159753', '12345678', '11111111'
    ];

    const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1qaz2wsx3edc', 'qazwsxedc'];
    const LEET = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't' };
    const ASCII = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };

    const leakedRank = new Map(LEAKED.map((word, i) => [word, i + 1]));
    const wordRank = new Map(WORDS.map((word, i) => [word, i + 1]));
    const pinRank = new Map(COMMON_PINS.map((pin, i) => [pin, i + 1]));

    function lower(text) {
        return Array.from(text.toLowerCase()).map((ch) => ASCII[ch] || ch).join('');
    }

    function charPool(ch) {
        if (/[0-9]/.test(ch)) return 10;
        if (/[a-z]/i.test(ch)) return 26;
        return 33;
    }

    function restSpace(chars) {
        return chars.reduce((total, ch) => total * charPool(ch), 1);
    }

    // Case choices an attacker's rules try: none, capitalised / all caps, otherwise per letter
    function caseVariants(text) {
        const letters = text.replace(/[^a-zA-Z]/g, '');
        const uppers = letters.replace(/[^A-Z]/g, '').length;
        if (!uppers) return 1;
        if (letters === letters.toUpperCase() || (uppers === 1 && /[A-Z]/.test(letters[0]))) return 2;
        return Math.pow(2, Math.min(uppers, 20));
    }

    // ── Test 1: leaked list ──────────────────────────────────────────────────
    function testLeaked(password) {
        const rank = leakedRank.get(lower(password));
        if (!rank) return { g: null, code: 'no_match' };
        return { g: rank * caseVariants(password), code: 'leaked', rank };
    }

    // ── Test 2: dictionary word + rules ──────────────────────────────────────
    function deleet(text) {
        let subs = 0;
        const out = Array.from(text).map((ch) => {
            if (LEET[ch]) { subs += 1; return LEET[ch]; }
            return ch;
        }).join('');
        return { out, subs };
    }

    function testDictionary(password) {
        const low = lower(password);
        // Digits and symbols the rules put before or after the word
        const parts = low.match(/^([^a-z@$!+]*)(.*?)([^a-z]*)$/) || ['', '', low, ''];
        const prefix = Array.from(parts[1]);
        const suffix = Array.from(parts[3]);
        const { out: core, subs } = deleet(parts[2]);
        if (core.length < 3) return { g: null, code: 'no_match' };

        // Whole core is a word, or the longest word inside it
        let rank = wordRank.get(core) || leakedRank.get(core);
        let rest = [];
        if (!rank) {
            let best = null;
            for (const [word, r] of wordRank) {
                if (word.length >= 4 && core.includes(word) && (!best || word.length > best.word.length)) best = { word, r };
            }
            if (!best) return { g: null, code: 'no_match' };
            rank = best.r;
            rest = Array.from(core.replace(best.word, ''));
        }
        const affix = restSpace(prefix.concat(suffix)) * (prefix.length + suffix.length + 1);
        const g = rank * caseVariants(password) * Math.pow(2, subs) * affix * restSpace(rest);
        return { g, code: 'word' };
    }

    // ── Test 3: keyboard runs, sequences, repeats ────────────────────────────
    function runLength(text, start) {
        // Longest run from start that is a repeat, an alphabet/digit sequence or a keyboard walk
        const best = { len: 1, guesses: 1 };
        const tryRun = (len, guesses) => { if (len >= 3 && len > best.len) { best.len = len; best.guesses = guesses; } };

        let i = start + 1;
        while (i < text.length && text[i] === text[start]) i += 1;
        tryRun(i - start, 40);

        for (const step of [1, -1]) {
            i = start + 1;
            while (i < text.length && /[a-z0-9]/.test(text[i]) &&
                text.charCodeAt(i) - text.charCodeAt(i - 1) === step &&
                /[0-9]/.test(text[i]) === /[0-9]/.test(text[start])) i += 1;
            tryRun(i - start, 80);
        }

        for (const row of KEYBOARD_ROWS) {
            for (const dir of [1, -1]) {
                const line = dir === 1 ? row : Array.from(row).reverse().join('');
                let pos = line.indexOf(text[start]);
                if (pos < 0) continue;
                i = start + 1;
                while (i < text.length && line[pos + 1] === text[i]) { i += 1; pos += 1; }
                tryRun(i - start, 120);
            }
        }
        return best;
    }

    function testPattern(password) {
        const low = lower(password);
        let covered = 0;
        let guesses = 1;
        const rest = [];
        let i = 0;
        while (i < low.length) {
            const run = runLength(low, i);
            if (run.len >= 3) {
                covered += run.len;
                guesses *= run.guesses * caseVariants(password.slice(i, i + run.len));
                i += run.len;
            } else {
                rest.push(password[i]);
                i += 1;
            }
        }
        if (!covered || covered * 2 < low.length) return { g: null, code: 'no_match' };
        return { g: guesses * restSpace(rest), code: 'pattern' };
    }

    // ── Test 4: dates and PINs ───────────────────────────────────────────────
    function validDate(day, month) {
        return day >= 1 && day <= 31 && month >= 1 && month <= 12;
    }

    function dateSpace(run) {
        const n = (s) => parseInt(s, 10);
        const year = (y) => y >= 1900 && y <= 2039;
        if (run.length === 8) {
            if (validDate(n(run.slice(0, 2)), n(run.slice(2, 4))) && year(n(run.slice(4)))) return 140 * 366 * 2;
            if (year(n(run.slice(0, 4))) && validDate(n(run.slice(6)), n(run.slice(4, 6)))) return 140 * 366 * 2;
        }
        if (run.length === 6 && validDate(n(run.slice(0, 2)), n(run.slice(2, 4)))) return 100 * 366 * 2;
        if (run.length === 4) {
            if (year(n(run))) return 140;
            if (validDate(n(run.slice(0, 2)), n(run.slice(2))) || validDate(n(run.slice(2)), n(run.slice(0, 2)))) return 366 * 2;
        }
        return 0;
    }

    function testDate(password) {
        if (/^[0-9]+$/.test(password) && pinRank.has(password)) {
            return { g: pinRank.get(password), code: 'date' };
        }
        let best = null;
        const runs = password.match(/[0-9]{4,8}/g) || [];
        runs.forEach((run) => {
            const space = dateSpace(run);
            if (space && (!best || run.length > best.run.length)) best = { run, space };
        });
        if (!best || best.run.length * 2 < password.length) return { g: null, code: 'no_match' };
        const rest = Array.from(password.replace(best.run, ''));
        return { g: best.space * restSpace(rest) * (rest.length + 1), code: 'date' };
    }

    // ── Summaries (numbers only) ─────────────────────────────────────────────
    function poolOf(password) {
        let pool = 0;
        if (/[a-z]/.test(password)) pool += 26;
        if (/[A-Z]/.test(password)) pool += 26;
        if (/[0-9]/.test(password)) pool += 10;
        if (/[^a-zA-Z0-9]/.test(password)) pool += 33;
        return pool;
    }

    function poolFromOptions(options) {
        return Object.keys(POOL_SIZES).reduce((sum, key) => sum + (options[key] ? POOL_SIZES[key] : 0), 0);
    }

    // options: the generator settings it was made with, or null for a typed sample
    function analyze(password, options, source) {
        const length = Array.from(password).length;
        const pool = options ? poolFromOptions(options) : poolOf(password);
        return {
            v: 1,
            source: source || 'generator',
            length,
            pool,
            pin: /^[0-9]+$/.test(password) && length <= 8,
            tests: [testLeaked(password), testDictionary(password), testPattern(password), testDate(password)]
        };
    }

    // ── Verdicts ─────────────────────────────────────────────────────────────
    function evaluate(summary) {
        const keyspace = Math.pow(summary.pool, summary.length);
        const brute = { g: Math.max(1, keyspace / 2), code: 'brute', space: keyspace };
        const all = summary.tests.concat([brute]);
        const budgetGuesses = SPEEDS.md5 * BUDGET_SECONDS;

        let brokenAt = -1;
        const tests = all.map((test, index) => {
            const applies = test.g !== null;
            let status = 'held';
            if (brokenAt >= 0) status = 'skipped';
            else if (applies && test.g <= budgetGuesses) { status = 'broken'; brokenAt = index; }
            return { index, code: test.code, rank: test.rank, g: test.g, space: test.space, status, applies };
        });

        // The attacker always takes the cheapest route that exists
        const best = Math.min.apply(null, all.filter((test) => test.g !== null).map((test) => test.g));
        const scenario = (speed) => {
            const seconds = best / speed;
            return { seconds, falls: seconds <= BUDGET_SECONDS };
        };
        const pinChance = Math.min(1, PIN_TRIES / Math.max(1, best * 2));
        return {
            tests,
            brokenAt,
            best,
            keyspace,
            bits: summary.length * Math.log2(Math.max(1, summary.pool)),
            scenarios: {
                online: scenario(SPEEDS.online),
                md5: scenario(SPEEDS.md5),
                bcrypt: scenario(SPEEDS.bcrypt),
                pin: summary.pin ? { applies: true, falls: best <= PIN_TRIES, chance: pinChance } : { applies: false }
            },
            // Shortest generator length (same pool) that outlasts the budget on the MD5 rig
            saferLength: [8, 10, 12, 14, 16, 20, 24].find((len) => Math.pow(summary.pool, len) / 2 > budgetGuesses * 1000) || 24
        };
    }

    return {
        analyze,
        evaluate,
        SPEEDS,
        BUDGET_SECONDS,
        LEAKED_COUNT: LEAKED.length
    };
})();

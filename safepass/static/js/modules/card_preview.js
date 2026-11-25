/**
 * Shared by the new-card wizard and the edit form: password strength (same rules as the server,
 * PINs included), the live preview row, Lokki's reactions, show/hide and the "Generate" button.
 */
window.SafePassCardForm = (function () {
    'use strict';

    function t(key, params) {
        return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
    }

    function setI18nText(el, key, params) {
        if (!el) return;
        el.setAttribute('data-i18n', key);
        if (params) el.setAttribute('data-i18n-params', JSON.stringify(params));
        else el.removeAttribute('data-i18n-params');
        el.textContent = t(key, params);
    }

    // ── strength: mirrors generator.calculate_password_strength / calculate_pin_strength ──

    const PIN_MAX_LENGTH = 8;
    const COMMON_PINS = new Set([
        '1234', '1111', '0000', '1212', '7777', '1004', '2000', '4444', '2222', '6969', '9999', '3333',
        '5555', '6666', '1122', '1313', '8888', '4321', '2001', '1010', '2580', '0852', '1478', '1236',
        '123456', '111111', '000000', '654321', '121212', '123123', '666666', '112233', '159753', '696969',
        '777777', '888888', '999999', '555555', '147258', '258369', '123321', '102030', '101010', '131313'
    ]);
    const PIN_PENALTIES = { repeated: 70, sequence: 65, common: 65, pattern: 50, date: 35, few_digits: 25 };

    const isPin = (code) => /^\d+$/.test(code) && code.length <= PIN_MAX_LENGTH;
    const validDayMonth = (day, month) => month >= 1 && month <= 12 && day >= 1 && day <= 31;

    function looksLikeDate(pin) {
        const n = pin.length;
        const num = (a, b) => parseInt(pin.slice(a, b), 10);
        if (n === 4) {
            const a = num(0, 2), b = num(2, 4), year = num(0, 4);
            return validDayMonth(a, b) || validDayMonth(b, a) || (year >= 1940 && year <= 2039);
        }
        if (n === 6) {
            const x = num(0, 2), y = num(2, 4), z = num(4, 6);
            return validDayMonth(x, y) || validDayMonth(y, x) || validDayMonth(z, y);
        }
        if (n === 8) {
            return (validDayMonth(num(0, 2), num(2, 4)) && num(4, 8) >= 1900 && num(4, 8) <= 2099) ||
                (num(0, 4) >= 1900 && num(0, 4) <= 2099 && validDayMonth(num(6, 8), num(4, 6)));
        }
        return false;
    }

    function pinIssues(pin) {
        const issues = [];
        const n = pin.length;
        const distinct = new Set(pin).size;
        const steps = new Set();
        for (let i = 1; i < n; i++) steps.add(pin.charCodeAt(i) - pin.charCodeAt(i - 1));
        const onlyStep = steps.size === 1 ? [...steps][0] : null;
        let repeats = false;
        for (let size = 2; size <= Math.floor(n / 2); size++) {
            if (n % size === 0 && pin === pin.slice(0, size).repeat(n / size)) { repeats = true; break; }
        }
        if (distinct === 1) issues.push('repeated');
        else if (onlyStep === 1 || onlyStep === -1) issues.push('sequence');
        else if (repeats) issues.push('pattern');
        if (COMMON_PINS.has(pin)) issues.push('common');
        if (looksLikeDate(pin)) issues.push('date');
        if (!issues.length && distinct <= Math.floor(n / 2)) issues.push('few_digits');
        return issues;
    }

    function strength(password) {
        if (isPin(password)) {
            const n = password.length;
            const issues = pinIssues(password);
            const base = { 4: 70, 5: 78, 6: 90, 7: 95 }[n] || 100;
            const score = Math.max(0, base - issues.reduce((sum, code) => sum + PIN_PENALTIES[code], 0));
            const level = score >= 85 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'medium' : 'weak';
            return { score, strength: level, kind: 'pin', issues };
        }
        let score = password.length >= 16 ? 40 : password.length >= 12 ? 30 : password.length >= 8 ? 20 : 0;
        const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[!-/:-@[-`{-~]/].filter((re) => re.test(password)).length;
        score = Math.min(score + kinds * 15, 100);
        return { score, strength: score >= 80 ? 'strong' : score >= 50 ? 'medium' : 'weak', kind: 'password', issues: [] };
    }

    // ── Lokki ─────────────────────────────────────────────────

    const lokki = () => document.querySelector('.cw-preview .lokki');
    let moodTimer = null;

    function say(mood, key) {
        const el = lokki();
        if (el) {
            el.setAttribute('data-mood', mood);
            // Restart the hop so it plays on every happy moment
            if (mood === 'happy') { el.classList.remove('is-hopping'); void el.getBBox(); el.classList.add('is-hopping'); }
        }
        const bubble = document.getElementById('cwSay');
        if (bubble) bubble.classList.toggle('is-cloud', mood === 'shy');
        if (key) setI18nText(bubble, key);
    }

    function reactTo(result) {
        if (!result) return;
        const map = {
            weak: ['worried', 'wizard.say_weak'],
            medium: ['thinking', 'wizard.say_medium'],
            good: ['idle', 'wizard.say_good'],
            strong: ['happy', 'wizard.say_strong']
        };
        const [mood, key] = map[result.strength];
        say(mood, key);
    }

    // ── meter + preview ───────────────────────────────────────

    function renderMeter(password, emptyKey) {
        const meter = document.getElementById('cwMeter');
        const bar = document.getElementById('passwordStrengthBar');
        const text = document.getElementById('passwordStrengthText');
        if (!meter) return null;
        if (!password) {
            meter.removeAttribute('data-strength');
            bar.style.width = '0%';
            setI18nText(text, emptyKey);
            return null;
        }
        const result = strength(password);
        meter.setAttribute('data-strength', result.strength);
        bar.style.width = Math.max(result.score, 6) + '%';
        if (result.kind === 'pin') {
            // "Weak PIN · looks like a date": the first problem tells the user what to change
            const issue = result.issues[0];
            setI18nText(text, issue ? 'wizard.pin_meter_issue' : 'wizard.pin_meter', {
                level: t('strength.' + result.strength),
                issue: issue ? t('generator.pin_issue.' + issue) : ''
            });
        } else {
            setI18nText(text, 'strength.' + result.strength);
        }
        return result;
    }

    let treeCache = null;

    function categoryLookup(slug) {
        if (!treeCache) {
            try { treeCache = JSON.parse(document.getElementById('spCategoryTree').textContent); } catch (e) { treeCache = []; }
        }
        for (const main of treeCache) {
            if (main.slug === slug) return { main, sub: null };
            const sub = main.children.find((c) => c.slug === slug);
            if (sub) return { main, sub };
        }
        return null;
    }

    function nameOf(def) {
        return def ? (def.label_key ? t(def.label_key) : def.name) : '';
    }

    function updatePreview() {
        const title = document.getElementById('title');
        const user = document.getElementById('username');
        const cat = document.getElementById('category');
        const sub = document.getElementById('subcategory');
        const row = document.getElementById('cwPreviewRow');
        if (!row) return;

        const titleEl = document.getElementById('cwPreviewTitle');
        if (title && title.value.trim()) {
            titleEl.removeAttribute('data-i18n');
            titleEl.textContent = title.value.trim();
            titleEl.classList.remove('is-placeholder');
        } else {
            setI18nText(titleEl, 'form.title');
            titleEl.classList.add('is-placeholder');
        }
        document.getElementById('cwPreviewUser').textContent = user ? user.value.trim() : '';

        const mainSlug = cat ? cat.value : 'genel';
        const found = categoryLookup(mainSlug);
        const template = document.querySelector(`template[data-cat-icon="${CSS.escape(mainSlug)}"]`);
        row.style.setProperty('--cat-color', (template && template.dataset.color) || '#a855f7');
        document.getElementById('cwPreviewTile').innerHTML = template ? template.innerHTML : '';
        document.getElementById('cwPreviewCat').textContent = found ? nameOf(found.main) : '';
        const subFound = sub && sub.value ? categoryLookup(sub.value) : null;
        document.getElementById('cwPreviewSub').textContent = subFound && subFound.sub ? nameOf(subFound.sub) : '';
    }

    // ── show / hide, generate ─────────────────────────────────

    function bindToggle(fetchCurrent) {
        document.querySelectorAll('.cw-toggle[data-target]').forEach((btn) => {
            btn.addEventListener('click', async (event) => {
                event.preventDefault();
                const input = document.getElementById(btn.dataset.target);
                if (!input) return;
                // Edit form: the stored password is not in the page; fetch it only when asked to show it
                if (fetchCurrent && input.type === 'password' && !input.value) {
                    try {
                        const response = await fetch('/api/passwords/' + document.getElementById('cardId').value, { credentials: 'same-origin' });
                        if (!response.ok) throw new Error('Request failed');
                        input.value = (await response.json()).card.password;
                        input.dispatchEvent(new Event('input'));
                    } catch (error) {
                        window.showAlert(t('passwords.load_failed'), 'error');
                        return;
                    }
                }
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.setAttribute('aria-pressed', String(show));
                btn.querySelector('.icon-eye-open').style.display = show ? 'none' : '';
                btn.querySelector('.icon-eye-closed').style.display = show ? '' : 'none';
            });
        });
    }

    function bindGenerate() {
        const button = document.getElementById('cwGenerate');
        const input = document.getElementById('password');
        if (!button || !input) return;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                const response = await fetch('/api/generate-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.getCookie('csrftoken') },
                    body: JSON.stringify({ length: 16 })
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.password) {
                    window.showAlert(window.SafePassI18n.serverText(data) || t('common.error_generic'), 'error');
                    return;
                }
                input.value = data.password;
                input.dispatchEvent(new Event('input'));
                say('happy', 'wizard.say_generated');
            } catch (error) {
                window.showAlert(t('common.error_generic'), 'error');
            } finally {
                button.disabled = false;
            }
        });
    }

    /**
     * Wire everything on the page. emptyKey: meter text for an empty password field.
     */
    function init(options) {
        const emptyKey = options.emptyKey;
        const password = document.getElementById('password');
        ['title', 'username', 'category', 'subcategory'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', updatePreview);
        });
        if (password) {
            password.addEventListener('input', () => {
                const result = renderMeter(password.value, emptyKey);
                document.getElementById('cwPreviewDots').classList.toggle('is-empty', !password.value);
                // Lokki shuts his eyes while the password is typed, then gives a verdict
                clearTimeout(moodTimer);
                if (!password.value) { say('idle', options.sayKey); return; }
                if (document.activeElement === password) {
                    say('shy', 'wizard.say_typing');
                    moodTimer = setTimeout(() => reactTo(result), 700);
                } else {
                    reactTo(result);
                }
            });
            renderMeter(password.value, emptyKey);
        }
        bindToggle(Boolean(options.fetchCurrent));
        bindGenerate();
        updatePreview();
        window.addEventListener('sp-lang-changed', updatePreview);
    }

    return { init, strength, say, updatePreview, setI18nText, t };
})();

/**
 * Password Generator Module
 * Result slot stays empty until the first password; the server caps
 * generation at 10 per minute and the buttons count down when it is hit.
 */

function t(key, params) {
    return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
}

const POOL_SIZES = { uppercase: 26, lowercase: 26, numbers: 10, symbols: 32 };  // symbols = string.punctuation on the server
const SCRAMBLE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?';

let generating = false;
let cooldownTimer = null;
let currentPassword = '';
let currentStrength = null;
let currentOptions = null;

function readOptions() {
    const checked = document.querySelector('input[name="passwordLength"]:checked');
    return {
        length: checked ? parseInt(checked.value, 10) : 16,
        uppercase: document.getElementById('includeUppercase').checked,
        lowercase: document.getElementById('includeLowercase').checked,
        numbers: document.getElementById('includeNumbers').checked,
        symbols: document.getElementById('includeSymbols').checked
    };
}

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Generate new password based on selected options
 */
async function generateNewPassword() {
    const options = readOptions();

    if (!options.uppercase && !options.lowercase && !options.numbers && !options.symbols) {
        if (window.showAlert) window.showAlert(t('generator.need_type'), 'error');
        return;
    }
    if (generating || cooldownTimer) return;

    generating = true;
    setButtonsDisabled(true);
    const button = document.getElementById('generateBtn');
    const result = document.getElementById('genResult');
    if (button) button.classList.add('is-busy');
    const firstPassword = result && result.classList.contains('is-empty');
    setSlotLokki('awake');  // opens its eyes for the password
    const started = Date.now();

    try {
        const response = await fetch('/api/generate-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': window.getCookie ? window.getCookie('csrftoken') : ''
            },
            body: JSON.stringify(options)
        });
        const data = await response.json().catch(() => ({}));

        if (response.status === 429) {
            const seconds = Math.max(1, parseInt(data.retry_after, 10) || 60);
            if (window.showAlert) window.showAlert(t('generator.rate_limited', { time: formatWait(seconds) }), 'error');
            startCooldown(seconds);
        } else if (data.success) {
            // The first time, let Lokki finish waking up before the slot fills
            const wait = firstPassword && !prefersReducedMotion() ? 450 - (Date.now() - started) : 0;
            if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
            showPassword(data.password, data.strength, options);
        } else if (window.showAlert) {
            window.showAlert(window.SafePassI18n.serverText(data) || t('generator.failed'), 'error');
        }
    } catch (error) {
        if (window.showAlert) window.showAlert(t('generator.failed'), 'error');
    } finally {
        generating = false;
        if (button) button.classList.remove('is-busy');
        // Still no password (limit hit or an error): back to sleep; otherwise settle beside it
        clearTimeout(slotLokkiTimer);
        slotLokkiTimer = setTimeout(() => setSlotLokki(result && result.classList.contains('is-empty') ? 'sleepy' : 'idle'), 600);
        if (!cooldownTimer) setButtonsDisabled(false);
    }
}

let slotLokkiTimer = null;

function setSlotLokki(mood) {
    const lokki = document.querySelector('.gen-slot-lokki');
    if (!lokki) return;
    lokki.setAttribute('data-mood', mood === 'awake' ? 'idle' : mood);
    if (mood === 'awake') {
        void lokki.getBoundingClientRect();  // restart the pop each time
        lokki.setAttribute('data-mood', 'awake');
    }
}

/**
 * Fill the result slot: characters settle from a short scramble
 */
function showPassword(password, strength, options) {
    const result = document.getElementById('genResult');
    const output = document.getElementById('generatedPassword');
    document.getElementById('genResultEmpty').hidden = true;
    document.getElementById('genResultFilled').hidden = false;
    result.classList.remove('is-empty');

    currentPassword = password;
    currentStrength = strength;
    currentOptions = options;
    cheerLokki();
    updateStrengthIndicator(strength);
    updateEntropy(password.length, options, strength);
    updatePinNotes(strength);

    if (prefersReducedMotion()) {
        renderPassword(output, password);
        return;
    }
    const frames = 9;
    let frame = 0;
    output.classList.add('is-scrambling');
    const tick = () => {
        frame += 1;
        if (password !== currentPassword) return;  // a newer password took over
        if (frame >= frames) {
            output.classList.remove('is-scrambling');
            renderPassword(output, password);
            return;
        }
        // Characters lock in from left to right
        const settled = Math.floor(password.length * frame / frames);
        let text = password.slice(0, settled);
        for (let i = settled; i < password.length; i++) {
            text += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
        output.textContent = text;
        requestAnimationFrame(() => setTimeout(tick, 28));
    };
    tick();
}

/**
 * Digits and symbols get their own colour (built with text nodes, never innerHTML)
 */
function renderPassword(output, password) {
    output.textContent = '';
    for (const ch of password) {
        const span = document.createElement('span');
        span.textContent = ch;
        if (/[0-9]/.test(ch)) span.className = 'ch-digit';
        else if (!/[A-Za-z]/.test(ch)) span.className = 'ch-symbol';
        output.appendChild(span);
    }
}

function updateEntropy(length, options, strength) {
    const el = document.getElementById('entropyText');
    // A PIN is easier to grasp as a count: "10,000 combinations"
    if (strength && strength.kind === 'pin') {
        const lang = window.SafePassI18n ? window.SafePassI18n.getLang() : 'tr';
        const n = Number(strength.combinations).toLocaleString(lang);
        el.setAttribute('data-i18n', 'generator.pin_combos');
        el.setAttribute('data-i18n-params', JSON.stringify({ n }));
        el.textContent = t('generator.pin_combos', { n });
        return;
    }
    const pool = Object.keys(POOL_SIZES).reduce((sum, key) => sum + (options[key] ? POOL_SIZES[key] : 0), 0);
    const bits = pool > 1 ? Math.round(length * Math.log2(pool)) : 0;
    el.setAttribute('data-i18n', 'generator.entropy');
    el.setAttribute('data-i18n-params', JSON.stringify({ bits }));
    el.textContent = t('generator.entropy', { bits });
}

/**
 * PINs: list what makes the code weak (text nodes only)
 */
function updatePinNotes(strength) {
    const list = document.getElementById('pinNotes');
    const badge = document.getElementById('strengthKind');
    const isPin = strength && strength.kind === 'pin';
    if (badge) badge.hidden = !isPin;
    if (!list) return;
    list.textContent = '';
    const issues = isPin && Array.isArray(strength.issues) ? strength.issues : [];
    issues.forEach((code) => {
        const item = document.createElement('li');
        item.setAttribute('data-i18n', 'generator.pin_issue.' + code);
        item.textContent = t('generator.pin_issue.' + code);
        if (code === 'short') item.className = 'is-info';
        list.appendChild(item);
    });
    list.hidden = issues.length === 0;
}

// 75 → "1:15", 45 → "0:45"
function formatWait(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + ':' + String(s).padStart(2, '0');
}

// While waiting, the settings are locked too: changing them doesn't get round the limit
function setOptionsDisabled(disabled) {
    const panel = document.querySelector('.gen-console');
    if (panel) panel.classList.toggle('is-cooling', disabled);
    document.querySelectorAll('.gen-field input').forEach((input) => { input.disabled = disabled; });
}

function setButtonsDisabled(disabled) {
    ['generateBtn', 'regenerateBtn'].forEach((id) => {
        const button = document.getElementById(id);
        if (button) button.disabled = disabled;
    });
}

/**
 * Lock the generate buttons and count down on the main button
 */
function startCooldown(seconds) {
    const label = document.getElementById('generateBtnLabel');
    let left = seconds;
    const render = () => {
        if (!label) return;
        // data-i18n keeps the countdown right when the language changes
        label.setAttribute('data-i18n', 'generator.wait_button');
        label.setAttribute('data-i18n-params', JSON.stringify({ time: formatWait(left) }));
        label.textContent = t('generator.wait_button', { time: formatWait(left) });
    };
    setButtonsDisabled(true);
    setOptionsDisabled(true);
    render();
    cooldownTimer = setInterval(() => {
        left -= 1;
        if (left > 0) {
            render();
            return;
        }
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        if (label) {
            label.setAttribute('data-i18n', 'generator.generate');
            label.removeAttribute('data-i18n-params');
            label.textContent = t('generator.generate');
        }
        setButtonsDisabled(false);
        setOptionsDisabled(false);
    }, 1000);
}

/**
 * Open the new-card page with this password filled in. It travels in this tab's
 * sessionStorage (not the URL, which would land in history); the card page reads it once and deletes it.
 */
const CARD_HANDOFF_KEY = 'sp-generated-for-card';

function saveGeneratedAsCard() {
    if (!currentPassword) {
        if (window.showAlert) window.showAlert(t('generator.generate_first'), 'error');
        return;
    }
    try {
        sessionStorage.setItem(CARD_HANDOFF_KEY, JSON.stringify({
            password: currentPassword,
            pin: !!(currentStrength && currentStrength.kind === 'pin'),
            at: Date.now()
        }));
    } catch (e) {
        // Storage blocked: the card page still opens, the user pastes the password
    }
    window.location.href = '/passwords/add';
}

/**
 * Open the cyber test for this password; it starts the run on arrival. The password and its
 * settings go through this tab's sessionStorage, which the cyber test page empties on read.
 */
const ATTACK_HANDOFF_KEY = 'sp-siber-test';

function testAgainstAttack() {
    if (!currentPassword || !currentOptions) {
        if (window.showAlert) window.showAlert(t('generator.generate_first'), 'error');
        return;
    }
    try {
        sessionStorage.setItem(ATTACK_HANDOFF_KEY, JSON.stringify({
            password: currentPassword,
            options: {
                uppercase: !!currentOptions.uppercase,
                lowercase: !!currentOptions.lowercase,
                numbers: !!currentOptions.numbers,
                symbols: !!currentOptions.symbols
            },
            at: Date.now()
        }));
    } catch (e) {
        // Storage blocked: the page still opens and the user types the password
    }
    window.location.href = '/siber-test';
}

/**
 * Copy generated password to clipboard
 */
function copyGeneratedPassword() {
    if (!currentPassword) {
        if (window.showAlert) window.showAlert(t('generator.generate_first'), 'error');
        return;
    }
    window.SafePassClipboard.copy(currentPassword).then(() => {
        if (window.showAlert) window.showAlert(window.SafePassClipboard.copiedMessage(), 'success');
    }).catch(() => {
        if (window.showAlert) window.showAlert(t('clipboard.failed'), 'error');
    });
}

/**
 * Four-segment meter; the label follows the UI language
 */
function updateStrengthIndicator(strength) {
    const meter = document.getElementById('strengthMeter');
    const strengthText = document.getElementById('strengthText');
    const score = strength.score;

    let level = 'weak';
    let color = 'var(--sp-danger)';
    if (score >= 80) { level = 'strong'; color = 'var(--sp-success)'; }
    else if (score >= 60) { level = 'good'; color = 'var(--sp-primary)'; }
    else if (score >= 40) { level = 'medium'; color = 'var(--sp-warning)'; }
    meter.setAttribute('data-level', level);

    // The server sends strong / medium / weak (and good for PINs)
    const label = ['strong', 'good', 'medium', 'weak'].includes(strength.strength) ? strength.strength : 'weak';
    strengthText.setAttribute('data-i18n', 'strength.' + label);
    strengthText.textContent = t('strength.' + label);
    strengthText.style.color = color;
}

/**
 * Short lengths only suit PINs: say so next to the choice
 */
function updateShortNote() {
    const note = document.getElementById('shortNote');
    if (note) note.hidden = readOptions().length >= 8;
}

document.querySelectorAll('input[name="passwordLength"]').forEach((input) => {
    input.addEventListener('change', updateShortNote);
});

/**
 * Lokki reacts to the settings: thinks while they change, then looks
 * worried about a weak choice (PIN length or a single character type)
 */
let lokkiTimer = null;

function setLokkiMood(mood) {
    const lokki = document.querySelector('.gen-tips .lokki');
    if (lokki) lokki.setAttribute('data-mood', mood);
}

function settledMood() {
    const options = readOptions();
    const types = ['uppercase', 'lowercase', 'numbers', 'symbols'].filter((key) => options[key]).length;
    return options.length < 8 || types <= 1 ? 'worried' : 'idle';
}

function lokkiThinks() {
    setLokkiMood('thinking');
    clearTimeout(lokkiTimer);
    lokkiTimer = setTimeout(() => setLokkiMood(settledMood()), 1100);
}

// Happy when a password arrives, then back to judging the settings
function cheerLokki() {
    setLokkiMood('happy');
    clearTimeout(lokkiTimer);
    lokkiTimer = setTimeout(() => setLokkiMood(settledMood()), 1300);
}

document.querySelectorAll('input[name="passwordLength"], .gen-types input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', lokkiThinks);
});

/**
 * Tip tabs (arrow keys move between them); Lokki's bubble follows the tab
 */
function initTipTabs() {
    const tabs = Array.from(document.querySelectorAll('.gen-tabs [role="tab"]'));
    const bubble = document.getElementById('genBubbleText');
    if (!tabs.length) return;

    const select = (tab, focus) => {
        tabs.forEach((other) => {
            const active = other === tab;
            other.setAttribute('aria-selected', active ? 'true' : 'false');
            other.tabIndex = active ? 0 : -1;
            const panel = document.getElementById(other.getAttribute('aria-controls'));
            panel.hidden = !active;
            if (active && !prefersReducedMotion()) {
                panel.classList.remove('is-entering');
                void panel.offsetWidth;
                panel.classList.add('is-entering');
            }
        });
        if (bubble) {
            bubble.setAttribute('data-i18n', tab.dataset.bubble);
            bubble.textContent = t(tab.dataset.bubble);
        }
        if (focus) tab.focus();
    };

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => select(tab, false));
        tab.addEventListener('keydown', (event) => {
            const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
            if (event.key === 'Home') { event.preventDefault(); select(tabs[0], true); }
            else if (event.key === 'End') { event.preventDefault(); select(tabs[tabs.length - 1], true); }
            else if (step) { event.preventDefault(); select(tabs[(index + step + tabs.length) % tabs.length], true); }
        });
    });
}

initTipTabs();

// Make functions globally accessible
window.generateNewPassword = generateNewPassword;
window.copyGeneratedPassword = copyGeneratedPassword;
window.saveGeneratedAsCard = saveGeneratedAsCard;

document.getElementById('generateBtn').addEventListener('click', generateNewPassword);
document.getElementById('regenerateBtn').addEventListener('click', generateNewPassword);
document.getElementById('copyGeneratedBtn').addEventListener('click', copyGeneratedPassword);
document.getElementById('saveAsCardBtn').addEventListener('click', saveGeneratedAsCard);
document.getElementById('attackTestBtn').addEventListener('click', testAgainstAttack);

/* SafePass - Main Application */

function showAlert(message, type) {
    const alertType = type || 'info';
    const alert = document.createElement('div');
    // Positioning and the opaque surface live in alerts.css (.alert-toast)
    alert.className = 'alert alert-toast alert-' + alertType;
    alert.setAttribute('role', alertType === 'error' ? 'alert' : 'status');
    alert.textContent = message;

    document.body.appendChild(alert);

    setTimeout(function () {
        alert.classList.add('alert-toast-leaving');
        setTimeout(function () { alert.remove(); }, 300);
    }, 3000);
}

window.showAlert = showAlert;
window.showNotification = showAlert;

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

window.getCookie = getCookie;

// The session's API key (see middleware.ApiKeyMiddleware). Cookies reach every port of this
// host; localStorage belongs to this exact origin (port included), so programs on other ports can't
// read it. One that took this port while SafePass was stopped could, but the key dies with the session.
const API_KEY_STORAGE = 'sp-api-key';
const API_KEY_HEADER = 'X-SafePass-Key';

function readApiKey() {
    try { return localStorage.getItem(API_KEY_STORAGE); } catch (e) { return null; }
}

function storeApiKey(value) {
    try {
        if (value) localStorage.setItem(API_KEY_STORAGE, value);
        else localStorage.removeItem(API_KEY_STORAGE);
    } catch (e) { /* storage blocked: the next API call signs the user out */ }
}

// Signed-out pages: whatever key is left belongs to a session that no longer exists
if (isAuthPage(window.location.pathname)) storeApiKey(null);

// Trusted-device keys, one per account name (views.with_device). Sent with the next sign-in, so a
// lockout caused by another program guessing at the account doesn't shut this browser out. They stay
// after signing out on purpose; a new master password replaces them. A program that took this port
// while SafePass was stopped could read them, but sign-in also needs the launch mark below.
const DEVICE_STORAGE = 'sp-device-keys';
const DEVICE_LIMIT = 20;

window.SafePassDevice = {
    get: function (username) {
        try {
            const keys = JSON.parse(localStorage.getItem(DEVICE_STORAGE) || '{}') || {};
            return keys[String(username || '').trim().toLowerCase()] || null;
        } catch (e) { return null; }
    },
    set: function (username, token) {
        try {
            const keys = JSON.parse(localStorage.getItem(DEVICE_STORAGE) || '{}') || {};
            delete keys[username];
            keys[username] = token;  // last used goes last; the oldest names drop off past the limit
            Object.keys(keys).slice(0, Math.max(0, Object.keys(keys).length - DEVICE_LIMIT)).forEach(function (name) { delete keys[name]; });
            localStorage.setItem(DEVICE_STORAGE, JSON.stringify(keys));
        } catch (e) { /* storage blocked: this browser simply isn't remembered */ }
    }
};

// The launch mark (safepass/launch.py): proof that `safepass start` opened this browser during the
// current run. Only then do the sign-in forms work. A restart voids it, so a mark read by a program
// that took the port while SafePass was stopped is worthless.
const LAUNCH_STORAGE = 'sp-launch-mark';
const LAUNCH_HEADER = 'X-SafePass-Launch';

function readLaunchMark() {
    try { return localStorage.getItem(LAUNCH_STORAGE); } catch (e) { return null; }
}

function storeLaunchMark(value) {
    try { localStorage.setItem(LAUNCH_STORAGE, value); } catch (e) { /* storage blocked: start opens a new link each time */ }
}

function isOwnApiUrl(input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    try {
        const parsed = new URL(url, window.location.href);
        return parsed.origin === window.location.origin && parsed.pathname.indexOf('/api/') === 0;
    } catch (e) {
        return false;
    }
}

function setHeader(options, name, value) {
    if (options.headers instanceof Headers) options.headers.set(name, value);
    else options.headers = Object.assign({}, options.headers || {}, { [name]: value });
}

const originalFetch = window.fetch;
window.fetch = function () {
    const args = Array.prototype.slice.call(arguments);
    const ownApi = isOwnApiUrl(args[0]);
    if (ownApi) {
        args[1] = Object.assign({}, args[1] || {});
        const apiKey = readApiKey();
        if (apiKey) setHeader(args[1], API_KEY_HEADER, apiKey);
        const launchMark = readLaunchMark();
        if (launchMark) setHeader(args[1], LAUNCH_HEADER, launchMark);
    }
    if (args[1] && ['POST', 'PUT', 'DELETE', 'PATCH'].indexOf(args[1].method) !== -1) {
        setHeader(args[1], 'X-CSRFToken', getCookie('csrftoken'));
    }

    return originalFetch.apply(this, args)
        .then(function (response) {
            // Sent once, when a session starts (sign-in, sign-up, recovery, new master password)
            const newKey = ownApi && response.headers.get(API_KEY_HEADER);
            if (newKey) storeApiKey(newKey);
            const device = ownApi && response.headers.get('X-SafePass-Device');  // "<url-encoded name> <key>"
            if (device && device.indexOf(' ') > 0) {
                const split = device.indexOf(' ');
                window.SafePassDevice.set(decodeURIComponent(device.slice(0, split)), device.slice(split + 1));
            }

            const currentPath = window.location.pathname;
            if (response.status === 401) {
                if (currentPath.indexOf('/auth/login') === -1 && currentPath.indexOf('/auth/register') === -1) {
                    // The login page explains why (timeout vs. session gone), no browser alert
                    response.clone().json().catch(function () { return {}; }).then(function (data) {
                        const timedOut = data.reason === 'timeout' || data.error_code === 'session_expired';
                        window.location.href = timedOut ? '/auth/login?expired=1' : '/auth/login?ended=1';
                    });
                }
                return response;
            }

            if (response.status === 403) {
                showAlert(getText('srv.csrf_failed', 'Bu işlem için yetkiniz yok'), 'error');
                return response;
            }

            if (response.status === 500) {
                showAlert(getText('srv.server_error', 'Sunucu hatası oluştu.'), 'error');
                return response;
            }

            return response;
        })
        .catch(function (error) {
            if (error.name === 'AbortError' || (error.message && error.message.indexOf('timeout') !== -1)) {
                showAlert(getText('common.timeout', 'İstek zaman aşımına uğradı.'), 'error');
            } else if (
                error.message &&
                (error.message.indexOf('Failed to fetch') !== -1 || error.message.indexOf('NetworkError') !== -1)
            ) {
                showAlert(getText('common.network_error', 'Bağlantı hatası.'), 'error');
            }
            throw error;
        });
};

function getText(key, fallback) {
    if (window.SafePassI18n && typeof window.SafePassI18n.t === 'function') {
        return window.SafePassI18n.t(key);
    }
    return fallback || key;
}

// The link `safepass start` opened carries #launch=<one-time code>: traded once for this browser's
// mark, then removed from the address bar. A signed-in browser may land on another page with it.
window.SafePassLaunch = (function () {
    const match = /^#launch=([0-9A-Za-z.]{1,200})$/.exec(window.location.hash);
    let claimed = Promise.resolve();
    if (match) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        claimed = window.fetch('/api/launch/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link: match[1] })
        }).then(function (response) { return response.json(); })
            .then(function (data) { if (data && data.mark) storeLaunchMark(data.mark); })
            .catch(function () { /* the page below explains what to do */ });
    }
    return {
        // {verified, greeting}: may this browser show the sign-in forms, and the account's greeting phrase
        status: function (username) {
            return claimed.then(function () {
                const query = username ? '?username=' + encodeURIComponent(username) : '';
                return window.fetch('/api/launch/status' + query).then(function (response) { return response.json(); });
            }).catch(function () { return { verified: false, unreachable: true }; });
        }
    };
})();

function isAuthPage(pathname) {
    return pathname.indexOf('/auth/login') !== -1 || pathname.indexOf('/auth/register') !== -1;
}

function initializeActiveNav(currentPath) {
    const navLinks = document.querySelectorAll('.sidebar-menu a');
    navLinks.forEach(function (link) {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });
}

// Error page's "go back" button
document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('[data-history-back]')) window.history.back();
});

// ── Recovery key dialog ──────────────────────────────────────
// Shows a new recovery key once. It can't be closed by accident: the user first confirms
// having saved it. SafePassRecovery.show(key, { username, replaced }) → Promise, resolved on close.
const SafePassRecovery = (function () {
    function show(key, options) {
        const opts = options || {};
        return new Promise(function (resolve) {
            const previousFocus = document.activeElement;
            const root = document.createElement('div');
            root.className = 'sp-session-modal sp-recovery-modal';
            root.innerHTML =
                '<div class="sp-session-dialog" role="alertdialog" aria-modal="true" aria-labelledby="spRecoveryTitle" aria-describedby="spRecoveryText">' +
                '<div class="sp-session-icon" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>' +
                '</div>' +
                '<h2 id="spRecoveryTitle"></h2>' +
                '<p id="spRecoveryText"></p>' +
                '<code class="sp-recovery-code"></code>' +
                '<div class="sp-recovery-tools">' +
                '<button type="button" class="sp-recovery-tool" data-recovery="copy"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>' +
                '<button type="button" class="sp-recovery-tool" data-recovery="download"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>' +
                '</div>' +
                '<label class="sp-recovery-check"><input type="checkbox"><span></span></label>' +
                '<div class="sp-session-actions"><button type="button" class="btn btn-primary" data-recovery="done" disabled></button></div>' +
                '</div>';
            document.body.appendChild(root);

            const check = root.querySelector('input[type="checkbox"]');
            const done = root.querySelector('[data-recovery="done"]');
            const render = function () {
                root.querySelector('#spRecoveryTitle').textContent = getText('recovery.show_title');
                root.querySelector('#spRecoveryText').textContent = getText(opts.replaced ? 'recovery.show_text_replaced' : 'recovery.show_text');
                [['copy', 'card.copy'], ['download', 'recovery.download']].forEach(function (tool) {
                    const button = root.querySelector('[data-recovery="' + tool[0] + '"]');
                    button.title = getText(tool[1]);
                    button.setAttribute('aria-label', button.title);
                });
                root.querySelector('.sp-recovery-check span').textContent = getText('recovery.saved_check');
                done.textContent = getText('recovery.done');
            };
            render();
            root.querySelector('.sp-recovery-code').textContent = key;
            window.addEventListener('sp-lang-changed', render);

            root.querySelector('[data-recovery="copy"]').addEventListener('click', function () {
                navigator.clipboard.writeText(key).then(function () {
                    showAlert(getText('recovery.copied'), 'success');
                }).catch(function () {
                    showAlert(getText('common.error_generic'), 'error');
                });
            });
            root.querySelector('[data-recovery="download"]').addEventListener('click', function () {
                const body = 'SafePass\n' + (opts.username ? opts.username + '\n' : '') + key + '\n';
                const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'safepass-recovery-key.txt';
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
            });
            check.addEventListener('change', function () { done.disabled = !check.checked; });
            done.addEventListener('click', function () {
                window.removeEventListener('sp-lang-changed', render);
                root.remove(); // the key does not stay in the page
                if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
                resolve();
            });
            root.addEventListener('keydown', function (event) {
                if (event.key !== 'Tab') return;
                const items = Array.from(root.querySelectorAll('input, button')).filter(function (el) { return !el.disabled; });
                const index = items.indexOf(document.activeElement);
                event.preventDefault();
                items[((event.shiftKey ? index - 1 : index + 1) + items.length) % items.length].focus();
            });
            root.querySelector('[data-recovery="copy"]').focus();
        });
    }

    // Make or replace the key; the master password is asked first. → true once it was shown and saved
    async function create(replacing) {
        let issued = null;
        const result = await window.SafePassDialog.confirm({
            icon: 'lock',
            title: function () { return getText(replacing ? 'recovery.renew' : 'recovery.create'); },
            text: function () { return getText(replacing ? 'recovery.renew_text' : 'recovery.create_text'); },
            confirmLabel: function () { return getText('common.confirm'); },
            fields: [{ name: 'password', type: 'password', autocomplete: 'current-password', label: function () { return getText('profile.current_master'); } }],
            onConfirm: async function (values) {
                const response = await fetch('/api/profile/recovery-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ master_password: values.password })
                });
                const data = await response.json().catch(function () { return {}; });
                if (!response.ok || !data.success) {
                    return function () { return window.SafePassI18n.serverText(data) || getText('common.error_generic'); };
                }
                issued = data.recovery_key;
                return null;
            }
        });
        if (!result || !issued) return false;
        const account = document.querySelector('meta[name="sp-username"]');
        await show(issued, { username: account ? account.content : '', replaced: replacing });
        return true;
    }

    return { show: show, create: create };
})();

window.SafePassRecovery = SafePassRecovery;

// ── Confirm dialog ───────────────────────────────────────────
// In-app replacement for window.confirm()/prompt(), styled like the session dialog.
// SafePassDialog.confirm({ title, text, confirmLabel, cancelLabel, danger, fields, onConfirm })
//   title/text/labels: string or () => string (re-rendered when the language changes)
//   icon: 'lock' for dialogs that aren't about deleting something (default: trash can)
//   fields: [{ name, label, type: 'password'|'text', autocomplete, mustEqual, maxLength, placeholder }] — Confirm stays
//           disabled until every field is filled (and equals mustEqual when given)
//   onConfirm(values): async; return an error text (or () => text) to keep the dialog open
//   → Promise<false | true | values>
const SafePassDialog = (function () {
    let root = null;
    let resolver = null;
    let previousFocus = null;
    let current = null;

    const LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
    const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
    const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    const value = function (v) { return typeof v === 'function' ? v() : (v || ''); };

    function build() {
        root = document.createElement('div');
        root.className = 'sp-session-modal sp-confirm-modal';
        root.hidden = true;
        root.innerHTML =
            '<form class="sp-session-dialog" role="alertdialog" aria-modal="true" aria-labelledby="spConfirmTitle" aria-describedby="spConfirmText" novalidate>' +
            '<div class="sp-session-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>' +
            '</div>' +
            '<h2 id="spConfirmTitle"></h2>' +
            '<p id="spConfirmText"></p>' +
            '<div class="sp-dialog-fields"></div>' +
            '<p class="sp-dialog-error" role="alert" hidden></p>' +
            '<div class="sp-session-actions">' +
            '<button type="button" class="btn btn-secondary" data-confirm="no"></button>' +
            '<button type="submit" class="btn btn-primary" data-confirm="yes"></button>' +
            '</div></form>';
        document.body.appendChild(root);
        const form = root.querySelector('form');
        form.addEventListener('submit', function (event) { event.preventDefault(); submit(); });
        root.querySelector('[data-confirm="no"]').addEventListener('click', function () { close(false); });
        root.addEventListener('click', function (event) { if (event.target === root) close(false); });
        root.addEventListener('input', updateState);
        root.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                close(false);
            } else if (event.key === 'Tab') {
                const items = Array.from(root.querySelectorAll('input, button')).filter(function (el) { return !el.disabled; });
                const index = items.indexOf(document.activeElement);
                event.preventDefault();
                items[((event.shiftKey ? index - 1 : index + 1) + items.length) % items.length].focus();
            }
        });
        window.addEventListener('sp-lang-changed', function () {
            if (root.hidden) return;
            renderTexts();
            updateState(); // e.g. the confirm word changed
        });
    }

    function renderFields(fields) {
        const box = root.querySelector('.sp-dialog-fields');
        box.innerHTML = '';
        box.hidden = !fields.length;
        if (fields.some(function (field) { return field.type === 'password'; })) {
            // Hidden account name for password forms (browsers expect one)
            const account = document.createElement('input');
            account.type = 'text';
            account.name = 'username';
            account.autocomplete = 'username';
            account.hidden = true;
            account.value = (document.querySelector('meta[name="sp-username"]') || {}).content || '';
            box.appendChild(account);
        }
        fields.forEach(function (field, i) {
            const id = 'spDialogField' + i;
            const group = document.createElement('div');
            group.className = 'sp-dialog-field';
            group.innerHTML = '<label></label><div class="sp-dialog-input"><input></div>';
            const label = group.querySelector('label');
            const input = group.querySelector('input');
            label.htmlFor = id;
            input.id = id;
            input.name = field.name;
            input.type = field.type || 'text';
            input.autocomplete = field.autocomplete || 'off';
            input.spellcheck = false;
            if (field.maxLength) input.maxLength = field.maxLength;
            if (field.placeholder) input.placeholder = value(field.placeholder);
            if (input.type === 'password') {
                const eye = document.createElement('button');
                eye.type = 'button';
                eye.className = 'sp-dialog-eye';
                eye.innerHTML = EYE;
                eye.addEventListener('click', function () {
                    input.type = input.type === 'password' ? 'text' : 'password';
                    eye.classList.toggle('is-on', input.type === 'text');
                    renderTexts();
                    input.focus();
                });
                group.querySelector('.sp-dialog-input').appendChild(eye);
            }
            box.appendChild(group);
        });
    }

    function renderTexts() {
        const opts = current;
        root.querySelector('.sp-session-icon').innerHTML = opts.icon === 'lock' ? LOCK_ICON : TRASH_ICON;
        root.querySelector('#spConfirmTitle').textContent = value(opts.title);
        const text = root.querySelector('#spConfirmText');
        text.textContent = value(opts.text);
        text.hidden = !text.textContent;
        root.querySelector('[data-confirm="yes"]').textContent = value(opts.confirmLabel) || getText('common.confirm', 'Onayla');
        root.querySelector('[data-confirm="no"]').textContent = value(opts.cancelLabel) || getText('common.cancel', 'İptal');
        root.querySelectorAll('.sp-dialog-field').forEach(function (group, i) {
            group.querySelector('label').textContent = value(opts.fields[i].label);
            const eye = group.querySelector('.sp-dialog-eye');
            if (eye) {
                const label = getText(eye.classList.contains('is-on') ? 'auth.password_hide' : 'auth.password_show', 'Şifreyi göster');
                eye.title = label;
                eye.setAttribute('aria-label', label);
            }
        });
        const error = root.querySelector('.sp-dialog-error');
        if (current.error) error.textContent = value(current.error);
    }

    function values() {
        const out = {};
        root.querySelectorAll('.sp-dialog-field input').forEach(function (input) { out[input.name] = input.value; });
        return out;
    }

    function ready() {
        const v = values();
        return (current.fields || []).every(function (field) {
            const entered = (v[field.name] || '').trim();
            if (!entered) return false;
            if (field.mustEqual === undefined) return true;
            // Case-insensitive in the UI language ("sil" counts as "SİL")
            const lang = document.documentElement.lang || undefined;
            return entered.toLocaleUpperCase(lang) === value(field.mustEqual).toLocaleUpperCase(lang);
        });
    }

    function updateState() {
        if (!current || current.busy) return;
        root.querySelector('[data-confirm="yes"]').disabled = !ready();
    }

    function setError(message) {
        current.error = message || null;
        const error = root.querySelector('.sp-dialog-error');
        error.hidden = !message;
        error.textContent = message ? value(message) : '';
    }

    async function submit() {
        if (!current || current.busy || !ready()) return;
        const v = values();
        if (!current.onConfirm) {
            close(current.fields.length ? v : true);
            return;
        }
        const yes = root.querySelector('[data-confirm="yes"]');
        current.busy = true;
        yes.disabled = true;
        yes.classList.add('is-loading');
        setError(null);
        let failure = null;
        try {
            failure = await current.onConfirm(v);
        } catch (e) {
            failure = function () { return getText('common.error_generic', 'Bir hata oluştu.'); };
        }
        current.busy = false;
        yes.classList.remove('is-loading');
        if (failure) {
            setError(failure);
            updateState();
            const first = root.querySelector('.sp-dialog-field input');
            if (first) { first.select(); first.focus(); }
            return;
        }
        close(v);
    }

    function close(result) {
        if (!root || root.hidden || (current && current.busy)) return;
        root.hidden = true;
        // Typed secrets do not stay in the DOM
        root.querySelector('.sp-dialog-fields').innerHTML = '';
        current = null;
        if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
        if (resolver) resolver(result);
        resolver = null;
    }

    function confirm(options) {
        if (!root) build();
        const opts = Object.assign({ fields: [] }, options || {});
        current = opts;
        renderFields(opts.fields);
        setError(null);
        renderTexts();
        const yes = root.querySelector('[data-confirm="yes"]');
        yes.classList.toggle('btn-danger', !!opts.danger);
        yes.classList.toggle('btn-primary', !opts.danger);
        yes.classList.remove('is-loading');
        root.classList.toggle('is-danger', !!opts.danger);
        previousFocus = document.activeElement;
        root.hidden = false;
        updateState();
        // Safe default: focus the first field, else Cancel for destructive actions
        const first = root.querySelector('.sp-dialog-field input');
        (first || (opts.danger ? root.querySelector('[data-confirm="no"]') : yes)).focus();
        return new Promise(function (resolve) { resolver = resolve; });
    }

    return { confirm: confirm };
})();

window.SafePassDialog = SafePassDialog;

// ── Clipboard ────────────────────────────────────────────────
// Copies a secret and wipes it from the clipboard after the user's chosen delay.
// If clipboard-read is already granted, a newer copy is left alone; we never
// ask for that permission (a prompt 30 s later would be confusing), so without
// it the clipboard is cleared unconditionally — like most password managers.
const SafePassClipboard = (function () {
    const DEFAULT_SECONDS = 30;
    let pending = null;
    let timer = null;
    let clearSeconds = null;

    // User setting from <meta name="sp-clipboard-clear">; 0 means never clear
    function getClearSeconds() {
        if (clearSeconds !== null) return clearSeconds;
        const meta = document.querySelector('meta[name="sp-clipboard-clear"]');
        const value = meta ? parseInt(meta.getAttribute('content'), 10) : NaN;
        return isNaN(value) ? DEFAULT_SECONDS : value;
    }

    function setClearSeconds(seconds) {
        clearSeconds = seconds;
    }

    // Toast text matching the current setting, e.g. "... in 1 minute"
    function copiedMessage() {
        const seconds = getClearSeconds();
        if (!seconds) {
            return getText('clipboard.copied_kept', 'Şifre kopyalandı.');
        }
        return getText('clipboard.copied', 'Şifre kopyalandı. {time} sonra panodan silinecek.')
            .replace('{time}', getText('settings.clipboard_' + seconds, seconds + ' saniye'));
    }

    function canRead() {
        if (!navigator.permissions || !navigator.clipboard.readText) {
            return Promise.resolve(false);
        }
        return navigator.permissions.query({ name: 'clipboard-read' })
            .then(function (status) { return status.state === 'granted'; })
            .catch(function () { return false; });
    }

    function wipe(value) {
        return navigator.clipboard.writeText('').then(function () {
            if (pending === value) pending = null;
        }, function () {
            // Writing needs focus: retry once the window is focused again
            window.addEventListener('focus', function () {
                if (pending === value) wipe(value);
            }, { once: true });
        });
    }

    function clearNow() {
        const value = pending;
        if (value === null) return Promise.resolve();
        return canRead().then(function (readable) {
            if (!readable) return wipe(value);
            return navigator.clipboard.readText().then(function (current) {
                if (current === value) return wipe(value);
                pending = null; // something else was copied since
            }, function () { return wipe(value); });
        });
    }

    function copy(text) {
        return navigator.clipboard.writeText(text).then(function () {
            clearTimeout(timer);
            const seconds = getClearSeconds();
            pending = seconds ? text : null;
            if (seconds) timer = setTimeout(clearNow, seconds * 1000);
        });
    }

    // Timers die with the page: clear before leaving if a secret is still pending
    window.addEventListener('pagehide', function () {
        if (pending !== null) clearNow();
    });

    return { copy: copy, clearNow: clearNow, copiedMessage: copiedMessage, setClearSeconds: setClearSeconds };
})();

window.SafePassClipboard = SafePassClipboard;

// ── Session timeout ──────────────────────────────────────────
// The server is the single source of truth for the remaining time: polling
// /api/auth/session does not extend the session, user activity is reported
// to /api/auth/session/refresh (at most once a minute), and tabs keep each
// other in sync through a BroadcastChannel.
const SafePassSession = (function () {
    const POLL_MS = 30000;
    const WARNING_POLL_MS = 10000;
    const ACTIVITY_PING_MS = 60000;

    let remaining = null;
    let timeout = null;
    let lastSync = 0;
    let lastPing = 0;
    let pollTimer = null;
    let tickTimer = null;
    let started = false;
    let ended = false;
    let modal = null;
    let previousFocus = null;
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('sp-session') : null;

    function csrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : getCookie('csrftoken');
    }

    function request(url, options) {
        return fetch(url, Object.assign({
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken() }
        }, options)).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (!response.ok) {
                    const error = new Error((window.SafePassI18n && window.SafePassI18n.serverText(data)) || data.error || 'Request failed');
                    error.status = response.status;
                    error.data = data;
                    throw error;
                }
                return data;
            });
        });
    }

    function post(url, body) {
        return request(url, { method: 'POST', body: JSON.stringify(body || {}) });
    }

    function broadcast(type) {
        if (channel) channel.postMessage({ type: type });
    }

    // Warn earlier for long limits, but never use more than a fifth of a short one
    function warningWindow() {
        return Math.min(300, Math.max(30, Math.round((timeout || 420) / 5)));
    }

    function secondsLeft() {
        return Math.max(0, remaining - (Date.now() - lastSync) / 1000);
    }

    function formatTime(seconds) {
        const total = Math.ceil(seconds);
        const minutes = Math.floor(total / 60);
        const secs = String(total % 60).padStart(2, '0');
        return minutes + ':' + secs;
    }

    function sync(data) {
        if (!data || ended) return;
        if (data.authenticated === false) {
            expire(data.reason);
            return;
        }
        if (typeof data.remaining === 'number') {
            remaining = data.remaining;
            timeout = data.timeout || timeout;
            lastSync = Date.now();
        }
        evaluate();
    }

    function evaluate() {
        if (remaining === null || ended) return;
        const left = secondsLeft();
        if (left <= 0) {
            expire();
            return;
        }
        if (left <= warningWindow()) {
            showWarning();
        } else {
            hideWarning();
        }
        schedulePoll(left);
    }

    function schedulePoll(left) {
        clearTimeout(pollTimer);
        const untilWarning = (left - warningWindow()) * 1000;
        const delay = isWarningOpen() ? WARNING_POLL_MS : Math.max(1000, Math.min(POLL_MS, untilWarning));
        pollTimer = setTimeout(poll, delay);
    }

    function poll() {
        request('/api/auth/session')
            .then(sync)
            .catch(function () {
                // Server unreachable (stopped, crashed, computer back from sleep): our own clock decides
                const left = secondsLeft();
                if (remaining !== null && left <= 0) lockScreen();
                else schedulePoll(left);
            });
    }

    function refresh() {
        lastPing = Date.now();
        return post('/api/auth/session/refresh').then(function (data) {
            sync(data);
            broadcast('refreshed');
            return data;
        });
    }

    function onActivity() {
        // Once the warning is up, only an explicit "stay signed in" extends the session
        if (ended || isWarningOpen() || Date.now() - lastPing < ACTIVITY_PING_MS) return;
        refresh().catch(function () { /* the next poll reports the real state */ });
    }

    // reason: 'timeout' (inactivity; the default when our own countdown runs out)
    // or 'ended' (the server no longer knows the session, e.g. SafePass was restarted)
    function expire(reason) {
        if (ended) return;
        ended = true;
        clearTimeout(pollTimer);
        clearInterval(tickTimer);
        const type = reason === 'ended' ? 'ended' : 'expired';
        broadcast(type);
        // Leave the page right away so decrypted data does not stay on screen
        window.location.href = loginUrlFor(type);
    }

    // Time is up but the server can't be reached, so there is no login page to go to:
    // everything on screen goes anyway
    function lockScreen() {
        if (ended) return;
        ended = true;
        clearTimeout(pollTimer);
        clearInterval(tickTimer);
        broadcast('expired');
        const box = document.createElement('main');
        box.className = 'sp-lock-screen';
        const title = document.createElement('h1');
        const text = document.createElement('p');
        const retry = document.createElement('a');
        retry.className = 'btn btn-primary';
        retry.href = '/auth/login?expired=1';
        const render = function () {
            title.textContent = getText('session.locked_title');
            text.textContent = getText('session.locked_text');
            retry.textContent = getText('session.locked_retry');
        };
        render();
        window.addEventListener('sp-lang-changed', render);
        box.append(title, text, retry);
        document.body.className = '';
        document.body.replaceChildren(box);
    }

    function loginUrlFor(type) {
        if (type === 'expired') return '/auth/login?expired=1';
        if (type === 'ended') return '/auth/login?ended=1';
        return '/auth/login';
    }

    // ── Warning dialog ──
    function buildModal() {
        modal = document.createElement('div');
        modal.className = 'sp-session-modal';
        modal.hidden = true;
        modal.innerHTML =
            '<div class="sp-session-dialog" role="alertdialog" aria-modal="true" aria-labelledby="spSessionTitle" aria-describedby="spSessionText">' +
            '<div class="sp-session-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>' +
            '</div>' +
            '<h2 id="spSessionTitle"></h2>' +
            '<p id="spSessionText"></p>' +
            '<div class="sp-session-actions">' +
            '<button type="button" class="btn btn-secondary" data-session-action="logout"></button>' +
            '<button type="button" class="btn btn-primary" data-session-action="stay"></button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(modal);

        modal.querySelector('[data-session-action="stay"]').addEventListener('click', stay);
        modal.querySelector('[data-session-action="logout"]').addEventListener('click', logout);
        modal.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                stay();
            } else if (event.key === 'Tab') {
                // Keep focus on the dialog's two buttons
                const buttons = Array.from(modal.querySelectorAll('button'));
                const index = buttons.indexOf(document.activeElement);
                const next = event.shiftKey ? index - 1 : index + 1;
                event.preventDefault();
                buttons[(next + buttons.length) % buttons.length].focus();
            }
        });
    }

    function renderModalText() {
        if (!modal) return;
        modal.querySelector('#spSessionTitle').textContent = getText('session.warning_title', 'Oturumunuz kapanmak üzere');
        modal.querySelector('#spSessionText').textContent = getText('session.warning_text', 'Hareketsiz kaldığınız için {time} sonra otomatik olarak çıkış yapılacak.')
            .replace('{time}', formatTime(secondsLeft()));
        modal.querySelector('[data-session-action="stay"]').textContent = getText('session.stay', 'Oturumu açık tut');
        modal.querySelector('[data-session-action="logout"]').textContent = getText('session.logout_now', 'Çıkış yap');
    }

    function isWarningOpen() {
        return !!modal && !modal.hidden;
    }

    function showWarning() {
        if (!modal) buildModal();
        renderModalText();
        if (isWarningOpen()) return;
        previousFocus = document.activeElement;
        modal.hidden = false;
        modal.querySelector('[data-session-action="stay"]').focus();
        clearInterval(tickTimer);
        tickTimer = setInterval(function () {
            if (secondsLeft() <= 0) {
                expire();
            } else {
                renderModalText();
            }
        }, 1000);
    }

    function hideWarning() {
        if (!isWarningOpen()) return;
        modal.hidden = true;
        clearInterval(tickTimer);
        if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
    }

    function stay() {
        refresh()
            .then(function () {
                hideWarning();
                showAlert(getText('session.renewed', 'Oturumunuz yenilendi'), 'success');
            })
            .catch(function () {
                showAlert(getText('session.refresh_failed', 'Oturum yenilenemedi. Lütfen tekrar giriş yapın.'), 'error');
                setTimeout(expire, 2000);
            });
    }

    function logout() {
        ended = true;
        broadcast('logout');
        const leave = function () { window.location.href = '/auth/login'; };
        post('/api/auth/logout').then(leave, leave);
    }

    function start() {
        if (started) return;
        started = true;
        lastPing = Date.now(); // loading this page already counted as activity

        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (name) {
            document.addEventListener(name, onActivity, { passive: true });
        });

        // The logout link: a POST (a plain link could be triggered by another site), and other tabs follow
        document.addEventListener('click', function (event) {
            const link = event.target.closest && event.target.closest('[data-logout]');
            if (link) {
                event.preventDefault();
                logout();
            }
        });

        // A page brought back by the Back button may be showing an ended session
        window.addEventListener('pageshow', function (event) {
            if (event.persisted && !ended) poll();
        });

        if (channel) {
            channel.onmessage = function (event) {
                const type = event.data && event.data.type;
                if (type === 'refreshed') {
                    poll();
                } else if (type === 'expired' || type === 'ended' || type === 'logout') {
                    ended = true;
                    window.location.href = loginUrlFor(type);
                }
            };
        }

        // Timers are throttled in background tabs; re-check once the tab is visible again
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden && !ended) poll();
        });

        window.addEventListener('sp-lang-changed', renderModalText);

        poll();
    }

    return { start: start, post: post, sync: sync, refresh: refresh };
})();

window.SafePassSession = SafePassSession;

function initializeSessionTimeout(currentPath) {
    // Only for signed-in pages (e.g. not a 404 seen while logged out)
    if (isAuthPage(currentPath) || !document.querySelector('meta[name="sp-authenticated"]')) {
        return;
    }
    SafePassSession.start();
}

function setThemeToggleState(theme) {
    document.querySelectorAll('[data-theme-option]').forEach(function (button) {
        const isActive = button.getAttribute('data-theme-option') === theme;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-checked', String(isActive));
    });
}

// ── Layout settings panel: appearance preferences ──────────────
// Buttons:   data-appearance="<key>" data-value="<value>"
// Switches:  <input type=checkbox data-appearance="<key>">  (true / false)
function initializeAppearanceControls() {
    const appearance = window.SafePassAppearance;
    if (!appearance) return;
    const accentName = document.getElementById('spAccentName');

    function sync(prefs) {
        document.querySelectorAll('button[data-appearance]').forEach(function (button) {
            const isActive = String(prefs[button.dataset.appearance]) === button.dataset.value;
            button.classList.toggle('active', isActive);
            // listbox options are "selected", radio buttons are "checked"
            button.setAttribute(button.getAttribute('role') === 'option' ? 'aria-selected' : 'aria-checked', String(isActive));
        });
        // The trigger carries the chosen option's key, so later translations update it too
        const transitionValue = document.getElementById('spTransitionValue');
        const chosen = document.querySelector('#spTransitionMenu .sp-listbox-option.active [data-i18n]');
        if (transitionValue && chosen) {
            const key = chosen.getAttribute('data-i18n');
            transitionValue.setAttribute('data-i18n', key);
            transitionValue.textContent = getText(key, chosen.textContent.trim());
        }
        document.querySelectorAll('input[type="checkbox"][data-appearance]').forEach(function (input) {
            input.checked = prefs[input.dataset.appearance] === true;
        });
        if (accentName) {
            accentName.setAttribute('data-i18n', 'settings.color_' + prefs.accent);
            accentName.textContent = getText('settings.color_' + prefs.accent, prefs.accent);
        }
        labelCompactSidebar(prefs.sidebar === 'compact');
    }

    // Icons only: the menu names move into tooltips
    function labelCompactSidebar(compact) {
        document.querySelectorAll('.sidebar .sidebar-menu a').forEach(function (link) {
            const label = link.querySelector('span[data-i18n]');
            if (!label) return;
            if (compact) {
                link.setAttribute('title', label.textContent.trim());
                link.setAttribute('aria-label', label.textContent.trim());
            } else {
                link.removeAttribute('title');
                link.removeAttribute('aria-label');
            }
        });
    }

    document.querySelectorAll('button[data-appearance]').forEach(function (button) {
        button.addEventListener('click', function () {
            appearance.set(button.dataset.appearance, button.dataset.value);
        });
    });
    document.querySelectorAll('input[type="checkbox"][data-appearance]').forEach(function (input) {
        input.addEventListener('change', function () {
            appearance.set(input.dataset.appearance, input.checked);
        });
    });

    initializeListbox(document.getElementById('spTransitionListbox'));

    const reset = document.getElementById('spAppearanceReset');
    if (reset) {
        reset.addEventListener('click', function () {
            appearance.reset();
            if (window.SafePassTheme) window.SafePassTheme.setTheme('dark');
        });
    }

    window.addEventListener('sp-appearance-changed', function (event) { sync(event.detail); });
    window.addEventListener('sp-lang-changed', function () { sync(appearance.get()); });
    sync(appearance.get());
}


function getLanguages() {
    return window.SafePassI18n && Array.isArray(window.SafePassI18n.languages)
        ? window.SafePassI18n.languages
        : [{ code: 'tr', name: 'Türkçe', short: 'TR' }, { code: 'en', name: 'English', short: 'EN' }];
}

function setLangToggleState(lang) {
    document.querySelectorAll('[data-lang-option]').forEach(function (button) {
        const isActive = button.getAttribute('data-lang-option') === (lang || 'tr');
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });

    const languageLabel = document.querySelector('[data-auth-current-language]');
    if (languageLabel) {
        const meta = getLanguages().find(function (item) { return item.code === (lang || 'tr'); });
        languageLabel.textContent = meta ? meta.short : 'TR';
        const authTrigger = languageLabel.closest('.auth-language-trigger');
        if (authTrigger && meta) authTrigger.setAttribute('aria-label', meta.name);
    }

    const languageTrigger = document.querySelector('.auth-language-trigger');
    if (languageTrigger) {
        languageTrigger.setAttribute('data-language', lang || 'tr');
    }

    const topbarLang = document.getElementById('spTopbarLangLabel');
    const langLabel = (lang || 'tr').toUpperCase();

    if (topbarLang) topbarLang.textContent = langLabel;

    // Topbar trigger shows the active option's flag
    const topbarFlag = document.getElementById('spTopbarLangFlag');
    const activeOption = document.querySelector('#spTopbarLangMenu [data-lang-option="' + (lang || 'tr') + '"] svg');
    if (topbarFlag && activeOption) {
        topbarFlag.innerHTML = activeOption.outerHTML;
    }
}

function applyThemeToUi(theme) {
    if (window.SafePassTheme && typeof window.SafePassTheme.setTheme === 'function') {
        window.SafePassTheme.setTheme(theme);
    }
    setThemeToggleState(theme);
}

function applyLanguageToUi(lang) {
    if (window.SafePassI18n && typeof window.SafePassI18n.setLang === 'function') {
        window.SafePassI18n.setLang(lang);
    }
    setLangToggleState(lang);
}

function initializeAuthThemeToggle() {
    const themeToggle = document.getElementById('authThemeToggle');
    if (!themeToggle) {
        return;
    }

    themeToggle.addEventListener('click', function () {
        if (window.SafePassTheme && typeof window.SafePassTheme.toggleTheme === 'function') {
            window.SafePassTheme.toggleTheme();
        }
    });
}

// Listbox-style language dropdown (used on auth pages and in the app topbar)
function setupLanguageDropdown(trigger, menu) {
    if (!trigger || !menu) {
        return;
    }

    const options = function () {
        return Array.from(menu.querySelectorAll('[data-lang-option]'));
    };

    const setOpen = function (open, focusTrigger) {
        trigger.setAttribute('aria-expanded', String(open));
        menu.hidden = !open;
        if (open) {
            const selected = menu.querySelector('[aria-selected="true"]') || options()[0];
            if (selected) selected.focus();
        } else if (focusTrigger) {
            trigger.focus();
        }
    };

    trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        setOpen(trigger.getAttribute('aria-expanded') !== 'true', false);
    });

    document.addEventListener('click', function (event) {
        if (trigger.getAttribute('aria-expanded') === 'true' && !trigger.parentElement.contains(event.target)) {
            setOpen(false, false);
        }
    });

    menu.addEventListener('keydown', function (event) {
        const items = options();
        const index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            items[(index + step + items.length) % items.length].focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            items[event.key === 'Home' ? 0 : items.length - 1].focus();
        } else if (event.key === 'Tab') {
            setOpen(false, false);
        }
    });

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
            setOpen(false, true);
        }
    });

    options().forEach(function (button) {
        button.addEventListener('click', function () {
            applyLanguageToUi(button.getAttribute('data-lang-option'));
            setOpen(false, true);
        });
    });
}

function initializeLanguageControls() {
    setupLanguageDropdown(
        document.querySelector('.auth-language-trigger'),
        document.getElementById('auth-language-menu')
    );
    setupLanguageDropdown(
        document.getElementById('spTopbarLangToggle'),
        document.getElementById('spTopbarLangMenu')
    );

    window.addEventListener('sp-lang-changed', function (event) {
        const lang = event.detail && event.detail.lang ? event.detail.lang : 'tr';
        setLangToggleState(lang);
    });

    const initialLang = window.SafePassI18n && typeof window.SafePassI18n.getLang === 'function'
        ? window.SafePassI18n.getLang()
        : 'tr';
    setLangToggleState(initialLang);
}

function initializeTopbarAndSettings(currentPath) {
    const notifWrap = document.getElementById('spTopbarNotification');
    const notifBtn = document.getElementById('spTopbarNotifBtn');
    const notifDropdown = document.getElementById('spNotifDropdown');
    const profileTrigger = document.getElementById('spProfileTrigger');
    const profileDropdown = document.getElementById('spProfileDropdown');
    const currentPageLabel = document.getElementById('spCurrentPageLabel');
    const edgeToggle = document.getElementById('spLayoutEdgeToggle');
    const settingsPanel = document.getElementById('spSettingsPanel');
    const settingsOverlay = document.getElementById('spSettingsOverlay');
    const settingsClose = document.getElementById('spSettingsClose');
    const topbarThemeToggle = document.getElementById('spTopbarThemeToggle');

    if (!profileTrigger || !profileDropdown) {
        return;
    }

    const pageTitleKeys = {
        '/dashboard': 'dashboard.title',
        '/profile': 'profile.title',
        '/settings': 'settings.page_title',
        '/trash': 'trash.title',
        '/notifications': 'notif.page_title'
};
    const activeNav = document.querySelector('.sidebar-menu a.active span, .sidebar-menu a.active');
    if (currentPageLabel) {
        if (activeNav) {
            currentPageLabel.textContent = activeNav.textContent.trim();
            // Follow language changes via the nav item's translation key
            const keyed = activeNav.matches('[data-i18n]') ? activeNav : activeNav.querySelector('[data-i18n]');
            if (keyed) currentPageLabel.setAttribute('data-i18n', keyed.getAttribute('data-i18n'));
        } else if (pageTitleKeys[currentPath]) {
            // Pages without a sidebar entry (reached from the topbar / profile menu)
            const key = pageTitleKeys[currentPath];
            currentPageLabel.textContent = getText(key, currentPageLabel.textContent);
            currentPageLabel.setAttribute('data-i18n', key);
        } else {
            // Otherwise use the page's own title key (<title data-i18n-page>)
            const titleKey = document.querySelector('title[data-i18n-page]')?.getAttribute('data-i18n-page');
            if (titleKey) {
                currentPageLabel.textContent = getText(titleKey, currentPageLabel.textContent);
                currentPageLabel.setAttribute('data-i18n', titleKey);
            } else {
                currentPageLabel.textContent = document.title.replace(' - SafePass', '').trim();
            }
        }
    }

    profileTrigger.addEventListener('click', function (e) {
        // The dropdown lives inside the trigger: let its links navigate
        if (profileDropdown.contains(e.target)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (notifDropdown) notifDropdown.classList.remove('open');
        profileDropdown.classList.toggle('open');
    });

    document.addEventListener('click', function (e) {
        if (!profileTrigger.contains(e.target)) {
            profileDropdown.classList.remove('open');
        }
        if (notifWrap && notifDropdown && !notifWrap.contains(e.target)) {
            notifDropdown.classList.remove('open');
        }
    });

    if (notifBtn && notifDropdown) {
        notifBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            profileDropdown.classList.remove('open');
            notifDropdown.classList.toggle('open');
        });
    }

    // Mark the current page in the profile menu
    profileDropdown.querySelectorAll('.sp-profile-card-item[href]').forEach(function (item) {
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
            item.setAttribute('aria-current', 'page');
        }
    });

    function openSettings() {
        if (settingsPanel) settingsPanel.classList.add('open');
        if (settingsOverlay) settingsOverlay.classList.add('open');
        if (edgeToggle) edgeToggle.classList.add('open');
    }

    function closeSettings() {
        if (settingsPanel) settingsPanel.classList.remove('open');
        if (settingsOverlay) settingsOverlay.classList.remove('open');
        if (edgeToggle) edgeToggle.classList.remove('open');
    }

    function toggleSettings() {
        if (settingsPanel && settingsPanel.classList.contains('open')) {
            closeSettings();
        } else {
            openSettings();
        }
    }

    if (edgeToggle) edgeToggle.addEventListener('click', toggleSettings);
    if (settingsClose) settingsClose.addEventListener('click', closeSettings);
    if (settingsOverlay) settingsOverlay.addEventListener('click', closeSettings);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            closeSettings();
            profileDropdown.classList.remove('open');
            if (notifDropdown) notifDropdown.classList.remove('open');
        }
    });

    closeSettings();

    if (topbarThemeToggle) {
        topbarThemeToggle.addEventListener('click', function () {
            if (window.SafePassTheme && typeof window.SafePassTheme.toggleTheme === 'function') {
                window.SafePassTheme.toggleTheme();
            }
        });
    }

    document.querySelectorAll('[data-theme-option]').forEach(function (button) {
        button.addEventListener('click', function () {
            const nextTheme = button.getAttribute('data-theme-option');
            applyThemeToUi(nextTheme);
        });
    });

    initializeAppearanceControls();

    window.addEventListener('sp-theme-changed', function (event) {
        const choice = event.detail && (event.detail.choice || event.detail.theme);
        setThemeToggleState(choice || 'dark');
    });

    const initialTheme = window.SafePassTheme && typeof window.SafePassTheme.getChoice === 'function'
        ? window.SafePassTheme.getChoice()
        : 'dark';
    setThemeToggleState(initialTheme);
}

// Themed listbox: a trigger button plus a menu of role="option" buttons.
// Choosing an option is handled by its own click handler; this only opens,
// closes and moves the keyboard focus.
function initializeListbox(root) {
    if (!root) return;
    const trigger = root.querySelector('.sp-listbox-trigger');
    const menu = root.querySelector('.sp-listbox-menu');
    const options = function () { return Array.from(menu.querySelectorAll('[role="option"]')); };

    function open() {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        (menu.querySelector('.active') || options()[0]).focus();
    }

    function close(focusTrigger) {
        if (menu.hidden) return;
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (focusTrigger) trigger.focus();
    }

    trigger.addEventListener('click', function () { menu.hidden ? open() : close(true); });
    trigger.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            open();
        }
    });
    menu.addEventListener('click', function (event) {
        if (event.target.closest('[role="option"]')) close(true);
    });
    menu.addEventListener('keydown', function (event) {
        const items = options();
        const index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            items[(index + step + items.length) % items.length].focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();  // keep the settings panel open
            close(true);
        } else if (event.key === 'Tab') {
            close(false);
        }
    });
    document.addEventListener('click', function (event) {
        if (!root.contains(event.target)) close(false);
    });
}

document.addEventListener('DOMContentLoaded', function () {
    const currentPath = window.location.pathname;
    initializeActiveNav(currentPath);
    initializeSessionTimeout(currentPath);
    initializeLanguageControls();
    initializeTopbarAndSettings(currentPath);
    initializeAuthThemeToggle();

    if (window.SafePassI18n && typeof window.SafePassI18n.applyTranslations === 'function') {
        window.SafePassI18n.applyTranslations();
    }
});

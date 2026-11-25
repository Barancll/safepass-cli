/* SafePass - Auth Module */

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    const passwordToggles = document.querySelectorAll('.password-toggle');
    passwordToggles.forEach(toggle => {
        const input = document.getElementById(toggle.dataset.target);
        if (!input) return;

        const updateLabel = () => {
            const key = input.type === 'password' ? 'auth.password_show' : 'auth.password_hide';
            const label = window.SafePassI18n ? window.SafePassI18n.t(key) : 'Şifreyi göster';
            toggle.setAttribute('aria-label', label);
            toggle.title = label;
            toggle.setAttribute('aria-pressed', String(input.type !== 'password'));
        };

        updateLabel();
        window.addEventListener('sp-lang-changed', updateLabel);
        toggle.addEventListener('click', function() {
            input.type = input.type === 'password' ? 'text' : 'password';
            this.classList.toggle('visible', input.type !== 'password');
            updateLabel();
        });
    });

    const passwordRequirementsDialog = document.getElementById('password-requirements-dialog');
    const passwordHelpTrigger = document.querySelector('.password-help-trigger');
    if (passwordRequirementsDialog && passwordHelpTrigger) {
        // Non-modal popover anchored to the "?" button (no backdrop)
        const setOpen = function(open) {
            if (open) {
                passwordRequirementsDialog.show();
            } else {
                passwordRequirementsDialog.close();
            }
            passwordHelpTrigger.setAttribute('aria-expanded', String(open));
        };

        passwordHelpTrigger.addEventListener('click', function(event) {
            event.stopPropagation();
            setOpen(!passwordRequirementsDialog.open);
        });

        passwordRequirementsDialog
            .querySelector('.password-requirements-close')
            .addEventListener('click', function() {
                setOpen(false);
                passwordHelpTrigger.focus();
            });

        document.addEventListener('click', function(event) {
            if (passwordRequirementsDialog.open && !passwordRequirementsDialog.contains(event.target)) {
                setOpen(false);
            }
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && passwordRequirementsDialog.open) {
                setOpen(false);
                passwordHelpTrigger.focus();
            }
        });
    }

    setUpLaunchGate(loginForm || registerForm);

    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
        document.getElementById('forgotMaster').addEventListener('click', handleForgotMaster);
        
        // Login password validation
        const loginPasswordInput = document.getElementById('master-password');
        const loginPasswordError = document.getElementById('login-password-error');
        
        if (loginPasswordInput && loginPasswordError) {
            // Real-time validation
            loginPasswordInput.addEventListener('input', function() {
                const password = loginPasswordInput.value;
                
                if (password.length > 0 && password.length < 8) {
                    loginPasswordError.textContent = t('auth.msg_master_min_short', 'Şifre en az 8 karakter olmalıdır.');
                    loginPasswordError.style.display = 'block';
                    loginPasswordInput.classList.add('error');
                } else {
                    loginPasswordError.style.display = 'none';
                    loginPasswordInput.classList.remove('error');
                }
            });
            
            // Clear error on focus
            loginPasswordInput.addEventListener('focus', function() {
                if (loginPasswordInput.value.length >= 8) {
                    loginPasswordError.style.display = 'none';
                    loginPasswordInput.classList.remove('error');
                }
            });
        }
    }

    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
        
        const passwordInput = document.getElementById('master-password');
        // Real-time password match validation
        const confirmInput = document.getElementById('master-password-confirm');
        const matchHint = document.getElementById('password-match-hint');
        
        if (passwordInput && confirmInput && matchHint) {
            // data-i18n keeps the hint in step with language changes
            const setHint = (key) => {
                matchHint.setAttribute('data-i18n', key);
                matchHint.textContent = t(key, '');
            };
            confirmInput.addEventListener('input', function() {
                const password = passwordInput.value;
                const confirm = confirmInput.value;
                
                if (confirm.length === 0) {
                    matchHint.removeAttribute('data-i18n');
                    matchHint.textContent = '';
                    matchHint.className = 'form-hint password-match-hint';
                    confirmInput.style.borderColor = '';
                } else if (password === confirm) {
                    setHint('auth.match_ok');
                    matchHint.className = 'form-hint password-match-hint match-success';
                    confirmInput.style.borderColor = 'var(--success)';
                } else {
                    setHint('auth.match_no');
                    matchHint.className = 'form-hint password-match-hint match-error';
                    confirmInput.style.borderColor = 'var(--danger)';
                }
            });
            
            // Also check when password changes
            passwordInput.addEventListener('input', function() {
                if (confirmInput.value.length > 0) {
                    confirmInput.dispatchEvent(new Event('input'));
                }
            });
        }
    }
});

function t(key, fallback) {
    return window.SafePassI18n ? window.SafePassI18n.t(key) : fallback;
}

// ── Launch gate (safepass/launch.py) ─────────────────────────
// The forms appear only in a browser `safepass start` opened during this run; anywhere else the
// page says how to open SafePass. The login form also shows the account's security picture, which a
// look-alike page on this port can't know.
function setUpLaunchGate(form) {
    const notice = document.getElementById('launchNotice');
    if (!form || !notice || !window.SafePassLaunch) return;
    window.SafePassLaunch.status().then(function (state) {
        if (!state || !state.verified) {
            notice.hidden = false;
            document.querySelectorAll('.auth-session-notice').forEach(function (old) { old.remove(); });
            return;
        }
        form.hidden = false;
        const focus = form.querySelector('[autofocus]');
        if (focus) focus.focus();
        if (form.id === 'login-form') setUpPicture();
    });
}

function setUpPicture() {
    const box = document.getElementById('launchPicture');
    const input = document.getElementById('username');
    if (!box || !input || !window.SafePassPicture) return;
    const image = box.querySelector('.auth-picture-image');
    const missing = box.querySelector('.auth-picture-missing');
    let timer = null;
    let asked = '';
    // A small badge at the right end of the user name field; its tooltip says what it is
    const hide = function () {
        box.hidden = true;
        input.classList.remove('has-picture');
    };
    const show = function (username, picture) {
        if (username !== input.value.trim()) return;  // an older answer
        if (username.length < 3) { hide(); return; }
        const drawn = window.SafePassPicture.draw(image, picture);
        box.classList.toggle('is-empty', !drawn);
        image.hidden = !drawn;
        if (missing) missing.hidden = drawn;  // an older cached page may not have it
        const key = drawn ? 'picture.login_label' : 'picture.login_none';
        box.setAttribute('data-i18n-title', key);
        box.setAttribute('data-i18n-aria-label', key);
        box.title = t(key, '');
        box.setAttribute('aria-label', box.title);
        box.hidden = false;
        input.classList.add('has-picture');
    };
    const lookUp = function () {
        const username = input.value.trim();
        if (username === asked) return;
        asked = username;
        if (username.length < 3) { show(username, ''); return; }
        window.SafePassLaunch.status(username).then(function (state) {
            show(username, state && state.verified ? state.picture || '' : '');
        });
    };
    input.addEventListener('input', function () {
        hide();
        clearTimeout(timer);
        timer = setTimeout(lookUp, 350);
    });
    input.addEventListener('change', lookUp);
    if (input.value.trim()) lookUp();
}

// Server field names → input ids, so errors can point at the right field
const FIELD_INPUTS = {
    username: 'username',
    master_password: 'master-password',
    master_password_confirm: 'master-password-confirm'
};

async function handleLogin(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const username = document.getElementById('username').value.trim();
    const masterPassword = document.getElementById('master-password').value;

    if (!username) {
        showFeedback(() => t('auth.msg_username_required', 'Kullanıcı adı boş bırakılamaz'), 'error', 'username');
        return;
    }
    if (!masterPassword) {
        showFeedback(() => t('auth.msg_password_required', 'Şifre boş bırakılamaz'), 'error', 'master-password');
        return;
    }

    setLoading(form, true, t('auth.msg_logging_in', 'Giriş yapılıyor…'));
    try {
        const keep = document.getElementById('keep-signed-in');
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, master_password: masterPassword, remember: !!(keep && keep.checked),
                                   device_token: window.SafePassDevice.get(username) })
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            if (data.recovery_key) {
                // A security update gave the account a new data key, so its recovery key was replaced
                await window.SafePassRecovery.show(data.recovery_key, { username: username, replaced: true });
            }
            if (data.recovery_key || data.has_picture === false) {
                if (data.has_picture === false) await askPicture();
                window.location.href = '/dashboard';
                return;
            }
            showFeedback(() => t('auth.msg_login_success', 'Giriş başarılı, yönlendiriliyorsunuz…'), 'success');
            setTimeout(() => { window.location.href = '/dashboard'; }, 600);
            return; // keep the button busy until the redirect
        }
        showFeedback(() => window.SafePassI18n.serverText(data) || t('auth.msg_login_failed', 'Giriş başarısız'), 'error', FIELD_INPUTS[data.field]);
    } catch (error) {
        showFeedback(() => t('auth.msg_server_unreachable', 'Sunucuya bağlanılamadı. Lütfen tekrar deneyin.'), 'error');
    }
    setLoading(form, false);
}

// The security picture the login page shows (see setUpPicture); "Later" is allowed, it is asked again next time
function askPicture() {
    const modal = document.getElementById('pictureModal');
    if (!modal || !window.SafePassPicture) return Promise.resolve();
    const save = modal.querySelector('[data-picture="save"]');
    const later = modal.querySelector('[data-picture="later"]');
    const error = modal.querySelector('.sp-picture-error');
    const picker = window.SafePassPicture.mount(modal.querySelector('[data-picture-picker]'), '', function (value) {
        save.disabled = !value;
        error.hidden = true;
    });
    save.disabled = true;
    modal.hidden = false;
    const first = modal.querySelector('.sp-picture-shape');
    if (first) first.focus();

    return new Promise(function (resolve) {
        const close = function () {
            modal.hidden = true;
            save.removeEventListener('click', onSave);
            later.removeEventListener('click', close);
            document.removeEventListener('keydown', onKey);
            resolve();
        };
        const onKey = function (event) { if (event.key === 'Escape') close(); };
        const onSave = async function () {
            save.disabled = true;
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ security_picture: picker.value() })
                });
                const data = await response.json().catch(() => ({}));
                if (response.ok) { close(); return; }
                error.textContent = window.SafePassI18n.serverText(data) || t('settings.save_failed', 'Ayarlar kaydedilemedi. Tekrar deneyin.');
            } catch (e) {
                error.textContent = t('auth.msg_server_unreachable', 'Sunucuya bağlanılamadı. Lütfen tekrar deneyin.');
            }
            error.hidden = false;
            save.disabled = !picker.value();
        };
        save.addEventListener('click', onSave);
        later.addEventListener('click', close);
        document.addEventListener('keydown', onKey);
    });
}

async function handleForgotMaster() {
    let issued = null;
    let account = document.getElementById('username').value.trim();
    const result = await window.SafePassDialog.confirm({
        icon: 'lock',
        title: () => t('recovery.form_title'),
        text: () => t('recovery.form_text'),
        confirmLabel: () => t('recovery.form_submit'),
        fields: [
            { name: 'account', type: 'text', autocomplete: 'username', label: () => t('auth.username') },
            { name: 'recovery_key', type: 'text', label: () => t('recovery.heading') },
            { name: 'new_password', type: 'password', autocomplete: 'new-password', label: () => t('profile.new_master') },
            { name: 'confirm_password', type: 'password', autocomplete: 'new-password', label: () => t('profile.confirm_master') }
        ],
        onConfirm: async (values) => {
            if (values.new_password !== values.confirm_password) return () => t('auth.msg_mismatch');
            const response = await fetch('/api/auth/recover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: values.account.trim(), recovery_key: values.recovery_key, new_password: values.new_password,
                                       device_token: window.SafePassDevice.get(values.account) })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) return () => window.SafePassI18n.serverText(data) || t('common.error_generic');
            issued = data.recovery_key;
            account = values.account.trim();
            return null;
        }
    });
    if (!result || !issued) return;
    // The key that was just used stops working: the user needs this one from now on
    await window.SafePassRecovery.show(issued, { username: account, replaced: true });
    window.location.href = '/dashboard';
}

async function handleRegister(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const username = document.getElementById('username').value.trim();
    const masterPassword = document.getElementById('master-password').value;
    const masterPasswordConfirm = document.getElementById('master-password-confirm').value;
    const checkbox = form.querySelector('input[type="checkbox"]');

    // Client-side checks mirror the server rules (views.master_password_error)
    const problems = [
        [!username, 'auth.msg_username_required', 'Kullanıcı adı boş bırakılamaz', 'username'],
        [username.length < 3, 'auth.msg_username_min', 'Kullanıcı adı en az 3 karakter olmalı', 'username'],
        [username.length > 20, 'srv.username_max', 'Kullanıcı adı en fazla 20 karakter olabilir.', 'username'],
        [!masterPassword, 'auth.msg_master_required', 'Ana şifre boş bırakılamaz', 'master-password'],
        [masterPassword.length < 8, 'auth.msg_master_min', 'Ana şifre en az 8 karakter olmalı', 'master-password'],
        [!/[A-Z]/.test(masterPassword) || !/[a-z]/.test(masterPassword) || !/[0-9]/.test(masterPassword),
            'auth.msg_master_weak', 'Zayıf şifre! Büyük harf, küçük harf ve rakam içermelidir', 'master-password'],
        [masterPassword !== masterPasswordConfirm, 'auth.msg_mismatch', 'Şifreler eşleşmiyor. Lütfen aynı şifreyi girin.', 'master-password-confirm'],
        [checkbox && !checkbox.checked, 'auth.msg_ack_required', 'Devam etmek için uyarıyı onaylamalısınız', null]
    ];
    const problem = problems.find(([failed]) => failed);
    if (problem) {
        const [, key, fallback, field] = problem;
        showFeedback(() => t(key, fallback), key === 'auth.msg_ack_required' ? 'warning' : 'error', field);
        return;
    }

    setLoading(form, true, t('auth.msg_registering', 'Hesap oluşturuluyor…'));
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, master_password: masterPassword, lang: window.SafePassI18n ? window.SafePassI18n.getLang() : 'tr' })
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            showFeedback(() => t('auth.msg_register_success', 'Hesabınız oluşturuldu, giriş yapılıyor…'), 'success');
            await window.SafePassRecovery.show(data.recovery_key, { username: username });
            await askPicture();
            window.location.href = '/dashboard';
            return;
        }
        showFeedback(() => window.SafePassI18n.serverText(data) || t('auth.msg_register_failed', 'Kayıt başarısız'), 'error', FIELD_INPUTS[data.field]);
    } catch (error) {
        showFeedback(() => t('auth.msg_server_unreachable', 'Sunucuya bağlanılamadı. Lütfen tekrar deneyin.'), 'error');
    }
    setLoading(form, false);
}

// ── Inline form feedback ─────────────────────────────────────
// Shown under the form heading (not floating), so it never covers the
// theme/language controls and sits where the user is already looking.
const FEEDBACK_ICONS = {
    error: '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>',
    success: '<circle cx="12" cy="12" r="10"></circle><polyline points="8 12.5 11 15.5 16 9.5"></polyline>',
    warning: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
};

function clearInvalidFields() {
    document.querySelectorAll('.form-input.is-invalid').forEach(input => {
        input.classList.remove('is-invalid');
        input.removeAttribute('aria-invalid');
    });
}

// `message` may be a function: it is called again when the language changes,
// so a message that is already on screen follows the new language.
let currentFeedbackText = null;

// Lokki in the illustration reacts to the result: happy on success, worried on a problem
let lokkiMoodTimer = null;
function lokkiReact(type) {
    const lokki = document.querySelector('.auth-illustration .lokki');
    if (!lokki) return;
    const mood = type === 'success' ? 'happy' : (type === 'error' || type === 'warning') ? 'worried' : null;
    if (!mood) return;
    lokki.setAttribute('data-mood', mood);
    clearTimeout(lokkiMoodTimer);
    if (mood === 'worried') lokkiMoodTimer = setTimeout(() => lokki.setAttribute('data-mood', 'typing'), 2500);  // back to typing
}

function showFeedback(message, type = 'info', fieldId = null) {
    lokkiReact(type);
    const box = document.getElementById('authFeedback');
    if (!box) return;
    currentFeedbackText = typeof message === 'function' ? message : null;
    const text = currentFeedbackText ? currentFeedbackText() : message;

    // A fresh message replaces the "session expired" notice
    document.querySelectorAll('.auth-session-notice').forEach(notice => notice.remove());

    const kind = FEEDBACK_ICONS[type] ? type : 'info';
    box.className = `auth-feedback auth-feedback-${kind}`;
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    box.innerHTML = `<svg class="auth-feedback-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${FEEDBACK_ICONS[kind]}</svg><span class="auth-feedback-text"></span>`;
    box.querySelector('.auth-feedback-text').textContent = text; // server text is never parsed as HTML
    box.hidden = false;

    clearInvalidFields();
    const input = fieldId ? document.getElementById(fieldId) : null;
    if (input) {
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
    }
}

function setLoading(form, loading, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (loading) {
        button.dataset.label = button.textContent;
        button.textContent = label;
        button.classList.add('is-loading');
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
    } else {
        button.textContent = button.dataset.label || button.textContent;
        button.classList.remove('is-loading');
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

window.addEventListener('sp-lang-changed', function () {
    const box = document.getElementById('authFeedback');
    if (currentFeedbackText && box && !box.hidden) {
        box.querySelector('.auth-feedback-text').textContent = currentFeedbackText();
    }
});

// Typing in a flagged field clears its error state
document.addEventListener('input', function (event) {
    if (event.target.classList && event.target.classList.contains('is-invalid')) {
        event.target.classList.remove('is-invalid');
        event.target.removeAttribute('aria-invalid');
    }
});

// Kept for older callers
function showToast(message, type = 'info') {
    showFeedback(message, type);
}

function showAlert(message, type = 'info') {
    showFeedback(message, type);
}

/**
 * New-card wizard: 1 account → 2 sign-in details → 3 category and notes.
 * Strength meter, preview, Lokki, show/hide and Generate live in card_preview.js.
 */

function t(key, params) {
    return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
}

// Subcategories come from the user's definitions (modules/categories.js)
function updateSubcategoryOptions(categoryValue, selectedSubcategory = '') {
    window.SafePassCategories.fillSubSelect(document.getElementById('subcategory'), categoryValue, selectedSubcategory);
    window.SafePassCardForm.updatePreview();
}

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('addCardForm');
    if (!form) return;
    const showAlert = window.showAlert;
    const titleInput = document.getElementById('title');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const urlInput = document.getElementById('url');
    const categorySelect = document.getElementById('category');
    const prev = document.getElementById('cwPrev');
    const next = document.getElementById('cwNext');
    const save = document.getElementById('cwSave');
    const LAST = 3;
    let step = 1;

    window.SafePassCardForm.init({ emptyKey: 'strength.enter', sayKey: 'wizard.say_new' });

    categorySelect.addEventListener('change', function () { updateSubcategoryOptions(this.value); });
    updateSubcategoryOptions(categorySelect.value);

    // ── steps ─────────────────────────────────────────────────

    function stepError() {
        if (step === 1 && !titleInput.value.trim()) return [titleInput, 'form.title_required'];
        // No minimum length: vault entries include PINs and short codes (the meter shows how weak they are)
        if (step === 2 && !passwordInput.value) return [passwordInput, 'auth.msg_password_required'];
        return null;
    }

    function goTo(target, focus) {
        step = target;
        form.querySelectorAll('.cw-step').forEach((section) => {
            section.hidden = Number(section.dataset.step) !== step;
        });
        form.querySelectorAll('.cw-step-dot').forEach((dot) => {
            const n = Number(dot.dataset.step);
            dot.classList.toggle('is-done', n < step);
            if (n === step) dot.setAttribute('aria-current', 'step'); else dot.removeAttribute('aria-current');
        });
        prev.hidden = step === 1;
        next.hidden = step === LAST;
        save.hidden = step !== LAST;
        if (focus !== false) {
            const first = form.querySelector(`.cw-step[data-step="${step}"] input, .cw-step[data-step="${step}"] select`);
            if (first) first.focus();
        }
    }

    function forward() {
        const error = stepError();
        if (error) {
            error[0].focus();
            showAlert(t(error[1]), 'error');
            return;
        }
        if (step < LAST) goTo(step + 1);
    }

    next.addEventListener('click', forward);
    prev.addEventListener('click', () => goTo(step - 1));

    // Enter moves on instead of submitting early (notes keep their new lines)
    form.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && step < LAST && event.target.tagName !== 'TEXTAREA' && event.target.tagName !== 'BUTTON') {
            event.preventDefault();
            forward();
        }
    });

    // Earlier steps can be revisited from the step list
    form.querySelectorAll('.cw-step-dot').forEach((dot) => {
        dot.addEventListener('click', () => {
            const n = Number(dot.dataset.step);
            if (n < step) goTo(n);
        });
    });

    // ── step 1: a service fills title, URL and category, then moves on ─────

    const serviceButtons = form.querySelectorAll('.cw-service');
    serviceButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            serviceButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
            titleInput.value = btn.dataset.service || '';
            if (btn.dataset.url) urlInput.value = btn.dataset.url;
            if (btn.dataset.category) {
                categorySelect.value = btn.dataset.category;
                updateSubcategoryOptions(btn.dataset.category, btn.dataset.subcategory || '');
            }
            titleInput.dispatchEvent(new Event('input'));
            window.SafePassCardForm.say('happy', 'wizard.say_service');
            goTo(2);
        });
    });
    serviceButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    // Typing a title by hand un-picks the service
    titleInput.addEventListener('input', (event) => {
        if (event.isTrusted) serviceButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
    });

    // ── password handed over by the generator ("Bu şifreyle kart oluştur"): read once, then delete ──

    let handoff = null;
    try {
        handoff = JSON.parse(sessionStorage.getItem('sp-generated-for-card') || 'null');
        sessionStorage.removeItem('sp-generated-for-card');
    } catch (e) {
        handoff = null;
    }
    if (handoff && typeof handoff.password === 'string' && Date.now() - handoff.at < 2 * 60 * 1000) {
        passwordInput.value = handoff.password;
        passwordInput.dispatchEvent(new Event('input'));
        if (handoff.pin) {
            categorySelect.value = 'sistem-ag';
            updateSubcategoryOptions('sistem-ag', 'cihaz-pinleri');
        }
        titleInput.focus();
        showAlert(t('form.generated_filled'), 'success');
    } else {
        titleInput.focus();
    }

    // ── save ──────────────────────────────────────────────────

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (step < LAST) { forward(); return; }
        // A step left invalid (e.g. title cleared later): go back to it
        for (const [n, input, key] of [[1, titleInput, 'form.title_required'], [2, passwordInput, 'auth.msg_password_required']]) {
            if (!(n === 1 ? input.value.trim() : input.value)) {
                goTo(n, false);
                input.focus();
                showAlert(t(key), 'error');
                return;
            }
        }

        const formData = {
            app_name: titleInput.value.trim(),
            username: usernameInput.value.trim(),
            password: passwordInput.value,
            url: urlInput.value.trim(),
            notes: document.getElementById('notes').value.trim(),
            category: categorySelect.value || 'genel',
            subcategory: document.getElementById('subcategory').value || ''
        };

        save.disabled = true;
        try {
            const response = await fetch('/api/passwords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.getCookie('csrftoken') },
                body: JSON.stringify(formData)
            });
            const data = await response.json().catch(() => ({}));
            if (data.success) {
                form.reset(); // Back must not bring typed values back
                window.SafePassCardForm.say('happy', 'wizard.say_saved');
                showAlert(t('form.added'), 'success');
                setTimeout(() => { window.location.href = '/passwords'; }, 1000);
                return;
            }
            showAlert(window.SafePassI18n.serverText(data) || t('form.add_failed'), 'error');
        } catch (error) {
            showAlert(t('common.error_generic'), 'error');
        }
        save.disabled = false;
    });
});

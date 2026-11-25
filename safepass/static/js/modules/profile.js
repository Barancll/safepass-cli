/**
 * Profile Module
 * Handles profile settings and account management
 */

// Use global functions from app.js
const showAlert = window.showAlert;
const getCookie = window.getCookie;
const t = (key, params) => (window.SafePassI18n ? window.SafePassI18n.t(key, params) : key);

// Load stats on page load
document.addEventListener('DOMContentLoaded', () => {
    loadProfileStats();
});

document.getElementById('changeMasterBtn').addEventListener('click', openChangeMasterPassword);
document.getElementById('changeMasterClose').addEventListener('click', closeChangeMasterPassword);
document.getElementById('changeMasterCancel').addEventListener('click', closeChangeMasterPassword);
document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);

/**
 * Load profile statistics
 */
async function loadProfileStats() {
    try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();

        // API returns stats directly, not wrapped in success/stats
        document.getElementById('totalCards').textContent = data.total_cards || 0;
        document.getElementById('safeCards').textContent = data.strong_count || 0;
        document.getElementById('weakCards').textContent = data.weak_count || 0;
        
        // Calculate average strength
        const total = data.total_cards || 0;
        if (total > 0) {
            const avgScore = Math.round(data.security_score || 0);
            document.getElementById('avgStrength').textContent = avgScore + '%';
        } else {
            document.getElementById('avgStrength').textContent = '0%';
        }
    } catch {
        // Keep the placeholders; nothing is logged to the console
    }
}

/**
 * Open change master password modal
 */
function openChangeMasterPassword() {
    const modal = document.getElementById('changeMasterPasswordModal');
    modal.style.display = 'flex';

    // Form submit handler
    const form = document.getElementById('changeMasterPasswordForm');
    form.onsubmit = async (e) => {
        e.preventDefault();

        const currentPassword = document.getElementById('currentMasterPassword').value;
        const newPassword = document.getElementById('newMasterPassword').value;
        const confirmPassword = document.getElementById('confirmMasterPassword').value;

        if (newPassword !== confirmPassword) {
            showAlert(t('profile.mismatch'), 'error');
            return;
        }

        // Same rules as the server (views.master_password_error)
        if (newPassword.length < 8) {
            showAlert(t('auth.msg_master_min_short'), 'error');
            return;
        }

        if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            showAlert(t('auth.msg_master_weak'), 'error');
            return;
        }

        if (newPassword === currentPassword) {
            showAlert(t('srv.new_password_same'), 'error');
            return;
        }

        // Re-encrypting every entry can take a moment
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.setAttribute('data-i18n', 'profile.reencrypting');
        submitButton.textContent = t('profile.reencrypting');

        try {
            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
            const response = await fetch('/api/auth/change-master-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfMeta ? csrfMeta.content : getCookie('csrftoken')
                },
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok && data.success) {
                showAlert(t('profile.password_changed'), 'success');
                closeChangeMasterPassword();
                // The data key changed, so the old recovery key no longer opens anything
                await window.SafePassRecovery.show(data.recovery_key, { username: document.querySelector('meta[name="sp-username"]')?.content, replaced: true });
            } else {
                showAlert(window.SafePassI18n.serverText(data) || t('srv.change_password_failed'), 'error');
            }
        } catch (error) {
            showAlert(t('common.error_generic'), 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.setAttribute('data-i18n', 'profile.change');
            submitButton.textContent = t('profile.change');
        }
    };
}

/**
 * Close change master password modal
 */
function closeChangeMasterPassword() {
    const modal = document.getElementById('changeMasterPasswordModal');
    modal.style.display = 'none';
    // Typed master passwords do not stay in the page
    document.getElementById('changeMasterPasswordForm').reset();
}

/**
 * Delete account
 */
async function deleteAccount() {
    // The confirmation word is in the UI language (SİL / DELETE / ELIMINAR / LÖSCHEN)
    const word = () => t('profile.delete_word');
    let deleted = null;

    const result = await window.SafePassDialog.confirm({
        danger: true,
        title: () => t('profile.delete_title'),
        text: () => t('profile.delete_modal_text'),
        confirmLabel: () => t('profile.delete_forever'),
        fields: [
            { name: 'password', type: 'password', autocomplete: 'current-password', label: () => t('profile.delete_password_label') },
            { name: 'word', type: 'text', label: () => t('profile.delete_word_label', { word: word() }), mustEqual: word }
        ],
        // Runs while the dialog stays open, so a wrong password is shown right there
        onConfirm: async (values) => {
            const response = await fetch('/api/profile/delete-account', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ master_password: values.password })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                return () => window.SafePassI18n.serverText(data) || t('srv.delete_account_failed');
            }
            deleted = data;
            return null;
        }
    });

    if (!result || !deleted) return;
    showAlert(window.SafePassI18n.serverText(deleted, 'message'), 'success');
    setTimeout(() => {
        window.location.href = '/auth/login';
    }, 2000);
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeChangeMasterPassword();
    }
});

// Close modal on outside click
document.getElementById('changeMasterPasswordModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        closeChangeMasterPassword();
    }
});

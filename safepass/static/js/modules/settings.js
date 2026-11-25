/* SafePass - Settings page */

document.addEventListener('DOMContentLoaded', function () {
    const t = function (key, fallback) {
        return window.SafePassI18n ? window.SafePassI18n.t(key) : fallback;
    };

    // Each <select data-setting="field"> saves on change; reverts if the server rejects it
    document.querySelectorAll('select[data-setting]').forEach(function (select) {
        let savedValue = select.value;

        select.addEventListener('change', function () {
            const value = select.value;
            const body = {};
            body[select.dataset.setting] = Number(value);
            select.disabled = true;

            window.SafePassSession.post('/api/settings', body)
                .then(function (data) {
                    savedValue = value;
                    window.SafePassSession.sync(data);
                    if (window.SafePassClipboard && typeof data.clipboard_clear_seconds === 'number') {
                        window.SafePassClipboard.setClearSeconds(data.clipboard_clear_seconds);
                    }
                    showAlert(t('settings.saved', 'Ayarlar kaydedildi'), 'success');
                })
                .catch(function () {
                    select.value = savedValue;
                    showAlert(t('settings.save_failed', 'Ayarlar kaydedilemedi. Tekrar deneyin.'), 'error');
                })
                .finally(function () {
                    select.disabled = false;
                });
        });
    });
});

// Security picture: shown on the login page only in a browser `safepass start` opened (safepass/launch.py)
(function () {
    const setting = document.getElementById('pictureSetting');
    if (!setting || !window.SafePassPicture) return;
    const t = function (key, fallback) { return window.SafePassI18n ? window.SafePassI18n.t(key) : fallback; };
    const save = document.getElementById('pictureSave');
    const remove = document.getElementById('pictureRemove');
    let saved = setting.dataset.picture || '';
    const sync = function (value) {
        save.disabled = !value || value === saved;
        remove.disabled = !saved;
    };
    const picker = window.SafePassPicture.mount(setting.querySelector('[data-picture-picker]'), saved, sync);
    sync(picker.value());

    const store = function (value) {
        save.disabled = remove.disabled = true;
        window.SafePassSession.post('/api/settings', { security_picture: value })
            .then(function (data) {
                saved = data.security_picture || '';
                picker.set(saved);
                window.SafePassSession.sync(data);
                showAlert(t(saved ? 'picture.saved' : 'picture.removed', 'Ayarlar kaydedildi'), 'success');
            })
            .catch(function () {
                showAlert(t('settings.save_failed', 'Ayarlar kaydedilemedi. Tekrar deneyin.'), 'error');
            })
            .finally(function () { sync(picker.value()); });
    };
    save.addEventListener('click', function () { store(picker.value()); });
    remove.addEventListener('click', function () { store(''); });
})();

// Recovery key: a permanent place to make or replace it
(function () {
    const setting = document.getElementById('recoverySetting');
    document.getElementById('recoveryBtn').addEventListener('click', async function () {
        const replacing = setting.dataset.hasKey === '1';
        if (!(await window.SafePassRecovery.create(replacing))) return;
        setting.dataset.hasKey = '1';
        document.getElementById('recoveryStateTitle').setAttribute('data-i18n', 'recovery.title_on');
        document.getElementById('recoveryState').setAttribute('data-i18n', 'recovery.state_on');
        document.getElementById('recoveryBtnLabel').setAttribute('data-i18n', 'recovery.renew');
        window.SafePassI18n.applyTranslations();
    });
})();

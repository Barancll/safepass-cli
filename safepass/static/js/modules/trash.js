/* SafePass - Trash page: password cards and deleted definitions (categories / services) */

document.addEventListener('DOMContentLoaded', function () {
    const panel = document.querySelector('.trash-panel');
    const emptyState = document.getElementById('trashEmpty');
    const emptyAllButton = document.getElementById('trashEmptyBtn');
    if (!panel) return;

    const t = function (key, fallback) {
        return window.SafePassI18n ? window.SafePassI18n.t(key) : fallback;
    };
    const items = function () { return panel.querySelectorAll('.trash-item'); };

    // Texts that carry a number are rendered here (and again on language change)
    function renderCounts() {
        panel.querySelectorAll('.trash-days').forEach(function (badge) {
            const days = badge.dataset.days;
            badge.textContent = t(days === '1' ? 'trash.days_left_one' : 'trash.days_left', '{n} gün kaldı').replace('{n}', days);
        });
        panel.querySelectorAll('.trash-moved').forEach(function (note) {
            note.textContent = t('trash.moved', "{n} kart Genel'e taşındı").replace('{n}', note.dataset.moved);
        });
    }
    renderCounts();
    window.addEventListener('sp-lang-changed', renderCounts);

    function updateCounts(count) {
        const badge = document.getElementById('spTrashBadge');
        if (badge) {
            badge.textContent = count;
            badge.hidden = !count;
        }
        // Each group hides when it runs out; the empty state shows when both have
        panel.querySelectorAll('.trash-group').forEach(function (group) {
            const left = group.querySelectorAll('.trash-item').length;
            group.hidden = !left;
            const counter = group.querySelector('.trash-group-count');
            if (counter) counter.textContent = left;
        });
        const isEmpty = !items().length;
        emptyState.hidden = !isEmpty;
        if (emptyAllButton) emptyAllButton.hidden = isEmpty;
    }

    function removeItem(item) {
        item.classList.add('is-leaving');
        setTimeout(function () {
            item.remove();
            updateCounts(items().length);
        }, 200);
    }

    panel.addEventListener('click', async function (event) {
        const button = event.target.closest('[data-trash-action]');
        if (!button) return;
        const item = button.closest('.trash-item');
        const name = item.querySelector('.trash-item-name').textContent.trim();
        const action = button.dataset.trashAction;
        const kind = item.dataset.kind;  // set for definitions only

        if (action === 'delete') {
            const confirmed = await window.SafePassDialog.confirm({
                title: t('trash.confirm_delete_title', 'Kalıcı olarak silinsin mi?'),
                text: (kind
                    ? t('trash.confirm_delete_def_text', "\"{name}\" kalıcı olarak silinecek. Kartlar Genel'de kalır.")
                    : t('trash.confirm_delete_text', '"{name}" ve şifre geçmişi kalıcı olarak silinecek. Bu işlem geri alınamaz.')).replace('{name}', name),
                confirmLabel: t('trash.delete_forever', 'Kalıcı sil'),
                danger: true
            });
            if (!confirmed) return;
        }

        button.disabled = true;
        try {
            const url = kind
                ? `/api/trash/definitions/${kind}/${item.dataset.id}/${action}`
                : `/api/trash/${item.dataset.id}/${action}`;
            await window.SafePassSession.post(url);
            removeItem(item);
            let message;
            if (action !== 'restore') {
                message = t('trash.deleted', '"{name}" kalıcı olarak silindi');
            } else if (kind && Number(item.dataset.moved) > 0) {
                message = t('trash.restored_def_moved', '"{name}" geri yüklendi; {n} kart eski yerine döndü').replace('{n}', item.dataset.moved);
            } else {
                message = t('trash.restored', '"{name}" geri yüklendi');
            }
            showAlert(message.replace('{name}', name), 'success');
        } catch (error) {
            button.disabled = false;
            showAlert(t('trash.action_failed', 'İşlem tamamlanamadı. Tekrar deneyin.'), 'error');
        }
    });

    if (emptyAllButton) {
        emptyAllButton.addEventListener('click', async function () {
            const count = items().length;
            const confirmed = await window.SafePassDialog.confirm({
                title: t('trash.confirm_empty_title', 'Çöp kutusu boşaltılsın mı?'),
                text: t('trash.confirm_empty_all_text', '{n} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.').replace('{n}', count),
                confirmLabel: t('trash.empty_all', 'Çöp kutusunu boşalt'),
                danger: true
            });
            if (!confirmed) return;
            try {
                await window.SafePassSession.post('/api/trash/empty');
                items().forEach(removeItem);
                showAlert(t('trash.emptied', 'Çöp kutusu boşaltıldı'), 'success');
            } catch (error) {
                showAlert(t('trash.action_failed', 'İşlem tamamlanamadı. Tekrar deneyin.'), 'error');
            }
        });
    }
});

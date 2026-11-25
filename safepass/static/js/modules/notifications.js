/* SafePass - Notifications (topbar bell menu + /notifications page)
 *
 * The server sends kinds and numbers (see notifications.py); the text is
 * written here from translations. Both views draw from the same list, so an
 * action in one updates the other and the unread count on the bell.
 */

(function () {
    'use strict';

    const REFRESH_AFTER_MS = 30000; // re-fetch when the bell is opened after this long

    let items = [];
    let unread = 0;
    let total = 0;
    let loadedAt = 0;
    let filter = 'all';          // page: 'all' | 'unread'
    const selected = new Set();  // page: ids ticked for bulk actions

    function t(key, params) {
        return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
    }

    function lang() {
        return window.SafePassI18n && window.SafePassI18n.getLang ? window.SafePassI18n.getLang() : 'tr';
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function svg(paths) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
    }

    const UPDATE_COMMANDS = 'safepass stop\nsafepass update\nsafepass start';

    const ICONS = {
        stale: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>'),
        failed_login: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
        master_changed: svg('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'),
        trash_expiring: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
        update: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
        copy: svg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
        read: svg('<path d="M20 6 9 17l-5-5"/>'),
        unread: svg('<circle cx="12" cy="12" r="4" fill="currentColor"/>'),
        remove: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
        empty: svg('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="m9 11 2 2 4-4"/>'),
    };

    // ── Wording ───────────────────────────────────────────────

    function describe(item) {
        const name = item.card ? item.card.name : '—';
        const p = item.params || {};
        switch (item.kind) {
            case 'stale':
                return { title: t('notif.k_stale_title', { name: name }), text: t('notif.k_stale_text', { days: p.days }),
                         href: item.card ? '/passwords/' + item.card.id + '/edit' : null, go: 'notif.go_change' };
            case 'failed_login':
                return { title: t('notif.k_failed_title'), text: t('notif.k_failed_text', { n: p.count || 1 }),
                         href: '/profile', go: 'notif.go_master' };
            case 'master_changed':
                return { title: t('notif.k_master_title'), text: t('notif.k_master_text'), href: null };
            case 'trash_expiring':
                return { title: t('notif.k_trash_title', { name: name }), text: t('notif.k_trash_text'),
                         href: '/trash', go: 'notif.go_trash' };
            case 'update':
                return { title: t('notif.k_update_title', { version: p.version }), text: t('notif.k_update_text'), href: null };
            default:
                return { title: item.kind, text: '', href: null };
        }
    }

    function timeAgo(iso) {
        const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
        const steps = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
        let format;
        try { format = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' }); } catch (e) { return ''; }
        for (let i = 0; i < steps.length; i++) {
            if (Math.abs(seconds) >= steps[i][1]) return format.format(Math.round(seconds / steps[i][1]), steps[i][0]);
        }
        return t('notif.just_now');
    }

    // ── Rendering ─────────────────────────────────────────────

    function iconButton(action, key, icon, danger) {
        const button = el('button', 'sp-notif-icon' + (danger ? ' is-danger' : ''));
        button.type = 'button';
        button.dataset.notifItemAction = action;
        button.title = t(key);
        button.setAttribute('aria-label', t(key));
        button.innerHTML = icon;
        return button;
    }

    // The commands to run, ready to copy. Updating happens in a terminal: a running
    // server can't safely replace itself.
    function updateSteps() {
        const box = el('div', 'sp-notif-commands');
        box.appendChild(el('code', '', UPDATE_COMMANDS));
        const copy = el('button', 'sp-notif-icon');
        copy.type = 'button';
        copy.title = t('card.copy');
        copy.setAttribute('aria-label', t('card.copy'));
        copy.innerHTML = ICONS.copy;
        copy.addEventListener('click', function (event) {
            event.stopPropagation();
            navigator.clipboard.writeText(UPDATE_COMMANDS).then(function () {
                window.showAlert(t('notif.k_update_copied'), 'success');
            }).catch(function () {
                window.showAlert(t('common.error_generic'), 'error');
            });
        });
        box.appendChild(copy);
        return box;
    }

    function renderItem(item, onPage) {
        const info = describe(item);
        const row = el('div', 'sp-notif-item kind-' + item.kind + (item.read ? '' : ' is-unread') + (selected.has(item.id) ? ' is-selected' : ''));
        row.setAttribute('role', 'listitem');
        row.dataset.id = item.id;

        if (onPage) {
            const box = el('input', 'notif-item-check');
            box.type = 'checkbox';
            box.checked = selected.has(item.id);
            box.dataset.notifSelect = item.id;
            box.setAttribute('aria-label', info.title);
            row.appendChild(box);
        }

        const kind = el('span', 'sp-notif-kind');
        kind.setAttribute('aria-hidden', 'true');
        kind.innerHTML = ICONS[item.kind] || ICONS.empty;
        row.appendChild(kind);

        const body = el('div', 'sp-notif-body');
        const title = el(info.href ? 'a' : 'span', 'sp-notif-title', info.title);
        if (info.href) {
            title.href = info.href;
            title.dataset.notifOpen = item.id;
        }
        title.title = info.title;
        body.appendChild(title);
        body.appendChild(el('p', 'sp-notif-text', info.text));
        if (item.kind === 'update') body.appendChild(updateSteps());
        const meta = el('div', 'sp-notif-meta');
        const when = el('time', '', timeAgo(item.created_at));
        when.dateTime = item.created_at;
        when.title = new Date(item.created_at).toLocaleString(lang());
        meta.appendChild(when);
        if (onPage && info.href && info.go) {
            const go = el('a', 'sp-notif-go', t(info.go) + ' →');
            go.href = info.href;
            go.dataset.notifOpen = item.id;
            meta.appendChild(go);
        }
        body.appendChild(meta);
        row.appendChild(body);

        const actions = el('div', 'sp-notif-actions');
        actions.appendChild(item.read
            ? iconButton('unread', 'notif.mark_unread', ICONS.unread)
            : iconButton('read', 'notif.mark_read', ICONS.read));
        actions.appendChild(iconButton('delete', 'notif.delete', ICONS.remove, true));
        row.appendChild(actions);
        return row;
    }

    function renderEmpty(onPage) {
        const box = el('div', 'sp-notif-empty');
        const icon = el('span', 'sp-notif-empty-icon');
        icon.innerHTML = ICONS.empty;
        box.appendChild(icon);
        const unreadOnly = onPage && filter === 'unread' && total > 0;
        box.appendChild(el('strong', '', t(unreadOnly ? 'notif.empty_unread' : 'notif.empty')));
        box.appendChild(el('span', '', t(unreadOnly ? 'notif.empty_unread_text' : 'notif.empty_text')));
        return box;
    }

    function renderList(list, rows, onPage) {
        list.innerHTML = '';
        list.removeAttribute('aria-busy');
        if (!rows.length) {
            list.appendChild(renderEmpty(onPage));
            return;
        }
        rows.forEach(function (item) { list.appendChild(renderItem(item, onPage)); });
    }

    function renderBell() {
        const count = document.getElementById('spNotifCount');
        if (count) {
            count.hidden = !unread;
            count.textContent = unread > 9 ? '9+' : String(unread);
        }
        const button = document.getElementById('spTopbarNotifBtn');
        if (button) {
            const label = unread ? t('notif.title_unread', { n: unread }) : t('notif.title');
            button.setAttribute('aria-label', label);
            button.title = label;
        }
        const chip = document.getElementById('spNotifNew');
        if (chip) {
            chip.hidden = !unread;
            chip.textContent = t('notif.new_count', { n: unread });
        }
        const dropdown = document.getElementById('spNotifDropdown');
        if (dropdown) {
            dropdown.querySelector('[data-notif-action="read-all"]').disabled = !unread;
            dropdown.querySelector('[data-notif-action="delete-all"]').disabled = !total;
        }
        const list = document.getElementById('spNotifList');
        if (list && loadedAt) renderList(list, items, false);
    }

    function renderPage() {
        const list = document.getElementById('notifPageList');
        if (!list || !loadedAt) return;
        // Forget ticks on rows that are gone
        Array.from(selected).forEach(function (id) {
            if (!items.some(function (item) { return item.id === id; })) selected.delete(id);
        });
        const rows = filter === 'unread' ? items.filter(function (item) { return !item.read; }) : items;
        renderList(list, rows, true);

        document.getElementById('notifCountAll').textContent = String(total);
        document.getElementById('notifCountUnread').textContent = String(unread);
        document.querySelectorAll('[data-notif-filter]').forEach(function (tab) {
            const active = tab.dataset.notifFilter === filter;
            tab.classList.toggle('is-active', active);
            tab.setAttribute('aria-selected', String(active));
        });
        const page = document.querySelector('.notif-panel');
        page.querySelector('[data-notif-action="read-all"]').disabled = !unread;
        page.querySelector('[data-notif-action="delete-all"]').disabled = !total;

        const visibleIds = rows.map(function (item) { return item.id; });
        const ticked = visibleIds.filter(function (id) { return selected.has(id); }).length;
        const all = document.getElementById('notifSelectAll');
        all.checked = ticked > 0 && ticked === visibleIds.length;
        all.indeterminate = ticked > 0 && ticked < visibleIds.length;
        all.disabled = !visibleIds.length;
        document.getElementById('notifSelectBar').hidden = !visibleIds.length;
        const bulk = document.getElementById('notifBulk');
        bulk.hidden = !selected.size;
        document.getElementById('notifBulkCount').textContent = t('notif.selected', { n: selected.size });
    }

    function renderAll() {
        renderBell();
        renderPage();
    }

    // ── Server ────────────────────────────────────────────────

    function csrf() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : '';
    }

    function apply(data) {
        if (!data || !Array.isArray(data.items)) return;
        items = data.items;
        unread = data.unread || 0;
        total = data.total || 0;
        loadedAt = Date.now();
        renderAll();
    }

    function load() {
        return fetch('/api/notifications', { credentials: 'same-origin' })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(apply)
            .catch(function () { /* offline: keep what is shown */ });
    }

    function send(url, body, options) {
        return fetch(url, Object.assign({
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
            body: JSON.stringify(body),
        }, options || {}))
            .then(function (response) {
                if (!response.ok) throw new Error(String(response.status));
                return response.json();
            })
            .then(apply)
            .catch(function () {
                if (window.showAlert) window.showAlert(t('notif.action_failed'), 'error');
                return load();
            });
    }

    function markRead(ids, read) {
        return send('/api/notifications/read', ids === 'all' ? { all: true, read: read } : { ids: ids, read: read });
    }

    function remove(ids) {
        ids.forEach(function (id) { selected.delete(id); });
        return send('/api/notifications/delete', { ids: ids });
    }

    function removeAll() {
        const dialog = window.SafePassDialog;
        const run = function () { selected.clear(); return send('/api/notifications/delete', { all: true }); };
        if (!dialog) return run();
        return dialog.confirm({
            title: function () { return t('notif.delete_all_title'); },
            text: function () { return t('notif.delete_all_text', { n: total }); },
            confirmLabel: function () { return t('notif.delete_all'); },
            danger: true,
        }).then(function (yes) { if (yes) return run(); });
    }

    // Slide a row out, then ask the server
    function leave(row, then) {
        if (!row) return then();
        row.classList.add('is-leaving');
        setTimeout(then, 180);
    }

    // ── Events ────────────────────────────────────────────────

    function onItemClick(event) {
        const open = event.target.closest('[data-notif-open]');
        if (open) {
            // Following a notification marks it read (keepalive: the page is about to change)
            const id = Number(open.dataset.notifOpen);
            const item = items.find(function (it) { return it.id === id; });
            if (item && !item.read) send('/api/notifications/read', { ids: [id], read: true }, { keepalive: true });
            return;
        }
        const button = event.target.closest('[data-notif-item-action]');
        if (!button) return;
        const row = button.closest('.sp-notif-item');
        const id = Number(row.dataset.id);
        const action = button.dataset.notifItemAction;
        if (action === 'delete') leave(row, function () { remove([id]); });
        else markRead([id], action === 'read');
    }

    function onWideAction(event) {
        const button = event.target.closest('[data-notif-action]');
        if (!button) return false;
        if (button.dataset.notifAction === 'read-all') markRead('all', true);
        else removeAll();
        return true;
    }

    function initBell() {
        const dropdown = document.getElementById('spNotifDropdown');
        const button = document.getElementById('spTopbarNotifBtn');
        if (!dropdown || !button) return;
        dropdown.addEventListener('click', function (event) {
            // Rows are redrawn after an action; keep the menu open (app.js closes it on outside clicks)
            event.stopPropagation();
            if (!onWideAction(event)) onItemClick(event);
        });
        button.addEventListener('click', function () {
            setTimeout(function () {
                const open = dropdown.classList.contains('open');
                button.setAttribute('aria-expanded', String(open));
                if (open && Date.now() - loadedAt > REFRESH_AFTER_MS) load();
            }, 0);
        });
    }

    function initPage() {
        const panel = document.querySelector('.notif-panel');
        if (!panel) return;
        panel.addEventListener('click', function (event) {
            const tab = event.target.closest('[data-notif-filter]');
            if (tab) {
                filter = tab.dataset.notifFilter;
                selected.clear();
                renderPage();
                return;
            }
            const bulk = event.target.closest('[data-notif-bulk]');
            if (bulk) {
                const ids = Array.from(selected);
                if (!ids.length) return;
                if (bulk.dataset.notifBulk === 'delete') remove(ids);
                else markRead(ids, bulk.dataset.notifBulk === 'read').then(function () { selected.clear(); renderPage(); });
                return;
            }
            if (onWideAction(event)) return;
            onItemClick(event);
        });
        panel.addEventListener('change', function (event) {
            if (event.target.id === 'notifSelectAll') {
                const rows = filter === 'unread' ? items.filter(function (item) { return !item.read; }) : items;
                rows.forEach(function (item) {
                    if (event.target.checked) selected.add(item.id); else selected.delete(item.id);
                });
                renderPage();
            } else if (event.target.dataset.notifSelect) {
                const id = Number(event.target.dataset.notifSelect);
                if (event.target.checked) selected.add(id); else selected.delete(id);
                renderPage();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.getElementById('spNotifDropdown')) return;
        initBell();
        initPage();
        load();
        window.addEventListener('sp-lang-changed', renderAll);
    });
})();

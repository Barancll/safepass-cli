/**
 * Definitions page: main categories (icon + colour), subcategories (icon) and quick-pick services.
 * Lists are drawn from JSON the server put in the page and redrawn from each API answer.
 * User-typed names are always set with textContent; only the app's own icon markup uses innerHTML.
 */
(function () {
    'use strict';

    function t(key, params) {
        return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
    }

    function readJson(id) {
        const el = document.getElementById(id);
        try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
    }

    let categories = readJson('defsCategoriesData') || [];
    let services = readJson('defsServicesData') || [];
    const icons = readJson('defsIconCatalog') || { line: {}, brand: {} };

    const $ = (id) => document.getElementById(id);
    const catGrid = $('defsCategories');
    const serviceGrid = $('defsServices');
    let activeTab = 'categories';
    const SUB_LIMIT = 4;
    const expanded = new Set();   // main categories showing all their subcategories

    // ── helpers ────────────────────────────────────────────────

    const nameOf = (def) => (def.label_key ? t(def.label_key) : def.name);

    function iconSvg(key, size) {
        size = size || 20;
        if (icons.brand[key]) {
            return `<svg class="sp-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${icons.brand[key]}</svg>`;
        }
        const body = icons.line[key] || icons.line.folder;
        return `<svg class="sp-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
            `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function iconButton(action, label, path) {
        const button = el('button', 'defs-icon-btn');
        button.type = 'button';
        button.dataset.action = action;
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
        return button;
    }

    const EDIT_PATH = '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
    const PAUSE_PATH = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';

    // Pause / resume toggle; pressed = paused
    function pauseButton(item) {
        const key = item.active ? 'vault.pause' : 'vault.resume';
        const button = iconButton('toggle-active', t(key), PAUSE_PATH);
        button.setAttribute('aria-pressed', String(!item.active));
        return button;
    }

    function pausedTag() {
        return el('span', 'defs-paused-tag', t('vault.paused'));
    }

    const DELETE_PATH = '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>';

    function findCategory(id) {
        for (const main of categories) {
            if (main.id === id) return { item: main, parent: null };
            const sub = main.children.find((c) => c.id === id);
            if (sub) return { item: sub, parent: main };
        }
        return null;
    }

    // ── categories ─────────────────────────────────────────────

    function renderCategories() {
        catGrid.textContent = '';
        categories.forEach((main) => {
            const panel = el('article', 'defs-cat' + (main.active ? '' : ' is-paused'));
            panel.style.setProperty('--cat-color', main.color || '#a855f7');
            panel.dataset.id = main.id;

            const head = el('header', 'defs-cat-head');
            const tile = el('span', 'defs-cat-icon');
            tile.innerHTML = iconSvg(main.icon, 22);
            const titleBox = el('div', 'defs-cat-title');
            const heading = el('h2', '', nameOf(main));
            if (!main.active) heading.appendChild(pausedTag());
            titleBox.appendChild(heading);
            titleBox.appendChild(el('p', 'defs-cat-meta', t('defs.meta', { cards: main.count, subs: main.children.length })));
            const actions = el('div', 'defs-actions');
            actions.appendChild(pauseButton(main));
            actions.appendChild(iconButton('edit', t('common.edit'), EDIT_PATH));
            const del = iconButton('delete', t('common.delete'), DELETE_PATH);
            if (!main.deletable) {
                del.disabled = true;
                del.title = t('defs.fallback_locked');
                del.setAttribute('aria-label', t('defs.fallback_locked'));
            }
            actions.appendChild(del);
            head.append(tile, titleBox, actions);
            head.dataset.id = main.id;
            panel.appendChild(head);

            const list = el('ul', 'defs-sub-list');
            const open = expanded.has(main.id);
            main.children.forEach((sub, index) => {
                const row = el('li', 'defs-sub' + (sub.active ? '' : ' is-paused'));
                // Only the first SUB_LIMIT show until the card is opened
                if (index >= SUB_LIMIT && !open) row.hidden = true;
                row.dataset.id = sub.id;
                const subIcon = el('span', 'defs-sub-icon');
                subIcon.innerHTML = iconSvg(sub.icon, 16);
                const subName = el('span', 'defs-sub-name', nameOf(sub));
                if (!sub.active) subName.appendChild(pausedTag());
                const count = el('span', 'defs-sub-count', String(sub.count));
                count.title = t('defs.card_count', { n: sub.count });
                const subActions = el('div', 'defs-actions');
                subActions.appendChild(pauseButton(sub));
                subActions.appendChild(iconButton('edit', t('common.edit'), EDIT_PATH));
                subActions.appendChild(iconButton('delete', t('common.delete'), DELETE_PATH));
                row.append(subIcon, subName, count, subActions);
                list.appendChild(row);
            });
            panel.appendChild(list);

            const extra = main.children.length - SUB_LIMIT;
            if (extra > 0) {
                const more = el('button', 'defs-more');
                more.type = 'button';
                more.dataset.action = 'toggle-subs';
                more.dataset.main = main.id;
                more.setAttribute('aria-expanded', String(open));
                more.textContent = open ? t('defs.show_less') : t('defs.show_more', { n: extra });
                panel.appendChild(more);
            }

            const add = el('button', 'defs-add-sub');
            add.type = 'button';
            add.dataset.action = 'add-sub';
            add.dataset.parent = main.slug;
            add.textContent = '+ ' + t('defs.add_sub');
            panel.appendChild(add);
            catGrid.appendChild(panel);
        });
    }

    catGrid.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (!button || button.disabled) return;
        if (button.dataset.action === 'toggle-subs') {
            const id = Number(button.dataset.main);
            if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
            renderCategories();
            const again = catGrid.querySelector(`[data-action="toggle-subs"][data-main="${id}"]`);
            if (again) again.focus();
            return;
        }
        if (button.dataset.action === 'add-sub') {
            const parent = categories.find((c) => c.slug === button.dataset.parent);
            openEditor({ type: 'sub', parent });
            return;
        }
        const holder = button.closest('[data-id]');
        const found = holder && findCategory(Number(holder.dataset.id));
        if (!found) return;
        const type = found.parent ? 'sub' : 'main';
        if (button.dataset.action === 'toggle-active') {
            setActive(`/api/definitions/categories/${found.item.id}/active`, found.item, nameOf(found.item));
            return;
        }
        if (button.dataset.action === 'edit') openEditor({ type, item: found.item, parent: found.parent });
        if (button.dataset.action === 'delete') deleteCategory(found.item, found.parent);
    });

    async function deleteCategory(item, parent) {
        const name = nameOf(item);
        const lines = [];
        if (!parent && item.children.length) lines.push(t('defs.delete_subs', { n: item.children.length }));
        lines.push(item.count ? t('defs.delete_cards', { n: item.count }) : t('defs.delete_no_cards'));
        lines.push(t('defs.delete_trash_note'));
        const confirmed = await window.SafePassDialog.confirm({
            title: t('defs.delete_title', { name }),
            text: lines.join(' '),
            confirmLabel: t('common.delete'),
            danger: true
        });
        if (!confirmed) return;
        try {
            const data = await window.SafePassSession.post(`/api/definitions/categories/${item.id}/delete`);
            apply(data);
            showAlert(data.moved ? t('defs.deleted_moved', { name, n: data.moved }) : t('defs.deleted', { name }), 'success');
        } catch (error) {
            showAlert(error.message || t('defs.save_failed'), 'error');
        }
    }

    // ── services ───────────────────────────────────────────────

    function categoryPath(sub, main) {
        return main ? `${nameOf(main)} › ${nameOf(sub)}` : '';
    }

    function linkedLabel(service) {
        if (!service.subcategory) return t('defs.no_category');
        for (const main of categories) {
            const sub = main.children.find((c) => c.slug === service.subcategory);
            if (sub) return categoryPath(sub, main);
        }
        return t('defs.no_category');
    }

    // Pause or resume a category / subcategory / service; the answer redraws both lists
    async function setActive(url, item, name) {
        try {
            apply(await window.SafePassSession.post(url, { active: !item.active }));
            showAlert(t(item.active ? 'defs.paused' : 'defs.resumed', { name }), 'success');
        } catch (error) {
            showAlert(error.message || t('defs.save_failed'), 'error');
        }
    }

    function renderServices() {
        serviceGrid.textContent = '';
        if (!services.length) {
            serviceGrid.appendChild(el('p', 'defs-empty', t('defs.no_services')));
            return;
        }
        services.forEach((service) => {
            const tile = el('article', 'defs-service' + (service.active ? '' : ' is-paused'));
            tile.dataset.id = service.id;
            const icon = el('span', 'defs-service-icon');
            icon.innerHTML = iconSvg(service.icon, 28);
            const body = el('div', 'defs-service-body');
            const title = el('h3', '', service.name);
            if (!service.active) title.appendChild(pausedTag());
            body.appendChild(title);
            body.appendChild(el('p', 'defs-service-url', service.url || '—'));
            body.appendChild(el('p', 'defs-service-cat', linkedLabel(service)));
            const actions = el('div', 'defs-actions');
            actions.appendChild(pauseButton(service));
            actions.appendChild(iconButton('edit', t('common.edit'), EDIT_PATH));
            actions.appendChild(iconButton('delete', t('common.delete'), DELETE_PATH));
            tile.append(icon, body, actions);
            serviceGrid.appendChild(tile);
        });
    }

    serviceGrid.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const tile = button.closest('[data-id]');
        const service = tile && services.find((s) => s.id === Number(tile.dataset.id));
        if (!service) return;
        if (button.dataset.action === 'edit') {
            openEditor({ type: 'service', item: service });
            return;
        }
        if (button.dataset.action === 'toggle-active') {
            setActive(`/api/definitions/services/${service.id}/active`, service, service.name);
            return;
        }
        const confirmed = await window.SafePassDialog.confirm({
            title: t('defs.delete_title', { name: service.name }),
            text: t('defs.delete_service_text'),
            confirmLabel: t('common.delete'),
            danger: true
        });
        if (!confirmed) return;
        try {
            apply(await window.SafePassSession.post(`/api/definitions/services/${service.id}/delete`));
            showAlert(t('defs.deleted', { name: service.name }), 'success');
        } catch (error) {
            showAlert(error.message || t('defs.save_failed'), 'error');
        }
    });

    // ── editor ─────────────────────────────────────────────────

    const modal = $('defsModal');
    const form = $('defsForm');
    const nameInput = $('defsName');
    const urlInput = $('defsUrl');
    const serviceCategory = $('defsServiceCategory');
    const iconGrid = $('defsIconGrid');
    const errorBox = $('defsError');
    let editing = null;      // {type, item, parent}
    let chosenIcon = 'folder';
    let chosenColor = '#a855f7';
    let iconSet = 'line';
    let lastFocus = null;

    function renderIconGrid() {
        const set = iconSet === 'brand' ? icons.brand : icons.line;
        iconGrid.textContent = '';
        Object.keys(set).forEach((key) => {
            const option = el('button', 'defs-icon-option');
            option.type = 'button';
            option.setAttribute('role', 'option');
            option.dataset.icon = key;
            option.setAttribute('aria-label', key.replace('brand-', ''));
            option.setAttribute('aria-selected', key === chosenIcon ? 'true' : 'false');
            option.innerHTML = iconSvg(key, 20);
            iconGrid.appendChild(option);
        });
        document.querySelectorAll('#defsIconTabs [data-set]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.set === iconSet ? 'true' : 'false'));
    }

    function renderPreview() {
        const previewIcon = $('defsPreviewIcon');
        previewIcon.innerHTML = iconSvg(chosenIcon, 22);
        const color = editing.type === 'main' ? chosenColor : (editing.parent ? editing.parent.color : '#a855f7');
        $('defsPreview').style.setProperty('--cat-color', color || '#a855f7');
        $('defsPreviewName').textContent = nameInput.value.trim() || (editing.item ? nameOf(editing.item) : t('defs.field_name'));
        document.querySelectorAll('#defsSwatches .defs-swatch[data-color]').forEach((s) => {
            s.setAttribute('aria-pressed', s.dataset.color === chosenColor ? 'true' : 'false');
        });
    }

    function fillServiceCategories(selected) {
        serviceCategory.textContent = '';
        const none = el('option', '', t('defs.no_category'));
        none.value = '';
        serviceCategory.appendChild(none);
        categories.forEach((main) => {
            const group = document.createElement('optgroup');
            group.label = nameOf(main);
            main.children.forEach((sub) => {
                const option = el('option', '', nameOf(sub));
                option.value = sub.slug;
                if (sub.slug === selected) option.selected = true;
                group.appendChild(option);
            });
            if (main.children.length) serviceCategory.appendChild(group);
        });
    }

    function openEditor(options) {
        editing = options;
        const { type, item, parent } = options;
        lastFocus = document.activeElement;
        form.dataset.type = type;
        modal.querySelectorAll('[data-only]').forEach((node) => {
            node.hidden = node.dataset.only !== type;
        });
        const titles = {
            main: item ? 'defs.edit_category' : 'defs.add_category',
            sub: item ? 'defs.edit_sub' : 'defs.add_sub_in',
            service: item ? 'defs.edit_service' : 'defs.add_service'
        };
        $('defsModalTitle').textContent = t(titles[type], { parent: parent ? nameOf(parent) : '' });
        // Built-ins show their translated name; clearing it brings that back
        nameInput.value = item ? (item.label_key ? '' : item.name) : '';
        nameInput.placeholder = item && item.label_key ? nameOf(item) : '';
        $('defsNameHint').hidden = !(item && item.builtin);
        urlInput.value = type === 'service' && item ? item.url : '';
        chosenIcon = item ? item.icon : (type === 'service' ? 'globe' : (type === 'sub' ? 'tag' : 'folder'));
        chosenColor = type === 'main' ? ((item && item.color) || '#a855f7') : '';
        iconSet = icons.brand[chosenIcon] ? 'brand' : 'line';
        if (type === 'service') fillServiceCategories(item ? item.subcategory : '');
        errorBox.hidden = true;
        renderIconGrid();
        renderPreview();
        modal.hidden = false;
        document.body.classList.add('defs-modal-open');
        nameInput.focus();
    }

    function closeEditor() {
        modal.hidden = true;
        document.body.classList.remove('defs-modal-open');
        editing = null;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    modal.addEventListener('click', (event) => {
        if (event.target.closest('[data-close]')) closeEditor();
        const option = event.target.closest('.defs-icon-option');
        if (option) {
            chosenIcon = option.dataset.icon;
            iconGrid.querySelectorAll('.defs-icon-option').forEach((o) => o.setAttribute('aria-selected', o === option ? 'true' : 'false'));
            renderPreview();
        }
        const swatch = event.target.closest('.defs-swatch[data-color]');
        if (swatch) {
            chosenColor = swatch.dataset.color;
            renderPreview();
        }
        const setButton = event.target.closest('#defsIconTabs [data-set]');
        if (setButton) {
            iconSet = setButton.dataset.set;
            renderIconGrid();
        }
    });

    $('defsColorCustom').addEventListener('input', (event) => {
        chosenColor = event.target.value;
        renderPreview();
    });
    nameInput.addEventListener('input', renderPreview);

    document.addEventListener('keydown', (event) => {
        if (modal.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeEditor();
            return;
        }
        if (event.key === 'Tab') {  // keep focus inside the dialog
            const focusable = Array.from(form.querySelectorAll('button, input, select')).filter((n) => !n.disabled && n.offsetParent !== null);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const { type, item, parent } = editing;
        const name = nameInput.value.trim();
        if (!name && !(item && item.builtin)) {
            errorBox.textContent = t('defs.name_required');
            errorBox.hidden = false;
            nameInput.focus();
            return;
        }
        let url;
        let body;
        if (type === 'service') {
            url = item ? `/api/definitions/services/${item.id}` : '/api/definitions/services';
            body = { name, url: urlInput.value.trim(), icon: chosenIcon, subcategory: serviceCategory.value };
        } else {
            url = item ? `/api/definitions/categories/${item.id}` : '/api/definitions/categories';
            body = { name, icon: chosenIcon, color: chosenColor };
            if (!item && type === 'sub') body.parent = parent.slug;
        }
        const save = $('defsSave');
        save.disabled = true;
        try {
            apply(await window.SafePassSession.post(url, body));
            closeEditor();
            showAlert(t('defs.saved'), 'success');
        } catch (error) {
            errorBox.textContent = error.message || t('defs.save_failed');
            errorBox.hidden = false;
        } finally {
            save.disabled = false;
        }
    });

    // ── tabs, header button, refresh ───────────────────────────

    function apply(data) {
        if (data.categories) categories = data.categories;
        if (data.services) services = data.services;
        if (typeof data.trash_count === 'number') {
            const badge = document.getElementById('spTrashBadge');
            if (badge) {
                badge.textContent = data.trash_count;
                badge.hidden = !data.trash_count;
            }
        }
        renderCategories();
        renderServices();
    }

    function selectTab(name, focus) {
        activeTab = name;
        const tabs = { categories: $('defsTabCategories'), services: $('defsTabServices') };
        Object.keys(tabs).forEach((key) => {
            const on = key === name;
            tabs[key].setAttribute('aria-selected', on ? 'true' : 'false');
            tabs[key].tabIndex = on ? 0 : -1;
        });
        catGrid.hidden = name !== 'categories';
        serviceGrid.hidden = name !== 'services';
        const label = $('defsAddLabel');
        label.setAttribute('data-i18n', name === 'categories' ? 'defs.add_category' : 'defs.add_service');
        label.textContent = t(label.getAttribute('data-i18n'));
        if (focus) tabs[name].focus();
    }

    $('defsTabCategories').addEventListener('click', () => selectTab('categories'));
    $('defsTabServices').addEventListener('click', () => selectTab('services'));
    document.querySelector('.defs-tabs').addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            selectTab(activeTab === 'categories' ? 'services' : 'categories', true);
        }
    });
    $('defsAddBtn').addEventListener('click', () => openEditor({ type: activeTab === 'categories' ? 'main' : 'service' }));

    // Names and counts are drawn here, so redraw on language change
    window.addEventListener('sp-lang-changed', () => {
        renderCategories();
        renderServices();
    });

    renderCategories();
    renderServices();
})();

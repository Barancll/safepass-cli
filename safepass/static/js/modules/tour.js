/* Lokki's page tour: the Help button explains the current page, one highlighted area at a time.
   Steps live in TOURS; their words are the i18n keys tour.<page>.<step>.title / .text.
   A step whose target isn't on screen (empty vault, another wizard step…) is left out. */
window.SafePassTour = (function () {
    'use strict';

    const GAP = 14;
    const EDGE = 8;
    const SPOT_PADDING = 6;

    // target: CSS selector (first visible match); up: highlight this ancestor of it instead;
    // no target: the box sits in the middle of the page. mood: Lokki's face (last step: happy).
    const TOURS = {
        dashboard: [
            { id: 'intro' },
            { id: 'stats', target: '.stats-grid', mood: 'thinking' },
            { id: 'score', target: '.score-section' },
            { id: 'categories', target: '.category-section' },
            { id: 'attention', target: '.attention-section', mood: 'worried' },
            { id: 'paused', target: '.paused-section' }
        ],
        passwords: [
            { id: 'intro' },
            { id: 'search', target: '.vault-search' },
            { id: 'filters', target: '.vault-filters' },
            { id: 'row', target: '.vault-list .vault-row', mood: 'shy' },
            { id: 'actions', target: '.vault-list .vault-actions', mood: 'thinking' },
            { id: 'add', target: '.vault-toolbar .btn-primary' }
        ],
        card_add: [
            { id: 'intro' },
            { id: 'steps', target: '.cw-steps' },
            { id: 'services', target: '.cw-services' },
            { id: 'generate', target: '#cwGenerate', up: '.cw-field', mood: 'typing' },
            { id: 'category', target: '#category', up: '.cw-row', mood: 'thinking' },
            { id: 'preview', target: '.cw-preview' },
            { id: 'save', target: '.cw-nav' }
        ],
        card_edit: [
            { id: 'intro' },
            { id: 'password', target: '#password', up: '.cw-field', mood: 'shy' },
            { id: 'category', target: '#category', up: '.cw-row', mood: 'thinking' },
            { id: 'preview', target: '.cw-preview' },
            { id: 'save', target: '.cw-nav' }
        ],
        generator: [
            { id: 'intro' },
            { id: 'result', target: '.gen-result' },
            { id: 'length', target: '.gen-lengths', up: '.gen-field', mood: 'thinking' },
            { id: 'types', target: '.gen-types', up: '.gen-field' },
            { id: 'generate', target: '.gen-submit' },
            { id: 'tips', target: '.gen-tips' }
        ],
        siber_test: [
            { id: 'intro', mood: 'thinking' },
            { id: 'target', target: '.sim-target' },
            { id: 'attacker', target: '.sim-attacker', mood: 'typing' },
            { id: 'defense', target: '.sim-defense' },
            { id: 'outcome', target: '.sim-disclaimer', mood: 'shy' }
        ],
        import_export: [
            { id: 'intro' },
            { id: 'import', target: '#ieImport' },
            { id: 'export', target: '#ieExport', mood: 'worried' },
            { id: 'formats', target: '#ieFormatsBtn' }
        ],
        definitions: [
            { id: 'intro' },
            { id: 'tabs', target: '.defs-tabs' },
            { id: 'category', target: '#defsCategories > *', mood: 'thinking' },
            { id: 'service', target: '#defsServices > *', mood: 'thinking' },
            { id: 'add', target: '#defsAddBtn' }
        ],
        notifications: [
            { id: 'intro' },
            { id: 'tabs', target: '.notif-tabs' },
            { id: 'list', target: '#notifPageList', mood: 'thinking' },
            { id: 'bulk', target: '.notif-toolbar-actions' },
            { id: 'settings', target: '.notif-settings-link' }
        ],
        settings: [
            { id: 'intro' },
            { id: 'session', target: 'section[aria-labelledby="sessionSettingsTitle"]', mood: 'thinking' },
            { id: 'clipboard', target: 'section[aria-labelledby="clipboardSettingsTitle"]' },
            { id: 'age', target: 'section[aria-labelledby="ageSettingsTitle"]' },
            { id: 'updates', target: '#updatesSection' },
            { id: 'recovery', target: '#recoverySection' }
        ],
        profile: [
            { id: 'intro' },
            { id: 'master', target: '#changeMasterBtn', up: '.setting-item', mood: 'thinking' },
            { id: 'danger', target: '.danger-zone', mood: 'worried' },
            { id: 'stats', target: '.stats-grid-mini' }
        ],
        // Once after an update that raises models.WHATS_NEW_VERSION; these are that release's notes
        whatsnew: [
            { id: 'welcome', mood: 'happy' },
            { id: 'help' },
            { id: 'security', mood: 'thinking' },
            { id: 'backup' },
            { id: 'updates', mood: 'thinking' },
            { id: 'recovery_missing', when: () => !hasRecoveryKey(), action: 'recovery.create', mood: 'worried' },
            { id: 'recovery_saved', when: () => hasRecoveryKey() }
        ],
        trash: [
            { id: 'intro' },
            { id: 'empty', target: '#trashEmpty' },
            { id: 'item', target: '#trashList > li', mood: 'thinking' },
            { id: 'definitions', target: '#trashDefsGroup', mood: 'thinking' },
            { id: 'clear', target: '#trashEmptyBtn', mood: 'worried' }
        ]
    };

    const PAGES = {
        '/dashboard': 'dashboard',
        '/passwords': 'passwords',
        '/passwords/add': 'card_add',
        '/generator': 'generator',
        '/siber-test': 'siber_test',
        '/import-export': 'import_export',
        '/definitions': 'definitions',
        '/notifications': 'notifications',
        '/settings': 'settings',
        '/profile': 'profile',
        '/trash': 'trash'
    };

    let root = null;     // the open tour
    let parts = null;
    let page = null;
    let steps = [];
    let index = 0;
    let frame = 0;
    let lastLayout = '';
    let afterClose = null;

    function t(key, params) {
        return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
    }

    function hasRecoveryKey() {
        const meta = document.querySelector('meta[name="sp-has-recovery-key"]');
        return !!meta && meta.content === '1';
    }

    function pageKey() {
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        if (/^\/passwords\/\d+\/edit$/.test(path)) return 'card_edit';
        return PAGES[path] || null;
    }

    function isVisible(el) {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    }

    function findTarget(step) {
        if (!step.target) return null;
        const match = Array.from(document.querySelectorAll(step.target)).find(isVisible);
        if (!match) return null;
        return (step.up && match.closest(step.up)) || match;
    }

    function motionAllowed() {
        return document.documentElement.getAttribute('data-motion') !== 'off'
            && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function isDocked() {
        return window.matchMedia('(max-width: 768px)').matches;
    }

    function topbarBottom() {
        const bar = document.querySelector('.topbar, .sp-topbar');
        return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    }

    // Bring the area into view without sliding it under the topbar or (docked) under the box
    function reveal(el) {
        const rect = el.getBoundingClientRect();
        const top = topbarBottom() + GAP;
        const bottom = window.innerHeight - EDGE - (isDocked() ? parts.pop.offsetHeight + GAP : 0);
        if (rect.top >= top && rect.bottom <= bottom) return;

        const fits = rect.height <= bottom - top;
        const previous = el.style.scrollMarginTop;
        el.style.scrollMarginTop = top + 'px';
        el.scrollIntoView({
            block: fits && !isDocked() ? 'center' : 'start',
            inline: 'nearest',
            // Not 'auto': the page sets scroll-behavior: smooth, which 'auto' would follow
            behavior: motionAllowed() ? 'smooth' : 'instant'
        });
        el.style.scrollMarginTop = previous;
    }

    // Where the box goes around the area: the first side it fits on, else the page corner
    function choosePlacement(rect, width, height) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const across = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE), vw - width - EDGE);
        const along = Math.min(Math.max(rect.top + rect.height / 2 - height / 2, EDGE), vh - height - EDGE);
        const sides = [
            { side: 'bottom', left: across, top: rect.bottom + GAP },
            { side: 'top', left: across, top: rect.top - GAP - height },
            { side: 'right', left: rect.right + GAP, top: along },
            { side: 'left', left: rect.left - GAP - width, top: along }
        ];
        // Checked on all four edges: while the area is off screen a side can look free but isn't
        return sides.find(function (option) {
            return option.left >= EDGE && option.left + width <= vw - EDGE
                && option.top >= EDGE && option.top + height <= vh - EDGE;
        }) || { side: 'none', left: vw - width - EDGE * 2, top: vh - height - EDGE * 2 };
    }

    function placeBox(left, top, side, arrow) {
        parts.pop.style.left = Math.round(left) + 'px';
        parts.pop.style.top = Math.round(top) + 'px';
        parts.pop.setAttribute('data-side', side);
        if (arrow !== undefined) parts.pop.style.setProperty('--sp-tour-arrow', Math.round(arrow) + 'px');
    }

    // Runs every frame while open, so the highlight follows scrolling, resizing and late layout changes
    function layout() {
        const target = findTarget(steps[index]);
        const width = parts.pop.offsetWidth;
        const height = parts.pop.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = target ? target.getBoundingClientRect() : null;
        const signature = [vw, vh, width, height, rect ? [rect.left, rect.top, rect.width, rect.height].join() : ''].join('|');
        if (signature === lastLayout) return;
        lastLayout = signature;

        root.classList.toggle('is-plain', !rect);
        parts.spot.hidden = !rect;
        if (rect) {
            // Clipped to the window: a tall area must not push the border out of sight
            const left = Math.max(rect.left - SPOT_PADDING, EDGE / 2);
            const top = Math.max(rect.top - SPOT_PADDING, EDGE / 2);
            const right = Math.min(rect.right + SPOT_PADDING, vw - EDGE / 2);
            const bottom = Math.min(rect.bottom + SPOT_PADDING, vh - EDGE / 2);
            parts.spot.style.left = left + 'px';
            parts.spot.style.top = top + 'px';
            parts.spot.style.width = Math.max(right - left, 0) + 'px';
            parts.spot.style.height = Math.max(bottom - top, 0) + 'px';
        }

        if (isDocked()) {
            placeBox((vw - width) / 2, vh - height - GAP, 'none');
        } else if (!rect) {
            placeBox((vw - width) / 2, (vh - height) / 2, 'none');
        } else {
            const place = choosePlacement(rect, width, height);
            const horizontal = place.side === 'top' || place.side === 'bottom';
            const offset = horizontal
                ? rect.left + rect.width / 2 - place.left
                : rect.top + rect.height / 2 - place.top;
            const limit = (horizontal ? width : height) - 22;
            placeBox(place.left, place.top, place.side, Math.min(Math.max(offset, 22), limit));
        }
    }

    function loop() {
        if (!root) return;
        layout();
        frame = window.requestAnimationFrame(loop);
    }

    function render() {
        const step = steps[index];
        const prefix = 'tour.' + page + '.' + step.id;
        const last = index === steps.length - 1;

        parts.count.textContent = t('tour.step', { n: index + 1, total: steps.length });
        parts.title.textContent = t(prefix + '.title');
        parts.text.textContent = t(prefix + '.text');
        parts.close.textContent = t('tour.close');
        parts.back.textContent = t('tour.back');
        parts.next.textContent = t(last ? 'tour.done' : 'tour.next');
        parts.back.hidden = index === 0;
        parts.action.hidden = !step.action;
        if (step.action) parts.action.textContent = t(step.action);
        parts.lokki.setAttribute('data-mood', step.mood || (last ? 'happy' : 'idle'));
        lastLayout = '';
    }

    function show(next) {
        index = next;
        render();
        const target = findTarget(steps[index]);
        if (target) reveal(target);
        parts.next.focus({ preventScroll: true });
    }

    function onKeydown(event) {
        // Another dialog (session warning) took over: leave its keys alone
        const active = document.activeElement;
        if (active && active !== document.body && !root.contains(active)) return;

        // Page shortcuts ("/" for search…) stay off while the tour is open
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            if (index < steps.length - 1) show(index + 1);
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            if (index > 0) show(index - 1);
        } else if (event.key === 'Tab') {
            const stops = Array.from(parts.pop.querySelectorAll('button')).filter(function (button) { return !button.hidden; });
            const position = stops.indexOf(active);
            event.preventDefault();
            stops[(position + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
        }
    }

    function close() {
        if (!root) return;
        window.cancelAnimationFrame(frame);
        document.removeEventListener('keydown', onKeydown, true);
        window.removeEventListener('sp-lang-changed', render);
        root.remove();
        root = null;
        parts = null;
        if (afterClose) afterClose();
        afterClose = null;
        const button = document.getElementById('spHelpBtn');
        if (button) button.focus({ preventScroll: true });
    }

    function start(name, onClose) {
        const template = document.getElementById('spTourTemplate');
        const key = typeof name === 'string' ? name : pageKey();
        if (root || !template || !key) return false;
        page = key;
        afterClose = onClose || null;
        steps = TOURS[page].filter(function (step) {
            return (!step.target || findTarget(step)) && (!step.when || step.when());
        });

        root = template.content.firstElementChild.cloneNode(true);
        parts = {
            spot: root.querySelector('.sp-tour-spot'),
            pop: root.querySelector('.sp-tour-pop'),
            lokki: root.querySelector('.lokki'),
            count: root.querySelector('.sp-tour-count'),
            title: root.querySelector('.sp-tour-title'),
            text: root.querySelector('.sp-tour-text'),
            close: root.querySelector('.sp-tour-close'),
            back: root.querySelector('.sp-tour-back'),
            next: root.querySelector('.sp-tour-next'),
            action: root.querySelector('.sp-tour-action')
        };
        parts.action.addEventListener('click', runAction);
        parts.close.addEventListener('click', close);
        parts.back.addEventListener('click', function () { show(index - 1); });
        parts.next.addEventListener('click', function () {
            if (index < steps.length - 1) show(index + 1);
            else close();
        });

        document.body.appendChild(root);
        document.addEventListener('keydown', onKeydown, true);
        window.addEventListener('sp-lang-changed', render);
        show(0);
        loop();
        return true;
    }

    // The "what's new" key step: once made, the step turns into the "keep it safe" one
    async function runAction() {
        if (!(await window.SafePassRecovery.create(false)) || !root) return;
        const meta = document.querySelector('meta[name="sp-has-recovery-key"]');
        if (meta) meta.content = '1';
        steps[index] = TOURS.whatsnew.find(function (step) { return step.id === 'recovery_saved'; });
        show(index);
    }

    function showWhatsNew() {
        if (!document.querySelector('meta[name="sp-whats-new"]')) return;
        start('whatsnew', function () {
            // Closed early or finished: either way it isn't shown again
            fetch('/api/profile/whats-new-seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
        });
    }

    function init() {
        showWhatsNew();
        const button = document.getElementById('spHelpBtn');
        if (!button || !pageKey()) return;
        button.closest('li').hidden = false;
        button.addEventListener('click', function (event) {
            event.preventDefault();
            start();
        });
        // It's a link only to share the menu's look: Space has to work like on a button
        button.addEventListener('keydown', function (event) {
            if (event.key === ' ') {
                event.preventDefault();
                start();
            }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return { start: start, close: close };
})();

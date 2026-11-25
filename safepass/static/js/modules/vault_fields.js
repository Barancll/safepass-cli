/* Private card fields (title, username, web address, notes) are never written into a page's HTML.
 * A page opens with the session cookie alone, and browsers send cookies to every port of this
 * host, so another program on the computer could replay it. Pages carry empty placeholders:
 *   <span data-sp-card="12" data-sp-field="app_name"></span>   (also inputs, textareas and links)
 * and this module fills them from /api/vault/fields, which needs the session's API key (app.js),
 * always as text. data-sp-if="<field>" on a wrapper hides it while that field is empty;
 * data-sp-wait keeps a control disabled until the fields are in, so a form can't be saved half-filled.
 * window.SafePassVault.ready resolves once everything is filled. */
(function () {
    'use strict';

    const CHUNK = 200;  // ids per request (the server's limit)
    const nodes = Array.prototype.slice.call(document.querySelectorAll('[data-sp-card][data-sp-field]'));

    function valueFor(card, field) {
        if (field === 'initial') return (card.app_name || '').slice(0, 1).toLocaleUpperCase();
        return card[field] || '';
    }

    function fill(node, card) {
        const field = node.dataset.spField;
        const value = valueFor(card, field);
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
            node.value = value;
            node.defaultValue = value;
            node.dispatchEvent(new Event('input', { bubbles: true }));  // live preview, strength meter
        } else {
            node.textContent = value;
            if (node.tagName === 'A') {
                if (/^https?:\/\//i.test(value)) node.href = value;
                else node.removeAttribute('href');  // only http(s) addresses become links
            }
        }
        const holder = node.closest('[data-sp-if]');
        if (holder && holder.dataset.spIf === field) holder.hidden = !value;
    }

    async function load() {
        const ids = Array.from(new Set(nodes.map(function (node) { return node.dataset.spCard; })));
        const fields = {};
        for (let i = 0; i < ids.length; i += CHUNK) {
            const response = await fetch('/api/vault/fields?ids=' + ids.slice(i, i + CHUNK).join(','));
            if (!response.ok) return false;  // 401: app.js takes the user to the sign-in page
            const data = await response.json();
            Object.assign(fields, data.fields || {});
        }
        nodes.forEach(function (node) { fill(node, fields[node.dataset.spCard] || {}); });
        document.querySelectorAll('[data-sp-wait]').forEach(function (control) {
            control.disabled = false;
            control.removeAttribute('data-sp-wait');
        });
        return true;
    }

    window.SafePassVault = { ready: nodes.length ? load().catch(function () { return false; }) : Promise.resolve(true) };
})();

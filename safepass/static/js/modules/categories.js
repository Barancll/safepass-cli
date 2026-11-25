/**
 * The user's category definitions on pages with a category picker.
 * Reads the tree the server put in <script id="spCategoryTree">; names of untouched
 * built-ins come from i18n (label_key), the rest are the user's own text.
 */
window.SafePassCategories = (function () {
    'use strict';

    let tree = [];
    try {
        const el = document.getElementById('spCategoryTree');
        tree = el ? JSON.parse(el.textContent) : [];
    } catch (e) {
        tree = [];
    }

    function t(key) {
        return window.SafePassI18n ? window.SafePassI18n.t(key) : key;
    }

    function setName(el, def) {
        if (def.label_key) {
            el.setAttribute('data-i18n', def.label_key);
            el.textContent = t(def.label_key);
        } else {
            el.removeAttribute('data-i18n');
            el.textContent = def.name;
        }
    }

    function subsOf(mainSlug) {
        const main = tree.find((m) => m.slug === mainSlug);
        return main ? main.children : [];
    }

    // Fill a <select> with the subcategories of one main category
    function fillSubSelect(select, mainSlug, selected) {
        if (!select) return;
        select.textContent = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.setAttribute('data-i18n', 'form.select');
        placeholder.textContent = t('form.select');
        select.appendChild(placeholder);
        let found = !selected;
        subsOf(mainSlug).forEach((sub) => {
            const option = document.createElement('option');
            option.value = sub.slug;
            setName(option, sub);
            if (sub.slug === selected) {
                option.selected = true;
                found = true;
            }
            select.appendChild(option);
        });
        // A card can point at a subcategory that no longer exists: keep it rather than drop it silently
        if (!found) {
            const option = document.createElement('option');
            option.value = selected;
            option.textContent = selected;
            option.selected = true;
            select.appendChild(option);
        }
    }

    return { tree, subsOf, fillSubSelect, setName };
})();

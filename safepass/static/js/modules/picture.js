/* SafePass - Security picture (safepass/pictures.py): "<shape>:<colour>", chosen with
   templates/partials/picture_picker.html and shown under the user name on the login page. */

window.SafePassPicture = (function () {
    'use strict';

    const PATTERN = /^([a-z]+):([a-z]+)$/;

    function parse(value) {
        const match = PATTERN.exec(value || '');
        return match ? { shape: match[1], color: match[2] } : null;
    }

    // The picker's own buttons hold the drawings and colours, so the set lives in one place (pictures.py)
    function parts(value, scope) {
        const picture = parse(value);
        if (!picture) return null;
        const root = scope || document;
        const shape = root.querySelector('.sp-picture-shape[data-shape="' + picture.shape + '"] svg');
        const color = root.querySelector('.sp-picture-color[data-color="' + picture.color + '"]');
        if (!shape || !color) return null;
        return { svg: shape, hex: color.style.getPropertyValue('--swatch').trim(), shape: picture.shape, color: picture.color };
    }

    // Draw the picture into `target` (emptied first); false if there is none
    function draw(target, value, scope) {
        target.textContent = '';
        const found = parts(value, scope);
        if (!found) return false;
        target.appendChild(found.svg.cloneNode(true));
        target.style.color = found.hex;
        return true;
    }

    // Wire a picker up; returns { value(), set(value) }. onChange(value) runs after every pick.
    function mount(picker, initial, onChange) {
        let shape = null;
        let color = null;
        const preview = picker.querySelector('[data-picture-preview]');

        const select = function (selector, attribute, chosen) {
            picker.querySelectorAll(selector).forEach(function (button) {
                const on = button.getAttribute(attribute) === chosen;
                button.classList.toggle('is-selected', on);
                button.setAttribute('aria-checked', String(on));
                button.tabIndex = on || (!chosen && button === picker.querySelector(selector)) ? 0 : -1;
            });
        };
        const value = function () { return shape && color ? shape + ':' + color : ''; };
        const render = function () {
            select('.sp-picture-shape', 'data-shape', shape);
            select('.sp-picture-color', 'data-color', color);
            const colorButton = color && picker.querySelector('.sp-picture-color[data-color="' + color + '"]');
            picker.style.setProperty('--picked', colorButton ? colorButton.style.getPropertyValue('--swatch').trim() : 'currentColor');
            if (preview) {
                const full = value();
                if (!(full && draw(preview, full, picker))) {
                    preview.textContent = '';
                    preview.style.color = '';
                }
                preview.classList.toggle('is-empty', !full);
            }
        };
        const set = function (next) {
            const picture = parse(next);
            shape = picture ? picture.shape : null;
            color = picture ? picture.color : null;
            render();
        };

        picker.addEventListener('click', function (event) {
            const shapeButton = event.target.closest('.sp-picture-shape');
            const colorButton = event.target.closest('.sp-picture-color');
            if (shapeButton) shape = shapeButton.getAttribute('data-shape');
            else if (colorButton) color = colorButton.getAttribute('data-color');
            else return;
            render();
            if (onChange) onChange(value());
        });

        // Arrow keys move within a group, as in any radio group
        picker.addEventListener('keydown', function (event) {
            const button = event.target.closest('.sp-picture-shape, .sp-picture-color');
            if (!button || ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].indexOf(event.key) === -1) return;
            event.preventDefault();
            const group = Array.prototype.slice.call(button.parentElement.children);
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            const next = group[(group.indexOf(button) + step + group.length) % group.length];
            next.focus();
            next.click();
        });

        set(initial);
        return { value: value, set: set };
    }

    return { parse: parse, draw: draw, mount: mount };
})();

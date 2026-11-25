/**
 * Edit form. Strength meter, preview, Lokki, show/hide and Generate live in card_preview.js.
 */

function t(key, params) {
    return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
}

// Subcategories come from the user's definitions (modules/categories.js)
function updateSubcategoryOptions(categoryValue, selectedSubcategory = '') {
    window.SafePassCategories.fillSubSelect(document.getElementById('subcategory'), categoryValue, selectedSubcategory);
    window.SafePassCardForm.updatePreview();
}

document.addEventListener('DOMContentLoaded', () => {
    const editCardForm = document.getElementById('editCardForm');
    if (!editCardForm) return;
    const categorySelect = document.getElementById('category');
    const subcategorySelect = document.getElementById('subcategory');

    // Empty password on the edit form means "keep the current one"
    window.SafePassCardForm.init({ emptyKey: 'form.password_kept', sayKey: 'wizard.say_edit', fetchCurrent: true });

    categorySelect.addEventListener('change', function () { updateSubcategoryOptions(this.value); });
    updateSubcategoryOptions(categorySelect.value, subcategorySelect.dataset.initial || '');

    editCardForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const cardId = document.getElementById('cardId').value;
        const formData = {
            app_name: document.getElementById('title').value.trim(),
            username: document.getElementById('username').value.trim(),
            password: document.getElementById('password').value,
            url: document.getElementById('url').value.trim(),
            notes: document.getElementById('notes').value.trim(),
            category: categorySelect.value || 'genel',
            subcategory: subcategorySelect.value || ''
        };

        if (!formData.app_name) {
            document.getElementById('title').focus();
            window.showAlert(t('form.title_required'), 'error');
            return;
        }

        // Empty = keep the current password (the server leaves it unchanged); no minimum length,
        // vault entries include PINs and short codes
        try {
            const response = await fetch(`/api/passwords/${cardId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': window.getCookie('csrftoken') },
                body: JSON.stringify(formData)
            });
            const data = await response.json().catch(() => ({}));

            if (data.success) {
                editCardForm.reset(); // Back must not bring typed values back
                window.SafePassCardForm.say('happy', 'wizard.say_saved');
                window.showAlert(t('form.saved'), 'success');
                setTimeout(() => { window.location.href = '/passwords'; }, 1000);
            } else {
                window.showAlert(window.SafePassI18n.serverText(data) || t('form.save_failed'), 'error');
            }
        } catch (error) {
            window.showAlert(t('common.error_generic'), 'error');
        }
    });
});

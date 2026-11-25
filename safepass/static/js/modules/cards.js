/* SafePass - My Passwords: a compact list of the vault (filter chips, search, reveal / copy, details) */

const REVEAL_MS = 30000;

const vaultState = { main: '', sub: '' };

function t(key, fallback) {
    return window.SafePassI18n ? window.SafePassI18n.t(key) : fallback;
}

// The tree the server put in <script id="spCategoryTree">
function categoryTree() {
    if (!categoryTree.cache) {
        try {
            categoryTree.cache = JSON.parse(document.getElementById('spCategoryTree').textContent);
        } catch (e) {
            categoryTree.cache = [];
        }
    }
    return categoryTree.cache;
}

document.addEventListener('DOMContentLoaded', function () {
    const list = document.getElementById('vaultList');
    const search = document.getElementById('vaultSearch');
    if (!list) return;

    document.querySelectorAll('.vault-filters .vault-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            vaultState.main = chip.dataset.filter;
            vaultState.sub = '';
            document.querySelectorAll('.vault-filters .vault-chip').forEach(function (other) {
                other.setAttribute('aria-pressed', String(other === chip));
            });
            renderSubfilters();
            applyFilter();
        });
    });

    if (search) {
        search.addEventListener('input', applyFilter);
        search.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && search.value) {
                event.stopPropagation();
                search.value = '';
                applyFilter();
            }
        });
        // "/" jumps to the search box from anywhere on the page
        document.addEventListener('keydown', function (event) {
            const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
            if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                search.focus();
            }
        });
    }

    const clear = document.getElementById('vaultClear');
    if (clear) {
        clear.addEventListener('click', function () {
            if (search) search.value = '';
            const all = document.querySelector('.vault-filters .vault-chip[data-filter=""]');
            if (all) all.click(); else applyFilter();
        });
    }

    list.addEventListener('click', function (event) {
        const toggle = event.target.closest('.vault-row-toggle');
        if (toggle) {
            toggleDetails(toggle);
            return;
        }
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const row = button.closest('.vault-row');
        const action = button.dataset.action;
        if (action === 'reveal') togglePassword(row, button);
        else if (action === 'copy') copyCardPassword(row, button);
        else if (action === 'history') showPasswordHistory(row.dataset.id);
        else if (action === 'delete') deleteCard(row);
        else if (action === 'toggle-active') toggleActive(row, button);
    });

    window.addEventListener('sp-lang-changed', renderSubfilters);
    document.querySelectorAll('.vault-row').forEach(function (row) {
        setToggleLabel(row, row.querySelector('[data-action="toggle-active"]'));
    });
    updateCounts();
});

// ── filtering ─────────────────────────────────────────────────

function renderSubfilters() {
    const box = document.getElementById('vaultSubfilters');
    if (!box) return;
    box.textContent = '';
    const main = categoryTree().find(function (m) { return m.slug === vaultState.main; });
    // Only subcategories that actually hold a card are offered
    const used = new Set(Array.from(document.querySelectorAll('.vault-row')).map(function (row) { return row.dataset.subcategory; }));
    const subs = main ? main.children.filter(function (sub) { return used.has(sub.slug); }) : [];
    box.hidden = subs.length === 0;
    if (!subs.length) return;

    box.style.setProperty('--cat-color', main.color || '');
    [{ slug: '', label_key: 'passwords.category_all', name: '' }].concat(subs).forEach(function (sub) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'vault-chip vault-chip-sub';
        chip.setAttribute('aria-pressed', String(sub.slug === vaultState.sub));
        chip.textContent = sub.label_key ? t(sub.label_key, sub.name) : sub.name;
        chip.addEventListener('click', function () {
            vaultState.sub = sub.slug;
            box.querySelectorAll('.vault-chip').forEach(function (other) {
                other.setAttribute('aria-pressed', String(other === chip));
            });
            applyFilter();
        });
        box.appendChild(chip);
    });
}

function applyFilter() {
    const term = (document.getElementById('vaultSearch')?.value || '').trim().toLocaleLowerCase();
    const groups = {};
    categoryTree().forEach(function (main) {
        groups[main.slug] = [main.slug].concat(main.children.map(function (sub) { return sub.slug; }));
    });

    let shown = 0;
    document.querySelectorAll('.vault-row').forEach(function (row) {
        const title = row.querySelector('.vault-title').textContent.toLocaleLowerCase();
        const user = row.querySelector('.vault-user').textContent.toLocaleLowerCase();
        const category = row.dataset.category;
        const sub = row.dataset.subcategory;

        let matches = !term || title.includes(term) || user.includes(term);
        if (matches && vaultState.main === '__paused') {
            matches = row.dataset.active === '0';
        } else if (matches && vaultState.sub) {
            matches = sub === vaultState.sub;
        } else if (matches && vaultState.main) {
            const group = groups[vaultState.main] || [vaultState.main];
            matches = group.includes(category) || group.includes(sub);
        }
        row.hidden = !matches;
        if (matches) shown += 1;
    });

    const total = document.querySelectorAll('.vault-row').length;
    document.getElementById('vaultList').hidden = total > 0 && shown === 0;
    const noResults = document.getElementById('vaultNoResults');
    if (noResults) noResults.hidden = total === 0 || shown > 0;
}

// ── a row: details, reveal, copy, delete ──────────────────────

function toggleDetails(toggle) {
    const details = document.getElementById(toggle.getAttribute('aria-controls'));
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.closest('.vault-row').classList.toggle('is-open', open);
    details.hidden = !open;
}

// Passwords are not in the page HTML; fetch one only when it is revealed or copied
async function fetchCardPassword(row) {
    const response = await fetch(`/api/passwords/${row.dataset.id}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Request failed');
    const data = await response.json();
    return data.card.password;
}

function setRevealLabel(button, shown) {
    const key = shown ? 'auth.password_hide' : 'auth.password_show';
    const label = t(key, shown ? 'Şifreyi gizle' : 'Şifreyi göster');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('data-i18n-title', key);
    button.setAttribute('data-i18n-aria-label', key);
    button.setAttribute('aria-pressed', String(shown));
}

function hidePassword(row) {
    const secret = row.querySelector('.vault-secret');
    const plain = secret.querySelector('.vault-plain');
    clearTimeout(secret._hideTimer);
    plain.textContent = ''; // drop the plaintext from the DOM
    plain.hidden = true;
    secret.querySelector('.vault-dots').hidden = false;
    secret.classList.remove('is-shown');
    setRevealLabel(secret.querySelector('[data-action="reveal"]'), false);
}

async function togglePassword(row, button) {
    const secret = row.querySelector('.vault-secret');
    if (secret.classList.contains('is-shown')) {
        hidePassword(row);
        return;
    }
    try {
        const plain = secret.querySelector('.vault-plain');
        plain.textContent = await fetchCardPassword(row);
        plain.hidden = false;
        secret.querySelector('.vault-dots').hidden = true;
        secret.classList.add('is-shown');
        setRevealLabel(button, true);
        // Re-hide automatically so a revealed password is not left on screen
        secret._hideTimer = setTimeout(function () { hidePassword(row); }, REVEAL_MS);
    } catch (error) {
        showToast(t('passwords.load_failed', 'Şifre alınamadı'), 'error');
    }
}

async function copyPassword(password) {
    try {
        await window.SafePassClipboard.copy(password);
        showToast(window.SafePassClipboard.copiedMessage(), 'success');
        return true;
    } catch (error) {
        showToast(t('clipboard.failed', 'Kopyalama başarısız'), 'error');
        return false;
    }
}

async function copyCardPassword(row, button) {
    let password;
    try {
        password = await fetchCardPassword(row);
    } catch (error) {
        showToast(t('passwords.load_failed', 'Şifre alınamadı'), 'error');
        return;
    }
    if (await copyPassword(password)) {
        // A short tick on the button shows which row was copied
        button.classList.add('is-done');
        setTimeout(function () { button.classList.remove('is-done'); }, 1200);
    }
}

// Deleting moves the card to the trash (restorable for 7 days), so no confirmation
async function deleteCard(row) {
    try {
        const response = await fetch(`/api/passwords/${row.dataset.id}/delete`, { method: 'DELETE' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            showToast(t('trash.action_failed', 'İşlem tamamlanamadı. Tekrar deneyin.'), 'error');
            return;
        }
        row.remove();
        updateCounts();
        applyFilter();
        const badge = document.getElementById('spTrashBadge');
        if (badge && typeof data.trash_count === 'number') {
            badge.textContent = data.trash_count;
            badge.hidden = !data.trash_count;
        }
        showToast(t('trash.moved', 'Çöp kutusuna taşındı. 7 gün içinde geri yükleyebilirsiniz.'), 'success');
        if (!document.querySelector('.vault-row')) window.location.reload(); // show the empty state
    } catch (error) {
        showToast(t('trash.action_failed', 'İşlem tamamlanamadı. Tekrar deneyin.'), 'error');
    }
}

// ── pause / resume ────────────────────────────────────────────

function setToggleLabel(row, button) {
    const paused = row.dataset.active === '0';
    const key = paused ? 'vault.resume' : 'vault.pause';
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('data-i18n-title', key);
    button.setAttribute('data-i18n-aria-label', key);
    button.title = t(key, paused ? 'Aktif et' : 'Pasife al');
    button.setAttribute('aria-label', button.title);
}

async function toggleActive(row, button) {
    const active = row.dataset.active === '0';  // paused now → resume
    try {
        const data = await window.SafePassSession.post(`/api/passwords/${row.dataset.id}/active`, { active });
        row.dataset.active = data.active ? '1' : '0';
        row.classList.toggle('is-paused', !data.active);
        setToggleLabel(row, button);
        updateCounts();
        applyFilter();
        showToast(t(data.active ? 'vault.resumed' : 'vault.paused_toast'), 'success');
    } catch (error) {
        showToast(error.message || t('trash.action_failed', 'İşlem tamamlanamadı. Tekrar deneyin.'), 'error');
    }
}

// Chip counts after a delete or a pause
function updateCounts() {
    const rows = Array.from(document.querySelectorAll('.vault-row'));
    const groups = {};
    categoryTree().forEach(function (main) {
        groups[main.slug] = [main.slug].concat(main.children.map(function (sub) { return sub.slug; }));
    });
    document.querySelectorAll('.vault-filters .vault-chip').forEach(function (chip) {
        const slug = chip.dataset.filter;
        if (slug === '__paused') {
            const paused = rows.filter(function (row) { return row.dataset.active === '0'; }).length;
            chip.querySelector('.vault-chip-count').textContent = paused;
            chip.hidden = paused === 0 && vaultState.main !== '__paused';
            return;
        }
        const n = slug ? rows.filter(function (row) {
            const group = groups[slug] || [slug];
            return group.includes(row.dataset.category) || group.includes(row.dataset.subcategory);
        }).length : rows.length;
        chip.querySelector('.vault-chip-count').textContent = n;
        chip.hidden = Boolean(slug) && n === 0;
    });
}

// ── password history modal ─────────────────────────────────────

const HISTORY_REVEAL_MS = 30000;
const HISTORY_MASK = '••••••••';

function hideHistoryPassword(item) {
    clearTimeout(item.hideTimer);
    item.querySelector('.password-text').textContent = HISTORY_MASK;
    const eye = item.querySelector('.btn-reveal-history');
    eye.title = t('auth.password_show', 'Şifreyi göster');
    eye.setAttribute('aria-label', eye.title);
    eye.setAttribute('aria-pressed', 'false');
}

function closePasswordHistory() {
    const modal = document.getElementById('history-modal');
    if (!modal) return;
    modal.style.display = 'none';
    // Old passwords do not stay in the page
    const list = document.getElementById('history-list');
    list.querySelectorAll('.history-item').forEach((item) => clearTimeout(item.hideTimer));
    list.innerHTML = '';
}

async function showPasswordHistory(cardId) {
    const modal = document.getElementById('history-modal');
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');
    const historyEmptyText = document.getElementById('history-empty-text');

    modal.style.display = 'flex';
    historyList.innerHTML = '';
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.setAttribute('data-i18n', 'common.loading');
    loading.textContent = t('common.loading', 'Yükleniyor...');
    historyList.appendChild(loading);
    historyEmpty.style.display = 'none';
    historyEmptyText.setAttribute('data-i18n', 'history.empty');
    historyEmptyText.textContent = t('history.empty', 'Henüz şifre geçmişi yok');

    try {
        const response = await fetch(`/api/passwords/${cardId}/history`);
        const data = await response.json();

        if (data.success && data.history.length > 0) {
            historyList.innerHTML = '';
            data.history.forEach((item, index) => {
                // Static markup only; passwords and dates are set as text (never parsed as HTML)
                const historyItem = document.createElement('div');
                historyItem.className = 'history-item';
                historyItem.innerHTML = `
                    <div class="history-info">
                        <span class="history-number"></span>
                        <span class="history-date"></span>
                    </div>
                    <div class="history-password">
                        <span class="password-text"></span>
                        <button type="button" class="btn-icon btn-reveal-history">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                        <button type="button" class="btn-icon btn-copy-history" data-i18n-title="card.copy" data-i18n-aria-label="card.copy">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                `;
                historyItem.querySelector('.history-number').textContent = `#${index + 1}`;
                historyItem.querySelector('.history-date').textContent = item.changed_at;
                hideHistoryPassword(historyItem);
                historyItem.querySelector('.btn-reveal-history').addEventListener('click', (event) => {
                    const eye = event.currentTarget;
                    if (eye.getAttribute('aria-pressed') === 'true') {
                        hideHistoryPassword(historyItem);
                        return;
                    }
                    historyItem.querySelector('.password-text').textContent = item.password;
                    eye.title = t('auth.password_hide', 'Şifreyi gizle');
                    eye.setAttribute('aria-label', eye.title);
                    eye.setAttribute('aria-pressed', 'true');
                    clearTimeout(historyItem.hideTimer);
                    historyItem.hideTimer = setTimeout(() => hideHistoryPassword(historyItem), HISTORY_REVEAL_MS);
                });
                const copyBtn = historyItem.querySelector('.btn-copy-history');
                copyBtn.title = t('card.copy', 'Kopyala');
                copyBtn.setAttribute('aria-label', copyBtn.title);
                copyBtn.addEventListener('click', () => copyPassword(item.password));
                historyList.appendChild(historyItem);
            });
        } else {
            historyList.innerHTML = '';
            historyEmpty.style.display = 'block';
        }
    } catch (error) {
        historyList.innerHTML = '';
        historyEmptyText.setAttribute('data-i18n', 'history.load_failed');
        historyEmptyText.textContent = t('history.load_failed', 'Geçmiş yüklenemedi');
        historyEmpty.style.display = 'block';
    }
}

document.addEventListener('click', function (e) {
    const modal = document.getElementById('history-modal');
    if (modal && (e.target === modal || e.target.closest('.modal-close'))) closePasswordHistory();
});

document.addEventListener('keydown', function (e) {
    const modal = document.getElementById('history-modal');
    if (e.key === 'Escape' && modal && modal.style.display === 'flex') closePasswordHistory();
});

// The shared toast (app.js / alerts.css) sits under the topbar instead of over it
function showToast(message, type = 'info') {
    window.showAlert(message, type);
}

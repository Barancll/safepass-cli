// Import / Export. One drop zone takes a CSV from another app or a SafePass .json backup;
// Lokki (between the two panels) is glad when passwords come in and sad when they leave (from the first hover on Export).
// showNotification is available globally via window.showNotification

const stage = document.querySelector('.ie-stage');
const importPanel = document.getElementById('ieImport');
const exportPanel = document.getElementById('ieExport');
const dropZone = document.getElementById('file-upload-area');
const fileInput = document.getElementById('csv-file-input');
const fileInfo = document.getElementById('file-info');
const fileKind = document.getElementById('file-kind');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const removeFileBtn = document.getElementById('remove-file-btn');
const importBtn = document.getElementById('import-btn');
const importProgress = document.getElementById('import-progress');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const importResult = document.getElementById('import-result');
const exportBtn = document.getElementById('export-btn');
const includeMetadata = document.getElementById('include-metadata');

let selectedFile = null;

function t(key, params) {
    return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
}

// An error whose text is rebuilt in the current language
class LocalizedError extends Error {
    constructor(render) {
        super(render());
        this.render = render;
    }
}
const renderOf = (error) => error.render || (() => error.message);
const serverError = (result, fallbackKey) => new LocalizedError(() => window.SafePassI18n.serverText(result) || t(fallbackKey));

// Text that is re-rendered when the language changes
function setLocalizedText(el, render) {
    el.removeAttribute('data-i18n');
    el._build = null;
    el._render = render;
    el.textContent = render();
}
window.addEventListener('sp-lang-changed', () => {
    [importResult, progressText, document.getElementById('ieSay')].forEach((el) => {
        if (el && el._build) el._build();
        else if (el && el._render) el.textContent = el._render();
    });
});

// ── Lokki ─────────────────────────────────────────────────────

const lokki = {
    el: document.querySelector('.ie-lokki .lokki'),
    say: document.getElementById('ieSay'),
    holdUntil: 0,   // a result (imported, exported, error) stays on screen for a while
    restTimer: null,

    show(mood, key, params, holdMs) {
        clearTimeout(this.restTimer);
        if (this.el) {
            this.el.setAttribute('data-mood', mood);
            // Replay the hop each time he is glad again
            if (mood === 'happy') { this.el.classList.remove('is-hopping'); void this.el.getBBox(); this.el.classList.add('is-hopping'); }
        }
        setLocalizedText(this.say, () => t(key, params));
        this.holdUntil = holdMs ? Date.now() + holdMs : 0;
        if (holdMs) this.restTimer = setTimeout(() => this.rest(), holdMs);
    },

    // Hover reactions don't interrupt a result that is still showing
    hover(mood, key, side) {
        if (Date.now() < this.holdUntil || busy) return;
        stage.dataset.active = side;
        this.show(mood, key);
    },

    // The file types he understands, as a short list in his bubble (text nodes only)
    explainFormats(introKey) {
        const formats = [
            ['ie.safepass_backup', null, 'ie.safepass_backup_text'],
            ['ie.safepass_json', null, 'ie.safepass_json_text'],
            ['ie.keepass_format', 'Group,Subcategory,Title,Username,Password,URL'],
            ['ie.safepass_format', 'title,username,password,website,category,subcategory']
        ];
        const build = () => {
            this.say.textContent = '';
            this.say.appendChild(document.createTextNode(t(introKey)));
            const list = document.createElement('dl');
            list.className = 'ie-say-list';
            formats.forEach(([nameKey, columns, textKey]) => {
                const dt = document.createElement('dt');
                dt.textContent = t(nameKey);
                const dd = document.createElement('dd');
                if (columns) {
                    const code = document.createElement('code');
                    code.textContent = columns;
                    dd.appendChild(code);
                } else {
                    dd.textContent = t(textKey);
                }
                list.append(dt, dd);
            });
            this.say.appendChild(list);
        };
        clearTimeout(this.restTimer);
        if (this.el) this.el.setAttribute('data-mood', 'thinking');
        stage.dataset.active = 'import';
        this.say.removeAttribute('data-i18n');
        this.say._render = null;
        this.say._build = build;
        build();
        this.holdUntil = Date.now() + 12000;
        this.restTimer = setTimeout(() => this.rest(), 12000);
    },

    rest() {
        if (busy) return;
        delete stage.dataset.active;
        this.show('idle', 'ie.say_idle');
    },

    leave() {
        if (Date.now() < this.holdUntil || busy) return;
        clearTimeout(this.restTimer);
        this.restTimer = setTimeout(() => this.rest(), 900);
    }
};

let busy = false;

importPanel.addEventListener('pointerenter', () => lokki.hover('happy', selectedFile ? 'ie.say_file' : 'ie.say_import', 'import'));
importPanel.addEventListener('focusin', () => lokki.hover('happy', selectedFile ? 'ie.say_file' : 'ie.say_import', 'import'));
exportPanel.addEventListener('pointerenter', () => lokki.hover('sad', 'ie.say_export', 'export'));
exportPanel.addEventListener('focusin', () => lokki.hover('sad', 'ie.say_export', 'export'));
[importPanel, exportPanel].forEach((panel) => {
    panel.addEventListener('pointerleave', () => lokki.leave());
    panel.addEventListener('focusout', (event) => {
        if (!panel.contains(event.relatedTarget)) lokki.leave();
    });
});

// ── choosing a file ───────────────────────────────────────────

const kindOf = (file) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.safepass')) return 'safepass';
    return name.endsWith('.csv') ? 'csv' : name.endsWith('.json') ? 'json' : null;
};

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
    }
});
fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) chooseFile(fileInput.files[0]);
});
removeFileBtn.addEventListener('click', clearFile);
document.getElementById('ieFormatsBtn').addEventListener('click', () => lokki.explainFormats('ie.say_formats_intro'));

dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!dropZone.classList.contains('drag-over')) {
        dropZone.classList.add('drag-over');
        stage.dataset.active = 'import';
        lokki.show('cheer', 'ie.say_drag');
    }
});
dropZone.addEventListener('dragleave', (event) => {
    if (dropZone.contains(event.relatedTarget)) return;
    dropZone.classList.remove('drag-over');
    lokki.show('happy', 'ie.say_import');
});
dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    if (event.dataTransfer.files.length) chooseFile(event.dataTransfer.files[0]);
});

function chooseFile(file) {
    const kind = kindOf(file);
    if (!kind) {
        showNotification(t('ie.wrong_file'), 'error');
        lokki.explainFormats('ie.say_wrong_file');
        if (lokki.el) lokki.el.setAttribute('data-mood', 'worried');
        return;
    }
    selectedFile = file;
    fileKind.textContent = kind.toUpperCase();
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    dropZone.hidden = true;
    fileInfo.hidden = false;
    importBtn.disabled = false;
    importResult.hidden = true;
    stage.dataset.active = 'import';
    lokki.show('happy', 'ie.say_file');
    importBtn.focus();
}

function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    dropZone.hidden = false;
    fileInfo.hidden = true;
    importBtn.disabled = true;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── CSV ───────────────────────────────────────────────────────

async function parseCSV(file) {
    const text = await file.text().catch(() => { throw new LocalizedError(() => t('ie.read_failed')); });
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) throw new LocalizedError(() => t('ie.csv_empty'));

    const header = parseCSVLine(lines[0]);
    // KeePass format (Group, Subcategory, Title, Username, Password, URL)
    const keepassFields = ['Group', 'Subcategory', 'Title', 'Username', 'Password', 'URL'];
    const isKeePassFormat = keepassFields.every(field => header.some(h => h.toLowerCase() === field.toLowerCase()));
    // SafePass format (title, username, password, …)
    const safepassFields = ['title', 'username', 'password'];
    const isSafePassFormat = safepassFields.every(field => header.some(h => h.toLowerCase() === field.toLowerCase()));
    if (!isKeePassFormat && !isSafePassFormat) throw new LocalizedError(() => t('ie.csv_columns'));

    const passwords = [];
    if (isKeePassFormat) {
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length >= 6) {
                passwords.push({
                    category: values[0].toLowerCase().trim(),
                    subcategory: values[1].toLowerCase().trim(),
                    title: values[2],
                    username: values[3],
                    password: values[4],
                    website: values[5],
                    notes: values[6] || ''
                });
            }
        }
    } else {
        const headerMap = {};
        header.forEach((col, idx) => { headerMap[col.toLowerCase().trim()] = idx; });
        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length >= 3) {
                passwords.push({
                    title: values[headerMap['title']] || values[headerMap['app_name']] || '',
                    username: values[headerMap['username']] || '',
                    password: values[headerMap['password']] || '',
                    website: values[headerMap['website']] || values[headerMap['url']] || '',
                    category: values[headerMap['category']] || 'genel',
                    subcategory: values[headerMap['subcategory']] || '',
                    notes: values[headerMap['notes']] || ''
                });
            }
        }
    }
    return passwords;
}

// Parse CSV line (handles quoted values)
function parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    values.push(current.trim());
    return values.map(v => v.replace(/^"|"$/g, ''));
}

// ── import ────────────────────────────────────────────────────

importBtn.addEventListener('click', handleImport);

async function readJsonBackup(file) {
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch (parseError) {
        throw new LocalizedError(() => t('srv.invalid_json'));
    }
    if (!data || !Array.isArray(data.passwords)) throw new LocalizedError(() => t('srv.invalid_file_format'));
    return data.passwords;
}

// The encrypted backup inside a file (also when someone renamed it to .json), or null
async function readEncryptedBackup(file) {
    try {
        const data = JSON.parse(await file.text());
        return data && data.format === 'safepass-encrypted-backup' ? data : null;
    } catch (parseError) {
        return null;
    }
}

function showImportSummary(result) {
    const imported = result.imported || 0;
    const updated = result.updated || 0;
    const skipped = result.skipped || 0;
    showResult(() => window.SafePassI18n.serverText({ message_code: 'import_summary', message_params: { imported, updated, skipped } }, 'message'), 'success');
    clearFile();
    if (imported + updated > 0) lokki.show('happy', 'ie.say_imported', { n: imported + updated }, 6000);
    else lokki.show('idle', 'ie.say_nothing_new', null, 5000);
}

async function importEncryptedBackup(backup) {
    let result = null;
    const confirmed = await window.SafePassDialog.confirm({
        icon: 'lock',
        title: () => t('ie.import_backup_title'),
        text: () => t('ie.import_backup_text'),
        confirmLabel: () => t('ie.import'),
        fields: [{ name: 'password', type: 'password', autocomplete: 'off', label: () => t('ie.backup_password') }],
        onConfirm: async (values) => {
            const response = await fetch('/api/import-backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backup, password: values.password })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) return () => window.SafePassI18n.serverText(data) || t('ie.import_failed');
            result = data;
            return null;
        }
    });
    if (confirmed && result) showImportSummary(result);
}

async function handleImport() {
    if (!selectedFile) return;
    const kind = kindOf(selectedFile);
    if (kind !== 'csv') {
        const backup = await readEncryptedBackup(selectedFile);
        if (backup) {
            await importEncryptedBackup(backup);
            return;
        }
        if (kind === 'safepass') {
            showResult(() => t('srv.invalid_file_format'), 'error');
            lokki.show('worried', 'ie.say_error', null, 6000);
            return;
        }
    }
    busy = true;
    importBtn.disabled = true;
    importProgress.hidden = false;
    importResult.hidden = true;
    progressFill.style.width = '0%';
    setLocalizedText(progressText, () => t('ie.reading_file'));
    lokki.show('thinking', 'ie.say_importing');

    try {
        const passwords = kind === 'json' ? await readJsonBackup(selectedFile) : await parseCSV(selectedFile);
        if (passwords.length === 0) throw new LocalizedError(() => t('ie.csv_no_passwords'));

        setLocalizedText(progressText, () => t('ie.found_importing', { n: passwords.length }));
        progressFill.style.width = '30%';

        // CSV rows and SafePass backups use different endpoints (field names differ)
        const response = await fetch(kind === 'json' ? '/api/import' : '/api/import-passwords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(kind === 'json' ? { passwords, skip_duplicates: true } : { passwords })
        });
        const result = await response.json().catch(() => ({}));
        progressFill.style.width = '100%';
        if (!response.ok) throw serverError(result, 'ie.import_failed');

        setLocalizedText(progressText, () => t('ie.done'));
        await new Promise((resolve) => setTimeout(resolve, 400));
        importProgress.hidden = true;
        busy = false;
        showImportSummary(result);
    } catch (error) {
        importProgress.hidden = true;
        showResult(renderOf(error), 'error');
        busy = false;
        importBtn.disabled = !selectedFile;
        lokki.show('worried', 'ie.say_error', null, 6000);
    }
}

function showResult(render, type) {
    setLocalizedText(importResult, render);
    importResult.className = `ie-result ${type}`;
    importResult.hidden = false;
}

// ── export ────────────────────────────────────────────────────

exportBtn.addEventListener('click', handleExport);

const encryptedMode = document.getElementById('exportModeEncrypted');

function isEncryptedExport() {
    return encryptedMode.checked;
}

function exportButtonKey() {
    return isEncryptedExport() ? 'ie.download_backup' : 'ie.download_json';
}

function updateExportMode() {
    const encrypted = isEncryptedExport();
    document.getElementById('ieWarnEncrypted').hidden = !encrypted;
    document.getElementById('ieWarnPlain').hidden = encrypted;
    document.getElementById('ieMetaOption').hidden = encrypted;
    const label = document.getElementById('export-btn-label');
    label.setAttribute('data-i18n', exportButtonKey());
    label.textContent = t(exportButtonKey());
}

document.querySelectorAll('input[name="exportMode"]').forEach((input) => input.addEventListener('change', updateExportMode));

function downloadFile(content, type, name) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function handleExport() {
    // Either way the file is every password: confirm it's really the owner
    const encrypted = isEncryptedExport();
    let exported = null;
    const masterField = { name: 'password', type: 'password', autocomplete: 'current-password', label: () => t('profile.current_master') };
    const confirmed = await window.SafePassDialog.confirm({
        icon: 'lock',
        title: () => t(encrypted ? 'ie.backup_dialog_title' : 'ie.export_confirm_title'),
        text: () => t(encrypted ? 'ie.backup_warning' : 'ie.export_confirm_text'),
        confirmLabel: () => t(exportButtonKey()),
        fields: encrypted ? [
            masterField,
            { name: 'backup_password', type: 'password', autocomplete: 'new-password', label: () => t('ie.backup_password') },
            { name: 'backup_confirm', type: 'password', autocomplete: 'new-password', label: () => t('ie.backup_password_confirm') }
        ] : [masterField],
        onConfirm: async (values) => {
            if (encrypted && values.backup_password !== values.backup_confirm) return () => t('auth.msg_mismatch');
            const body = { master_password: values.password };
            if (encrypted) body.backup_password = values.backup_password;
            else body.include_metadata = includeMetadata.checked;
            const response = await fetch('/api/export-passwords', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) return () => window.SafePassI18n.serverText(data) || t('ie.export_failed');
            exported = data;
            return null;
        }
    });
    if (!confirmed || !exported) return;

    stage.dataset.active = 'export';
    const date = new Date().toISOString().split('T')[0];
    downloadFile(JSON.stringify(exported, null, 2), 'application/json',
        encrypted ? `safepass-backup-${date}.safepass` : `safepass-export-${date}.json`);
    showNotification(t('ie.exported'), 'success');
    lokki.show('sad', 'ie.say_exported', null, 7000);
}

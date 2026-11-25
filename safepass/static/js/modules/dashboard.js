/* SafePass - Dashboard Module */

document.addEventListener('DOMContentLoaded', function() {
    initTips();
    animateCounters();
    animateScoreCircle();
    initChartTooltips();
    initPausedResume();
});

// "Resume" on a paused card: the figures above change, so the page is drawn again
function initPausedResume() {
    document.querySelectorAll('[data-resume]').forEach(function (button) {
        button.addEventListener('click', async function () {
            button.disabled = true;
            try {
                await window.SafePassSession.post('/api/passwords/' + button.dataset.resume + '/active', { active: true });
                window.location.reload();
            } catch (error) {
                button.disabled = false;
                window.showAlert(error.message || t('trash.action_failed'), 'error');
            }
        });
    });
}

function t(key, params) {
    return window.SafePassI18n ? window.SafePassI18n.t(key, params) : key;
}

function motionAllowed() {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return !reduced && document.documentElement.getAttribute('data-motion') !== 'off';
}

// The numbers are rendered by the server; this only counts up to them
function animateCounters() {
    if (!motionAllowed()) return;
    document.querySelectorAll('.stat-value[data-count]').forEach(function (element) {
        const end = parseInt(element.dataset.count, 10) || 0;
        if (!end) return;
        const started = performance.now();
        const duration = 700;
        element.textContent = '0';
        function step(now) {
            const progress = Math.min(1, (now - started) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = String(Math.round(end * eased));
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    });
}

function animateScoreCircle() {
    const scoreCircle = document.querySelector('.score-circle');
    const scoreLabel = document.querySelector('.score-label');

    if (scoreCircle) {
        const score = parseInt(scoreCircle.dataset.score) || 0;
        scoreCircle.style.setProperty('--score', score);

        // Skora göre renk sınıfı ekle
        let colorClass = 'score-poor';
        let labelKey = 'dashboard.score_poor';

        if (score >= 90) {
            colorClass = 'score-excellent';
            labelKey = 'dashboard.score_excellent';
        } else if (score >= 75) {
            colorClass = 'score-good';
            labelKey = 'dashboard.score_good';
        } else if (score >= 50) {
            colorClass = 'score-medium';
            labelKey = 'dashboard.score_medium';
        }

        // Eski renk sınıflarını temizle
        scoreCircle.classList.remove('score-excellent', 'score-good', 'score-medium', 'score-poor');
        scoreCircle.classList.add(colorClass);

        if (scoreLabel) {
            scoreLabel.classList.remove('score-excellent', 'score-good', 'score-medium', 'score-poor');
            scoreLabel.classList.add(colorClass);
            // data-i18n lets the label follow later language changes too
            scoreLabel.setAttribute('data-i18n', labelKey);
            scoreLabel.textContent = window.SafePassI18n ? window.SafePassI18n.t(labelKey) : scoreLabel.textContent;
        }
    }
}

// Hover/focus tooltip for the health bar segments and category rows
function initChartTooltips() {
    const tooltip = document.getElementById('spChartTooltip');
    if (!tooltip) return;
    // position: fixed is relative to the nearest transformed ancestor (.main-content keeps one from its
    // entrance animation), which pushed the tip a sidebar-width to the right; under <body> it follows the viewport
    document.body.appendChild(tooltip);

    function text(target) {
        const count = target.dataset.tipCount;
        const label = t(target.dataset.tipKey);
        const pct = target.dataset.tipPct;
        return pct !== undefined
            ? t('dashboard.tip_share', { label: label, n: count, p: pct })
            : t('dashboard.tip_count', { label: label, n: count });
    }

    function show(target, x, y) {
        tooltip.textContent = text(target);
        tooltip.hidden = false;
        const box = tooltip.getBoundingClientRect();
        const left = Math.min(window.innerWidth - box.width - 8, Math.max(8, x - box.width / 2));
        tooltip.style.left = left + 'px';
        tooltip.style.top = Math.max(8, y - box.height - 12) + 'px';
    }

    document.querySelectorAll('[data-tip-key]').forEach(function (target) {
        target.tabIndex = 0;
        target.addEventListener('mousemove', function (event) { show(target, event.clientX, event.clientY); });
        target.addEventListener('focus', function () {
            const rect = target.getBoundingClientRect();
            show(target, rect.left + rect.width / 2, rect.top);
        });
        ['mouseleave', 'blur'].forEach(function (name) {
            target.addEventListener(name, function () { tooltip.hidden = true; });
        });
    });
}

// ── Security tips: a different one on every visit, "next" button cycles ──
const TIP_STORAGE_KEY = 'sp-last-tip';

function initTips() {
    const banner = document.getElementById('spTipBanner');
    if (!banner) return;
    const total = parseInt(banner.dataset.tipCount, 10) || 20;
    const body = banner.querySelector('.tip-body');
    const icon = banner.querySelector('.tip-icon');
    let current = 0;

    function readLast() {
        try { return parseInt(localStorage.getItem(TIP_STORAGE_KEY), 10) || 0; } catch (e) { return 0; }
    }

    function remember(index) {
        try { localStorage.setItem(TIP_STORAGE_KEY, String(index)); } catch (e) { /* storage blocked: rotation still works per page */ }
    }

    function render(index) {
        current = index;
        const title = document.getElementById('spTipTitle');
        const text = document.getElementById('spTipText');
        // data-i18n keeps the tip in step with language changes
        title.setAttribute('data-i18n', 'tips.' + index + '.title');
        text.setAttribute('data-i18n', 'tips.' + index + '.text');
        title.textContent = t('tips.' + index + '.title');
        text.textContent = t('tips.' + index + '.text');
        document.getElementById('spTipCounter').textContent = index + ' / ' + total;
        remember(index);
        if (motionAllowed()) {
            [body, icon].forEach(function (el) {
                el.classList.remove('tip-enter', 'tip-leave');
                void el.offsetWidth;  // restart the animation
                el.classList.add('tip-enter');
            });
        }
    }

    // Random, but never the one shown last time
    const last = readLast();
    let first = 1 + Math.floor(Math.random() * total);
    if (first === last) first = (first % total) + 1;
    render(first);

    document.getElementById('spTipNext').addEventListener('click', function () {
        const next = (current % total) + 1;
        if (!motionAllowed()) { render(next); return; }
        body.classList.remove('tip-enter');
        body.classList.add('tip-leave');
        setTimeout(function () { render(next); }, 180);
    });
}

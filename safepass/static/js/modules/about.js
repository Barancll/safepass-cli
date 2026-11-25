/* The "who made SafePass" card behind the topbar button. <dialog> keeps focus inside and closes on Esc. */
(function () {
    'use strict';

    const button = document.getElementById('spTopbarAboutBtn');
    const dialog = document.getElementById('spAboutDialog');
    if (!button || !dialog) return;
    const lokki = dialog.querySelector('.lokki');

    button.addEventListener('click', function () {
        dialog.showModal();
        lokki.setAttribute('data-mood', 'happy');
    });
    document.getElementById('spAboutClose').addEventListener('click', function () {
        dialog.close();
    });
    // A click on the backdrop lands on the dialog element itself
    dialog.addEventListener('click', function (event) {
        if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', function () {
        lokki.setAttribute('data-mood', 'idle'); // so the hop plays again next time
    });
})();

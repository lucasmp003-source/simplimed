/**
 * GALENO-IA - Header Logic
 * Handles mobile menu toggle.
 */

document.addEventListener('DOMContentLoaded', function () {
    const menuToggle = document.querySelector('.menu-toggle');
    const menu = document.querySelector('.menu');

    if (menuToggle && menu) {
        menuToggle.addEventListener('click', function () {
            menu.classList.toggle('active');
            menuToggle.classList.toggle('active');
        });
    }
});

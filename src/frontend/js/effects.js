/**
 * GALENO-IA - Shared Visual Effects
 * Handles sparkle effects, mouse glow, and particle animations.
 */

document.addEventListener('DOMContentLoaded', () => {
    setupTitleSparkles();
    setupCardEffects();
});

function setupTitleSparkles() {
    const titleWrapper = document.getElementById('hero-title-wrapper');
    const particlesContainer = document.getElementById('title-particles');

    if (titleWrapper && particlesContainer) {
        titleWrapper.addEventListener('mousemove', (e) => {
            const rect = titleWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            for (let i = 0; i < 3; i++) {
                createSparkle(x, y, particlesContainer);
            }
        });
    }
}

function createSparkle(x, y, container) {
    const spark = document.createElement('div');
    spark.className = 'spark';
    const offsetX = (Math.random() - 0.5) * 40;
    const offsetY = (Math.random() - 0.5) * 40;
    const tx = (Math.random() - 0.5) * 100;
    const ty = -Math.random() * 80 - 20;
    spark.style.left = (x + offsetX) + 'px';
    spark.style.top = (y + offsetY) + 'px';
    spark.style.setProperty('--tx', tx + 'px');
    spark.style.setProperty('--ty', ty + 'px');
    spark.style.width = (Math.random() * 6 + 4) + 'px';
    spark.style.height = spark.style.width;
    spark.style.animation = 'sparkle 0.8s ease-out forwards';
    container.appendChild(spark);
    setTimeout(() => spark.remove(), 800);
}

function setupCardEffects() {
    // Upload Card Mouse Glow Effect
    document.querySelectorAll('.upload-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            card.style.setProperty('--mouse-x', x + '%');
            card.style.setProperty('--mouse-y', y + '%');
        });

        // Particle effect on hover
        card.addEventListener('mouseenter', () => {
            const particleContainer = card.querySelector('.card-particles');
            if (particleContainer) {
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => createCardParticle(particleContainer, card), i * 100);
                }
            }
        });
    });
}

function createCardParticle(container, card) {
    const particle = document.createElement('div');
    particle.className = 'card-particle';
    const rect = card.getBoundingClientRect();
    particle.style.left = Math.random() * rect.width + 'px';
    particle.style.bottom = '0px';
    particle.style.width = (Math.random() * 4 + 2) + 'px';
    particle.style.height = particle.style.width;
    particle.style.animation = 'floatUp 1.5s ease-out forwards';
    container.appendChild(particle);
    setTimeout(() => particle.remove(), 1500);
}

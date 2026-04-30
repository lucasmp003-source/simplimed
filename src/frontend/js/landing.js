/**
 * GALENO-IA - Landing Page Interaction Logic
 */

document.addEventListener('DOMContentLoaded', function () {
    const titleWrapper = document.getElementById('hero-title-wrapper');
    const particlesContainer = document.getElementById('title-particles');

    if (!titleWrapper || !particlesContainer) return;

    // Create sparkle only when mouse moves over the title
    titleWrapper.addEventListener('mousemove', (e) => {
        const rect = titleWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Create multiple sparkles
        for (let i = 0; i < 3; i++) {
            createSparkle(x, y);
        }
    });

    function createSparkle(x, y) {
        const spark = document.createElement('div');
        spark.className = 'spark';

        // Random offset and trajectory
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

        particlesContainer.appendChild(spark);

        // Remove after animation
        setTimeout(() => spark.remove(), 800);
    }
});

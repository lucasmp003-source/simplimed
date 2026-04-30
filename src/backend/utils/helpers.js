/**
 * Convierte un path de Windows a formato WSL
 * @param {string} winPath - Path en formato Windows
 * @returns {string} Path en formato WSL
 */
function toWslPath(winPath) {
    let p = winPath.replace(/\\/g, '/');
    if (p.match(/^[a-zA-Z]:/)) {
        const drive = p.charAt(0).toLowerCase();
        p = `/mnt/${drive}${p.slice(2)}`;
    }
    return p;
}

module.exports = {
    toWslPath
};

const fs = require('fs');
const path = require('path');

// Base de datos de usuarios - Persistida en archivo JSON
// IMPORTANTE: Las contraseñas están hasheadas con bcrypt
const usersFilePath = path.join(__dirname, '..', 'users.json');
let USERS_DATABASE = [];

// Función para cargar usuarios desde el archivo
function loadUsers() {
    try {
        if (fs.existsSync(usersFilePath)) {
            const data = fs.readFileSync(usersFilePath, 'utf8');
            USERS_DATABASE = JSON.parse(data);
            console.log(`[SERVER] ✅ ${USERS_DATABASE.length} usuarios cargados desde ${usersFilePath}`);
        } else {
            console.log('[SERVER] ⚠️  Archivo de usuarios no encontrado. Creando uno por defecto...');
            // Usuarios por defecto
            USERS_DATABASE = [
                {
                    id: 1,
                    email: 'lmolino@ujaen.es',
                    password: '$2b$10$h4arzB4rHLYpQDvdd0SzFuEQeX/MwCFIUhzgcV5zI3O.beXzLbqYG', // lmolino
                    firstName: 'Lucas',
                    lastName: 'Molino Piñar',
                    role: 'admin',
                    institution: 'Universidad de Jaén - SINAI'
                },
                {
                    id: 2,
                    email: 'mcdiaz@ujaen.es',
                    password: '$2b$10$.LeXweFpN1nqF3pKQ5mbpefFenI56QqVcrBKUeYcPcEjqQM5Qp.I.', // mcdiaz
                    firstName: 'Manuel Carlos',
                    lastName: 'Díaz Galiano',
                    role: 'tester',
                    institution: 'Universidad de Jaén - SINAI'
                },
                {
                    id: 3,
                    email: 'maite@ujaen.es',
                    password: '$2b$10$yAzfeqccLA8thntOK5fm1OXWJZBCXIYFeyyHZdQp897687xEEcHXq', // maite
                    firstName: 'Maite',
                    lastName: 'Martín Valdivia',
                    role: 'tester',
                    institution: 'Universidad de Jaén - SINAI'
                }
            ];
            saveUsers(); // Guardar usuarios por defecto
        }
    } catch (error) {
        console.error('[SERVER] ❌ Error al cargar usuarios:', error);
        USERS_DATABASE = [];
    }
}

// Función para guardar usuarios en el archivo
function saveUsers() {
    try {
        fs.writeFileSync(usersFilePath, JSON.stringify(USERS_DATABASE, null, 4), 'utf8');
        console.log(`[SERVER] 💾 Usuarios guardados en ${usersFilePath}`);
    } catch (error) {
        console.error('[SERVER] ❌ Error al guardar usuarios:', error);
    }
}

// Cargar usuarios al iniciar
loadUsers();

// Exportar como getter para mantener la referencia mutable
module.exports = {
    get USERS_DATABASE() { return USERS_DATABASE; },
    set USERS_DATABASE(val) { USERS_DATABASE = val; },
    loadUsers,
    saveUsers
};

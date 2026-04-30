module.exports = {
    testEnvironment: 'node',
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'routes/**/*.js',
        'middleware/**/*.js',
        'services/**/*.js',
        '!**/*.test.js'
    ],
    testMatch: [
        '**/__tests__/**/*.js',
        '**/?(*.)+(spec|test).js'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/helpers/'
    ],
    testTimeout: 30000,
    verbose: true
};

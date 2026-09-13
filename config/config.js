// =====================================================
// Application Configuration
// =====================================================
require('dotenv').config();

module.exports = {
    // Server
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Session
    SESSION_SECRET: process.env.SESSION_SECRET || 'hms-secret-key-change-in-production-2026',
    SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE) || 30 * 60 * 1000, // 30 minutes

    // Bcrypt
    SALT_ROUNDS: parseInt(process.env.SALT_ROUNDS) || 10,

    // Application
    APP_NAME: 'Hospital Management System',
    APP_SHORT_NAME: 'HMS',
    APP_VERSION: '1.0.0',

    // Database
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_PORT: parseInt(process.env.DB_PORT) || 3306,
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || '',
    DB_NAME: process.env.DB_NAME || 'hospital_db',
};

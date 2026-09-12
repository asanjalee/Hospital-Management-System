// =====================================================
// Database Connection Module (sql.js - Pure JS SQLite)
// =====================================================
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'hms.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

/**
 * Initialize sql.js and open/create the database.
 */
async function initDatabase() {
    if (db) return db;

    const SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON;');

    return db;
}

/**
 * Get the raw database instance.
 */
function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

/**
 * Save the database to disk.
 */
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

/**
 * Close and save the database.
 */
function closeDatabase() {
    saveDatabase();
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Run a SELECT query and return all results as objects.
 */
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);

    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

/**
 * Run a SELECT query and return the first result as object (or null).
 */
function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

/**
 * Execute a write statement (INSERT, UPDATE, DELETE).
 * Auto-saves to disk after execution.
 */
function execute(sql, params = []) {
    db.run(sql, params);
    const changes = db.getRowsModified();
    const lastId = queryOne('SELECT last_insert_rowid() as id');
    saveDatabase();
    return { changes, lastInsertRowid: lastId ? lastId.id : 0 };
}

module.exports = {
    initDatabase,
    getDatabase,
    saveDatabase,
    closeDatabase,
    queryAll,
    queryOne,
    execute
};

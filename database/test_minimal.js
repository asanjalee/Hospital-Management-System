// Minimal test - combines sql.js + bcryptjs + file I/O
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'hms.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

(async () => {
    try {
        console.log('Step 1: Init sql.js...');
        const SQL = await initSqlJs();
        
        console.log('Step 2: Create database...');
        const db = new SQL.Database();
        
        console.log('Step 3: Create table...');
        db.run('CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, role_name TEXT NOT NULL UNIQUE);');
        db.run("INSERT OR IGNORE INTO roles (role_name) VALUES ('Administrator');");
        
        console.log('Step 4: Query...');
        const stmt = db.prepare('SELECT * FROM roles');
        while (stmt.step()) {
            console.log('  Role:', JSON.stringify(stmt.getAsObject()));
        }
        stmt.free();
        
        console.log('Step 5: Hash password...');
        const hash = bcrypt.hashSync('admin123', 10);
        console.log('  Hash:', hash.substring(0, 30) + '...');
        
        console.log('Step 6: Save to disk...');
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
        
        console.log('Step 7: Close...');
        db.close();
        
        console.log('\n✅ All steps passed!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed at:', err);
        process.exit(1);
    }
})();

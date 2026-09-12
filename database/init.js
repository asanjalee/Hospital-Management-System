// =====================================================
// Database Initialization Script
// Run with: npm run init-db
// =====================================================
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'hms.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Ensure data directory
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

async function main() {
    console.log('🏥 Initializing Hospital Management System Database...\n');

    const SQL = await initSqlJs();
    const db = new SQL.Database();

    // Execute entire schema at once using exec()
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    console.log('✅ Schema created successfully');

    // Check if admin exists
    const results = db.exec("SELECT id FROM users WHERE username = 'admin'");
    
    if (results.length === 0 || results[0].values.length === 0) {
        // Create admin user
        const hashedPassword = bcrypt.hashSync('admin123', 10);

        // Get role and dept IDs
        const roleResult = db.exec("SELECT id FROM roles WHERE role_name = 'Administrator'");
        const roleId = roleResult[0].values[0][0];

        const deptResult = db.exec("SELECT id FROM departments WHERE department_name = 'Administration'");
        const deptId = deptResult.length > 0 ? deptResult[0].values[0][0] : null;

        db.run(
            `INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ['admin', 'admin@hospital.com', hashedPassword, 'System Administrator',
             roleId, deptId, '+94 11 2345678', 1]
        );

        console.log('✅ Default admin user created');
        console.log('   Username: admin');
        console.log('   Password: admin123');
        console.log('   ⚠️  Change this password after first login!\n');
    } else {
        console.log('ℹ️  Admin user already exists\n');
    }

    // Summary
    const counts = {
        roles: db.exec('SELECT COUNT(*) FROM roles')[0].values[0][0],
        departments: db.exec('SELECT COUNT(*) FROM departments')[0].values[0][0],
        users: db.exec('SELECT COUNT(*) FROM users')[0].values[0][0]
    };

    console.log('📊 Database Summary:');
    console.log(`   Roles:       ${counts.roles}`);
    console.log(`   Departments: ${counts.departments}`);
    console.log(`   Users:       ${counts.users}`);

    // Save to disk
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    db.close();

    console.log(`\n💾 Saved: ${DB_PATH}`);
    console.log('🎉 Database initialization complete!');

    // Use setTimeout to let libuv clean up properly on Node 24
    setTimeout(() => process.exit(0), 100);
}

main().catch(err => {
    console.error('❌ Failed:', err);
    setTimeout(() => process.exit(1), 100);
});

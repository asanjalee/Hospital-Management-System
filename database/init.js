// =====================================================
// Database Initialization & Seeding Script (MySQL)
// Run with: npm run init-db
// =====================================================
const { initDatabase, closeDatabase } = require('./db');

async function main() {
    console.log('🏥 Initializing Hospital Management System MySQL Database...\n');

    try {
        await initDatabase();
        console.log('\n🎉 MySQL Database initialization complete!');
        await closeDatabase();
        process.exit(0);
    } catch (err) {
        console.error('❌ Database Initialization Failed:', err);
        process.exit(1);
    }
}

main();

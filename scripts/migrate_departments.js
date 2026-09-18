const mysql = require('mysql2/promise');
const config = require('../config/config');

async function migrateDepartments() {
    const host = config.DB_HOST || 'localhost';
    const port = parseInt(config.DB_PORT) || 3306;
    const user = config.DB_USER || 'root';
    const password = config.DB_PASSWORD !== undefined ? config.DB_PASSWORD : '';
    const database = config.DB_NAME || 'hospital_db';

    console.log(`Connecting to database ${database}...`);
    const connection = await mysql.createConnection({ host, port, user, password, database });

    try {
        console.log('Adding department_type column...');
        await connection.query(`ALTER TABLE departments ADD COLUMN department_type ENUM('Clinical', 'Operational', 'Shared') DEFAULT 'Clinical'`);
        
        console.log('Updating predefined department types...');
        const updates = {
            'Operational': ['Administration'],
            'Shared': ['Radiology', 'Pathology', 'Pharmacy', 'Emergency'],
            'Clinical': ['General Medicine', 'Cardiology', 'Neurology', 'Orthopedics', 'Pediatrics', 'Gynecology', 'Dermatology', 'Ophthalmology', 'ENT']
        };

        for (const [type, depts] of Object.entries(updates)) {
            for (const dept of depts) {
                await connection.query(`UPDATE departments SET department_type = ? WHERE department_name = ?`, [type, dept]);
            }
        }
        
        console.log('✅ Migration complete!');
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log('⚠️ Column department_type already exists. Skiping structural alter...');
        } else {
            console.error('❌ Migration failed:', err);
        }
    } finally {
        await connection.end();
    }
}

migrateDepartments();

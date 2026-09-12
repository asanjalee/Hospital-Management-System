// =====================================================
// Database Initialization & Seeding Script
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
    const adminCheck = db.exec("SELECT id FROM users WHERE username = 'admin'");
    
    if (adminCheck.length === 0 || adminCheck[0].values.length === 0) {
        // Create admin user
        const hashedPassword = bcrypt.hashSync('admin123', 10);

        const roleId = db.exec("SELECT id FROM roles WHERE role_name = 'Administrator'")[0].values[0][0];
        const docRoleId = db.exec("SELECT id FROM roles WHERE role_name = 'Doctor'")[0].values[0][0];
        const adminDeptId = db.exec("SELECT id FROM departments WHERE department_name = 'Administration'")[0].values[0][0];
        const cardioDeptId = db.exec("SELECT id FROM departments WHERE department_name = 'Cardiology'")[0].values[0][0];

        // 1. Admin Account
        db.run(
            `INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ['admin', 'admin@hospital.com', hashedPassword, 'System Administrator', roleId, adminDeptId, '+94 11 2345678', 1]
        );
        const adminId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

        // 2. Sample Doctor Account
        db.run(
            `INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            ['dr.smith', 'smith@hospital.com', hashedPassword, 'Dr. Alexander Smith', docRoleId, cardioDeptId, '+94 77 9998877', 1]
        );
        const docUserId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

        // Insert Doctor profile
        db.run(
            `INSERT INTO doctors (user_id, department_id, specialization, qualification, room_number, consultation_fee)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [docUserId, cardioDeptId, 'Cardiologist', 'MBBS, MD (Cardiology)', 'Room 204', 3500.00]
        );
        const doctorId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];

        console.log('✅ Default users created (admin & Dr. Alexander Smith)');

        // 3. Seed Sample Patients
        const samplePatients = [
            {
                uid: 'PAT-2026-0001',
                first: 'Kamal',
                last: 'Perera',
                dob: '1985-06-15',
                gender: 'Male',
                nic: '198516700123',
                blood: 'A+',
                phone: '+94 77 1234567',
                email: 'kamal.perera@email.com',
                city: 'Colombo',
                address: '123 Galle Road, Colombo 03',
                emergency: 'Sunethra Perera (Spouse)',
                e_phone: '+94 71 9876543',
                allergies: 'Penicillin',
                notes: 'Hypertension history'
            },
            {
                uid: 'PAT-2026-0002',
                first: 'Nimali',
                last: 'Fernando',
                dob: '1992-11-20',
                gender: 'Female',
                nic: '199261200456',
                blood: 'O+',
                phone: '+94 71 4567890',
                email: 'nimali.f@email.com',
                city: 'Kandy',
                address: '45 Lake Round, Kandy',
                emergency: 'Bandula Fernando (Father)',
                e_phone: '+94 81 2233445',
                allergies: 'None',
                notes: 'Regular wellness checkup'
            },
            {
                uid: 'PAT-2026-0003',
                first: 'Saman',
                last: 'Kumara',
                dob: '1978-03-08',
                gender: 'Male',
                nic: '197806700789',
                blood: 'B+',
                phone: '+94 75 8887766',
                email: 'saman.k@email.com',
                city: 'Galle',
                address: '78 Main Street, Galle',
                emergency: 'Dilhani Kumara (Wife)',
                e_phone: '+94 91 3344556',
                allergies: 'Aspirin, Shellfish',
                notes: 'Type 2 Diabetes mellitus'
            }
        ];

        samplePatients.forEach(p => {
            db.run(
                `INSERT INTO patients (
                    patient_uid, first_name, last_name, date_of_birth, gender,
                    nic_number, blood_group, phone, email, address, city,
                    emergency_contact, emergency_phone, medical_notes, allergies, registered_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    p.uid, p.first, p.last, p.dob, p.gender,
                    p.nic, p.blood, p.phone, p.email, p.address, p.city,
                    p.emergency, p.e_phone, p.notes, p.allergies, adminId
                ]
            );
        });

        const p1Id = db.exec("SELECT id FROM patients WHERE patient_uid = 'PAT-2026-0001'")[0].values[0][0];

        // 4. Seed Sample Medical History
        db.run(
            `INSERT INTO medical_history (
                patient_id, doctor_id, visit_date, diagnosis, symptoms,
                treatment_plan, prescription, doctor_notes,
                vitals_bp, vitals_pulse, vitals_temp, vitals_weight
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                p1Id, doctorId, '2026-09-10', 'Primary Hypertension',
                'Chest tightness, mild headache',
                'Low sodium diet, daily exercise, blood pressure monitoring',
                '1. Amlodipine 5mg - 1 tab daily (morning)\n2. Paracetamol 500mg - 2 tab PRN',
                'Patient advised to return for follow-up in 2 weeks.',
                '135/85', 76, 98.4, 78.5
            ]
        );

        // 5. Seed Sample Billing Invoices
        db.run(
            `INSERT INTO billing (invoice_number, patient_id, total_amount, net_amount, paid_amount, payment_status, payment_method, invoice_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['INV-2026-0001', p1Id, 3500.00, 3500.00, 3500.00, 'Paid', 'Cash', '2026-09-10', adminId]
        );

        // 6. Seed Audit Logs
        db.run(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, details)
             VALUES (?, ?, ?, ?, ?)`,
            [adminId, 'SYSTEM_INITIALIZED', 'system', 1, 'Initial database schema and seed data created']
        );

        console.log('✅ Seed data initialized (3 Patients, Medical History, Billing record)');
    } else {
        console.log('ℹ️  Database already seeded\n');
    }

    // Summary
    const counts = {
        roles: db.exec('SELECT COUNT(*) FROM roles')[0].values[0][0],
        departments: db.exec('SELECT COUNT(*) FROM departments')[0].values[0][0],
        users: db.exec('SELECT COUNT(*) FROM users')[0].values[0][0],
        patients: db.exec('SELECT COUNT(*) FROM patients')[0].values[0][0]
    };

    console.log('📊 Database Summary:');
    console.log(`   Roles:       ${counts.roles}`);
    console.log(`   Departments: ${counts.departments}`);
    console.log(`   Users:       ${counts.users}`);
    console.log(`   Patients:    ${counts.patients}`);

    // Save to disk
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
    db.close();

    console.log(`\n💾 Saved: ${DB_PATH}`);
    console.log('🎉 Database initialization complete!');

    setTimeout(() => process.exit(0), 100);
}

main().catch(err => {
    console.error('❌ Failed:', err);
    setTimeout(() => process.exit(1), 100);
});

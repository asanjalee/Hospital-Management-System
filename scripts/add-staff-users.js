// =====================================================
// One-Time Migration: Create Login Accounts for Staff
// =====================================================
// Run this against a LIVE database to add user accounts
// for existing staff members without dropping any data.
//
// Usage:  node scripts/add-staff-users.js
// =====================================================

const bcrypt = require('bcryptjs');
const { initDatabase, queryOne, execute, closeDatabase } = require('../database/db');

// Staff user accounts to create / upsert
// Each account has a UNIQUE password per the security spec.
const STAFF_ACCOUNTS = [
    {
        username:    'receptionist',
        email:       'reception@hospital.com',
        full_name:   'Front Desk Receptionist',
        role_name:   'Receptionist',
        dept_name:   'Administration',
        phone:       '+94 11 2345670',
        password:    'Recep@2026!'
    },
    {
        username:    'mary.fernando',
        email:       'mary.f@hospital.com',
        full_name:   'Sister Mary Fernando',
        role_name:   'Nurse',
        dept_name:   'General Medicine',
        phone:       '+94 77 3334455',
        password:    'Nurse@HMS2026'
    },
    {
        username:    'kusal.mendis',
        email:       'kusal.m@hospital.com',
        full_name:   'Kusal Mendis',
        role_name:   'Accountant',
        dept_name:   'Administration',
        phone:       '+94 71 5556677',
        password:    'Acct@HMS2026'
    },
    {
        username:    'dilshan.pradeep',
        email:       'dilshan.p@hospital.com',
        full_name:   'Dilshan Pradeep',
        role_name:   'Pharmacist',
        dept_name:   'Pharmacy',
        phone:       '+94 75 7778899',
        password:    'Pharm@HMS2026'
    },
    {
        username:    'anura.dissanayake',
        email:       'anura.d@hospital.com',
        full_name:   'Anura Dissanayake',
        role_name:   'Lab Technician',
        dept_name:   'Pathology',
        phone:       '+94 76 1112233',
        password:    'LabTech@HMS26'
    }
];

async function main() {
    console.log('\n🏥 Hospital Management System — Staff Account Migration\n');
    console.log('=' .repeat(55));

    await initDatabase();

    let created = 0;
    let skipped = 0;

    for (const acc of STAFF_ACCOUNTS) {
        // Resolve role_id
        const role = await queryOne('SELECT id FROM roles WHERE role_name = ?', [acc.role_name]);
        if (!role) {
            console.warn(`  ⚠️  Role "${acc.role_name}" not found — skipping ${acc.username}`);
            skipped++;
            continue;
        }

        // Resolve department_id
        const dept = await queryOne('SELECT id FROM departments WHERE department_name = ?', [acc.dept_name]);

        // Check if username or email already exists
        const existing = await queryOne(
            'SELECT id, username FROM users WHERE username = ? OR email = ?',
            [acc.username, acc.email]
        );

        if (existing) {
            console.log(`  ⏭️   Skipping  ${acc.username.padEnd(22)} — account already exists (id: ${existing.id})`);
            skipped++;
            continue;
        }

        // Hash the unique password (cost factor 10)
        const hash = bcrypt.hashSync(acc.password, 10);

        await execute(
            `INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [acc.username, acc.email, hash, acc.full_name, role.id, dept ? dept.id : null, acc.phone]
        );

        console.log(`  ✅  Created   ${acc.username.padEnd(22)} | role: ${acc.role_name.padEnd(16)} | pwd: ${acc.password}`);
        created++;
    }

    console.log('\n' + '='.repeat(55));
    console.log(`  Done — ${created} created, ${skipped} skipped`);
    console.log('='.repeat(55) + '\n');

    await closeDatabase();
    process.exit(0);
}

main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});

// =====================================================
// Database Connection & Management Module (MySQL via mysql2)
// =====================================================
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../config/config');

let pool = null;

/**
 * Get current date & time formatted in Sri Lanka Standard Time (Asia/Colombo)
 * Format: YYYY-MM-DD HH:mm:ss
 */
function getSLTimestamp() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Colombo' }).replace('T', ' ');
}

/**
 * Initialize MySQL Database connection, create hospital_db if not existing,
 * and synchronize database schema and seed data cleanly.
 */
async function initDatabase() {
    if (pool) return pool;

    const host = config.DB_HOST || 'localhost';
    const port = parseInt(config.DB_PORT) || 3306;
    const user = config.DB_USER || 'root';
    const password = config.DB_PASSWORD !== undefined ? config.DB_PASSWORD : '';
    const dbName = config.DB_NAME || 'hospital_db';

    try {
        // Step 1: Auto-Database Creation Wrapper
        // Connect to MySQL server without selecting DB to check/create target database
        const rootConnection = await mysql.createConnection({
            host,
            port,
            user,
            password
        });

        await rootConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
        await rootConnection.end();

        // Step 2: Create connection pool for hospital_db
        pool = mysql.createPool({
            host,
            port,
            user,
            password,
            database: dbName,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            multipleStatements: true,
            dateStrings: true
        });

        console.log(`✅ Connected to MySQL database "${dbName}" at ${host}:${port}`);

        // Step 3: Synchronize tables and seed initial data
        await syncSchema();

        return pool;
    } catch (err) {
        console.error('❌ MySQL Database Connection Error:', err.message);
        throw err;
    }
}

/**
 * Get active connection pool instance
 */
function getPool() {
    if (!pool) {
        throw new Error('Database pool not initialized. Call initDatabase() first.');
    }
    return pool;
}

/**
 * Create tables and seed default data if database is fresh
 */
async function syncSchema() {
    const p = getPool();

    // 1. roles
    await p.query(`
        CREATE TABLE IF NOT EXISTS roles (
            id INT AUTO_INCREMENT PRIMARY KEY,
            role_name VARCHAR(50) NOT NULL UNIQUE,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
    `);

    // 2. departments
    await p.query(`
        CREATE TABLE IF NOT EXISTS departments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            department_name VARCHAR(100) NOT NULL UNIQUE,
            description TEXT,
            head_of_dept VARCHAR(100),
            phone VARCHAR(20),
            department_type ENUM('Clinical', 'Operational', 'Shared') DEFAULT 'Clinical',
            is_active TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
    `);

    // 3. users
    await p.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            email VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(100) NOT NULL,
            role_id INT NOT NULL,
            department_id INT,
            phone VARCHAR(20),
            is_active TINYINT DEFAULT 1,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 4. patients
    await p.query(`
        CREATE TABLE IF NOT EXISTS patients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            patient_uid VARCHAR(50) NOT NULL UNIQUE,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            date_of_birth DATE,
            gender ENUM('Male', 'Female', 'Other'),
            nic_number VARCHAR(20) UNIQUE,
            blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-'),
            phone VARCHAR(20),
            email VARCHAR(100),
            address TEXT,
            city VARCHAR(50),
            emergency_contact VARCHAR(100),
            emergency_phone VARCHAR(20),
            medical_notes TEXT,
            allergies TEXT,
            is_active TINYINT DEFAULT 1,
            registered_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 5. doctors
    await p.query(`
        CREATE TABLE IF NOT EXISTS doctors (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNIQUE NOT NULL,
            department_id INT NOT NULL,
            specialization VARCHAR(100) NOT NULL,
            qualification VARCHAR(255),
            room_number VARCHAR(20),
            consultation_fee DECIMAL(10,2) DEFAULT 0.00,
            availability_schedule TEXT,
            is_available TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
    `);

    // 6. appointments
    await p.query(`
        CREATE TABLE IF NOT EXISTS appointments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            appointment_number VARCHAR(50) NOT NULL UNIQUE,
            patient_id INT NOT NULL,
            doctor_id INT NOT NULL,
            appointment_date DATE NOT NULL,
            appointment_time VARCHAR(20) NOT NULL,
            status ENUM('Scheduled', 'Completed', 'Cancelled', 'No-Show') DEFAULT 'Scheduled',
            reason TEXT,
            notes TEXT,
            created_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 7. medical_history
    await p.query(`
        CREATE TABLE IF NOT EXISTS medical_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            patient_id INT NOT NULL,
            doctor_id INT,
            appointment_id INT,
            visit_date DATE NOT NULL,
            diagnosis TEXT NOT NULL,
            symptoms TEXT,
            treatment_plan TEXT,
            prescription TEXT,
            doctor_notes TEXT,
            vitals_bp VARCHAR(20),
            vitals_pulse INT,
            vitals_temp DECIMAL(4,1),
            vitals_weight DECIMAL(5,2),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 8. billing
    await p.query(`
        CREATE TABLE IF NOT EXISTS billing (
            id INT AUTO_INCREMENT PRIMARY KEY,
            invoice_number VARCHAR(50) NOT NULL UNIQUE,
            patient_id INT NOT NULL,
            appointment_id INT,
            total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            discount_amount DECIMAL(10,2) DEFAULT 0.00,
            net_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            paid_amount DECIMAL(10,2) DEFAULT 0.00,
            payment_status ENUM('Unpaid', 'Partially Paid', 'Paid', 'Refunded') DEFAULT 'Unpaid',
            payment_method ENUM('Cash', 'Card', 'Insurance', 'Online'),
            invoice_date DATE NOT NULL,
            notes TEXT,
            created_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 9. lab_requests
    await p.query(`
        CREATE TABLE IF NOT EXISTS lab_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            request_number VARCHAR(50) NOT NULL UNIQUE,
            patient_id INT NOT NULL,
            doctor_id INT,
            test_name VARCHAR(100) NOT NULL,
            test_category VARCHAR(50),
            status ENUM('Pending', 'In Progress', 'Completed', 'Cancelled') DEFAULT 'Pending',
            result_summary TEXT,
            remarks TEXT,
            requested_date DATE NOT NULL,
            completed_date DATE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
            FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 10. audit_logs
    await p.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            action VARCHAR(100) NOT NULL,
            entity VARCHAR(50),
            entity_id INT,
            details TEXT,
            ip_address VARCHAR(45),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 11. medicines
    await p.query(`
        CREATE TABLE IF NOT EXISTS medicines (
            id INT AUTO_INCREMENT PRIMARY KEY,
            medicine_code VARCHAR(50) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL,
            generic_name VARCHAR(100),
            category VARCHAR(50),
            unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            stock_quantity INT NOT NULL DEFAULT 0,
            reorder_level INT DEFAULT 10,
            expiry_date DATE,
            manufacturer VARCHAR(100),
            is_active TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
    `);

    // 12. billing_items
    await p.query(`
        CREATE TABLE IF NOT EXISTS billing_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            billing_id INT NOT NULL,
            item_type ENUM('Consultation', 'Lab Test', 'Pharmacy', 'Service', 'Other') DEFAULT 'Other',
            description TEXT NOT NULL,
            quantity INT NOT NULL DEFAULT 1,
            unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
    `);

    // 13. staff (Section 3.9 Staff Management Module)
    await p.query(`
        CREATE TABLE IF NOT EXISTS staff (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_code VARCHAR(50) NOT NULL UNIQUE,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            email VARCHAR(100) NOT NULL UNIQUE,
            phone VARCHAR(20),
            nic_number VARCHAR(20) UNIQUE,
            role_id INT NOT NULL,
            department_id INT,
            designation VARCHAR(100) NOT NULL,
            joining_date DATE,
            salary DECIMAL(10,2) DEFAULT 0.00,
            employment_status ENUM('Full-Time', 'Part-Time', 'Contract', 'On Leave', 'Terminated') DEFAULT 'Full-Time',
            is_active TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    // 14. staff_attendance
    await p.query(`
        CREATE TABLE IF NOT EXISTS staff_attendance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            staff_id INT NOT NULL,
            attendance_date DATE NOT NULL,
            check_in TIME,
            check_out TIME,
            status ENUM('Present', 'Absent', 'Late', 'On Leave', 'Half Day') DEFAULT 'Present',
            remarks TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
    `);

    // 15. staff_leaves
    await p.query(`
        CREATE TABLE IF NOT EXISTS staff_leaves (
            id INT AUTO_INCREMENT PRIMARY KEY,
            staff_id INT NOT NULL,
            leave_type ENUM('Casual', 'Sick', 'Annual', 'Maternity', 'Unpaid') DEFAULT 'Casual',
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            total_days INT NOT NULL DEFAULT 1,
            reason TEXT,
            status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
            approved_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
            FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB;
    `);

    console.log('✅ MySQL Database Schema synchronized (15 tables)');

    // Seed Data Check
    const [rolesCount] = await p.query('SELECT COUNT(*) as cnt FROM roles');
    if (rolesCount[0].cnt === 0) {
        await seedData();
    }
}

/**
 * Seed initial sample data into MySQL database
 */
async function seedData() {
    const p = getPool();
    console.log('🌱 Seeding initial MySQL data...');

    // 1. Roles
    await p.query(`
        INSERT INTO roles (role_name, description) VALUES
        ('Administrator', 'Full system access, user management, and system configuration'),
        ('Doctor',        'Access to patient records, prescriptions, diagnosis, and appointments'),
        ('Nurse',         'Patient care, vitals recording, and clinical assistance'),
        ('Receptionist',  'Patient registration, appointment booking, and front-desk operations'),
        ('Lab Technician','Laboratory test requests, sample collection, and result entry'),
        ('Pharmacist',    'Medicine inventory, prescription processing, and stock management'),
        ('Accountant',    'Billing, payments, invoices, and revenue reporting');
    `);

    // 2. Departments
    await p.query(`
        INSERT INTO departments (department_name, description, head_of_dept, phone, department_type) VALUES
        ('General Medicine',    'General medical consultations and treatments', 'Dr. Kamal Perera', '+94 11 2000001', 'Clinical'),
        ('Cardiology',          'Heart and cardiovascular system', 'Dr. Alexander Smith', '+94 11 2000002', 'Clinical'),
        ('Neurology',           'Brain and nervous system disorders', 'Dr. Sarah Jenkins', '+94 11 2000003', 'Clinical'),
        ('Orthopedics',         'Bones, joints, and musculoskeletal system', 'Dr. Sunil Fernando', '+94 11 2000004', 'Clinical'),
        ('Pediatrics',          'Medical care for infants, children, and adolescents', 'Dr. Ruwan Jayasinghe', '+94 11 2000005', 'Clinical'),
        ('Gynecology',          'Female reproductive system health', 'Dr. Anoma Wickramasinghe', '+94 11 2000006', 'Clinical'),
        ('Dermatology',         'Skin, hair, and nail conditions', 'Dr. Nimal Gunaratne', '+94 11 2000007', 'Clinical'),
        ('Ophthalmology',       'Eye care and vision', 'Dr. Chitra Fonseka', '+94 11 2000008', 'Clinical'),
        ('ENT',                 'Ear, Nose, and Throat', 'Dr. Sanath Alwis', '+94 11 2000009', 'Clinical'),
        ('Radiology',           'Medical imaging and diagnostics', 'Dr. Priyantha Silva', '+94 11 2000010', 'Shared'),
        ('Pathology',           'Laboratory analysis of body fluids and tissues', 'Dr. Dilani Ranasinghe', '+94 11 2000011', 'Shared'),
        ('Pharmacy',            'Medicine dispensing and inventory', 'Mr. Asanka Jayawardena', '+94 11 2000012', 'Shared'),
        ('Emergency',           'Emergency and trauma care', 'Dr. Mahesh Senanayake', '+94 11 2000013', 'Shared'),
        ('Administration',      'Hospital administration and management', 'Mr. D. S. Senanayake', '+94 11 2000014', 'Operational');
    `);

    // Fetch created IDs for references
    const [roles] = await p.query('SELECT id, role_name FROM roles');
    const roleMap = {};
    roles.forEach(r => roleMap[r.role_name] = r.id);

    const [depts] = await p.query('SELECT id, department_name FROM departments');
    const deptMap = {};
    depts.forEach(d => deptMap[d.department_name] = d.id);

    // 3. Admin Account
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const [adminRes] = await p.query(`
        INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
        VALUES ('admin', 'admin@hospital.com', ?, 'System Administrator', ?, ?, '+94 11 2345678', 1)
    `, [hashedPassword, roleMap['Administrator'], deptMap['Administration']]);
    const adminId = adminRes.insertId;

    // 4. Sample Doctors
    const sampleDoctors = [
        { username: 'dr.smith', email: 'smith@hospital.com', name: 'Dr. Alexander Smith', dept: deptMap['Cardiology'], spec: 'Cardiologist', qual: 'MBBS, MD (Cardiology)', room: 'Room 204', fee: 3500.00, sched: 'Mon - Fri (09:00 AM - 04:00 PM)' },
        { username: 'dr.sarah', email: 'sarah@hospital.com', name: 'Dr. Sarah Jenkins', dept: deptMap['Neurology'], spec: 'Neurologist', qual: 'MBBS, FRCP (Neurology)', room: 'Room 301', fee: 4000.00, sched: 'Mon, Wed, Fri (10:00 AM - 05:00 PM)' },
        { username: 'dr.ruwan', email: 'ruwan@hospital.com', name: 'Dr. Ruwan Jayasinghe', dept: deptMap['Pediatrics'], spec: 'Pediatrician', qual: 'MBBS, DCH, MD (Pediatrics)', room: 'Room 105', fee: 3000.00, sched: 'Tue, Thu, Sat (08:30 AM - 02:00 PM)' }
    ];

    const doctorIds = [];
    for (const doc of sampleDoctors) {
        const [uRes] = await p.query(`
            INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
            VALUES (?, ?, ?, ?, ?, ?, '+94 77 9998877', 1)
        `, [doc.username, doc.email, hashedPassword, doc.name, roleMap['Doctor'], doc.dept]);
        const uId = uRes.insertId;

        const [dRes] = await p.query(`
            INSERT INTO doctors (user_id, department_id, specialization, qualification, room_number, consultation_fee, availability_schedule, is_available)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `, [uId, doc.dept, doc.spec, doc.qual, doc.room, doc.fee, doc.sched]);
        doctorIds.push(dRes.insertId);
    }

    // 5. Sample Patients
    const samplePatients = [
        { uid: 'PAT-2026-0001', first: 'Kamal', last: 'Perera', dob: '1985-06-15', gender: 'Male', nic: '198516700123', blood: 'A+', phone: '+94 77 1234567', email: 'kamal.perera@email.com', city: 'Colombo', address: '123 Galle Road, Colombo 03', emergency: 'Sunethra Perera (Spouse)', e_phone: '+94 71 9876543', allergies: 'Penicillin', notes: 'Hypertension history' },
        { uid: 'PAT-2026-0002', first: 'Nimali', last: 'Fernando', dob: '1992-11-20', gender: 'Female', nic: '199261200456', blood: 'O+', phone: '+94 71 4567890', email: 'nimali.f@email.com', city: 'Kandy', address: '45 Lake Round, Kandy', emergency: 'Bandula Fernando (Father)', e_phone: '+94 81 2233445', allergies: 'None', notes: 'Regular wellness checkup' },
        { uid: 'PAT-2026-0003', first: 'Saman', last: 'Kumara', dob: '1978-03-08', gender: 'Male', nic: '197806700789', blood: 'B+', phone: '+94 75 8887766', email: 'saman.k@email.com', city: 'Galle', address: '78 Main Street, Galle', emergency: 'Dilhani Kumara (Wife)', e_phone: '+94 91 3344556', allergies: 'Aspirin, Shellfish', notes: 'Type 2 Diabetes mellitus' }
    ];

    const patientIds = [];
    for (const pat of samplePatients) {
        const [pRes] = await p.query(`
            INSERT INTO patients (
                patient_uid, first_name, last_name, date_of_birth, gender,
                nic_number, blood_group, phone, email, address, city,
                emergency_contact, emergency_phone, medical_notes, allergies, registered_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            pat.uid, pat.first, pat.last, pat.dob, pat.gender,
            pat.nic, pat.blood, pat.phone, pat.email, pat.address, pat.city,
            pat.emergency, pat.e_phone, pat.notes, pat.allergies, adminId
        ]);
        patientIds.push(pRes.insertId);
    }

    // 6. Sample Appointments
    const todayStr = new Date().toISOString().split('T')[0];
    await p.query(`
        INSERT INTO appointments (appointment_number, patient_id, doctor_id, appointment_date, appointment_time, status, reason, created_by)
        VALUES 
        ('APT-2026-0001', ?, ?, ?, '09:30 AM', 'Scheduled', 'Routine Cardiovascular Review', ?),
        ('APT-2026-0002', ?, ?, ?, '11:00 AM', 'Scheduled', 'Severe Migraine & Dizziness Consultation', ?),
        ('APT-2026-0003', ?, ?, '2026-09-10', '02:30 PM', 'Completed', 'Childhood Vaccination Followup', ?)
    `, [
        patientIds[0], doctorIds[0], todayStr, adminId,
        patientIds[1], doctorIds[1], todayStr, adminId,
        patientIds[2], doctorIds[2], adminId
    ]);

    // 7. Sample Medical History
    await p.query(`
        INSERT INTO medical_history (
            patient_id, doctor_id, visit_date, diagnosis, symptoms,
            treatment_plan, prescription, doctor_notes,
            vitals_bp, vitals_pulse, vitals_temp, vitals_weight
        ) VALUES (?, ?, '2026-09-10', 'Primary Hypertension',
            'Chest tightness, mild headache',
            'Low sodium diet, daily exercise, blood pressure monitoring',
            '1. Amlodipine 5mg - 1 tab daily (morning)\\n2. Paracetamol 500mg - 2 tab PRN',
            'Patient advised to return for follow-up in 2 weeks.',
            '135/85', 76, 98.4, 78.5)
    `, [patientIds[0], doctorIds[0]]);

    // 8. Sample Pharmacy Medicines
    const sampleMedicines = [
        { code: 'MED-001', name: 'Paracetamol 500mg', generic: 'Acetaminophen', cat: 'Analgesics', price: 15.00, qty: 250, reorder: 50, exp: '2027-12-31', mfg: 'Cipla Pharma' },
        { code: 'MED-002', name: 'Amoxicillin 500mg', generic: 'Amoxicillin Trihydrate', cat: 'Antibiotics', price: 45.00, qty: 120, reorder: 30, exp: '2026-11-30', mfg: 'State Pharmaceuticals' },
        { code: 'MED-003', name: 'Amlodipine 5mg', generic: 'Amlodipine Besylate', cat: 'Cardiovascular', price: 25.00, qty: 180, reorder: 40, exp: '2028-05-15', mfg: 'Pfizer Ltd' },
        { code: 'MED-004', name: 'Metformin 500mg', generic: 'Metformin Hydrochloride', cat: 'Antidiabetic', price: 20.00, qty: 15, reorder: 25, exp: '2026-10-15', mfg: 'GlaxoSmithKline' },
        { code: 'MED-005', name: 'Omeprazole 20mg', generic: 'Omeprazole', cat: 'Gastrointestinal', price: 35.00, qty: 8, reorder: 20, exp: '2026-09-30', mfg: 'AstraZeneca' }
    ];

    for (const med of sampleMedicines) {
        await p.query(`
            INSERT INTO medicines (medicine_code, name, generic_name, category, unit_price, stock_quantity, reorder_level, expiry_date, manufacturer)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [med.code, med.name, med.generic, med.cat, med.price, med.qty, med.reorder, med.exp, med.mfg]);
    }

    // 9. Sample Lab Requests
    await p.query(`
        INSERT INTO lab_requests (request_number, patient_id, doctor_id, test_name, test_category, status, result_summary, remarks, requested_date, completed_date)
        VALUES 
        ('LAB-2026-0001', ?, ?, 'Full Blood Count (FBC)', 'Hematology', 'Completed', 'WBC: 6.5 x10^9/L, Hemoglobin: 14.2 g/dL, Platelets: 250 x10^9/L. All parameters normal.', 'No urgent action required.', '2026-09-10', '2026-09-10'),
        ('LAB-2026-0002', ?, ?, 'Fast Blood Sugar (FBS) & Lipid Profile', 'Biochemistry', 'Pending', null, 'Patient must fast 10-12 hours prior', ?, null)
    `, [patientIds[0], doctorIds[0], patientIds[1], doctorIds[1], todayStr]);

    // 10. Sample Billing Invoices & Items
    const [inv1Res] = await p.query(`
        INSERT INTO billing (invoice_number, patient_id, appointment_id, total_amount, discount_amount, net_amount, paid_amount, payment_status, payment_method, invoice_date, notes, created_by)
        VALUES ('INV-2026-0001', ?, 1, 5500.00, 500.00, 5000.00, 5000.00, 'Paid', 'Cash', '2026-09-10', 'Fully paid consultation and lab test', ?)
    `, [patientIds[0], adminId]);
    const inv1Id = inv1Res.insertId;

    await p.query(`
        INSERT INTO billing_items (billing_id, item_type, description, quantity, unit_price, amount)
        VALUES 
        (?, 'Consultation', 'Doctor Consultation - Dr. Alexander Smith', 1, 3500.00, 3500.00),
        (?, 'Lab Test', 'Full Blood Count (FBC)', 1, 2000.00, 2000.00)
    `, [inv1Id, inv1Id]);

    const [inv2Res] = await p.query(`
        INSERT INTO billing (invoice_number, patient_id, appointment_id, total_amount, discount_amount, net_amount, paid_amount, payment_status, payment_method, invoice_date, notes, created_by)
        VALUES ('INV-2026-0002', ?, 2, 4000.00, 0.00, 4000.00, 0.00, 'Unpaid', null, ?, 'Pending consultation payment', ?)
    `, [patientIds[1], todayStr, adminId]);
    const inv2Id = inv2Res.insertId;

    await p.query(`
        INSERT INTO billing_items (billing_id, item_type, description, quantity, unit_price, amount)
        VALUES (?, 'Consultation', 'Doctor Consultation - Dr. Sarah Jenkins', 1, 4000.00, 4000.00)
    `, [inv2Id]);

    // 4b. Receptionist user account
    // Credentials: username=receptionist | password=Recep@2026!
    const hashedReception = bcrypt.hashSync('Recep@2026!', 10);
    await p.query(`
        INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
        VALUES ('receptionist', 'reception@hospital.com', ?, 'Front Desk Receptionist', ?, ?, '+94 11 2345670', 1)
    `, [hashedReception, roleMap['Receptionist'], deptMap['Administration']]);

    // 11. Sample Staff Members + matching user login accounts
    // Each staff account has a UNIQUE password to meet professional security standards:
    //   Sister Mary Fernando  => username: mary.fernando  | password: Nurse@HMS2026
    //   Kusal Mendis          => username: kusal.mendis   | password: Acct@HMS2026
    //   Dilshan Pradeep       => username: dilshan.pradeep| password: Pharm@HMS2026
    //   Anura Dissanayake     => username: anura.dissanayake | password: LabTech@HMS26

    const sampleStaff = [
        {
            code: 'EMP-2026-0001', first: 'Sister Mary', last: 'Fernando',
            email: 'mary.f@hospital.com', phone: '+94 77 3334455', nic: '198278900111',
            role: roleMap['Nurse'], dept: deptMap['General Medicine'],
            desig: 'Head Nursing Officer', join: '2020-03-15', sal: 95000.00, status: 'Full-Time',
            username: 'mary.fernando', password: 'Nurse@HMS2026'
        },
        {
            code: 'EMP-2026-0002', first: 'Kusal', last: 'Mendis',
            email: 'kusal.m@hospital.com', phone: '+94 71 5556677', nic: '199012300222',
            role: roleMap['Accountant'], dept: deptMap['Administration'],
            desig: 'Senior Financial Accountant', join: '2021-07-01', sal: 120000.00, status: 'Full-Time',
            username: 'kusal.mendis', password: 'Acct@HMS2026'
        },
        {
            code: 'EMP-2026-0003', first: 'Dilshan', last: 'Pradeep',
            email: 'dilshan.p@hospital.com', phone: '+94 75 7778899', nic: '198845600333',
            role: roleMap['Pharmacist'], dept: deptMap['Pharmacy'],
            desig: 'Chief Pharmacist', join: '2019-11-10', sal: 110000.00, status: 'Full-Time',
            username: 'dilshan.pradeep', password: 'Pharm@HMS2026'
        },
        {
            code: 'EMP-2026-0004', first: 'Anura', last: 'Dissanayake',
            email: 'anura.d@hospital.com', phone: '+94 76 1112233', nic: '198599900444',
            role: roleMap['Lab Technician'], dept: deptMap['Pathology'],
            desig: 'Senior Lab Technologist', join: '2022-01-20', sal: 85000.00, status: 'Full-Time',
            username: 'anura.dissanayake', password: 'LabTech@HMS26'
        }
    ];

    const staffIds = [];
    for (const st of sampleStaff) {
        // Create a hashed password unique to each staff member
        const staffPwHash = bcrypt.hashSync(st.password, 10);

        // Create the login user account for this staff member
        await p.query(`
            INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            st.username,
            st.email,
            staffPwHash,
            `${st.first} ${st.last}`,
            st.role,
            st.dept,
            st.phone
        ]);

        // Create the staff HR record
        const [stRes] = await p.query(`
            INSERT INTO staff (employee_code, first_name, last_name, email, phone, nic_number, role_id, department_id, designation, joining_date, salary, employment_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [st.code, st.first, st.last, st.email, st.phone, st.nic, st.role, st.dept, st.desig, st.join, st.sal, st.status]);
        staffIds.push(stRes.insertId);
    }

    // 12. Sample Staff Attendance
    await p.query(`
        INSERT INTO staff_attendance (staff_id, attendance_date, check_in, check_out, status, remarks)
        VALUES 
        (?, ?, '08:00:00', '17:00:00', 'Present', 'On-time morning shift'),
        (?, ?, '08:15:00', '17:00:00', 'Late', 'Delayed due to traffic'),
        (?, ?, '08:00:00', '17:00:00', 'Present', 'Regular shift'),
        (?, ?, null, null, 'On Leave', 'Approved Annual Leave')
    `, [
        staffIds[0], todayStr,
        staffIds[1], todayStr,
        staffIds[2], todayStr,
        staffIds[3], todayStr
    ]);

    // 13. Sample Staff Leaves
    await p.query(`
        INSERT INTO staff_leaves (staff_id, leave_type, start_date, end_date, total_days, reason, status, approved_by)
        VALUES 
        (?, 'Annual', ?, ?, 1, 'Family medical emergency', 'Approved', ?),
        (?, 'Sick', '2026-09-12', '2026-09-14', 3, 'Severe viral fever and flu', 'Pending', null)
    `, [
        staffIds[3], todayStr, todayStr, adminId,
        staffIds[0]
    ]);

    // 14. Audit Log
    await p.query(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, details, created_at)
        VALUES (?, 'DATABASE_MIGRATED_MYSQL', 'system', 1, 'MySQL hospital_db database auto-created, tables synced, and initial seed data populated.', ?)
    `, [adminId, getSLTimestamp()]);

    console.log('🎉 Seed data successfully populated into MySQL!');
}

/**
 * Execute SELECT query and return array of objects
 */
async function queryAll(sql, params = []) {
    const p = getPool();
    const [rows] = await p.query(sql, params);
    return rows;
}

/**
 * Execute SELECT query and return first object or null
 */
async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Execute write query (INSERT, UPDATE, DELETE)
 * Returns object compatible with SQLite lastInsertRowid & changes
 */
async function execute(sql, params = []) {
    const p = getPool();
    const [result] = await p.query(sql, params);
    return {
        changes: result.affectedRows || 0,
        affectedRows: result.affectedRows || 0,
        lastInsertRowid: result.insertId || 0,
        insertId: result.insertId || 0
    };
}

/**
 * Close database connection pool
 */
async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
        console.log('🔒 Database connection pool closed.');
    }
}

module.exports = {
    initDatabase,
    getDatabase: getPool,
    closeDatabase,
    queryAll,
    queryOne,
    execute,
    getSLTimestamp
};

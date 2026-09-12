-- =====================================================
-- Hospital Management System (HMS) - Database Schema
-- Phase 1 - 4: Complete System Schema
-- =====================================================

-- -----------------------------------------------
-- Table: roles
-- Stores user role definitions (Admin, Doctor, etc.)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name   TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------
-- Table: departments
-- Hospital departments (Cardiology, Neurology, etc.)
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    department_name TEXT NOT NULL UNIQUE,
    description     TEXT,
    head_of_dept    TEXT,
    phone           TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------
-- Table: users
-- System login accounts with role-based access
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    username        TEXT NOT NULL UNIQUE,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    full_name       TEXT NOT NULL,
    role_id         INTEGER NOT NULL,
    department_id   INTEGER,
    phone           TEXT,
    is_active       INTEGER DEFAULT 1,
    last_login      DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- -----------------------------------------------
-- Table: patients
-- Patient demographics and registration info
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_uid         TEXT NOT NULL UNIQUE,           -- Unique patient ID (e.g., PAT-2026-0001)
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    date_of_birth       DATE,
    gender              TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
    nic_number          TEXT UNIQUE,                    -- National Identity Card / Passport
    blood_group         TEXT CHECK(blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    phone               TEXT,
    email               TEXT,
    address             TEXT,
    city                TEXT,
    emergency_contact   TEXT,
    emergency_phone     TEXT,
    medical_notes       TEXT,
    allergies           TEXT,
    is_active           INTEGER DEFAULT 1,
    registered_by       INTEGER,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registered_by) REFERENCES users(id)
);

-- -----------------------------------------------
-- Table: doctors
-- Doctor profiles linked to users and departments
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER UNIQUE NOT NULL,
    department_id       INTEGER NOT NULL,
    specialization      TEXT NOT NULL,
    qualification       TEXT,
    room_number         TEXT,
    consultation_fee    DECIMAL(10,2) DEFAULT 0.00,
    availability_schedule TEXT,
    is_available        INTEGER DEFAULT 1,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- -----------------------------------------------
-- Table: appointments
-- Patient appointment bookings
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_number  TEXT NOT NULL UNIQUE,
    patient_id          INTEGER NOT NULL,
    doctor_id           INTEGER NOT NULL,
    appointment_date    DATE NOT NULL,
    appointment_time    TEXT NOT NULL,
    status              TEXT CHECK(status IN ('Scheduled', 'Completed', 'Cancelled', 'No-Show')) DEFAULT 'Scheduled',
    reason              TEXT,
    notes               TEXT,
    created_by          INTEGER,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- -----------------------------------------------
-- Table: medical_history
-- Patient medical diagnoses, treatments, and clinical records
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS medical_history (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id          INTEGER NOT NULL,
    doctor_id           INTEGER,
    appointment_id      INTEGER,
    visit_date          DATE NOT NULL,
    diagnosis           TEXT NOT NULL,
    symptoms            TEXT,
    treatment_plan      TEXT,
    prescription        TEXT,
    doctor_notes        TEXT,
    vitals_bp           TEXT,
    vitals_pulse        INTEGER,
    vitals_temp         DECIMAL(4,1),
    vitals_weight       DECIMAL(5,2),
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

-- -----------------------------------------------
-- Table: billing
-- Patient invoices and billing records
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS billing (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number      TEXT NOT NULL UNIQUE,
    patient_id          INTEGER NOT NULL,
    appointment_id      INTEGER,
    total_amount        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    discount_amount     DECIMAL(10,2) DEFAULT 0.00,
    net_amount          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    paid_amount         DECIMAL(10,2) DEFAULT 0.00,
    payment_status      TEXT CHECK(payment_status IN ('Unpaid', 'Partially Paid', 'Paid', 'Refunded')) DEFAULT 'Unpaid',
    payment_method      TEXT CHECK(payment_method IN ('Cash', 'Card', 'Insurance', 'Online')),
    invoice_date        DATE NOT NULL,
    notes               TEXT,
    created_by          INTEGER,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- -----------------------------------------------
-- Table: lab_requests
-- Laboratory test requests and results
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS lab_requests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    request_number      TEXT NOT NULL UNIQUE,
    patient_id          INTEGER NOT NULL,
    doctor_id           INTEGER,
    test_name           TEXT NOT NULL,
    test_category       TEXT,
    status              TEXT CHECK(status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')) DEFAULT 'Pending',
    result_summary      TEXT,
    remarks             TEXT,
    requested_date      DATE NOT NULL,
    completed_date      DATE,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

-- -----------------------------------------------
-- Table: audit_logs
-- Tracks user actions for security compliance
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    action      TEXT NOT NULL,
    entity      TEXT,
    entity_id   INTEGER,
    details     TEXT,
    ip_address  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- =====================================================
-- Seed Data: Default Roles
-- =====================================================
INSERT OR IGNORE INTO roles (role_name, description) VALUES
    ('Administrator', 'Full system access, user management, and system configuration'),
    ('Doctor',        'Access to patient records, prescriptions, diagnosis, and appointments'),
    ('Nurse',         'Patient care, vitals recording, and clinical assistance'),
    ('Receptionist',  'Patient registration, appointment booking, and front-desk operations'),
    ('Lab Technician','Laboratory test requests, sample collection, and result entry'),
    ('Pharmacist',    'Medicine inventory, prescription processing, and stock management'),
    ('Accountant',    'Billing, payments, invoices, and revenue reporting');

-- =====================================================
-- Seed Data: Default Departments
-- =====================================================
INSERT OR IGNORE INTO departments (department_name, description) VALUES
    ('General Medicine',    'General medical consultations and treatments'),
    ('Cardiology',          'Heart and cardiovascular system'),
    ('Neurology',           'Brain and nervous system disorders'),
    ('Orthopedics',         'Bones, joints, and musculoskeletal system'),
    ('Pediatrics',          'Medical care for infants, children, and adolescents'),
    ('Gynecology',          'Female reproductive system health'),
    ('Dermatology',         'Skin, hair, and nail conditions'),
    ('Ophthalmology',       'Eye care and vision'),
    ('ENT',                 'Ear, Nose, and Throat'),
    ('Radiology',           'Medical imaging and diagnostics'),
    ('Pathology',           'Laboratory analysis of body fluids and tissues'),
    ('Pharmacy',            'Medicine dispensing and inventory'),
    ('Emergency',           'Emergency and trauma care'),
    ('Administration',      'Hospital administration and management');

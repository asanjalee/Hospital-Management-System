-- =====================================================
-- Hospital Management System (HMS) - Database Schema
-- Phase 1: Users, Roles, Departments, Patients
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
    patient_uid         TEXT NOT NULL UNIQUE,           -- Unique patient ID (e.g., PAT-00001)
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    date_of_birth       DATE,
    gender              TEXT CHECK(gender IN ('Male', 'Female', 'Other')),
    nic_number          TEXT UNIQUE,                    -- National Identity Card
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
-- Table: audit_logs
-- Tracks all user actions for security compliance
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

// =====================================================
// Patient Management Routes (CRUD + Medical History)
// =====================================================
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, execute } = require('../database/db');
const { isAuthenticated, authorize } = require('../middleware/auth');

// Audit log helper
function auditLog(userId, action, entity, entityId, details, ip) {
    try {
        execute(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, action, entity, entityId, details, ip]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

// Generate unique patient UID (PAT-YYYY-XXXX)
function generatePatientUID() {
    const year = new Date().getFullYear();
    const countResult = queryOne('SELECT COUNT(*) as total FROM patients');
    const nextNum = (countResult ? countResult.total + 1 : 1).toString().padStart(4, '0');
    return `PAT-${year}-${nextNum}`;
}

// Apply authentication & authorization guard to all patient routes
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Doctor', 'Nurse', 'Receptionist'));

// -------------------------------------------------
// GET /patients — Patient List & Search
// -------------------------------------------------
router.get('/', (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const bloodGroup = req.query.blood_group || '';
    const gender = req.query.gender || '';

    let sql = `
        SELECT p.*, u.full_name as registered_by_name
        FROM patients p
        LEFT JOIN users u ON p.registered_by = u.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        const fullTerm = `%${search}%`;
        const searchWords = search.split(/\s+/).filter(w => w.length > 0);

        if (searchWords.length > 1) {
            // For multi-word queries like "Kamal Perera", check concatenated full name OR match all words across fields
            sql += ` AND (
                (p.first_name || ' ' || p.last_name) LIKE ? 
                OR (p.last_name || ' ' || p.first_name) LIKE ?
                OR p.patient_uid LIKE ?
                OR p.nic_number LIKE ?
                OR p.phone LIKE ?`;
            params.push(fullTerm, fullTerm, fullTerm, fullTerm, fullTerm);

            sql += ` OR (`;
            const wordConditions = searchWords.map(word => {
                const wTerm = `%${word}%`;
                params.push(wTerm, wTerm, wTerm, wTerm, wTerm);
                return `(p.first_name LIKE ? OR p.last_name LIKE ? OR p.patient_uid LIKE ? OR p.nic_number LIKE ? OR p.phone LIKE ?)`;
            });
            sql += wordConditions.join(' AND ') + `)`;

            sql += `)`;
        } else {
            // Single-word search query
            sql += ` AND (
                p.patient_uid LIKE ? 
                OR p.first_name LIKE ? 
                OR p.last_name LIKE ? 
                OR p.nic_number LIKE ? 
                OR p.phone LIKE ?
                OR (p.first_name || ' ' || p.last_name) LIKE ?
            )`;
            params.push(fullTerm, fullTerm, fullTerm, fullTerm, fullTerm, fullTerm);
        }
    }

    if (bloodGroup) {
        sql += ` AND p.blood_group = ?`;
        params.push(bloodGroup);
    }

    if (gender) {
        sql += ` AND p.gender = ?`;
        params.push(gender);
    }

    sql += ` ORDER BY p.created_at DESC`;

    try {
        const patients = queryAll(sql, params);

        res.render('patients/index', {
            title: 'Patient Directory',
            activeMenu: 'patients',
            patients,
            search,
            bloodGroup,
            gender,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('Patient search error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /patients/add — Show Register Patient Form
// -------------------------------------------------
router.get('/add', (req, res) => {
    const autoUID = generatePatientUID();

    res.render('patients/add', {
        title: 'Register New Patient',
        activeMenu: 'patients',
        patientUID: autoUID,
        errors: [],
        formData: {},
        currentUser: req.session.user
    });
});

// -------------------------------------------------
// POST /patients/add — Save New Patient
// -------------------------------------------------
router.post('/add', [
    body('first_name').trim().notEmpty().withMessage('First Name is required'),
    body('last_name').trim().notEmpty().withMessage('Last Name is required'),
    body('gender').notEmpty().withMessage('Gender is required'),
    body('date_of_birth').optional({ checkFalsy: true }).isISO8601().withMessage('Invalid date format'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email address'),
    body('phone').optional({ checkFalsy: true }).trim()
], (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.render('patients/add', {
            title: 'Register New Patient',
            activeMenu: 'patients',
            patientUID: req.body.patient_uid || generatePatientUID(),
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const {
        patient_uid, first_name, last_name, date_of_birth, gender, nic_number,
        blood_group, phone, email, address, city, emergency_contact,
        emergency_phone, medical_notes, allergies
    } = req.body;

    try {
        // Check NIC uniqueness if provided
        if (nic_number && nic_number.trim() !== '') {
            const existing = queryOne('SELECT id FROM patients WHERE nic_number = ?', [nic_number.trim()]);
            if (existing) {
                return res.render('patients/add', {
                    title: 'Register New Patient',
                    activeMenu: 'patients',
                    patientUID: patient_uid,
                    errors: [{ msg: 'A patient with this NIC/Passport number already exists.' }],
                    formData: req.body,
                    currentUser: req.session.user
                });
            }
        }

        const uid = patient_uid && patient_uid.trim() ? patient_uid.trim() : generatePatientUID();

        const result = execute(
            `INSERT INTO patients (
                patient_uid, first_name, last_name, date_of_birth, gender,
                nic_number, blood_group, phone, email, address, city,
                emergency_contact, emergency_phone, medical_notes, allergies, registered_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uid, first_name.trim(), last_name.trim(),
                date_of_birth || null, gender,
                nic_number ? nic_number.trim() : null, blood_group || null,
                phone ? phone.trim() : null, email ? email.trim() : null,
                address ? address.trim() : null, city ? city.trim() : null,
                emergency_contact ? emergency_contact.trim() : null,
                emergency_phone ? emergency_phone.trim() : null,
                medical_notes ? medical_notes.trim() : null,
                allergies ? allergies.trim() : null,
                req.session.user.id
            ]
        );

        auditLog(req.session.user.id, 'PATIENT_REGISTERED', 'patients', result.lastInsertRowid, `Registered ${first_name} ${last_name} (${uid})`, req.ip);

        req.session.successMessage = `Patient ${first_name} ${last_name} (${uid}) registered successfully!`;
        res.redirect(`/patients/view/${result.lastInsertRowid}`);

    } catch (err) {
        console.error('Add patient error:', err);
        res.render('patients/add', {
            title: 'Register New Patient',
            activeMenu: 'patients',
            patientUID: req.body.patient_uid || generatePatientUID(),
            errors: [{ msg: 'An unexpected database error occurred. Please try again.' }],
            formData: req.body,
            currentUser: req.session.user
        });
    }
});

// -------------------------------------------------
// GET /patients/view/:id — View Patient Details & Medical History
// -------------------------------------------------
router.get('/view/:id', (req, res) => {
    const patientId = req.params.id;

    try {
        const patient = queryOne(`
            SELECT p.*, u.full_name as registered_by_name
            FROM patients p
            LEFT JOIN users u ON p.registered_by = u.id
            WHERE p.id = ?
        `, [patientId]);

        if (!patient) {
            req.session.errorMessage = 'Patient not found.';
            return res.redirect('/patients');
        }

        // Calculate age
        let age = 'N/A';
        if (patient.date_of_birth) {
            const dob = new Date(patient.date_of_birth);
            const diff = Date.now() - dob.getTime();
            const ageDate = new Date(diff);
            age = Math.abs(ageDate.getUTCFullYear() - 1970);
        }
        patient.age = age;

        // Fetch Medical History Records
        const medicalRecords = queryAll(`
            SELECT mh.*, u.full_name as doctor_name, d.specialization
            FROM medical_history mh
            LEFT JOIN doctors doc ON mh.doctor_id = doc.id
            LEFT JOIN users u ON doc.user_id = u.id
            LEFT JOIN departments d ON doc.department_id = d.id
            WHERE mh.patient_id = ?
            ORDER BY mh.visit_date DESC, mh.created_at DESC
        `, [patientId]);

        // Fetch Appointments History
        const appointments = queryAll(`
            SELECT a.*, u.full_name as doctor_name, dep.department_name
            FROM appointments a
            LEFT JOIN doctors doc ON a.doctor_id = doc.id
            LEFT JOIN users u ON doc.user_id = u.id
            LEFT JOIN departments dep ON doc.department_id = dep.id
            WHERE a.patient_id = ?
            ORDER BY a.appointment_date DESC
        `, [patientId]);

        // Fetch Billing History
        const invoices = queryAll(`
            SELECT * FROM billing WHERE patient_id = ? ORDER BY invoice_date DESC
        `, [patientId]);

        // Fetch Doctors list for new record dropdown
        const doctors = queryAll(`
            SELECT doc.id, u.full_name, doc.specialization
            FROM doctors doc
            JOIN users u ON doc.user_id = u.id
            WHERE doc.is_available = 1
        `);

        res.render('patients/view', {
            title: `Patient - ${patient.first_name} ${patient.last_name}`,
            activeMenu: 'patients',
            patient,
            medicalRecords,
            appointments,
            invoices,
            doctors,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('View patient error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /patients/edit/:id — Show Edit Patient Form
// -------------------------------------------------
router.get('/edit/:id', (req, res) => {
    const patientId = req.params.id;

    try {
        const patient = queryOne('SELECT * FROM patients WHERE id = ?', [patientId]);

        if (!patient) {
            req.session.errorMessage = 'Patient not found.';
            return res.redirect('/patients');
        }

        res.render('patients/edit', {
            title: `Edit Patient - ${patient.first_name} ${patient.last_name}`,
            activeMenu: 'patients',
            patient,
            errors: [],
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Edit patient fetch error:', err);
        res.redirect('/patients');
    }
});

// -------------------------------------------------
// POST /patients/edit/:id — Update Patient Info
// -------------------------------------------------
router.post('/edit/:id', [
    body('first_name').trim().notEmpty().withMessage('First Name is required'),
    body('last_name').trim().notEmpty().withMessage('Last Name is required'),
    body('gender').notEmpty().withMessage('Gender is required'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email address')
], (req, res) => {
    const patientId = req.params.id;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const patient = { ...req.body, id: patientId };
        return res.render('patients/edit', {
            title: 'Edit Patient',
            activeMenu: 'patients',
            patient,
            errors: errors.array(),
            currentUser: req.session.user
        });
    }

    const {
        first_name, last_name, date_of_birth, gender, nic_number,
        blood_group, phone, email, address, city, emergency_contact,
        emergency_phone, medical_notes, allergies
    } = req.body;

    try {
        const existingPatient = queryOne('SELECT id FROM patients WHERE id = ?', [patientId]);
        if (!existingPatient) {
            req.session.errorMessage = 'Patient record not found.';
            return res.redirect('/patients');
        }

        execute(
            `UPDATE patients SET
                first_name = ?, last_name = ?, date_of_birth = ?, gender = ?,
                nic_number = ?, blood_group = ?, phone = ?, email = ?,
                address = ?, city = ?, emergency_contact = ?, emergency_phone = ?,
                medical_notes = ?, allergies = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                first_name.trim(), last_name.trim(), date_of_birth || null, gender,
                nic_number ? nic_number.trim() : null, blood_group || null,
                phone ? phone.trim() : null, email ? email.trim() : null,
                address ? address.trim() : null, city ? city.trim() : null,
                emergency_contact ? emergency_contact.trim() : null,
                emergency_phone ? emergency_phone.trim() : null,
                medical_notes ? medical_notes.trim() : null,
                allergies ? allergies.trim() : null,
                existingPatient.id
            ]
        );

        auditLog(req.session.user.id, 'PATIENT_UPDATED', 'patients', existingPatient.id, `Updated ${first_name} ${last_name}`, req.ip);

        req.session.successMessage = `Patient information for ${first_name} ${last_name} updated successfully.`;
        res.redirect('/patients');

    } catch (err) {
        console.error('Update patient error:', err);
        req.session.errorMessage = 'An error occurred while updating patient details.';
        res.redirect('/patients');
    }
});

// -------------------------------------------------
// POST /patients/medical-history/add — Add Visit Record
// -------------------------------------------------
router.post('/medical-history/add', [
    body('patient_id').notEmpty().withMessage('Patient ID is required'),
    body('visit_date').notEmpty().withMessage('Visit date is required'),
    body('diagnosis').trim().notEmpty().withMessage('Diagnosis is required')
], (req, res) => {
    const {
        patient_id, doctor_id, visit_date, diagnosis, symptoms,
        treatment_plan, prescription, doctor_notes,
        vitals_bp, vitals_pulse, vitals_temp, vitals_weight
    } = req.body;

    try {
        execute(
            `INSERT INTO medical_history (
                patient_id, doctor_id, visit_date, diagnosis, symptoms,
                treatment_plan, prescription, doctor_notes,
                vitals_bp, vitals_pulse, vitals_temp, vitals_weight
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                patient_id, doctor_id || null, visit_date, diagnosis.trim(),
                symptoms ? symptoms.trim() : null,
                treatment_plan ? treatment_plan.trim() : null,
                prescription ? prescription.trim() : null,
                doctor_notes ? doctor_notes.trim() : null,
                vitals_bp ? vitals_bp.trim() : null,
                vitals_pulse || null, vitals_temp || null, vitals_weight || null
            ]
        );

        auditLog(req.session.user.id, 'MEDICAL_RECORD_ADDED', 'patients', patient_id, `Added medical record: ${diagnosis}`, req.ip);

        req.session.successMessage = 'New medical record added successfully.';
        res.redirect(`/patients/view/${patient_id}`);

    } catch (err) {
        console.error('Add medical history error:', err);
        req.session.errorMessage = 'Failed to add medical record.';
        res.redirect(`/patients/view/${patient_id}`);
    }
});

// -------------------------------------------------
// POST /patients/toggle-status/:id — Toggle Active Status
// -------------------------------------------------
router.post('/toggle-status/:id', (req, res) => {
    const patientId = req.params.id;

    try {
        const patient = queryOne('SELECT is_active, first_name, last_name FROM patients WHERE id = ?', [patientId]);
        if (patient) {
            const newStatus = patient.is_active === 1 ? 0 : 1;
            execute('UPDATE patients SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, patientId]);

            const statusText = newStatus === 1 ? 'activated' : 'deactivated';
            auditLog(req.session.user.id, 'PATIENT_STATUS_CHANGED', 'patients', patientId, `Patient ${statusText}`, req.ip);

            req.session.successMessage = `Patient ${patient.first_name} ${patient.last_name} ${statusText}.`;
        }
        res.redirect('/patients');

    } catch (err) {
        console.error('Toggle status error:', err);
        res.redirect('/patients');
    }
});

module.exports = router;

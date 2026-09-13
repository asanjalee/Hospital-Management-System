// =====================================================
// Electronic Medical Records (EMR) Router
// =====================================================
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, execute, getSLTimestamp } = require('../database/db');
const { isAuthenticated, authorize } = require('../middleware/auth');

// Audit log helper (Sri Lanka Standard Time)
function auditLog(userId, action, entity, entityId, details, ip) {
    try {
        execute(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, action, entity, entityId, details, ip, getSLTimestamp()]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Doctor', 'Nurse'));

// -------------------------------------------------
// GET /emr — Medical Records Directory & Search
// -------------------------------------------------
router.get('/', (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const patientId = req.query.patient_id || '';
    const doctorId = req.query.doctor_id || '';

    let sql = `
        SELECT mh.*, 
               p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.gender as patient_gender, p.date_of_birth,
               u.full_name as doctor_name, doc.specialization, d.department_name,
               a.appointment_number
        FROM medical_history mh
        JOIN patients p ON mh.patient_id = p.id
        LEFT JOIN doctors doc ON mh.doctor_id = doc.id
        LEFT JOIN users u ON doc.user_id = u.id
        LEFT JOIN departments d ON doc.department_id = d.id
        LEFT JOIN appointments a ON mh.appointment_id = a.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        sql += ` AND (p.patient_uid LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR mh.diagnosis LIKE ? OR mh.symptoms LIKE ? OR u.full_name LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term, term, term);
    }

    if (patientId) {
        sql += ` AND mh.patient_id = ?`;
        params.push(patientId);
    }

    if (doctorId) {
        sql += ` AND mh.doctor_id = ?`;
        params.push(doctorId);
    }

    sql += ` ORDER BY mh.visit_date DESC, mh.id DESC`;

    try {
        const records = queryAll(sql, params) || [];
        const patients = queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id ORDER BY u.full_name ASC`) || [];

        const stats = {
            total: queryOne('SELECT COUNT(*) as cnt FROM medical_history')?.cnt || 0,
            uniquePatients: queryOne('SELECT COUNT(DISTINCT patient_id) as cnt FROM medical_history')?.cnt || 0,
            recentVisits: queryOne('SELECT COUNT(*) as cnt FROM medical_history WHERE visit_date >= date("now", "-30 days")')?.cnt || 0
        };

        res.render('emr/index', {
            title: 'Electronic Medical Records (EMR)',
            activeMenu: 'emr',
            records,
            patients,
            doctors,
            search,
            patientId,
            doctorId,
            stats,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('EMR directory error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /emr/add — Show Add Medical Record Form
// -------------------------------------------------
router.get('/add', (req, res) => {
    const prePatientId = req.query.patient_id || '';
    const preAppointmentId = req.query.appointment_id || '';

    try {
        const patients = queryAll(`SELECT id, patient_uid, first_name, last_name, gender, date_of_birth FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id WHERE doc.is_available = 1 ORDER BY u.full_name ASC`) || [];
        const appointments = queryAll(`
            SELECT a.id, a.appointment_number, a.appointment_date, p.patient_uid, p.first_name, p.last_name, u.full_name as doctor_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors doc ON a.doctor_id = doc.id
            JOIN users u ON doc.user_id = u.id
            WHERE a.status = 'Scheduled'
            ORDER BY a.appointment_date DESC
        `) || [];

        const todayStr = new Date().toISOString().split('T')[0];

        res.render('emr/add', {
            title: 'Add Medical Record',
            activeMenu: 'emr',
            patients,
            doctors,
            appointments,
            prePatientId,
            preAppointmentId,
            todayStr,
            errors: [],
            formData: {
                patient_id: prePatientId,
                appointment_id: preAppointmentId,
                visit_date: todayStr
            },
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Add EMR view error:', err);
        res.redirect('/emr');
    }
});

// -------------------------------------------------
// POST /emr/add — Create Medical Record Entry
// -------------------------------------------------
router.post('/add', [
    body('patient_id').notEmpty().withMessage('Patient selection is required'),
    body('visit_date').notEmpty().isISO8601().withMessage('Valid visit date is required'),
    body('diagnosis').trim().notEmpty().withMessage('Medical diagnosis is required'),
    body('symptoms').trim().notEmpty().withMessage('Symptoms description is required'),
    body('vitals_pulse').optional({ checkFalsy: true }).isInt({ min: 30, max: 250 }).withMessage('Pulse rate must be a number between 30 and 250 BPM'),
    body('vitals_temp').optional({ checkFalsy: true }).isFloat({ min: 90, max: 110 }).withMessage('Body temperature must be between 90 and 110 °F'),
    body('vitals_weight').optional({ checkFalsy: true }).isFloat({ min: 1, max: 500 }).withMessage('Weight must be a positive number (kg)')
], (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const patients = queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id WHERE doc.is_available = 1 ORDER BY u.full_name ASC`) || [];
        const appointments = queryAll(`SELECT a.id, a.appointment_number, a.appointment_date, p.patient_uid, p.first_name, p.last_name FROM appointments a JOIN patients p ON a.patient_id = p.id WHERE a.status = 'Scheduled' ORDER BY a.appointment_date DESC`) || [];

        return res.render('emr/add', {
            title: 'Add Medical Record',
            activeMenu: 'emr',
            patients,
            doctors,
            appointments,
            prePatientId: req.body.patient_id || '',
            preAppointmentId: req.body.appointment_id || '',
            todayStr: new Date().toISOString().split('T')[0],
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const {
        patient_id, doctor_id, appointment_id, visit_date, diagnosis, symptoms,
        treatment_plan, prescription, doctor_notes, vitals_bp, vitals_pulse, vitals_temp, vitals_weight
    } = req.body;

    try {
        const result = execute(`
            INSERT INTO medical_history (
                patient_id, doctor_id, appointment_id, visit_date, diagnosis, symptoms,
                treatment_plan, prescription, doctor_notes, vitals_bp, vitals_pulse, vitals_temp, vitals_weight, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            patient_id,
            doctor_id ? doctor_id : null,
            appointment_id ? appointment_id : null,
            visit_date,
            diagnosis.trim(),
            symptoms.trim(),
            treatment_plan ? treatment_plan.trim() : null,
            prescription ? prescription.trim() : null,
            doctor_notes ? doctor_notes.trim() : null,
            vitals_bp ? vitals_bp.trim() : null,
            vitals_pulse ? parseInt(vitals_pulse) : null,
            vitals_temp ? parseFloat(vitals_temp) : null,
            vitals_weight ? parseFloat(vitals_weight) : null,
            getSLTimestamp()
        ]);

        // If linked to an appointment, auto update appointment status to 'Completed'
        if (appointment_id) {
            execute(`UPDATE appointments SET status = 'Completed', updated_at = ? WHERE id = ?`, [getSLTimestamp(), appointment_id]);
        }

        auditLog(req.session.user.id, 'EMR_RECORD_ADDED', 'medical_history', result.lastInsertRowid, `Logged EMR record for patient ID #${patient_id}: ${diagnosis.trim()}`, req.ip);

        req.session.successMessage = `Medical record logged successfully!`;
        res.redirect(`/emr/view/${result.lastInsertRowid}`);

    } catch (err) {
        console.error('Save EMR error:', err);
        req.session.errorMessage = 'An error occurred while saving the medical record.';
        res.redirect('/emr');
    }
});

// -------------------------------------------------
// GET /emr/view/:id — View Medical Record Details
// -------------------------------------------------
router.get('/view/:id', (req, res) => {
    const recId = req.params.id;

    try {
        const record = queryOne(`
            SELECT mh.*, 
                   p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.gender as patient_gender, p.date_of_birth, p.blood_group, p.phone as patient_phone, p.allergies,
                   u.full_name as doctor_name, doc.specialization, doc.room_number, d.department_name,
                   a.appointment_number, a.appointment_date
            FROM medical_history mh
            JOIN patients p ON mh.patient_id = p.id
            LEFT JOIN doctors doc ON mh.doctor_id = doc.id
            LEFT JOIN users u ON doc.user_id = u.id
            LEFT JOIN departments d ON doc.department_id = d.id
            LEFT JOIN appointments a ON mh.appointment_id = a.id
            WHERE mh.id = ?
        `, [recId]);

        if (!record) {
            req.session.errorMessage = `Medical record #${recId} not found.`;
            return res.redirect('/emr');
        }

        res.render('emr/view', {
            title: `Medical Record #${record.id}`,
            activeMenu: 'emr',
            record,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('View EMR record error:', err);
        req.session.errorMessage = 'Could not retrieve medical record.';
        res.redirect('/emr');
    }
});

// -------------------------------------------------
// GET /emr/edit/:id — Show Edit Form
// -------------------------------------------------
router.get('/edit/:id', (req, res) => {
    const recId = req.params.id;

    try {
        const record = queryOne(`SELECT * FROM medical_history WHERE id = ?`, [recId]);
        if (!record) {
            req.session.errorMessage = 'Medical record not found.';
            return res.redirect('/emr');
        }

        const patients = queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id ORDER BY u.full_name ASC`) || [];

        res.render('emr/edit', {
            title: `Edit Medical Record #${record.id}`,
            activeMenu: 'emr',
            record,
            patients,
            doctors,
            errors: [],
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Edit EMR view error:', err);
        res.redirect('/emr');
    }
});

// -------------------------------------------------
// POST /emr/edit/:id — Update Medical Record
// -------------------------------------------------
router.post('/edit/:id', [
    body('diagnosis').trim().notEmpty().withMessage('Medical diagnosis is required'),
    body('symptoms').trim().notEmpty().withMessage('Symptoms description is required'),
    body('vitals_pulse').optional({ checkFalsy: true }).isInt({ min: 30, max: 250 }).withMessage('Pulse rate must be between 30 and 250 BPM'),
    body('vitals_temp').optional({ checkFalsy: true }).isFloat({ min: 90, max: 110 }).withMessage('Body temperature must be between 90 and 110 °F')
], (req, res) => {
    const recId = req.params.id;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const record = { ...req.body, id: recId };
        const patients = queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id ORDER BY u.full_name ASC`) || [];
        return res.render('emr/edit', {
            title: `Edit Medical Record #${recId}`,
            activeMenu: 'emr',
            record,
            patients,
            doctors,
            errors: errors.array(),
            currentUser: req.session.user
        });
    }

    const {
        diagnosis, symptoms, treatment_plan, prescription, doctor_notes,
        vitals_bp, vitals_pulse, vitals_temp, vitals_weight
    } = req.body;

    try {
        execute(`
            UPDATE medical_history SET
                diagnosis = ?, symptoms = ?, treatment_plan = ?, prescription = ?, doctor_notes = ?,
                vitals_bp = ?, vitals_pulse = ?, vitals_temp = ?, vitals_weight = ?
            WHERE id = ?
        `, [
            diagnosis.trim(),
            symptoms.trim(),
            treatment_plan ? treatment_plan.trim() : null,
            prescription ? prescription.trim() : null,
            doctor_notes ? doctor_notes.trim() : null,
            vitals_bp ? vitals_bp.trim() : null,
            vitals_pulse ? parseInt(vitals_pulse) : null,
            vitals_temp ? parseFloat(vitals_temp) : null,
            vitals_weight ? parseFloat(vitals_weight) : null,
            recId
        ]);

        auditLog(req.session.user.id, 'EMR_RECORD_UPDATED', 'medical_history', recId, `Updated EMR record #${recId}`, req.ip);

        req.session.successMessage = `Medical record #${recId} updated successfully.`;
        res.redirect(`/emr/view/${recId}`);

    } catch (err) {
        console.error('Update EMR error:', err);
        req.session.errorMessage = 'Failed to update medical record.';
        res.redirect('/emr');
    }
});

module.exports = router;

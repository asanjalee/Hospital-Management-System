// =====================================================
// Laboratory Management Router - MySQL Async
// =====================================================
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, execute, getSLTimestamp } = require('../database/db');
const { isAuthenticated, authorize } = require('../middleware/auth');

// Audit log helper (Sri Lanka Standard Time)
async function auditLog(userId, action, entity, entityId, details, ip) {
    try {
        await execute(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, action, entity, entityId, details, ip, getSLTimestamp()]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

// Generate unique request number (LAB-YYYY-XXXX)
async function generateLabRequestNumber() {
    const year = new Date().getFullYear();
    const countResult = await queryOne('SELECT COUNT(*) as total FROM lab_requests');
    const nextNum = (countResult ? countResult.total + 1 : 1).toString().padStart(4, '0');
    return `LAB-${year}-${nextNum}`;
}

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Doctor', 'Nurse', 'Lab Technician', 'Receptionist'));

// -------------------------------------------------
// GET /laboratory — Laboratory Requests Directory
// -------------------------------------------------
router.get('/', async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const status = req.query.status || '';
    const category = req.query.category || '';

    let sql = `
        SELECT lr.*, 
               p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.gender as patient_gender, p.phone as patient_phone,
               u.full_name as doctor_name, doc.specialization
        FROM lab_requests lr
        JOIN patients p ON lr.patient_id = p.id
        LEFT JOIN doctors doc ON lr.doctor_id = doc.id
        LEFT JOIN users u ON doc.user_id = u.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        sql += ` AND (lr.request_number LIKE ? OR lr.test_name LIKE ? OR p.patient_uid LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term, term);
    }

    if (status) {
        sql += ` AND lr.status = ?`;
        params.push(status);
    }

    if (category) {
        sql += ` AND lr.test_category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY lr.id DESC`;

    try {
        const labRequests = await queryAll(sql, params) || [];

        const stats = {
            total: (await queryOne('SELECT COUNT(*) as cnt FROM lab_requests'))?.cnt || 0,
            pending: (await queryOne('SELECT COUNT(*) as cnt FROM lab_requests WHERE status = "Pending"'))?.cnt || 0,
            inProgress: (await queryOne('SELECT COUNT(*) as cnt FROM lab_requests WHERE status = "In Progress"'))?.cnt || 0,
            completed: (await queryOne('SELECT COUNT(*) as cnt FROM lab_requests WHERE status = "Completed"'))?.cnt || 0
        };

        res.render('laboratory/index', {
            title: 'Laboratory Management',
            activeMenu: 'laboratory',
            labRequests,
            search,
            status,
            category,
            stats,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('Lab list error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /laboratory/request — Show Order Lab Test Form
// -------------------------------------------------
router.get('/request', async (req, res) => {
    const prePatientId = req.query.patient_id || '';
    const preDoctorId = req.query.doctor_id || '';

    try {
        const autoNumber = await generateLabRequestNumber();
        const patients = await queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = await queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id ORDER BY u.full_name ASC`) || [];
        const todayStr = new Date().toISOString().split('T')[0];

        res.render('laboratory/request', {
            title: 'Request Laboratory Test',
            activeMenu: 'laboratory',
            autoNumber,
            patients,
            doctors,
            prePatientId,
            preDoctorId,
            todayStr,
            errors: [],
            formData: {
                patient_id: prePatientId,
                doctor_id: preDoctorId,
                requested_date: todayStr
            },
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Lab request view error:', err);
        res.redirect('/laboratory');
    }
});

// -------------------------------------------------
// POST /laboratory/request — Save New Lab Test Order
// -------------------------------------------------
router.post('/request', [
    body('patient_id').notEmpty().withMessage('Patient selection is required'),
    body('test_name').trim().notEmpty().withMessage('Test Name is required'),
    body('test_category').notEmpty().withMessage('Test category selection is required'),
    body('requested_date').notEmpty().isISO8601().withMessage('Valid requested date is required')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const patients = await queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const doctors = await queryAll(`SELECT doc.id, u.full_name, doc.specialization FROM doctors doc JOIN users u ON doc.user_id = u.id ORDER BY u.full_name ASC`) || [];
        return res.render('laboratory/request', {
            title: 'Request Laboratory Test',
            activeMenu: 'laboratory',
            autoNumber: req.body.request_number || await generateLabRequestNumber(),
            patients,
            doctors,
            prePatientId: req.body.patient_id || '',
            preDoctorId: req.body.doctor_id || '',
            todayStr: new Date().toISOString().split('T')[0],
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const { request_number, patient_id, doctor_id, test_name, test_category, remarks, requested_date } = req.body;

    try {
        const reqNum = request_number && request_number.trim() ? request_number.trim() : await generateLabRequestNumber();

        const result = await execute(`
            INSERT INTO lab_requests (
                request_number, patient_id, doctor_id, test_name, test_category,
                status, remarks, requested_date, created_at
            ) VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?, ?)
        `, [
            reqNum,
            patient_id,
            doctor_id ? doctor_id : null,
            test_name.trim(),
            test_category,
            remarks ? remarks.trim() : null,
            requested_date,
            getSLTimestamp()
        ]);

        await auditLog(req.session.user.id, 'LAB_REQUEST_CREATED', 'lab_requests', result.lastInsertRowid, `Ordered lab test ${reqNum} (${test_name}) for patient ID #${patient_id}`, req.ip);

        req.session.successMessage = `Lab Test ${reqNum} requested successfully!`;
        res.redirect(`/laboratory/view/${result.lastInsertRowid}`);

    } catch (err) {
        console.error('Save lab request error:', err);
        req.session.errorMessage = 'Failed to submit laboratory test request.';
        res.redirect('/laboratory');
    }
});

// -------------------------------------------------
// GET /laboratory/view/:id — View Lab Request & Result Screen
// -------------------------------------------------
router.get('/view/:id', async (req, res) => {
    const labId = req.params.id;

    try {
        const lab = await queryOne(`
            SELECT lr.*, 
                   p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.gender as patient_gender, p.date_of_birth, p.phone as patient_phone, p.blood_group,
                   u.full_name as doctor_name, doc.specialization, d.department_name
            FROM lab_requests lr
            JOIN patients p ON lr.patient_id = p.id
            LEFT JOIN doctors doc ON lr.doctor_id = doc.id
            LEFT JOIN users u ON doc.user_id = u.id
            LEFT JOIN departments d ON doc.department_id = d.id
            WHERE lr.id = ? OR lr.request_number = ?
        `, [labId, labId]);

        if (!lab) {
            req.session.errorMessage = `Laboratory request "${labId}" not found.`;
            return res.redirect('/laboratory');
        }

        res.render('laboratory/view', {
            title: `Lab Test ${lab.request_number}`,
            activeMenu: 'laboratory',
            lab,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('View lab request error:', err);
        res.redirect('/laboratory');
    }
});

// -------------------------------------------------
// POST /laboratory/status/:id — Update Status & Enter Lab Results
// -------------------------------------------------
router.post('/status/:id', async (req, res) => {
    const labId = req.params.id;
    const { status, result_summary, remarks } = req.body;

    const validStatuses = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
    if (!validStatuses.includes(status)) {
        req.session.errorMessage = 'Invalid status value.';
        return res.redirect(`/laboratory/view/${labId}`);
    }

    try {
        const lab = await queryOne('SELECT request_number, status FROM lab_requests WHERE id = ?', [labId]);
        if (!lab) {
            req.session.errorMessage = 'Laboratory record not found.';
            return res.redirect('/laboratory');
        }

        // Prevent modification of completed lab reports
        if (lab.status === 'Completed') {
            req.session.errorMessage = 'Completed lab reports are locked and cannot be modified. Please raise an amendment request if necessary.';
            return res.redirect(`/laboratory/view/${labId}`);
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const completedDate = status === 'Completed' ? todayStr : null;

        await execute(`
            UPDATE lab_requests SET
                status = ?,
                result_summary = COALESCE(?, result_summary),
                remarks = COALESCE(?, remarks),
                completed_date = COALESCE(?, completed_date)
            WHERE id = ?
        `, [status, result_summary ? result_summary.trim() : null, remarks ? remarks.trim() : null, completedDate, labId]);

        await auditLog(req.session.user.id, `LAB_REQUEST_${status.toUpperCase()}`, 'lab_requests', labId, `Lab request ${lab.request_number} status set to ${status}`, req.ip);

        req.session.successMessage = `Lab test ${lab.request_number} updated to "${status}".`;
        res.redirect(`/laboratory/view/${labId}`);

    } catch (err) {
        console.error('Update lab status error:', err);
        req.session.errorMessage = 'An error occurred while updating lab status.';
        res.redirect('/laboratory');
    }
});

module.exports = router;

// =====================================================
// Doctor Management Routes (CRUD + Department Assignment) - MySQL Async
// =====================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { queryAll, queryOne, execute, getSLTimestamp } = require('../database/db');
const { isAuthenticated, authorize } = require('../middleware/auth');

// Audit log helper (using Sri Lanka Standard Time)
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

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Doctor', 'Nurse', 'Receptionist'));

// -------------------------------------------------
// GET /doctors — Doctor Directory, Search & Filter
// -------------------------------------------------
router.get('/', async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const departmentId = req.query.department_id || '';
    const availability = req.query.availability || '';

    let sql = `
        SELECT doc.*, u.full_name, u.username, u.email, u.phone as user_phone, u.is_active as user_active,
               d.department_name, d.head_of_dept,
               (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = doc.id) as total_appointments,
               (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = doc.id AND a.status = 'Scheduled') as active_appts
        FROM doctors doc
        JOIN users u ON doc.user_id = u.id
        JOIN departments d ON doc.department_id = d.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        sql += ` AND (u.full_name LIKE ? OR doc.specialization LIKE ? OR doc.qualification LIKE ? OR doc.room_number LIKE ? OR d.department_name LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term, term);
    }

    if (departmentId) {
        sql += ` AND doc.department_id = ?`;
        params.push(departmentId);
    }

    if (availability !== '') {
        sql += ` AND doc.is_available = ?`;
        params.push(availability);
    }

    sql += ` ORDER BY doc.id DESC`;

    try {
        const doctors = await queryAll(sql, params) || [];
        const departments = await queryAll('SELECT * FROM departments WHERE is_active = 1 ORDER BY department_name ASC') || [];

        // Statistics
        const totalDoctors = await queryOne('SELECT COUNT(*) as cnt FROM doctors') || { cnt: 0 };
        const availableDoctors = await queryOne('SELECT COUNT(*) as cnt FROM doctors WHERE is_available = 1') || { cnt: 0 };

        res.render('doctors/index', {
            title: 'Doctor Directory',
            activeMenu: 'doctors',
            doctors,
            departments,
            search,
            departmentId,
            availability,
            stats: {
                total: totalDoctors.cnt,
                available: availableDoctors.cnt,
                departmentsCount: departments.length
            },
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('Doctor list error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /doctors/add — Show Add Doctor Form
// -------------------------------------------------
router.get('/add', async (req, res) => {
    try {
        const departments = await queryAll('SELECT * FROM departments WHERE is_active = 1 ORDER BY department_name ASC') || [];
        res.render('doctors/add', {
            title: 'Add New Doctor',
            activeMenu: 'doctors',
            departments,
            errors: [],
            formData: {},
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('Add doctor view error:', err);
        res.redirect('/doctors');
    }
});

// -------------------------------------------------
// POST /doctors/add — Register Doctor Account & Profile
// -------------------------------------------------
router.post('/add', [
    body('full_name').trim().notEmpty().withMessage('Full Name is required'),
    body('username').trim().notEmpty().withMessage('Username is required').isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('email').trim().notEmpty().withMessage('Email address is required').isEmail().withMessage('Invalid email address'),
    body('department_id').notEmpty().withMessage('Department assignment is required'),
    body('specialization').trim().notEmpty().withMessage('Specialization is required'),
    body('consultation_fee').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Consultation fee must be a positive number'),
    body('phone').optional({ checkFalsy: true }).trim().custom(val => {
        const cleaned = val.replace(/[\s-]/g, '');
        if (!/^(?:\+94|0)\d{9}$/.test(cleaned)) {
            throw new Error("Invalid phone number format. Must contain 10 digits (e.g., 0719876543 or +94719876543).");
        }
        return true;
    })
], async (req, res) => {
    const errors = validationResult(req);
    const departments = await queryAll('SELECT * FROM departments WHERE is_active = 1 ORDER BY department_name ASC') || [];

    if (!errors.isEmpty()) {
        return res.render('doctors/add', {
            title: 'Add New Doctor',
            activeMenu: 'doctors',
            departments,
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const {
        full_name, username, email, password, phone, department_id,
        specialization, qualification, room_number, consultation_fee, availability_schedule
    } = req.body;

    try {
        // Check username / email uniqueness
        const existingUser = await queryOne('SELECT id FROM users WHERE username = ? OR email = ?', [username.trim(), email.trim()]);
        if (existingUser) {
            return res.render('doctors/add', {
                title: 'Add New Doctor',
                activeMenu: 'doctors',
                departments,
                errors: [{ msg: 'A user account with this username or email already exists.' }],
                formData: req.body,
                currentUser: req.session.user
            });
        }

        // Normalize room_number & Check for room & schedule overlap
        let normalizedRoom = null;
        if (room_number && room_number.trim() !== '') {
            // Standardize format: trim spaces, convert 'rm 204', 'room-204', 'Room204' -> 'Room 204', Title Case
            normalizedRoom = room_number.trim().replace(/\s+/g, ' ').replace(/^r[o]*m[\s\-]*(\d+)/i, 'Room $1');
            normalizedRoom = normalizedRoom.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

            // Validate realistic room numbers
            const roomMatch = normalizedRoom.match(/Room\s+(\d+)/i);
            if (roomMatch) {
                const roomNum = parseInt(roomMatch[1], 10);
                if (roomNum <= 0 || roomNum > 999) {
                    return res.render('doctors/add', {
                        title: 'Add New Doctor',
                        activeMenu: 'doctors',
                        departments,
                        errors: [{ msg: `Room ${roomNum} is invalid. Building room numbers must be realistically bounded between 1 and 999.` }],
                        formData: req.body,
                        currentUser: req.session.user
                    });
                }
            }

            const allDoctors = await queryAll(
                'SELECT u.full_name, d.room_number, d.availability_schedule FROM doctors d JOIN users u ON d.user_id = u.id WHERE d.room_number IS NOT NULL AND d.is_available = 1'
            );

            for (const doc of allDoctors) {
                if (!doc.room_number) continue;
                
                let dbRoom = doc.room_number.trim().replace(/\s+/g, ' ').replace(/^r[o]*m[\s\-]*(\d+)/i, 'Room $1');
                dbRoom = dbRoom.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

                if (dbRoom === normalizedRoom) {
                    if (doc.availability_schedule && availability_schedule) {
                        const sched1 = doc.availability_schedule.toLowerCase();
                        const sched2 = availability_schedule.trim().toLowerCase();
                        
                        if (sched1 === sched2 || sched1.includes(sched2) || sched2.includes(sched1)) {
                            return res.render('doctors/add', {
                                title: 'Add New Doctor',
                                activeMenu: 'doctors',
                                departments,
                                errors: [{ msg: `Room conflict: ${normalizedRoom} is already assigned to ${doc.full_name} during an overlapping schedule (${doc.availability_schedule}). Please change the room or schedule.` }],
                                formData: req.body,
                                currentUser: req.session.user
                            });
                        }
                    }
                }
            }
        }

        // Get Doctor role ID
        const doctorRole = await queryOne("SELECT id FROM roles WHERE role_name = 'Doctor'");
        const roleId = doctorRole ? doctorRole.id : 2;

        // Hash password (default: 'doctor123' if empty)
        const plainPassword = password && password.trim() ? password.trim() : 'doctor123';
        const passwordHash = bcrypt.hashSync(plainPassword, 10);

        // 1. Create User Account
        const userResult = await execute(
            `INSERT INTO users (username, email, password_hash, full_name, role_id, department_id, phone, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [username.trim(), email.trim(), passwordHash, full_name.trim(), roleId, department_id, phone ? phone.trim() : null]
        );

        const newUserId = userResult.lastInsertRowid;

        // 2. Create Doctor Profile
        const docResult = await execute(
            `INSERT INTO doctors (user_id, department_id, specialization, qualification, room_number, consultation_fee, availability_schedule, is_available)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
            [
                newUserId, department_id, specialization.trim(),
                qualification ? qualification.trim() : null,
                normalizedRoom,
                consultation_fee ? parseFloat(consultation_fee) : 0.00,
                availability_schedule ? availability_schedule.trim() : 'Mon - Fri (09:00 AM - 04:00 PM)'
            ]
        );

        await auditLog(req.session.user.id, 'DOCTOR_ADDED', 'doctors', docResult.lastInsertRowid, `Registered doctor ${full_name} (${specialization})`, req.ip);

        req.session.successMessage = `Doctor ${full_name} added successfully!`;
        res.redirect(`/doctors/view/${docResult.lastInsertRowid}`);

    } catch (err) {
        console.error('Add doctor error:', err);
        res.render('doctors/add', {
            title: 'Add New Doctor',
            activeMenu: 'doctors',
            departments,
            errors: [{ msg: 'An unexpected database error occurred. Please try again.' }],
            formData: req.body,
            currentUser: req.session.user
        });
    }
});

// -------------------------------------------------
// GET /doctors/view/:id — View Doctor Profile & Appointments
// -------------------------------------------------
router.get('/view/:id', async (req, res) => {
    const docId = req.params.id;

    try {
        const doctor = await queryOne(`
            SELECT doc.*, u.full_name, u.username, u.email, u.phone as user_phone, u.is_active as user_active,
                   d.department_name, d.head_of_dept, d.phone as dept_phone
            FROM doctors doc
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            WHERE doc.id = ?
        `, [docId]);

        if (!doctor) {
            req.session.errorMessage = `Doctor record "#${docId}" not found.`;
            return res.redirect('/doctors');
        }

        // Fetch appointments for this doctor
        const appointments = await queryAll(`
            SELECT a.*, p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.phone as patient_phone, p.gender
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            WHERE a.doctor_id = ?
            ORDER BY a.appointment_date DESC, a.appointment_time ASC
        `, [doctor.id]) || [];

        // Stats
        const totalAppts = appointments.length;
        const completedAppts = appointments.filter(a => a.status === 'Completed').length;
        const scheduledAppts = appointments.filter(a => a.status === 'Scheduled').length;

        res.render('doctors/view', {
            title: `Doctor Profile - ${doctor.full_name}`,
            activeMenu: 'doctors',
            doctor,
            appointments,
            stats: {
                total: totalAppts,
                completed: completedAppts,
                scheduled: scheduledAppts
            },
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('View doctor error:', err);
        req.session.errorMessage = `Could not retrieve details for doctor.`;
        res.redirect('/doctors');
    }
});

// -------------------------------------------------
// GET /doctors/edit/:id — Show Edit Doctor Form
// -------------------------------------------------
router.get('/edit/:id', async (req, res) => {
    const docId = req.params.id;

    try {
        const doctor = await queryOne(`
            SELECT doc.*, u.full_name, u.email, u.phone as user_phone
            FROM doctors doc
            JOIN users u ON doc.user_id = u.id
            WHERE doc.id = ?
        `, [docId]);

        if (!doctor) {
            req.session.errorMessage = 'Doctor not found.';
            return res.redirect('/doctors');
        }

        const departments = await queryAll('SELECT * FROM departments WHERE is_active = 1 ORDER BY department_name ASC') || [];

        res.render('doctors/edit', {
            title: `Edit Doctor - ${doctor.full_name}`,
            activeMenu: 'doctors',
            doctor,
            departments,
            errors: [],
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Edit doctor fetch error:', err);
        res.redirect('/doctors');
    }
});

// -------------------------------------------------
// POST /doctors/edit/:id — Update Doctor Profile
// -------------------------------------------------
router.post('/edit/:id', [
    body('full_name').trim().notEmpty().withMessage('Full Name is required'),
    body('email').trim().notEmpty().withMessage('Email address is required').isEmail().withMessage('Invalid email address'),
    body('department_id').notEmpty().withMessage('Department assignment is required'),
    body('specialization').trim().notEmpty().withMessage('Specialization is required'),
    body('consultation_fee').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Consultation fee must be a positive number'),
    body('phone').optional({ checkFalsy: true }).trim().custom(val => {
        const cleaned = val.replace(/[\s-]/g, '');
        if (!/^(?:\+94|0)\d{9}$/.test(cleaned)) {
            throw new Error("Invalid phone number format. Must contain 10 digits (e.g., 0719876543 or +94719876543).");
        }
        return true;
    })
], async (req, res) => {
    const docId = req.params.id;
    const errors = validationResult(req);
    const departments = await queryAll('SELECT * FROM departments WHERE is_active = 1 ORDER BY department_name ASC') || [];

    if (!errors.isEmpty()) {
        const doctor = { ...req.body, id: docId };
        return res.render('doctors/edit', {
            title: 'Edit Doctor',
            activeMenu: 'doctors',
            doctor,
            departments,
            errors: errors.array(),
            currentUser: req.session.user
        });
    }

    const {
        full_name, email, phone, department_id,
        specialization, qualification, room_number, consultation_fee, availability_schedule
    } = req.body;

    try {
        const existingDoc = await queryOne('SELECT id, user_id FROM doctors WHERE id = ?', [docId]);
        if (!existingDoc) {
            req.session.errorMessage = 'Doctor record not found.';
            return res.redirect('/doctors');
        }

        // Normalize room_number & Check for room & schedule overlap
        let normalizedRoom = null;
        if (room_number && room_number.trim() !== '') {
            // Standardize format: trim spaces, convert 'rm 204', 'room-204', 'Room204' -> 'Room 204', Title Case
            normalizedRoom = room_number.trim().replace(/\s+/g, ' ').replace(/^r[o]*m[\s\-]*(\d+)/i, 'Room $1');
            normalizedRoom = normalizedRoom.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

            // Validate realistic room numbers
            const roomMatch = normalizedRoom.match(/Room\s+(\d+)/i);
            if (roomMatch) {
                const roomNum = parseInt(roomMatch[1], 10);
                if (roomNum <= 0 || roomNum > 999) {
                    const doctor = { ...req.body, id: docId };
                    return res.render('doctors/edit', {
                        title: 'Edit Doctor',
                        activeMenu: 'doctors',
                        doctor,
                        departments,
                        errors: [{ msg: `Room ${roomNum} is invalid. Building room numbers must be realistically bounded between 1 and 999.` }],
                        currentUser: req.session.user
                    });
                }
            }

            const allDoctors = await queryAll(
                'SELECT u.full_name, d.room_number, d.availability_schedule FROM doctors d JOIN users u ON d.user_id = u.id WHERE d.room_number IS NOT NULL AND d.is_available = 1 AND d.id != ?',
                [docId]
            );

            for (const doc of allDoctors) {
                if (!doc.room_number) continue;
                
                let dbRoom = doc.room_number.trim().replace(/\s+/g, ' ').replace(/^r[o]*m[\s\-]*(\d+)/i, 'Room $1');
                dbRoom = dbRoom.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

                if (dbRoom === normalizedRoom) {
                    if (doc.availability_schedule && availability_schedule) {
                        const sched1 = doc.availability_schedule.toLowerCase();
                        const sched2 = availability_schedule.trim().toLowerCase();
                        
                        if (sched1 === sched2 || sched1.includes(sched2) || sched2.includes(sched1)) {
                            const doctor = { ...req.body, id: docId };
                            return res.render('doctors/edit', {
                                title: 'Edit Doctor',
                                activeMenu: 'doctors',
                                doctor,
                                departments,
                                errors: [{ msg: `Room conflict: ${normalizedRoom} is already assigned to ${doc.full_name} during an overlapping schedule (${doc.availability_schedule}). Please change the room or schedule.` }],
                                currentUser: req.session.user
                            });
                        }
                    }
                }
            }
        }

        // Update User info
        await execute(
            `UPDATE users SET full_name = ?, email = ?, phone = ?, department_id = ?, updated_at = ? WHERE id = ?`,
            [full_name.trim(), email.trim(), phone ? phone.trim() : null, department_id, getSLTimestamp(), existingDoc.user_id]
        );

        // Update Doctor profile
        await execute(
            `UPDATE doctors SET
                department_id = ?, specialization = ?, qualification = ?,
                room_number = ?, consultation_fee = ?, availability_schedule = ?
             WHERE id = ?`,
            [
                department_id, specialization.trim(),
                qualification ? qualification.trim() : null,
                normalizedRoom,
                consultation_fee ? parseFloat(consultation_fee) : 0.00,
                availability_schedule ? availability_schedule.trim() : null,
                existingDoc.id
            ]
        );

        await auditLog(req.session.user.id, 'DOCTOR_UPDATED', 'doctors', existingDoc.id, `Updated doctor ${full_name}`, req.ip);

        req.session.successMessage = `Doctor profile for ${full_name} updated successfully.`;
        res.redirect(`/doctors/view/${existingDoc.id}`);

    } catch (err) {
        console.error('Update doctor error:', err);
        req.session.errorMessage = 'An error occurred while updating doctor details.';
        res.redirect('/doctors');
    }
});

// -------------------------------------------------
// POST /doctors/toggle-availability/:id — Toggle Doctor Status
// -------------------------------------------------
router.post('/toggle-availability/:id', async (req, res) => {
    const docId = req.params.id;

    try {
        const doc = await queryOne(`
            SELECT d.id, d.is_available, u.full_name
            FROM doctors d
            JOIN users u ON d.user_id = u.id
            WHERE d.id = ?
        `, [docId]);

        if (doc) {
            const newStatus = doc.is_available === 1 ? 0 : 1;
            await execute('UPDATE doctors SET is_available = ? WHERE id = ?', [newStatus, docId]);

            const statusText = newStatus === 1 ? 'Available' : 'Unavailable/On-Leave';
            await auditLog(req.session.user.id, 'DOCTOR_AVAILABILITY_CHANGED', 'doctors', docId, `Status set to ${statusText}`, req.ip);

            req.session.successMessage = `${doc.full_name} availability updated to ${statusText}.`;
        }
        res.redirect('/doctors');

    } catch (err) {
        console.error('Toggle doctor availability error:', err);
        res.redirect('/doctors');
    }
});

// -------------------------------------------------
// POST /doctors/delete/:id — Hard Delete Doctor
// -------------------------------------------------
router.post('/delete/:id', async (req, res) => {
    const docId = req.params.id;

    try {
        const doc = await queryOne('SELECT * FROM doctors WHERE id = ?', [docId]);
        if (!doc) {
            req.session.errorMessage = 'Doctor not found.';
            return res.redirect('/doctors');
        }

        const apptCount = await queryOne('SELECT COUNT(*) as cnt FROM appointments WHERE doctor_id = ?', [docId]);
        if (apptCount.cnt > 0) {
            req.session.errorMessage = 'Cannot permanently delete a doctor who has historical or active appointments. Please use the availability toggle instead.';
            return res.redirect('/doctors');
        }

        const userId = doc.user_id;

        // Hard Delete (Enforces cascade removal of doctor safely since they have 0 appointments)
        await execute('DELETE FROM doctors WHERE id = ?', [docId]);
        await execute('DELETE FROM users WHERE id = ?', [userId]);

        await auditLog(req.session.user.id, 'DOCTOR_DELETED', 'doctors', docId, `Permanently deleted dummy doctor record (User ID: ${userId})`, req.ip);

        req.session.successMessage = `Doctor record was permanently deleted from the database.`;
        res.redirect('/doctors');

    } catch (err) {
        console.error('Delete doctor error:', err);
        req.session.errorMessage = 'An error occurred while deleting the doctor.';
        res.redirect('/doctors');
    }
});

module.exports = router;

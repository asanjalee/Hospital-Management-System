// =====================================================
// Appointment Management Routes (Booking, Rescheduling, Status Tracking) - MySQL Async
// =====================================================
const express = require('express');
const router = express.Router();
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

// Generate unique appointment number (APT-YYYY-XXXX)
async function generateAppointmentNumber() {
    const year = new Date().getFullYear();
    const countResult = await queryOne('SELECT COUNT(*) as total FROM appointments');
    const nextNum = (countResult ? countResult.total + 1 : 1).toString().padStart(4, '0');
    return `APT-${year}-${nextNum}`;
}

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Doctor', 'Nurse', 'Receptionist'));

// -------------------------------------------------
// GET /appointments — List & Schedule Calendar View
// -------------------------------------------------
router.get('/', async (req, res) => {
    const viewMode = req.query.view || 'list'; // 'list' or 'schedule'
    const search = req.query.search ? req.query.search.trim() : '';
    const status = req.query.status || '';
    const doctorId = req.query.doctor_id || '';
    const selectedDate = req.query.date || '';

    let sql = `
        SELECT a.*, 
               p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.phone as patient_phone, p.gender as patient_gender,
               u.full_name as doctor_name, doc.specialization, doc.room_number, doc.consultation_fee,
               d.department_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN doctors doc ON a.doctor_id = doc.id
        JOIN users u ON doc.user_id = u.id
        JOIN departments d ON doc.department_id = d.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        sql += ` AND (a.appointment_number LIKE ? OR p.patient_uid LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR u.full_name LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term, term);
    }

    if (status) {
        sql += ` AND a.status = ?`;
        params.push(status);
    }

    if (doctorId) {
        sql += ` AND a.doctor_id = ?`;
        params.push(doctorId);
    }

    if (selectedDate) {
        sql += ` AND a.appointment_date = ?`;
        params.push(selectedDate);
    }

    sql += ` ORDER BY a.id DESC`;

    try {
        const appointments = await queryAll(sql, params) || [];

        // Active doctors for filter dropdown
        const doctors = await queryAll(`
            SELECT doc.id, u.full_name, doc.specialization, d.department_name
            FROM doctors doc
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            WHERE doc.is_available = 1
            ORDER BY u.full_name ASC
        `) || [];

        // Today's date string (YYYY-MM-DD)
        const todayStr = new Date().toISOString().split('T')[0];

        // Overall stats
        const stats = {
            total: (await queryOne('SELECT COUNT(*) as cnt FROM appointments'))?.cnt || 0,
            today: (await queryOne('SELECT COUNT(*) as cnt FROM appointments WHERE appointment_date = ? AND status != "Cancelled"', [todayStr]))?.cnt || 0,
            scheduled: (await queryOne('SELECT COUNT(*) as cnt FROM appointments WHERE status = "Scheduled"'))?.cnt || 0,
            completed: (await queryOne('SELECT COUNT(*) as cnt FROM appointments WHERE status = "Completed"'))?.cnt || 0,
            cancelled: (await queryOne('SELECT COUNT(*) as cnt FROM appointments WHERE status = "Cancelled"'))?.cnt || 0
        };

        res.render('appointments/index', {
            title: 'Appointment Management',
            activeMenu: 'appointments',
            viewMode,
            appointments,
            doctors,
            search,
            status,
            doctorId,
            selectedDate,
            todayStr,
            stats,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('Appointment list error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /appointments/book — Show Book Appointment Form
// -------------------------------------------------
router.get('/book', async (req, res) => {
    const prePatientId = req.query.patient_id || '';
    const preDoctorId = req.query.doctor_id || '';
    const preDate = req.query.date || new Date().toISOString().split('T')[0];
    const preTime = req.query.time || '09:00 AM';

    try {
        const autoNumber = await generateAppointmentNumber();

        // Fetch active patients
        const patients = await queryAll(`
            SELECT id, patient_uid, first_name, last_name, phone, nic_number
            FROM patients
            WHERE is_active = 1
            ORDER BY first_name ASC
        `) || [];

        // Fetch available doctors
        const doctors = await queryAll(`
            SELECT doc.id, doc.availability_schedule, u.full_name, doc.specialization, doc.room_number, doc.consultation_fee, d.department_name
            FROM doctors doc
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            WHERE doc.is_available = 1
            ORDER BY u.full_name ASC
        `) || [];

        // Fetch all upcoming booked slots across all doctors to block double bookings dynamically on the client
        const scheduledAppts = await queryAll(`SELECT doctor_id, DATE_FORMAT(appointment_date, '%Y-%m-%d') as date_str, appointment_time FROM appointments WHERE status = 'Scheduled' AND appointment_date >= CURDATE()`) || [];

        res.render('appointments/book', {
            title: 'Book New Appointment',
            activeMenu: 'appointments',
            autoNumber,
            patients,
            doctors,
            scheduledAppts,
            todayDate: getSLTimestamp().split(' ')[0],
            prePatientId,
            preDoctorId,
            preDate,
            preTime,
            errors: [],
            formData: {
                patient_id: prePatientId,
                doctor_id: preDoctorId,
                appointment_date: preDate,
                appointment_time: preTime
            },
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Book appointment view error:', err);
        res.redirect('/appointments');
    }
});

// -------------------------------------------------
// POST /appointments/book — Save New Appointment Booking
// -------------------------------------------------
router.post('/book', [
    body('patient_id').notEmpty().withMessage('Patient selection is required'),
    body('doctor_id').notEmpty().withMessage('Doctor selection is required'),
    body('appointment_date').notEmpty().isISO8601().withMessage('Valid appointment date is required'),
    body('appointment_time').notEmpty().withMessage('Appointment time slot is required')
], async (req, res) => {
    const errors = validationResult(req);

    const patients = await queryAll('SELECT id, patient_uid, first_name, last_name, phone FROM patients WHERE is_active = 1 ORDER BY first_name ASC') || [];
    const doctors = await queryAll('SELECT doc.id, doc.availability_schedule, u.full_name, doc.specialization, doc.room_number, doc.consultation_fee, d.department_name FROM doctors doc JOIN users u ON doc.user_id = u.id JOIN departments d ON doc.department_id = d.id WHERE doc.is_available = 1 ORDER BY u.full_name ASC') || [];
    const scheduledAppts = await queryAll(`SELECT doctor_id, DATE_FORMAT(appointment_date, '%Y-%m-%d') as date_str, appointment_time FROM appointments WHERE status = 'Scheduled' AND appointment_date >= CURDATE()`) || [];

    if (!errors.isEmpty()) {
        return res.render('appointments/book', {
            title: 'Book New Appointment',
            activeMenu: 'appointments',
            autoNumber: req.body.appointment_number || await generateAppointmentNumber(),
            patients,
            doctors,
            scheduledAppts,
            todayDate: getSLTimestamp().split(' ')[0],
            prePatientId: req.body.patient_id || '',
            preDoctorId: req.body.doctor_id || '',
            preDate: req.body.appointment_date || '',
            preTime: req.body.appointment_time || '',
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const { appointment_number, patient_id, doctor_id, appointment_date, appointment_time, reason, notes } = req.body;

    try {
        // 0. Past Date/Time Validation
        const slTimeFull = getSLTimestamp(); // "YYYY-MM-DD HH:MM:SS"
        const currentSLDate = slTimeFull.split(' ')[0];
        
        if (appointment_date < currentSLDate) {
            return res.render('appointments/book', {
                title: 'Book New Appointment',
                activeMenu: 'appointments',
                autoNumber: appointment_number || await generateAppointmentNumber(),
                patients, doctors, scheduledAppts, todayDate: currentSLDate, prePatientId: patient_id, preDoctorId: doctor_id, preDate: appointment_date, preTime: appointment_time,
                errors: [{ msg: 'Cannot book appointments for past dates. Please select today or a future date.' }],
                formData: req.body, currentUser: req.session.user
            });
        }
        
        if (appointment_date === currentSLDate) {
            const timeParts = appointment_time.trim().split(' ');
            if (timeParts.length === 2) {
                const clockParts = timeParts[0].split(':');
                let h = parseInt(clockParts[0], 10);
                const m = parseInt(clockParts[1], 10);
                if (timeParts[1].toUpperCase() === 'PM' && h < 12) h += 12;
                if (timeParts[1].toUpperCase() === 'AM' && h === 12) h = 0;
                
                const currTime = slTimeFull.split(' ')[1].split(':');
                const currH = parseInt(currTime[0], 10);
                const currM = parseInt(currTime[1], 10);
                
                if (h < currH || (h === currH && m <= currM)) {
                    return res.render('appointments/book', {
                        title: 'Book New Appointment',
                        activeMenu: 'appointments',
                        autoNumber: appointment_number || await generateAppointmentNumber(),
                        patients, doctors, scheduledAppts, todayDate: currentSLDate, prePatientId: patient_id, preDoctorId: doctor_id, preDate: appointment_date, preTime: appointment_time,
                        errors: [{ msg: `Cannot book past time slots for today. The time ${appointment_time} has already elapsed.` }],
                        formData: req.body, currentUser: req.session.user
                    });
                }
            }
        }
        
        // 1. Strict Schedule Validation Check
        const doctorData = doctors.find(d => d.id == doctor_id);
        if (doctorData && doctorData.availability_schedule) {
            const dateObj = new Date(appointment_date);
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const selectedDay = dayNames[dateObj.getDay()];
            
            const scheduleLower = doctorData.availability_schedule.toLowerCase();
            const dayLower = selectedDay.toLowerCase();
            
            let worksToday = false;
            if (scheduleLower.includes('everyday') || scheduleLower.includes('daily')) worksToday = true;
            else if ((scheduleLower.includes('mon - fri') || scheduleLower.includes('mon-fri') || scheduleLower.includes('weekdays')) && ['mon','tue','wed','thu','fri'].includes(dayLower)) worksToday = true;
            else if (scheduleLower.includes(dayLower)) worksToday = true;
            
            if (!worksToday) {
                return res.render('appointments/book', {
                    title: 'Book New Appointment',
                    activeMenu: 'appointments',
                    autoNumber: appointment_number || await generateAppointmentNumber(),
                    patients, doctors, scheduledAppts, prePatientId: patient_id, preDoctorId: doctor_id, preDate: appointment_date, preTime: appointment_time,
                    todayDate: getSLTimestamp().split(' ')[0],
                    errors: [{ msg: `Schedule Violation: ${doctorData.full_name} is strictly unavailable on ${selectedDay}days. Their official schedule is: ${doctorData.availability_schedule}.` }],
                    formData: req.body, currentUser: req.session.user
                });
            }
        }

        // 2. Conflict Check: Check if doctor is already booked at the exact same date & time
        const conflict = await queryOne(`
            SELECT id FROM appointments 
            WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status = 'Scheduled'
        `, [doctor_id, appointment_date, appointment_time]);

        if (conflict) {
            return res.render('appointments/book', {
                title: 'Book New Appointment',
                activeMenu: 'appointments',
                autoNumber: appointment_number || await generateAppointmentNumber(),
                patients,
                doctors,
                scheduledAppts,
                todayDate: getSLTimestamp().split(' ')[0],
                prePatientId: patient_id,
                preDoctorId: doctor_id,
                preDate: appointment_date,
                preTime: appointment_time,
                errors: [{ msg: 'The selected doctor is already booked for this date and time slot. Please choose another time slot or doctor.' }],
                formData: req.body,
                currentUser: req.session.user
            });
        }

        const aptNum = appointment_number && appointment_number.trim() ? appointment_number.trim() : await generateAppointmentNumber();

        const result = await execute(`
            INSERT INTO appointments (
                appointment_number, patient_id, doctor_id, appointment_date, appointment_time,
                status, reason, notes, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?, ?, ?)
        `, [
            aptNum, patient_id, doctor_id, appointment_date, appointment_time,
            reason ? reason.trim() : null,
            notes ? notes.trim() : null,
            req.session.user.id,
            getSLTimestamp(),
            getSLTimestamp()
        ]);

        await auditLog(req.session.user.id, 'APPOINTMENT_BOOKED', 'appointments', result.lastInsertRowid, `Booked appointment ${aptNum} for date ${appointment_date} at ${appointment_time}`, req.ip);

        req.session.successMessage = `Appointment ${aptNum} booked successfully!`;
        res.redirect(`/appointments/view/${result.lastInsertRowid}`);

    } catch (err) {
        console.error('Book appointment error:', err);
        res.render('appointments/book', {
            title: 'Book New Appointment',
            activeMenu: 'appointments',
            autoNumber: req.body.appointment_number || await generateAppointmentNumber(),
            patients,
            doctors,
            prePatientId: req.body.patient_id || '',
            preDoctorId: req.body.doctor_id || '',
            preDate: req.body.appointment_date || '',
            preTime: req.body.appointment_time || '',
            errors: [{ msg: 'An unexpected error occurred while saving the appointment.' }],
            formData: req.body,
            currentUser: req.session.user
        });
    }
});

// -------------------------------------------------
// GET /appointments/view/:id — View Appointment Details
// -------------------------------------------------
router.get('/view/:id', async (req, res) => {
    const aptId = req.params.id;

    try {
        const appointment = await queryOne(`
            SELECT a.*, 
                   p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.phone as patient_phone, p.email as patient_email, p.gender as patient_gender, p.date_of_birth, p.blood_group, p.id as patient_pk,
                   u.full_name as doctor_name, doc.specialization, doc.room_number, doc.consultation_fee, doc.id as doctor_pk,
                   d.department_name, creator.full_name as created_by_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors doc ON a.doctor_id = doc.id
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            LEFT JOIN users creator ON a.created_by = creator.id
            WHERE a.id = ? OR a.appointment_number = ?
        `, [aptId, aptId]);

        if (!appointment) {
            req.session.errorMessage = `Appointment record "${aptId}" not found.`;
            return res.redirect('/appointments');
        }

        // Fetch recent medical history for patient context
        const medicalRecords = await queryAll(`
            SELECT * FROM medical_history WHERE patient_id = ? ORDER BY visit_date DESC LIMIT 3
        `, [appointment.patient_pk]) || [];

        res.render('appointments/view', {
            title: `Appointment ${appointment.appointment_number}`,
            activeMenu: 'appointments',
            appointment,
            medicalRecords,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('View appointment error:', err);
        req.session.errorMessage = `Could not retrieve appointment details.`;
        res.redirect('/appointments');
    }
});

// -------------------------------------------------
// POST /appointments/status/:id — Update Status (Completed, Cancelled, No-Show)
// -------------------------------------------------
router.post('/status/:id', async (req, res) => {
    const aptId = req.params.id;
    const { status, notes } = req.body;

    const validStatuses = ['Scheduled', 'Completed', 'Cancelled', 'No-Show'];
    if (!validStatuses.includes(status)) {
        req.session.errorMessage = 'Invalid appointment status specified.';
        return res.redirect(`/appointments/view/${aptId}`);
    }

    try {
        const apt = await queryOne('SELECT appointment_number FROM appointments WHERE id = ?', [aptId]);
        if (!apt) {
            req.session.errorMessage = 'Appointment record not found.';
            return res.redirect('/appointments');
        }

        await execute(`
            UPDATE appointments SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?
        `, [status, notes ? notes.trim() : null, getSLTimestamp(), aptId]);

        await auditLog(req.session.user.id, `APPOINTMENT_${status.toUpperCase()}`, 'appointments', aptId, `Appointment ${apt.appointment_number} marked as ${status}`, req.ip);

        req.session.successMessage = `Appointment ${apt.appointment_number} marked as ${status}.`;
        res.redirect(`/appointments/view/${aptId}`);

    } catch (err) {
        console.error('Update appointment status error:', err);
        req.session.errorMessage = 'Failed to update appointment status.';
        res.redirect('/appointments');
    }
});

// -------------------------------------------------
// GET /appointments/reschedule/:id — Show Reschedule Form
// -------------------------------------------------
router.get('/reschedule/:id', async (req, res) => {
    const aptId = req.params.id;

    try {
        const appointment = await queryOne(`
            SELECT a.*, 
                   p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name,
                   u.full_name as doctor_name, doc.specialization, d.department_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors doc ON a.doctor_id = doc.id
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            WHERE a.id = ?
        `, [aptId]);

        if (!appointment) {
            req.session.errorMessage = 'Appointment record not found.';
            return res.redirect('/appointments');
        }

        const doctors = await queryAll(`
            SELECT doc.id, doc.availability_schedule, u.full_name, doc.specialization, d.department_name
            FROM doctors doc
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            WHERE doc.is_available = 1
            ORDER BY u.full_name ASC
        `) || [];

        const scheduledAppts = await queryAll(`SELECT doctor_id, DATE_FORMAT(appointment_date, '%Y-%m-%d') as date_str, appointment_time FROM appointments WHERE status = 'Scheduled' AND appointment_date >= CURDATE()`) || [];

        res.render('appointments/reschedule', {
            title: `Reschedule ${appointment.appointment_number}`,
            activeMenu: 'appointments',
            appointment,
            doctors,
            scheduledAppts,
            todayDate: getSLTimestamp().split(' ')[0],
            errors: [],
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Reschedule fetch error:', err);
        res.redirect('/appointments');
    }
});

// -------------------------------------------------
// POST /appointments/reschedule/:id — Save Rescheduled Details
// -------------------------------------------------
router.post('/reschedule/:id', [
    body('doctor_id').notEmpty().withMessage('Doctor selection is required'),
    body('appointment_date').notEmpty().isISO8601().withMessage('Valid appointment date is required'),
    body('appointment_time').notEmpty().withMessage('Appointment time slot is required')
], async (req, res) => {
    const aptId = req.params.id;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const appointment = { ...req.body, id: aptId };
        const doctors = await queryAll('SELECT doc.id, doc.availability_schedule, u.full_name, doc.specialization, d.department_name FROM doctors doc JOIN users u ON doc.user_id = u.id JOIN departments d ON doc.department_id = d.id WHERE doc.is_available = 1 ORDER BY u.full_name ASC') || [];
        const scheduledAppts = await queryAll(`SELECT doctor_id, DATE_FORMAT(appointment_date, '%Y-%m-%d') as date_str, appointment_time FROM appointments WHERE status = 'Scheduled' AND appointment_date >= CURDATE()`) || [];
        return res.render('appointments/reschedule', {
            title: 'Reschedule Appointment',
            activeMenu: 'appointments',
            appointment,
            doctors,
            scheduledAppts,
            todayDate: getSLTimestamp().split(' ')[0],
            errors: errors.array(),
            currentUser: req.session.user
        });
    }

    const { doctor_id, appointment_date, appointment_time, reason, notes } = req.body;

    try {
        const existingApt = await queryOne('SELECT appointment_number FROM appointments WHERE id = ?', [aptId]);
        if (!existingApt) {
            req.session.errorMessage = 'Appointment not found.';
            return res.redirect('/appointments');
        }

        const doctors = await queryAll('SELECT doc.id, doc.availability_schedule, u.full_name, doc.specialization, d.department_name FROM doctors doc JOIN users u ON doc.user_id = u.id JOIN departments d ON doc.department_id = d.id WHERE doc.is_available = 1 ORDER BY u.full_name ASC') || [];
        const scheduledAppts = await queryAll(`SELECT doctor_id, DATE_FORMAT(appointment_date, '%Y-%m-%d') as date_str, appointment_time FROM appointments WHERE status = 'Scheduled' AND appointment_date >= CURDATE()`) || [];
        const combinedApt = { ...req.body, id: aptId, appointment_number: existingApt.appointment_number, patient_first_name: '', patient_last_name: '', patient_uid: '' }; // Dummy fills to avoid ejs undefined crashes in error rendering if missing

        const slTimeFull = getSLTimestamp();
        const currentSLDate = slTimeFull.split(' ')[0];
        
        if (appointment_date < currentSLDate) {
            return res.render('appointments/reschedule', {
                title: 'Reschedule Appointment', activeMenu: 'appointments',
                appointment: combinedApt, doctors, scheduledAppts, todayDate: currentSLDate,
                errors: [{ msg: 'Cannot reschedule appointments to past dates. Please select today or a future date.' }],
                currentUser: req.session.user
            });
        }
        
        if (appointment_date === currentSLDate) {
            const timeParts = appointment_time.trim().split(' ');
            if (timeParts.length === 2) {
                const clockParts = timeParts[0].split(':');
                let h = parseInt(clockParts[0], 10);
                const m = parseInt(clockParts[1], 10);
                if (timeParts[1].toUpperCase() === 'PM' && h < 12) h += 12;
                if (timeParts[1].toUpperCase() === 'AM' && h === 12) h = 0;
                
                const currTime = slTimeFull.split(' ')[1].split(':');
                const currH = parseInt(currTime[0], 10);
                const currM = parseInt(currTime[1], 10);
                
                if (h < currH || (h === currH && m <= currM)) {
                    return res.render('appointments/reschedule', {
                        title: 'Reschedule Appointment', activeMenu: 'appointments',
                        appointment: combinedApt, doctors, scheduledAppts, todayDate: currentSLDate,
                        errors: [{ msg: `Cannot book past time slots for today. The time ${appointment_time} has already elapsed.` }],
                        currentUser: req.session.user
                    });
                }
            }
        }
        
        const doctorData = doctors.find(d => d.id == doctor_id);
        if (doctorData && doctorData.availability_schedule) {
            const dateObj = new Date(appointment_date);
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const selectedDay = dayNames[dateObj.getDay()];
            const scheduleLower = doctorData.availability_schedule.toLowerCase();
            const dayLower = selectedDay.toLowerCase();
            let worksToday = false;
            
            if (scheduleLower.includes('everyday') || scheduleLower.includes('daily')) worksToday = true;
            else if ((scheduleLower.includes('mon - fri') || scheduleLower.includes('mon-fri') || scheduleLower.includes('weekdays')) && ['mon','tue','wed','thu','fri'].includes(dayLower)) worksToday = true;
            else if (scheduleLower.includes(dayLower)) worksToday = true;
            
            if (!worksToday) {
                return res.render('appointments/reschedule', {
                    title: 'Reschedule Appointment', activeMenu: 'appointments',
                    appointment: combinedApt, doctors, scheduledAppts, todayDate: currentSLDate,
                    errors: [{ msg: `Schedule Violation: ${doctorData.full_name} is strictly unavailable on ${selectedDay}days. Their official schedule is: ${doctorData.availability_schedule}.` }],
                    currentUser: req.session.user
                });
            }
        }

        // Conflict check excluding current appointment
        const conflict = await queryOne(`
            SELECT id FROM appointments
            WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status = 'Scheduled' AND id != ?
        `, [doctor_id, appointment_date, appointment_time, aptId]);

        if (conflict) {
            return res.render('appointments/reschedule', {
                title: 'Reschedule Appointment',
                activeMenu: 'appointments',
                appointment: combinedApt,
                doctors,
                scheduledAppts,
                todayDate: currentSLDate,
                errors: [{ msg: 'The selected doctor is already booked for this date and time slot.' }],
                currentUser: req.session.user
            });
        }

        await execute(`
            UPDATE appointments SET
                doctor_id = ?, appointment_date = ?, appointment_time = ?,
                status = 'Scheduled', reason = COALESCE(?, reason), notes = COALESCE(?, notes),
                updated_at = ?
            WHERE id = ?
        `, [doctor_id, appointment_date, appointment_time, reason ? reason.trim() : null, notes ? notes.trim() : null, getSLTimestamp(), aptId]);

        await auditLog(req.session.user.id, 'APPOINTMENT_RESCHEDULED', 'appointments', aptId, `Rescheduled ${existingApt.appointment_number} to ${appointment_date} at ${appointment_time}`, req.ip);

        req.session.successMessage = `Appointment ${existingApt.appointment_number} rescheduled successfully.`;
        res.redirect(`/appointments/view/${aptId}`);

    } catch (err) {
        console.error('Reschedule appointment error:', err);
        req.session.errorMessage = 'Failed to reschedule appointment.';
        res.redirect('/appointments');
    }
});

module.exports = router;

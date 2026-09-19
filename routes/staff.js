// =====================================================
// Staff Management Router (Section 3.9 Specification)
// =====================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
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

// Generate unique Employee Code (EMP-YYYY-XXXX)
async function generateEmployeeCode() {
    const year = new Date().getFullYear();
    const countResult = await queryOne('SELECT COUNT(*) as total FROM staff');
    const nextNum = (countResult ? countResult.total + 1 : 1).toString().padStart(4, '0');
    return `EMP-${year}-${nextNum}`;
}

// Apply authentication & authorization guard
router.use(isAuthenticated);
// PER SPEC: Staff directory readable by all authenticated roles;
// HR write operations (add/edit/deactivate/attendance/leaves) are Administrator only.
router.use(authorize(
    'Administrator', 'Doctor', 'Nurse', 'Receptionist',
    'Accountant', 'Pharmacist', 'Lab Technician'
));

// -------------------------------------------------
// GET /staff — Staff Directory & Attendance Overview
// -------------------------------------------------
router.get('/', async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const departmentId = req.query.department_id || '';
    const status = req.query.status || '';
    const activeTab = req.query.tab || 'directory'; // 'directory', 'attendance', 'leaves'

    let sql = `
        SELECT s.*, 
               r.role_name, 
               d.department_name
        FROM staff s
        JOIN roles r ON s.role_id = r.id
        LEFT JOIN departments d ON s.department_id = d.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        sql += ` AND (s.employee_code LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR s.email LIKE ? OR s.designation LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term, term);
    }

    if (departmentId) {
        sql += ` AND s.department_id = ?`;
        params.push(departmentId);
    }

    if (status) {
        sql += ` AND s.employment_status = ?`;
        params.push(status);
    }

    sql += ` ORDER BY s.id DESC`;

    try {
        const staffMembers = await queryAll(sql, params) || [];
        const departments = await queryAll(`SELECT id, department_name FROM departments ORDER BY department_name ASC`) || [];
        const roles = await queryAll(`SELECT id, role_name FROM roles ORDER BY role_name ASC`) || [];

        const todayStr = new Date().toISOString().split('T')[0];

        // Fetch Today's Attendance
        const attendanceList = await queryAll(`
            SELECT sa.*, s.employee_code, s.first_name, s.last_name, s.designation, d.department_name
            FROM staff_attendance sa
            JOIN staff s ON sa.staff_id = s.id
            LEFT JOIN departments d ON s.department_id = d.id
            WHERE sa.attendance_date = ?
            ORDER BY sa.id DESC
        `, [todayStr]) || [];

        // Fetch Recent Leave Requests
        const leaveRequests = await queryAll(`
            SELECT sl.*, s.employee_code, s.first_name, s.last_name, s.designation, d.department_name, u.full_name as approver_name
            FROM staff_leaves sl
            JOIN staff s ON sl.staff_id = s.id
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN users u ON sl.approved_by = u.id
            ORDER BY sl.id DESC
        `) || [];

        const stats = {
            totalStaff: (await queryOne('SELECT COUNT(*) as cnt FROM staff'))?.cnt || 0,
            activeStaff: (await queryOne('SELECT COUNT(*) as cnt FROM staff WHERE is_active = 1 AND employment_status != "Terminated"'))?.cnt || 0,
            todayPresent: (await queryOne('SELECT COUNT(*) as cnt FROM staff_attendance WHERE attendance_date = ? AND status IN ("Present", "Late", "Half Day")', [todayStr]))?.cnt || 0,
            pendingLeaves: (await queryOne('SELECT COUNT(*) as cnt FROM staff_leaves WHERE status = "Pending"'))?.cnt || 0
        };

        // Fetch Role-wise Distribution (Excluding non-HR System Roles)
        const roleDistribution = await queryAll(`
            SELECT r.role_name, COUNT(s.id) as staff_count 
            FROM roles r 
            LEFT JOIN staff s ON r.id = s.role_id AND s.is_active = 1 AND s.employment_status != 'Terminated'
            WHERE r.role_name NOT IN ('Doctor', 'Administrator', 'Patient')
            GROUP BY r.id, r.role_name 
            ORDER BY staff_count DESC, r.role_name ASC
        `) || [];

        res.render('staff/index', {
            title: 'Staff & HR Management',
            activeMenu: 'staff',
            activeTab,
            staffMembers,
            departments,
            roles,
            attendanceList,
            leaveRequests,
            roleDistribution,
            search,
            departmentId,
            status,
            todayStr,
            stats,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('Staff directory error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /staff/add — Show Registration Form (Admin only)
// -------------------------------------------------
router.get('/add', authorize('Administrator'), async (req, res) => {
    try {
        const autoCode = await generateEmployeeCode();
        const departments = await queryAll(`SELECT id, department_name FROM departments WHERE department_type IN ('Operational', 'Shared') ORDER BY department_name ASC`) || [];
        const roles = await queryAll(`SELECT id, role_name FROM roles WHERE role_name NOT IN ('Doctor', 'Administrator', 'Patient') ORDER BY role_name ASC`) || [];
        const todayStr = new Date().toISOString().split('T')[0];

        res.render('staff/add', {
            title: 'Register Staff Member',
            activeMenu: 'staff',
            autoCode,
            departments,
            roles,
            todayStr,
            errors: [],
            formData: { employee_code: autoCode, joining_date: todayStr },
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('Add staff view error:', err);
        res.redirect('/staff');
    }
});

// -------------------------------------------------
// POST /staff/add — Create Staff Record (Admin only)
// -------------------------------------------------
router.post('/add', authorize('Administrator'), [
    body('first_name').trim().notEmpty().withMessage('First Name is required'),
    body('last_name').trim().notEmpty().withMessage('Last Name is required'),
    body('email').isEmail().withMessage('Valid email address is required'),
    body('phone').optional({ checkFalsy: true }).customSanitizer(val => val ? val.replace(/[\s-]/g, '') : val).matches(/^\+94\d{9}$/).withMessage('Phone must be strictly formatted as +94xxxxxxxxx'),
    body('nic_number').optional({ checkFalsy: true }).matches(/^([0-9]{9}[xXvV]|[0-9]{12})$/).withMessage('NIC strictly requires standard 9 digits+V/X or 12 digits format'),
    body('salary').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Monthly Salary must be a valid positive number'),
    body('role_id').notEmpty().withMessage('Role assignment is required'),
    body('designation').trim().notEmpty().withMessage('Designation is required')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const departments = await queryAll(`SELECT id, department_name FROM departments WHERE department_type IN ('Operational', 'Shared') ORDER BY department_name ASC`) || [];
        const roles = await queryAll(`SELECT id, role_name FROM roles WHERE role_name NOT IN ('Doctor', 'Administrator', 'Patient') ORDER BY role_name ASC`) || [];

        return res.render('staff/add', {
            title: 'Register Staff Member',
            activeMenu: 'staff',
            autoCode: req.body.employee_code || await generateEmployeeCode(),
            departments,
            roles,
            todayStr: new Date().toISOString().split('T')[0],
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const {
        employee_code, first_name, last_name, email, phone, nic_number,
        role_id, department_id, designation, joining_date, salary, employment_status, provision_login
    } = req.body;

    try {
        const code = employee_code && employee_code.trim() ? employee_code.trim() : await generateEmployeeCode();

        const result = await execute(`
            INSERT INTO staff (
                employee_code, first_name, last_name, email, phone, nic_number,
                role_id, department_id, designation, joining_date, salary, employment_status, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            code,
            first_name.trim(),
            last_name.trim(),
            email.trim().toLowerCase(),
            phone ? phone.trim() : null,
            nic_number ? nic_number.trim() : null,
            role_id,
            department_id ? department_id : null,
            designation.trim(),
            joining_date ? joining_date : null,
            salary ? parseFloat(salary) : 0.00,
            employment_status || 'Full-Time'
        ]);

        await auditLog(req.session.user.id, 'STAFF_REGISTERED', 'staff', result.lastInsertRowid, `Registered staff member ${first_name} ${last_name} (${code}) as ${designation}`, req.ip);

        let loginMessage = '';
        if (provision_login === 'yes') {
            const tempPassword = 'Hosp@' + Math.floor(1000 + Math.random() * 9000);
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            
            await execute(`
                INSERT INTO users (username, full_name, email, phone, password_hash, role_id, department_id, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                email.trim().toLowerCase().split('@')[0],
                `${first_name.trim()} ${last_name.trim()}`,
                email.trim().toLowerCase(),
                phone ? phone.trim() : null,
                hashedPassword,
                role_id,
                department_id ? department_id : null
            ]);
            
            loginMessage = ` System login provisioned! Username: ${email.trim().toLowerCase().split('@')[0]} (Temp Password: ${tempPassword})`;
            await auditLog(req.session.user.id, 'USER_CREATED', 'users', null, `Auto-provisioned system access for ${email}`, req.ip);
        }

        req.session.successMessage = `Staff member ${first_name} ${last_name} (${code}) registered successfully!${loginMessage}`;
        res.redirect(`/staff/view/${result.lastInsertRowid}`);

    } catch (err) {
        console.error('Save staff error:', err);
        let errorMsg = 'Failed to register staff member. Please check input parameters.';
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.message.includes('email')) {
                errorMsg = 'This Email Address is already registered to an existing employee!';
            } else if (err.message.includes('nic_number')) {
                errorMsg = 'This NIC Number is already registered to an existing employee!';
            } else if (err.message.includes('employee_code')) {
                errorMsg = 'This Employee Code already exists. Please generate another one.';
            } else {
                errorMsg = 'A duplicate entry exists (Email, NIC, or Code).';
            }
        }

        const departments = await queryAll(`SELECT id, department_name FROM departments WHERE department_type IN ('Operational', 'Shared') ORDER BY department_name ASC`) || [];
        const roles = await queryAll(`SELECT id, role_name FROM roles WHERE role_name NOT IN ('Doctor', 'Administrator', 'Patient') ORDER BY role_name ASC`) || [];

        return res.render('staff/add', {
            title: 'Register Staff Member',
            activeMenu: 'staff',
            autoCode: req.body.employee_code || await generateEmployeeCode(),
            departments,
            roles,
            todayStr: new Date().toISOString().split('T')[0],
            errors: [{ msg: errorMsg }],
            formData: req.body,
            currentUser: req.session.user
        });
    }
});

// -------------------------------------------------
// GET /staff/view/:id — View Employee Profile
// -------------------------------------------------
router.get('/view/:id', async (req, res) => {
    const staffId = req.params.id;

    try {
        const staff = await queryOne(`
            SELECT s.*, r.role_name, d.department_name,
                   u.id AS system_user_id, u.username AS system_username, u.email AS system_email, u.is_active AS system_is_active
            FROM staff s
            JOIN roles r ON s.role_id = r.id
            LEFT JOIN departments d ON s.department_id = d.id
            LEFT JOIN users u ON LOWER(TRIM(s.email)) = LOWER(TRIM(u.email))
            WHERE s.id = ? OR s.employee_code = ?
        `, [staffId, staffId]);

        if (staff && staff.system_user_id) {
            staff.system_user = {
                id: staff.system_user_id,
                username: staff.system_username,
                email: staff.system_email,
                is_active: staff.system_is_active
            };
        }

        if (!staff) {
            req.session.errorMessage = 'Staff member record not found.';
            return res.redirect('/staff');
        }

        const attendance = await queryAll(`
            SELECT * FROM staff_attendance WHERE staff_id = ? ORDER BY attendance_date DESC LIMIT 30
        `, [staff.id]) || [];

        const leaves = await queryAll(`
            SELECT sl.*, u.full_name as approver_name
            FROM staff_leaves sl
            LEFT JOIN users u ON sl.approved_by = u.id
            WHERE sl.staff_id = ?
            ORDER BY sl.start_date DESC
        `, [staff.id]) || [];

        res.render('staff/view', {
            title: `Staff Profile - ${staff.first_name} ${staff.last_name}`,
            activeMenu: 'staff',
            staff,
            attendance,
            leaves,
            currentUser: req.session.user
        });
    } catch (err) {
        console.error('View staff error:', err);
        res.redirect('/staff');
    }
});

// -------------------------------------------------
// GET /staff/edit/:id — Show Edit Staff Form (Admin only)
// -------------------------------------------------
router.get('/edit/:id', authorize('Administrator'), async (req, res) => {
    const staffId = req.params.id;

    try {
        const staff = await queryOne(`SELECT * FROM staff WHERE id = ?`, [staffId]);
        if (!staff) {
            req.session.errorMessage = 'Staff record not found.';
            return res.redirect('/staff');
        }

        const departments = await queryAll(`SELECT id, department_name FROM departments WHERE department_type IN ('Operational', 'Shared') ORDER BY department_name ASC`) || [];
        const roles = await queryAll(`SELECT id, role_name FROM roles WHERE role_name NOT IN ('Doctor', 'Administrator', 'Patient') ORDER BY role_name ASC`) || [];

        res.render('staff/edit', {
            title: `Edit Staff - ${staff.first_name} ${staff.last_name}`,
            activeMenu: 'staff',
            staff,
            departments,
            roles,
            errors: [],
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Edit staff view error:', err);
        res.redirect('/staff');
    }
});

// -------------------------------------------------
// POST /staff/edit/:id — Save Updated Staff Record (Admin only)
// -------------------------------------------------
router.post('/edit/:id', authorize('Administrator'), [
    body('first_name').trim().notEmpty().withMessage('First Name is required'),
    body('last_name').trim().notEmpty().withMessage('Last Name is required'),
    body('email').isEmail().withMessage('Valid email address is required'),
    body('phone').optional({ checkFalsy: true }).customSanitizer(val => val ? val.replace(/[\s-]/g, '') : val).matches(/^\+94\d{9}$/).withMessage('Phone must be strictly formatted as +94xxxxxxxxx'),
    body('nic_number').optional({ checkFalsy: true }).matches(/^([0-9]{9}[xXvV]|[0-9]{12})$/).withMessage('NIC strictly requires standard 9 digits+V/X or 12 digits format'),
    body('salary').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('Monthly Salary must be a valid positive number'),
    body('role_id').notEmpty().withMessage('Role assignment is required'),
    body('designation').trim().notEmpty().withMessage('Designation is required')
], async (req, res) => {
    const staffId = req.params.id;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const staff = { ...req.body, id: staffId };
        const departments = await queryAll(`SELECT id, department_name FROM departments WHERE department_type IN ('Operational', 'Shared') ORDER BY department_name ASC`) || [];
        const roles = await queryAll(`SELECT id, role_name FROM roles WHERE role_name NOT IN ('Doctor', 'Administrator', 'Patient') ORDER BY role_name ASC`) || [];

        return res.render('staff/edit', {
            title: `Edit Staff - ${req.body.first_name || 'Staff'}`,
            activeMenu: 'staff',
            staff,
            departments,
            roles,
            errors: errors.array(),
            currentUser: req.session.user
        });
    }

    const {
        first_name, last_name, email, phone, nic_number,
        role_id, department_id, designation, joining_date, salary, employment_status
    } = req.body;

    try {
        const currentStaff = await queryOne(`SELECT email FROM staff WHERE id = ?`, [staffId]);

        await execute(`
            UPDATE staff SET
                first_name = ?, last_name = ?, email = ?, phone = ?, nic_number = ?,
                role_id = ?, department_id = ?, designation = ?, joining_date = ?,
                salary = ?, employment_status = ?
            WHERE id = ?
        `, [
            first_name.trim(),
            last_name.trim(),
            email.trim().toLowerCase(),
            phone ? phone.trim() : null,
            nic_number ? nic_number.trim() : null,
            role_id,
            department_id ? department_id : null,
            designation.trim(),
            joining_date ? joining_date : null,
            salary ? parseFloat(salary) : 0.00,
            employment_status || 'Full-Time',
            staffId
        ]);

        if (currentStaff) {
            // Synchronize cascading structural updates to the natively joined Users IAM table
            await execute(`
                UPDATE users SET 
                    email = ?, full_name = ?, phone = ?, role_id = ?, department_id = ? 
                WHERE email = ?
            `, [
                email.trim().toLowerCase(),
                `${first_name.trim()} ${last_name.trim()}`,
                phone ? phone.trim() : null,
                role_id,
                department_id ? department_id : null,
                currentStaff.email
            ]);
        }

        await auditLog(req.session.user.id, 'STAFF_UPDATED', 'staff', staffId, `Updated profile for staff member ${first_name} ${last_name} and synced mapped credentials`, req.ip);

        req.session.successMessage = `Staff member ${first_name} ${last_name} updated successfully!`;
        res.redirect(`/staff/view/${staffId}`);

    } catch (err) {
        console.error('Update staff error:', err);
        req.session.errorMessage = 'Failed to update staff member details.';
        res.redirect('/staff');
    }
});

// -------------------------------------------------
// POST /staff/toggle-status/:id — Activate/Deactivate Staff (Admin only)
// -------------------------------------------------
router.post('/toggle-status/:id', authorize('Administrator'), async (req, res) => {
    const staffId = req.params.id;

    try {
        const staff = await queryOne(`SELECT id, employee_code, first_name, last_name, email, is_active FROM staff WHERE id = ?`, [staffId]);
        if (!staff) {
            req.session.errorMessage = 'Staff member not found.';
            return res.redirect('/staff');
        }

        const newStatus = staff.is_active ? 0 : 1;
        const statusText = newStatus ? 'Activated' : 'Deactivated';

        // 1. Update HR Staff Table
        await execute(`UPDATE staff SET is_active = ?, employment_status = ? WHERE id = ?`, [newStatus, newStatus ? 'Full-Time' : 'Terminated', staffId]);

        // 2. Cross-Module Trigger: Mirror status to System Users Table logically linked by Email
        await execute(`UPDATE users SET is_active = ? WHERE email = ?`, [newStatus, staff.email]);

        await auditLog(req.session.user.id, `STAFF_${statusText.toUpperCase()}`, 'staff', staffId, `${statusText} staff member ${staff.first_name} ${staff.last_name} (${staff.employee_code}) and synchronized system login access`, req.ip);

        req.session.successMessage = `Staff member ${staff.first_name} ${staff.last_name} ${statusText.toLowerCase()}, and login access updated!`;
        res.redirect('/staff');

    } catch (err) {
        console.error('Toggle staff status error:', err);
        req.session.errorMessage = 'Failed to update staff status.';
        res.redirect('/staff');
    }
});

// -------------------------------------------------
// POST /staff/attendance/mark — Log Daily Attendance (Admin only)
// -------------------------------------------------
router.post('/attendance/mark', authorize('Administrator'), async (req, res) => {
    const { staff_id, attendance_date, check_in, check_out, status, remarks } = req.body;

    if (!staff_id || !attendance_date || !status) {
        req.session.errorMessage = 'Please provide staff member, date, and attendance status.';
        return res.redirect('/staff?tab=attendance');
    }

    try {
        const existing = await queryOne(`SELECT id FROM staff_attendance WHERE staff_id = ? AND attendance_date = ?`, [staff_id, attendance_date]);

        if (existing) {
            await execute(`
                UPDATE staff_attendance SET check_in = ?, check_out = ?, status = ?, remarks = ? WHERE id = ?
            `, [check_in || null, check_out || null, status, remarks ? remarks.trim() : null, existing.id]);
        } else {
            await execute(`
                INSERT INTO staff_attendance (staff_id, attendance_date, check_in, check_out, status, remarks)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [staff_id, attendance_date, check_in || null, check_out || null, status, remarks ? remarks.trim() : null]);
        }

        await auditLog(req.session.user.id, 'STAFF_ATTENDANCE_LOGGED', 'staff_attendance', staff_id, `Marked attendance (${status}) for staff ID #${staff_id} on ${attendance_date}`, req.ip);

        req.session.successMessage = `Attendance record logged successfully for ${attendance_date}!`;
        res.redirect('/staff?tab=attendance');

    } catch (err) {
        console.error('Mark attendance error:', err);
        req.session.errorMessage = 'Failed to record attendance.';
        res.redirect('/staff?tab=attendance');
    }
});

// -------------------------------------------------
// POST /staff/leave/apply — Submit Leave Request (Admin only)
// -------------------------------------------------
router.post('/leave/apply', authorize('Administrator'), async (req, res) => {
    const { staff_id, leave_type, start_date, end_date, total_days, reason } = req.body;

    if (!staff_id || !start_date || !end_date) {
        req.session.errorMessage = 'Please fill out all required leave application fields.';
        return res.redirect('/staff?tab=leaves');
    }

    try {
        const result = await execute(`
            INSERT INTO staff_leaves (staff_id, leave_type, start_date, end_date, total_days, reason, status)
            VALUES (?, ?, ?, ?, ?, ?, 'Pending')
        `, [
            staff_id,
            leave_type || 'Casual',
            start_date,
            end_date,
            parseInt(total_days) || 1,
            reason ? reason.trim() : null
        ]);

        await auditLog(req.session.user.id, 'LEAVE_APPLICATION_SUBMITTED', 'staff_leaves', result.lastInsertRowid, `Submitted leave application (${leave_type}) for staff ID #${staff_id}`, req.ip);

        req.session.successMessage = 'Leave request submitted successfully!';
        res.redirect('/staff?tab=leaves');

    } catch (err) {
        console.error('Apply leave error:', err);
        req.session.errorMessage = 'Failed to submit leave application.';
        res.redirect('/staff?tab=leaves');
    }
});

// -------------------------------------------------
// POST /staff/leave/status — Approve or Reject Leave (Admin only)
// -------------------------------------------------
router.post('/leave/status', authorize('Administrator'), async (req, res) => {
    const { leave_id, status } = req.body;

    if (!leave_id || !['Approved', 'Rejected'].includes(status)) {
        req.session.errorMessage = 'Invalid leave approval request.';
        return res.redirect('/staff?tab=leaves');
    }

    try {
        await execute(`
            UPDATE staff_leaves SET status = ?, approved_by = ? WHERE id = ?
        `, [status, req.session.user.id, leave_id]);

        await auditLog(req.session.user.id, `LEAVE_${status.toUpperCase()}`, 'staff_leaves', leave_id, `Set leave request #${leave_id} status to ${status}`, req.ip);

        req.session.successMessage = `Leave request marked as ${status}!`;
        res.redirect('/staff?tab=leaves');

    } catch (err) {
        console.error('Leave status error:', err);
        req.session.errorMessage = 'Failed to process leave approval status.';
        res.redirect('/staff?tab=leaves');
    }
});

// -------------------------------------------------
// POST /staff/reset-password/:id — Admin Forced Password Reset
// -------------------------------------------------
router.post('/reset-password/:id', authorize('Administrator'), async (req, res) => {
    const staffId = req.params.id;

    try {
        const staff = await queryOne('SELECT s.id, s.first_name, s.last_name, s.email FROM staff s WHERE s.id = ?', [staffId]);
        if (!staff) {
            req.session.errorMessage = 'Staff member not found.';
            return res.redirect('/staff');
        }

        const userAccount = await queryOne('SELECT id FROM users WHERE email = ?', [staff.email]);
        if (!userAccount) {
            req.session.errorMessage = 'This staff member does not have a provisioned system login account.';
            return res.redirect(`/staff/view/${staffId}`);
        }

        // Generate temporary secure password
        const tempPassword = 'Hosp@' + Math.floor(1000 + Math.random() * 9000);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        await execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, userAccount.id]);
        
        await auditLog(req.session.user.id, 'PASSWORD_RESET_FORCED', 'users', userAccount.id, `Force reset password for ${staff.first_name}`, req.ip);

        // Intentionally storing temporary string in success payload to print to Administrator screen
        req.session.successMessage = `Account Recovery Successful! The temporary password for ${staff.first_name} is: ${tempPassword}`;
        res.redirect(`/staff/view/${staffId}`);

    } catch (err) {
        console.error('Password reset error:', err);
        req.session.errorMessage = 'An error occurred while resetting the password.';
        res.redirect(`/staff/view/${staffId}`);
    }
});

module.exports = router;

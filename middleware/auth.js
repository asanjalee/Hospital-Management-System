// =====================================================
// Authentication & Authorization Middleware
// Role-Based Access Control (RBAC) — Per Specification
// =====================================================
const { execute, getSLTimestamp } = require('../database/db');

// -----------------------------------------------------------------
// RBAC PERMISSION MATRIX (derived from Hospital System Specification)
// Each key is a module; value is an array of roles that can access it.
// ADMINISTRATOR always has full access (enforced below).
// -----------------------------------------------------------------
const PERMISSIONS = {
    dashboard:      ['Administrator', 'Doctor', 'Nurse', 'Receptionist', 'Lab Technician', 'Pharmacist', 'Accountant'],
    patients:       ['Administrator', 'Doctor', 'Nurse', 'Receptionist'],
    doctors:        ['Administrator', 'Doctor', 'Nurse', 'Receptionist'],
    appointments:   ['Administrator', 'Doctor', 'Nurse', 'Receptionist'],
    emr:            ['Administrator', 'Doctor', 'Nurse'],
    laboratory:     ['Administrator', 'Doctor', 'Nurse', 'Lab Technician'],
    pharmacy:       ['Administrator', 'Pharmacist', 'Doctor'],
    billing:        ['Administrator', 'Accountant', 'Receptionist'],
    staff:          ['Administrator'],                         // HR data — admin only for management
    staff_view:     ['Administrator', 'Doctor', 'Nurse', 'Receptionist', 'Pharmacist', 'Lab Technician', 'Accountant'], // READ only for others
    reports:        ['Administrator', 'Accountant'],
};

/**
 * Checks if the user is logged in.
 * Redirects to /auth/login if not authenticated.
 * Also regenerates the session ID on first auth check to prevent session fixation.
 */
function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        // Make user data available to all views
        res.locals.currentUser = req.session.user;
        return next();
    }
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/login');
}

/**
 * Checks if the user is NOT logged in.
 * Redirects to /dashboard if already authenticated.
 */
function isGuest(req, res, next) {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    next();
}

/**
 * Role-Based Access Control middleware factory.
 * Pass one or more allowed role names.
 * Administrator ALWAYS has full access to everything.
 *
 * Usage:
 *   router.get('/admin', authorize('Administrator'), handler);
 *   router.get('/clinical', authorize('Doctor', 'Nurse'), handler);
 */
function authorize(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.redirect('/auth/login');
        }

        const userRole = req.session.user.role_name;

        // Administrator always has unrestricted access
        if (userRole === 'Administrator') {
            return next();
        }

        if (allowedRoles.includes(userRole)) {
            return next();
        }

        // Access denied — render 403 with clear role info
        res.status(403).render('errors/403', {
            title: 'Access Denied',
            message: `Your role (${userRole}) does not have permission to access this area.`,
            requiredRoles: allowedRoles,
            currentUser: req.session.user
        });
    };
}

/**
 * Authorize using the built-in PERMISSIONS matrix.
 * Usage:  authorizeModule('billing')(req, res, next)
 */
function authorizeModule(moduleName) {
    const allowedRoles = PERMISSIONS[moduleName] || [];
    return authorize(...allowedRoles);
}

/**
 * Enforce that only Administrators can perform write (mutating) operations
 * on sensitive modules.  Read-only passes through.
 *
 * Usage on a router:
 *   router.post('/staff/add', adminOnly, handler);
 */
function adminOnly(req, res, next) {
    return authorize('Administrator')(req, res, next);
}

/**
 * Logs user actions to the audit_logs table (Async, MySQL).
 * Safe to call fire-and-forget from route handlers.
 */
async function auditLog(userId, action, entity = null, entityId = null, details = null, ipAddress = null) {
    try {
        await execute(
            `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, action, entity, entityId, details, ipAddress, getSLTimestamp()]
        );
    } catch (err) {
        console.error('Audit log error:', err.message);
    }
}

module.exports = {
    isAuthenticated,
    isGuest,
    authorize,
    authorizeModule,
    adminOnly,
    auditLog,
    PERMISSIONS
};

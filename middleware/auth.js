// =====================================================
// Authentication & Authorization Middleware
// =====================================================
const { execute, getSLTimestamp } = require('../database/db');

/**
 * Checks if the user is logged in.
 * Redirects to /login if not authenticated.
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

        // Administrator always has access
        if (userRole === 'Administrator' || allowedRoles.includes(userRole)) {
            return next();
        }

        // Access denied
        res.status(403).render('errors/403', {
            title: 'Access Denied',
            message: 'You do not have permission to access this page.',
            currentUser: req.session.user
        });
    };
}

/**
 * Logs user actions to the audit_logs table (Async for MySQL).
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

module.exports = { isAuthenticated, isGuest, authorize, auditLog };

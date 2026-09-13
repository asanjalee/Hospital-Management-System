// =====================================================
// Authentication Routes — Login, Logout, Password (MySQL Async)
// =====================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { queryOne, execute, getSLTimestamp } = require('../database/db');
const { isGuest, isAuthenticated } = require('../middleware/auth');

// Helper: audit log with Asia/Colombo (Sri Lanka Standard Time) timestamp
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

// -------------------------------------------------
// GET /auth/login — Show login page
// -------------------------------------------------
router.get('/login', isGuest, (req, res) => {
    res.render('auth/login', {
        title: 'Login',
        error: null
    });
});

// -------------------------------------------------
// POST /auth/login — Process login
// -------------------------------------------------
router.post('/login', isGuest, [
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required')
        .isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('password')
        .notEmpty().withMessage('Password is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('auth/login', {
            title: 'Login',
            error: errors.array()[0].msg,
            success: null
        });
    }

    const { username, password } = req.body;

    try {
        // Find user with role info
        const user = await queryOne(
            `SELECT u.*, r.role_name 
             FROM users u
             JOIN roles r ON u.role_id = r.id
             WHERE u.username = ? AND u.is_active = 1`,
            [username]
        );

        if (!user) {
            return res.render('auth/login', {
                title: 'Login',
                error: 'Invalid username or password',
                success: null
            });
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            await auditLog(user.id, 'LOGIN_FAILED', 'users', user.id, 'Invalid password', req.ip);
            return res.render('auth/login', {
                title: 'Login',
                error: 'Invalid username or password',
                success: null
            });
        }

        // Update last login
        await execute('UPDATE users SET last_login = ? WHERE id = ?', [getSLTimestamp(), user.id]);

        // Store user in session (exclude password hash)
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            full_name: user.full_name,
            role_id: user.role_id,
            role_name: user.role_name,
            department_id: user.department_id
        };

        // Audit log
        await auditLog(user.id, 'LOGIN_SUCCESS', 'users', user.id, null, req.ip);

        // Redirect to intended page or dashboard
        const returnTo = req.session.returnTo || '/dashboard';
        delete req.session.returnTo;
        res.redirect(returnTo);

    } catch (err) {
        console.error('Login error:', err);
        res.render('auth/login', {
            title: 'Login',
            error: 'An unexpected error occurred. Please try again.',
            success: null
        });
    }
});

// -------------------------------------------------
// GET /auth/logout — Logout and destroy session
// -------------------------------------------------
router.get('/logout', isAuthenticated, async (req, res) => {
    const userId = req.session.user ? req.session.user.id : null;

    if (userId) {
        await auditLog(userId, 'LOGOUT', 'users', userId, null, req.ip);
    }

    req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.clearCookie('hms.sid');
        res.redirect('/auth/login');
    });
});

// -------------------------------------------------
// GET /auth/change-password — Show change password form
// -------------------------------------------------
router.get('/change-password', isAuthenticated, (req, res) => {
    res.render('auth/change-password', {
        title: 'Change Password',
        error: null,
        success: null,
        currentUser: req.session.user
    });
});

// -------------------------------------------------
// POST /auth/change-password — Process password change
// -------------------------------------------------
router.post('/change-password', isAuthenticated, [
    body('currentPassword')
        .notEmpty().withMessage('Current password is required'),
    body('newPassword')
        .isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
        .matches(/\d/).withMessage('New password must contain at least one number'),
    body('confirmPassword')
        .custom((value, { req }) => {
            if (value !== req.body.newPassword) {
                throw new Error('Passwords do not match');
            }
            return true;
        })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('auth/change-password', {
            title: 'Change Password',
            error: errors.array()[0].msg,
            success: null,
            currentUser: req.session.user
        });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    try {
        const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [userId]);

        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.render('auth/change-password', {
                title: 'Change Password',
                error: 'Current password is incorrect',
                success: null,
                currentUser: req.session.user
            });
        }

        const config = require('../config/config');
        const hashedPassword = await bcrypt.hash(newPassword, config.SALT_ROUNDS);

        await execute('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [hashedPassword, userId]
        );

        await auditLog(userId, 'PASSWORD_CHANGED', 'users', userId, null, req.ip);

        res.render('auth/change-password', {
            title: 'Change Password',
            error: null,
            success: 'Password changed successfully!',
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Change password error:', err);
        res.render('auth/change-password', {
            title: 'Change Password',
            error: 'An unexpected error occurred.',
            success: null,
            currentUser: req.session.user
        });
    }
});

module.exports = router;

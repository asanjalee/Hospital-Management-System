const express = require('express');
const router = express.Router();
const { queryAll, queryOne } = require('../database/db');
const { isAuthenticated, authorize } = require('../middleware/auth');

router.get('/', isAuthenticated, authorize('Administrator'), async (req, res) => {
    try {
        const stats = {
            totalUsers: 0,
            activeSessions: 0,
            auditEvents: 0
        };

        const uReq = await queryOne('SELECT COUNT(*) as count FROM users WHERE is_active = 1');
        stats.totalUsers = uReq ? uReq.count : 0;

        const aReq = await queryOne('SELECT COUNT(*) as count FROM audit_logs');
        stats.auditEvents = aReq ? aReq.count : 0;

        // In a real system you'd track active sessions from Redis or DB store.
        // We'll approximate active sessions by users who logged in within the last 24 hours
        const sReq = await queryOne('SELECT COUNT(*) as count FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 1 DAY)');
        stats.activeSessions = sReq ? sReq.count : 1;

        const systemLogs = await queryAll(`
            SELECT al.*, u.full_name, u.username, r.role_name 
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            LEFT JOIN roles r ON u.role_id = r.id
            ORDER BY al.created_at DESC
            LIMIT 50
        `);

        res.render('admin/index', {
            title: 'IT Administrator Dashboard',
            activeMenu: 'admin',
            stats,
            systemLogs,
            success: req.session.successMessage,
            error: req.session.errorMessage
        });
        
    } catch (err) {
        console.error('IT Admin Dashboard Error:', err);
        req.session.errorMessage = 'Failed to load IT dashboard.';
        res.redirect('/dashboard');
    }
});

module.exports = router;

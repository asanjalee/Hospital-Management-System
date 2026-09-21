// =====================================================
// Hospital Management System — Main Server
// =====================================================
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const config = require('./config/config');
const { initDatabase, closeDatabase, queryAll, queryOne } = require('./database/db');
const { isAuthenticated } = require('./middleware/auth');

const app = express();

// -------------------------------------------------
// View Engine (EJS & Layouts)
// -------------------------------------------------
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// -------------------------------------------------
// Middleware
// -------------------------------------------------
// Parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    name: 'hms.sid',
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: config.SESSION_MAX_AGE,
        httpOnly: true,
        secure: false,
        sameSite: 'lax'
    }
}));

// Make app config and flash messages available to all views
app.use((req, res, next) => {
    res.locals.appName = config.APP_NAME;
    res.locals.appShortName = config.APP_SHORT_NAME;
    res.locals.currentUser = req.session.user || null;

    // Flash message management - extract to locals and clear from session
    // so they are consumed once and don't persist globally.
    res.locals.success = req.session.successMessage || null;
    res.locals.error = req.session.errorMessage || null;
    delete req.session.successMessage;
    delete req.session.errorMessage;

    next();
});

// Ensure database is initialized for serverless requests
app.use(async (req, res, next) => {
    try {
        await initDatabase();
        next();
    } catch (err) {
        console.error('Failed to initialize database on request:', err);
        res.status(500).send('Database connection error.');
    }
});

// -------------------------------------------------
// Routes
// -------------------------------------------------

// Auth routes (login, logout, change-password)
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);

// Patient Management routes
const patientRoutes = require('./routes/patients');
app.use('/patients', patientRoutes);

// Doctor Management routes
const doctorRoutes = require('./routes/doctors');
app.use('/doctors', doctorRoutes);

// Appointment Management routes
const appointmentRoutes = require('./routes/appointments');
app.use('/appointments', appointmentRoutes);

// EMR Management routes
const emrRoutes = require('./routes/emr');
app.use('/emr', emrRoutes);

// Laboratory Management routes
const labRoutes = require('./routes/laboratory');
app.use('/laboratory', labRoutes);

// Pharmacy Management routes
const pharmacyRoutes = require('./routes/pharmacy');
app.use('/pharmacy', pharmacyRoutes);

// Billing Management routes
const billingRoutes = require('./routes/billing');
app.use('/billing', billingRoutes);

// Staff Management Module routes (Section 3.9)
const staffRoutes = require('./routes/staff');
app.use('/staff', staffRoutes);

// Reports & Analytics Module routes (Section 3.10)
const reportsRoutes = require('./routes/reports');
app.use('/reports', reportsRoutes);

// IT Administrator Dashboard
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// Root redirect
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/auth/login');
});

// -------------------------------------------------
// Dashboard Route (Section 7 Real-time Metrics - MySQL)
// -------------------------------------------------
app.get('/dashboard', isAuthenticated, async (req, res) => {
    let stats = {
        totalPatients: 0,
        todayAppointments: 0,
        revenue: '0.00',
        labRequests: 0
    };

    try {
        const patientCount = await queryOne('SELECT COUNT(*) as count FROM patients WHERE is_active = 1');
        stats.totalPatients = patientCount ? patientCount.count : 0;

        const apptCount = await queryOne("SELECT COUNT(*) as count FROM appointments WHERE appointment_date = CURDATE() AND status != 'Cancelled'");
        stats.todayAppointments = apptCount ? apptCount.count : 0;

        const revCount = await queryOne("SELECT COALESCE(SUM(paid_amount), 0) as total FROM billing WHERE DATE_FORMAT(invoice_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')");
        stats.revenue = revCount ? Number(revCount.total).toFixed(2) : '0.00';

        const labCount = await queryOne("SELECT COUNT(*) as count FROM lab_requests WHERE status = 'Pending'");
        stats.labRequests = labCount ? labCount.count : 0;
    } catch (e) {
        console.error('Dashboard metrics error:', e.message);
    }

    // Get recent audit logs
    let recentLogs = [];
    try {
        recentLogs = await queryAll(`
            SELECT al.*, u.full_name 
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE al.user_id = ?
            ORDER BY al.created_at DESC
            LIMIT 8
        `, [req.session.user.id]);
    } catch (e) {
        console.error('Dashboard audit logs query error:', e.message);
    }

    // Get recent patients
    let recentPatients = [];
    try {
        recentPatients = await queryAll(`
            SELECT * FROM patients ORDER BY created_at DESC LIMIT 5
        `);
    } catch (e) {
        console.error('Dashboard recent patients query error:', e.message);
    }

    res.render('dashboard', {
        title: 'Dashboard',
        activeMenu: 'dashboard',
        stats,
        recentLogs,
        recentPatients,
        currentUser: req.session.user
    });
});

// -------------------------------------------------
// 404 & Error Handlers
// -------------------------------------------------
app.use((req, res) => {
    res.status(404).render('errors/404', {
        title: 'Page Not Found',
        currentUser: req.session.user || null
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).render('errors/404', {
        title: 'Server Error',
        currentUser: req.session.user || null
    });
});

// -------------------------------------------------
// Export App for Vercel (Serverless)
// -------------------------------------------------
// Directly export the app for Vercel serverless environment
module.exports = app;

// Run app.listen only when running locally on a standard laptop/development environment:
if (process.env.NODE_ENV !== 'production') {
    const PORT = config.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDatabase();
    process.exit(0);
});

module.exports = app;
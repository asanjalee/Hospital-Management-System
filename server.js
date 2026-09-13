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

// Make app config available to all views
app.use((req, res, next) => {
    res.locals.appName = config.APP_NAME;
    res.locals.appShortName = config.APP_SHORT_NAME;
    res.locals.currentUser = req.session.user || null;
    next();
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

// Root redirect
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/auth/login');
});

// -------------------------------------------------
// Dashboard Route (Section 7 Real-time Metrics)
// -------------------------------------------------
app.get('/dashboard', isAuthenticated, (req, res) => {
    let stats = {
        totalPatients: 0,
        todayAppointments: 0,
        revenue: '0.00',
        labRequests: 0
    };

    try {
        const patientCount = queryOne('SELECT COUNT(*) as count FROM patients WHERE is_active = 1');
        stats.totalPatients = patientCount ? patientCount.count : 0;

        const apptCount = queryOne("SELECT COUNT(*) as count FROM appointments WHERE date(appointment_date) = date('now') AND status != 'Cancelled'");
        stats.todayAppointments = apptCount ? apptCount.count : 0;

        const revCount = queryOne("SELECT COALESCE(SUM(paid_amount), 0) as total FROM billing WHERE strftime('%Y-%m', invoice_date) = strftime('%Y-%m', 'now')");
        stats.revenue = revCount ? Number(revCount.total).toFixed(2) : '0.00';

        const labCount = queryOne("SELECT COUNT(*) as count FROM lab_requests WHERE status = 'Pending'");
        stats.labRequests = labCount ? labCount.count : 0;
    } catch (e) {
        console.error('Dashboard metrics error:', e.message);
    }

    // Get recent audit logs
    let recentLogs = [];
    try {
        recentLogs = queryAll(`
            SELECT al.*, u.full_name 
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC
            LIMIT 8
        `);
    } catch (e) {}

    // Get recent patients
    let recentPatients = [];
    try {
        recentPatients = queryAll(`
            SELECT * FROM patients ORDER BY created_at DESC LIMIT 5
        `);
    } catch (e) {}

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
// Placeholder routes for remaining future modules
// -------------------------------------------------
const placeholderModules = [
    { path: '/staff', title: 'Staff Management', menu: 'staff', icon: 'bi-person-gear' },
    { path: '/reports', title: 'Reports', menu: 'reports', icon: 'bi-bar-chart-line-fill' }
];

placeholderModules.forEach(mod => {
    app.get(mod.path, isAuthenticated, (req, res) => {
        res.render('placeholder', {
            title: mod.title,
            activeMenu: mod.menu,
            icon: mod.icon,
            currentUser: req.session.user
        });
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
// Start Server
// -------------------------------------------------
async function startServer() {
    try {
        await initDatabase();
        console.log('✅ Database connected');

        app.listen(config.PORT, () => {
            console.log('');
            console.log('  🏥 ═══════════════════════════════════════');
            console.log(`  🏥  ${config.APP_NAME}`);
            console.log('  🏥 ═══════════════════════════════════════');
            console.log(`  🌐  URL:  http://localhost:${config.PORT}`);
            console.log(`  🔧  ENV:  ${config.NODE_ENV}`);
            console.log('  🏥 ═══════════════════════════════════════');
            console.log('');
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}

startServer();

process.on('SIGINT', () => {
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDatabase();
    process.exit(0);
});

// =====================================================
// Hospital Management System — Main Server
// =====================================================
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config/config');
const { initDatabase, closeDatabase, queryAll, queryOne } = require('./database/db');
const { isAuthenticated } = require('./middleware/auth');

const app = express();

const expressLayouts = require('express-ejs-layouts');

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

// Session configuration (in-memory store for simplicity)
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

// Root redirect
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/auth/login');
});

// Dashboard
app.get('/dashboard', isAuthenticated, (req, res) => {
    // Gather dashboard statistics
    let stats = {
        totalPatients: 0,
        todayAppointments: 0,
        revenue: '0.00',
        labRequests: 0
    };

    try {
        const patientCount = queryOne('SELECT COUNT(*) as count FROM patients WHERE is_active = 1');
        stats.totalPatients = patientCount ? patientCount.count : 0;
    } catch (e) {
        // Table may not exist yet
    }

    // Get recent audit logs
    let recentLogs = [];
    try {
        recentLogs = queryAll(`
            SELECT al.*, u.full_name 
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ORDER BY al.created_at DESC
            LIMIT 10
        `);
    } catch (e) {
        // Table may not exist yet
    }

    res.render('dashboard', {
        title: 'Dashboard',
        activeMenu: 'dashboard',
        stats,
        recentLogs,
        currentUser: req.session.user
    });
});

// -------------------------------------------------
// Placeholder routes for future modules
// -------------------------------------------------
const placeholderModules = [
    { path: '/patients', title: 'Patients', menu: 'patients', icon: 'bi-people-fill' },
    { path: '/doctors', title: 'Doctors', menu: 'doctors', icon: 'bi-person-badge-fill' },
    { path: '/appointments', title: 'Appointments', menu: 'appointments', icon: 'bi-calendar-check-fill' },
    { path: '/laboratory', title: 'Laboratory', menu: 'laboratory', icon: 'bi-droplet-fill' },
    { path: '/pharmacy', title: 'Pharmacy', menu: 'pharmacy', icon: 'bi-capsule' },
    { path: '/billing', title: 'Billing', menu: 'billing', icon: 'bi-receipt-cutoff' },
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
// 404 Handler
// -------------------------------------------------
app.use((req, res) => {
    res.status(404).render('errors/404', {
        title: 'Page Not Found',
        currentUser: req.session.user || null
    });
});

// -------------------------------------------------
// Global Error Handler
// -------------------------------------------------
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).render('errors/404', {
        title: 'Server Error',
        currentUser: req.session.user || null
    });
});

// -------------------------------------------------
// Initialize DB and Start Server
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

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🔒 Shutting down gracefully...');
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    closeDatabase();
    process.exit(0);
});

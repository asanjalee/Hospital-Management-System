// =====================================================
// Reports & Analytics System Router (Section 3.10 Specification)
// =====================================================
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, getSLTimestamp } = require('../database/db');
const { isAuthenticated, authorize } = require('../middleware/auth');

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Accountant', 'Doctor', 'Receptionist', 'Pharmacist', 'Lab Technician'));

// -------------------------------------------------
// GET /reports — Unified Reports & Analytics Suite
// -------------------------------------------------
router.get('/', async (req, res) => {
    const activeReport = req.query.report || 'overview'; // 'overview', 'patients', 'appointments', 'revenue', 'pharmacy', 'laboratory', 'staff'
    const fromDate = req.query.from_date || '';
    const toDate = req.query.to_date || '';

    try {
        const todayStr = new Date().toISOString().split('T')[0];

        // Date range query fragments
        let dateWhereAppt = '';
        let dateWhereBilling = '';
        let dateWhereLab = '';
        let dateWherePatient = '';
        const paramsAppt = [];
        const paramsBilling = [];
        const paramsLab = [];
        const paramsPatient = [];

        if (fromDate) {
            dateWhereAppt += ' AND appointment_date >= ?';
            dateWhereBilling += ' AND invoice_date >= ?';
            dateWhereLab += ' AND requested_date >= ?';
            dateWherePatient += ' AND DATE(created_at) >= ?';
            paramsAppt.push(fromDate);
            paramsBilling.push(fromDate);
            paramsLab.push(fromDate);
            paramsPatient.push(fromDate);
        }

        if (toDate) {
            dateWhereAppt += ' AND appointment_date <= ?';
            dateWhereBilling += ' AND invoice_date <= ?';
            dateWhereLab += ' AND requested_date <= ?';
            dateWherePatient += ' AND DATE(created_at) <= ?';
            paramsAppt.push(toDate);
            paramsBilling.push(toDate);
            paramsLab.push(toDate);
            paramsPatient.push(toDate);
        }

        // 1. Patient Analytics
        const patientStats = {
            total: (await queryOne(`SELECT COUNT(*) as cnt FROM patients WHERE 1=1 ${dateWherePatient}`, paramsPatient))?.cnt || 0,
            male: (await queryOne(`SELECT COUNT(*) as cnt FROM patients WHERE gender = 'Male' ${dateWherePatient}`, paramsPatient))?.cnt || 0,
            female: (await queryOne(`SELECT COUNT(*) as cnt FROM patients WHERE gender = 'Female' ${dateWherePatient}`, paramsPatient))?.cnt || 0,
            active: (await queryOne(`SELECT COUNT(*) as cnt FROM patients WHERE is_active = 1 ${dateWherePatient}`, paramsPatient))?.cnt || 0
        };

        const cityDistribution = await queryAll(`
            SELECT city, COUNT(*) as count 
            FROM patients 
            WHERE city IS NOT NULL AND city != '' ${dateWherePatient}
            GROUP BY city 
            ORDER BY count DESC 
            LIMIT 5
        `, paramsPatient) || [];

        const bloodGroupDistribution = await queryAll(`
            SELECT blood_group, COUNT(*) as count 
            FROM patients 
            WHERE blood_group IS NOT NULL AND blood_group != '' ${dateWherePatient}
            GROUP BY blood_group 
            ORDER BY count DESC
        `, paramsPatient) || [];

        // 2. Appointment Analytics
        const apptStats = {
            total: (await queryOne(`SELECT COUNT(*) as cnt FROM appointments WHERE 1=1 ${dateWhereAppt}`, paramsAppt))?.cnt || 0,
            scheduled: (await queryOne(`SELECT COUNT(*) as cnt FROM appointments WHERE status = 'Scheduled' ${dateWhereAppt}`, paramsAppt))?.cnt || 0,
            completed: (await queryOne(`SELECT COUNT(*) as cnt FROM appointments WHERE status = 'Completed' ${dateWhereAppt}`, paramsAppt))?.cnt || 0,
            cancelled: (await queryOne(`SELECT COUNT(*) as cnt FROM appointments WHERE status = 'Cancelled' ${dateWhereAppt}`, paramsAppt))?.cnt || 0
        };

        const topDoctorsAppts = await queryAll(`
            SELECT u.full_name as doctor_name, doc.specialization, d.department_name, COUNT(a.id) as appointment_count
            FROM appointments a
            JOIN doctors doc ON a.doctor_id = doc.id
            JOIN users u ON doc.user_id = u.id
            JOIN departments d ON doc.department_id = d.id
            WHERE 1=1 ${dateWhereAppt}
            GROUP BY a.doctor_id, u.full_name, doc.specialization, d.department_name
            ORDER BY appointment_count DESC
            LIMIT 5
        `, paramsAppt) || [];

        // 3. Revenue & Billing Analytics
        const revenueStats = {
            totalInvoices: (await queryOne(`SELECT COUNT(*) as cnt FROM billing WHERE 1=1 ${dateWhereBilling}`, paramsBilling))?.cnt || 0,
            grossAmount: (await queryOne(`SELECT COALESCE(SUM(total_amount), 0) as total FROM billing WHERE 1=1 ${dateWhereBilling}`, paramsBilling))?.total || 0,
            totalDiscounts: (await queryOne(`SELECT COALESCE(SUM(discount_amount), 0) as total FROM billing WHERE 1=1 ${dateWhereBilling}`, paramsBilling))?.total || 0,
            netRevenue: (await queryOne(`SELECT COALESCE(SUM(net_amount), 0) as total FROM billing WHERE 1=1 ${dateWhereBilling}`, paramsBilling))?.total || 0,
            paidAmount: (await queryOne(`SELECT COALESCE(SUM(paid_amount), 0) as total FROM billing WHERE 1=1 ${dateWhereBilling}`, paramsBilling))?.total || 0,
            unpaidAmount: (await queryOne(`SELECT COALESCE(SUM(net_amount - paid_amount), 0) as total FROM billing WHERE payment_status != 'Paid' ${dateWhereBilling}`, paramsBilling))?.total || 0
        };

        const paymentMethodBreakdown = await queryAll(`
            SELECT payment_method, COUNT(*) as count, COALESCE(SUM(paid_amount), 0) as total_collected
            FROM billing
            WHERE payment_method IS NOT NULL ${dateWhereBilling}
            GROUP BY payment_method
            ORDER BY total_collected DESC
        `, paramsBilling) || [];

        const revenueByItemType = await queryAll(`
            SELECT bi.item_type, COUNT(bi.id) as item_count, COALESCE(SUM(bi.amount), 0) as total_revenue
            FROM billing_items bi
            JOIN billing b ON bi.billing_id = b.id
            WHERE 1=1 ${dateWhereBilling}
            GROUP BY bi.item_type
            ORDER BY total_revenue DESC
        `, paramsBilling) || [];

        // 4. Pharmacy Analytics
        const pharmacyStats = {
            totalMedicines: (await queryOne(`SELECT COUNT(*) as cnt FROM medicines WHERE is_active = 1`))?.cnt || 0,
            lowStock: (await queryOne(`SELECT COUNT(*) as cnt FROM medicines WHERE is_active = 1 AND stock_quantity <= reorder_level`))?.cnt || 0,
            expiringSoon: (await queryOne(`SELECT COUNT(*) as cnt FROM medicines WHERE is_active = 1 AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)`))?.cnt || 0,
            totalInventoryValue: (await queryOne(`SELECT COALESCE(SUM(unit_price * stock_quantity), 0) as total FROM medicines WHERE is_active = 1`))?.total || 0
        };

        const lowStockItems = await queryAll(`
            SELECT medicine_code, name, category, stock_quantity, reorder_level, unit_price
            FROM medicines
            WHERE is_active = 1 AND stock_quantity <= reorder_level
            ORDER BY stock_quantity ASC
        `) || [];

        // 5. Laboratory Analytics
        const labStats = {
            total: (await queryOne(`SELECT COUNT(*) as cnt FROM lab_requests WHERE 1=1 ${dateWhereLab}`, paramsLab))?.cnt || 0,
            pending: (await queryOne(`SELECT COUNT(*) as cnt FROM lab_requests WHERE status = 'Pending' ${dateWhereLab}`, paramsLab))?.cnt || 0,
            inProgress: (await queryOne(`SELECT COUNT(*) as cnt FROM lab_requests WHERE status = 'In Progress' ${dateWhereLab}`, paramsLab))?.cnt || 0,
            completed: (await queryOne(`SELECT COUNT(*) as cnt FROM lab_requests WHERE status = 'Completed' ${dateWhereLab}`, paramsLab))?.cnt || 0
        };

        const labCategoryBreakdown = await queryAll(`
            SELECT test_category, COUNT(*) as count
            FROM lab_requests
            WHERE test_category IS NOT NULL AND test_category != '' ${dateWhereLab}
            GROUP BY test_category
            ORDER BY count DESC
        `, paramsLab) || [];

        // 6. Staff & HR Analytics
        const staffStats = {
            total: (await queryOne(`SELECT COUNT(*) as cnt FROM staff`))?.cnt || 0,
            active: (await queryOne(`SELECT COUNT(*) as cnt FROM staff WHERE is_active = 1 AND employment_status != 'Terminated'`))?.cnt || 0,
            presentToday: (await queryOne(`SELECT COUNT(*) as cnt FROM staff_attendance WHERE attendance_date = ? AND status IN ('Present', 'Late', 'Half Day')`, [todayStr]))?.cnt || 0,
            pendingLeaves: (await queryOne(`SELECT COUNT(*) as cnt FROM staff_leaves WHERE status = 'Pending'`))?.cnt || 0
        };

        const staffByDept = await queryAll(`
            SELECT d.department_name, COUNT(s.id) as staff_count
            FROM staff s
            LEFT JOIN departments d ON s.department_id = d.id
            GROUP BY d.department_name
            ORDER BY staff_count DESC
        `) || [];

        res.render('reports/index', {
            title: 'Reports & Business Analytics',
            activeMenu: 'reports',
            activeReport,
            fromDate,
            toDate,
            patientStats,
            cityDistribution,
            bloodGroupDistribution,
            apptStats,
            topDoctorsAppts,
            revenueStats,
            paymentMethodBreakdown,
            revenueByItemType,
            pharmacyStats,
            lowStockItems,
            labStats,
            labCategoryBreakdown,
            staffStats,
            staffByDept,
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Reports generation error:', err);
        res.status(500).render('errors/404', { title: 'Report Generation Error', currentUser: req.session.user });
    }
});

module.exports = router;

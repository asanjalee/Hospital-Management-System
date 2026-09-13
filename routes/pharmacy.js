// =====================================================
// Pharmacy Management Router - MySQL Async
// =====================================================
const express = require('express');
const router = express.Router();
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

// Generate unique medicine code (MED-XXX)
async function generateMedicineCode() {
    const countResult = await queryOne('SELECT COUNT(*) as total FROM medicines');
    const nextNum = (countResult ? countResult.total + 1 : 1).toString().padStart(3, '0');
    return `MED-${nextNum}`;
}

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Pharmacist', 'Doctor', 'Nurse'));

// -------------------------------------------------
// GET /pharmacy — Medicine Inventory Directory
// -------------------------------------------------
router.get('/', async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const category = req.query.category || '';
    const filter = req.query.filter || ''; // 'low_stock' | 'expiring'

    let sql = `SELECT * FROM medicines WHERE is_active = 1`;
    const params = [];

    if (search) {
        sql += ` AND (medicine_code LIKE ? OR name LIKE ? OR generic_name LIKE ? OR category LIKE ? OR manufacturer LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term, term);
    }

    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    if (filter === 'low_stock') {
        sql += ` AND stock_quantity <= reorder_level`;
    } else if (filter === 'expiring') {
        sql += ` AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)`;
    }

    sql += ` ORDER BY name ASC`;

    try {
        const medicines = await queryAll(sql, params) || [];

        const categories = await queryAll(`SELECT DISTINCT category FROM medicines WHERE is_active = 1 AND category IS NOT NULL AND category != '' ORDER BY category ASC`) || [];

        const stats = {
            totalItems: (await queryOne('SELECT COUNT(*) as cnt FROM medicines WHERE is_active = 1'))?.cnt || 0,
            lowStock: (await queryOne('SELECT COUNT(*) as cnt FROM medicines WHERE is_active = 1 AND stock_quantity <= reorder_level'))?.cnt || 0,
            expiring: (await queryOne('SELECT COUNT(*) as cnt FROM medicines WHERE is_active = 1 AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)'))?.cnt || 0,
            totalValue: (await queryOne('SELECT SUM(unit_price * stock_quantity) as total FROM medicines WHERE is_active = 1'))?.total || 0
        };

        res.render('pharmacy/index', {
            title: 'Pharmacy Management & Stock Control',
            activeMenu: 'pharmacy',
            medicines,
            categories,
            search,
            category,
            filter,
            stats,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('Pharmacy index error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /pharmacy/add — Show Add Medicine Form
// -------------------------------------------------
router.get('/add', async (req, res) => {
    const autoCode = await generateMedicineCode();
    res.render('pharmacy/add', {
        title: 'Add New Medicine',
        activeMenu: 'pharmacy',
        autoCode,
        errors: [],
        formData: { medicine_code: autoCode },
        currentUser: req.session.user
    });
});

// -------------------------------------------------
// POST /pharmacy/add — Save New Medicine
// -------------------------------------------------
router.post('/add', [
    body('name').trim().notEmpty().withMessage('Medicine Name is required'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('unit_price').isFloat({ min: 0.01 }).withMessage('Unit price must be greater than 0.00'),
    body('stock_quantity').isInt({ min: 0 }).withMessage('Stock quantity must be a non-negative integer'),
    body('reorder_level').isInt({ min: 0 }).withMessage('Reorder level must be a non-negative integer')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.render('pharmacy/add', {
            title: 'Add New Medicine',
            activeMenu: 'pharmacy',
            autoCode: req.body.medicine_code || await generateMedicineCode(),
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const { medicine_code, name, generic_name, category, unit_price, stock_quantity, reorder_level, expiry_date, manufacturer } = req.body;

    try {
        const code = medicine_code && medicine_code.trim() ? medicine_code.trim() : await generateMedicineCode();

        const result = await execute(`
            INSERT INTO medicines (
                medicine_code, name, generic_name, category, unit_price,
                stock_quantity, reorder_level, expiry_date, manufacturer, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `, [
            code,
            name.trim(),
            generic_name ? generic_name.trim() : null,
            category.trim(),
            parseFloat(unit_price),
            parseInt(stock_quantity),
            parseInt(reorder_level || 10),
            expiry_date ? expiry_date : null,
            manufacturer ? manufacturer.trim() : null,
            getSLTimestamp()
        ]);

        await auditLog(req.session.user.id, 'MEDICINE_ADDED', 'medicines', result.lastInsertRowid, `Added medicine ${name} (${code}) to pharmacy inventory`, req.ip);

        req.session.successMessage = `Medicine "${name}" (${code}) added to inventory!`;
        res.redirect('/pharmacy');

    } catch (err) {
        console.error('Add medicine error:', err);
        req.session.errorMessage = 'Failed to add medicine. Make sure code is unique.';
        res.redirect('/pharmacy');
    }
});

// -------------------------------------------------
// GET /pharmacy/edit/:id — Show Edit Medicine Form
// -------------------------------------------------
router.get('/edit/:id', async (req, res) => {
    const medId = req.params.id;

    try {
        const medicine = await queryOne(`SELECT * FROM medicines WHERE id = ?`, [medId]);
        if (!medicine) {
            req.session.errorMessage = 'Medicine not found.';
            return res.redirect('/pharmacy');
        }

        res.render('pharmacy/edit', {
            title: `Edit Medicine - ${medicine.name}`,
            activeMenu: 'pharmacy',
            medicine,
            errors: [],
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Edit medicine view error:', err);
        res.redirect('/pharmacy');
    }
});

// -------------------------------------------------
// POST /pharmacy/edit/:id — Update Medicine Stock Details
// -------------------------------------------------
router.post('/edit/:id', [
    body('name').trim().notEmpty().withMessage('Medicine Name is required'),
    body('unit_price').isFloat({ min: 0.01 }).withMessage('Unit price must be greater than 0.00'),
    body('stock_quantity').isInt({ min: 0 }).withMessage('Stock quantity must be a non-negative integer')
], async (req, res) => {
    const medId = req.params.id;
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const medicine = { ...req.body, id: medId };
        return res.render('pharmacy/edit', {
            title: `Edit Medicine - ${req.body.name || 'Medicine'}`,
            activeMenu: 'pharmacy',
            medicine,
            errors: errors.array(),
            currentUser: req.session.user
        });
    }

    const { name, generic_name, category, unit_price, stock_quantity, reorder_level, expiry_date, manufacturer } = req.body;

    try {
        await execute(`
            UPDATE medicines SET
                name = ?, generic_name = ?, category = ?, unit_price = ?,
                stock_quantity = ?, reorder_level = ?, expiry_date = ?, manufacturer = ?,
                updated_at = ?
            WHERE id = ?
        `, [
            name.trim(),
            generic_name ? generic_name.trim() : null,
            category ? category.trim() : null,
            parseFloat(unit_price),
            parseInt(stock_quantity),
            parseInt(reorder_level || 10),
            expiry_date ? expiry_date : null,
            manufacturer ? manufacturer.trim() : null,
            getSLTimestamp(),
            medId
        ]);

        await auditLog(req.session.user.id, 'MEDICINE_UPDATED', 'medicines', medId, `Updated stock/price details for ${name} (Stock: ${stock_quantity})`, req.ip);

        req.session.successMessage = `Medicine "${name}" updated successfully.`;
        res.redirect('/pharmacy');

    } catch (err) {
        console.error('Update medicine error:', err);
        req.session.errorMessage = 'Failed to update medicine.';
        res.redirect('/pharmacy');
    }
});

// -------------------------------------------------
// GET /pharmacy/dispense — Prescription Fulfillment Screen
// -------------------------------------------------
router.get('/dispense', async (req, res) => {
    const prePatientId = req.query.patient_id || '';

    try {
        const patients = await queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const medicines = await queryAll(`SELECT id, medicine_code, name, category, unit_price, stock_quantity FROM medicines WHERE is_active = 1 AND stock_quantity > 0 ORDER BY name ASC`) || [];

        res.render('pharmacy/dispense', {
            title: 'Dispense Medicine / Fulfill Prescription',
            activeMenu: 'pharmacy',
            patients,
            medicines,
            prePatientId,
            errors: [],
            formData: { patient_id: prePatientId },
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Dispense view error:', err);
        res.redirect('/pharmacy');
    }
});

// -------------------------------------------------
// POST /pharmacy/dispense — Deduct Inventory & Fulfill
// -------------------------------------------------
router.post('/dispense', [
    body('patient_id').notEmpty().withMessage('Patient selection is required'),
    body('medicine_id').notEmpty().withMessage('Medicine selection is required'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const patients = await queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const medicines = await queryAll(`SELECT id, medicine_code, name, category, unit_price, stock_quantity FROM medicines WHERE is_active = 1 AND stock_quantity > 0 ORDER BY name ASC`) || [];
        return res.render('pharmacy/dispense', {
            title: 'Dispense Medicine / Fulfill Prescription',
            activeMenu: 'pharmacy',
            patients,
            medicines,
            prePatientId: req.body.patient_id || '',
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const { patient_id, medicine_id, quantity } = req.body;
    const qtyToDispense = parseInt(quantity);

    try {
        const med = await queryOne(`SELECT * FROM medicines WHERE id = ?`, [medicine_id]);
        if (!med) {
            req.session.errorMessage = 'Selected medicine is not available.';
            return res.redirect('/pharmacy/dispense');
        }

        if (med.stock_quantity < qtyToDispense) {
            req.session.errorMessage = `Insufficient stock for ${med.name}. Available: ${med.stock_quantity}, Requested: ${qtyToDispense}.`;
            return res.redirect(`/pharmacy/dispense?patient_id=${patient_id}`);
        }

        // Deduct inventory stock
        const newQty = med.stock_quantity - qtyToDispense;
        await execute(`UPDATE medicines SET stock_quantity = ?, updated_at = ? WHERE id = ?`, [newQty, getSLTimestamp(), medicine_id]);

        const totalCost = (med.unit_price * qtyToDispense).toFixed(2);

        await auditLog(req.session.user.id, 'MEDICINE_DISPENSED', 'medicines', medicine_id, `Dispensed ${qtyToDispense} units of ${med.name} to patient ID #${patient_id} (Total: LKR ${totalCost})`, req.ip);

        req.session.successMessage = `Successfully dispensed ${qtyToDispense} x ${med.name} (Total: LKR ${totalCost}). Inventory stock remaining: ${newQty}.`;
        res.redirect('/pharmacy');

    } catch (err) {
        console.error('Dispense error:', err);
        req.session.errorMessage = 'An error occurred while processing pharmacy dispensation.';
        res.redirect('/pharmacy');
    }
});

module.exports = router;

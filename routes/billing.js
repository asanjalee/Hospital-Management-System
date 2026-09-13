// =====================================================
// Billing & Invoicing System Router - MySQL Async
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

// Generate unique invoice number (INV-YYYY-XXXX)
async function generateInvoiceNumber() {
    const year = new Date().getFullYear();
    const countResult = await queryOne('SELECT COUNT(*) as total FROM billing');
    const nextNum = (countResult ? countResult.total + 1 : 1).toString().padStart(4, '0');
    return `INV-${year}-${nextNum}`;
}

// Apply authentication & authorization guard
router.use(isAuthenticated);
router.use(authorize('Administrator', 'Cashier', 'Receptionist', 'Accountant'));

// -------------------------------------------------
// GET /billing — Invoice Directory & Financial Dashboard
// -------------------------------------------------
router.get('/', async (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    const status = req.query.status || '';

    let sql = `
        SELECT b.*, 
               p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.phone as patient_phone,
               u.full_name as creator_name
        FROM billing b
        JOIN patients p ON b.patient_id = p.id
        LEFT JOIN users u ON b.created_by = u.id
        WHERE 1=1
    `;
    const params = [];

    if (search) {
        sql += ` AND (b.invoice_number LIKE ? OR p.patient_uid LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)`;
        const term = `%${search}%`;
        params.push(term, term, term, term);
    }

    if (status) {
        sql += ` AND b.payment_status = ?`;
        params.push(status);
    }

    sql += ` ORDER BY b.invoice_date DESC, b.id DESC`;

    try {
        const invoices = await queryAll(sql, params) || [];

        const stats = {
            totalCount: (await queryOne('SELECT COUNT(*) as cnt FROM billing'))?.cnt || 0,
            totalRevenue: (await queryOne('SELECT SUM(net_amount) as total FROM billing'))?.total || 0,
            paidRevenue: (await queryOne('SELECT SUM(paid_amount) as total FROM billing'))?.total || 0,
            unpaidAmount: (await queryOne('SELECT SUM(net_amount - paid_amount) as total FROM billing WHERE payment_status != "Paid"'))?.total || 0
        };

        res.render('billing/index', {
            title: 'Billing & Invoice Management',
            activeMenu: 'billing',
            invoices,
            search,
            status,
            stats,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('Billing directory error:', err);
        res.status(500).render('errors/404', { title: 'Database Error', currentUser: req.session.user });
    }
});

// -------------------------------------------------
// GET /billing/create — Create Invoice Form
// -------------------------------------------------
router.get('/create', async (req, res) => {
    const prePatientId = req.query.patient_id || '';
    const preAppointmentId = req.query.appointment_id || '';

    try {
        const autoInvoiceNum = await generateInvoiceNumber();
        const patients = await queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const appointments = await queryAll(`
            SELECT a.id, a.appointment_number, a.appointment_date, p.patient_uid, p.first_name, p.last_name, doc.consultation_fee, u.full_name as doctor_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN doctors doc ON a.doctor_id = doc.id
            JOIN users u ON doc.user_id = u.id
            ORDER BY a.appointment_date DESC
        `) || [];
        const medicines = await queryAll(`SELECT id, medicine_code, name, unit_price, stock_quantity FROM medicines WHERE is_active = 1 AND stock_quantity > 0 ORDER BY name ASC`) || [];

        const todayStr = new Date().toISOString().split('T')[0];

        res.render('billing/create', {
            title: 'Generate Itemized Patient Invoice',
            activeMenu: 'billing',
            autoInvoiceNum,
            patients,
            appointments,
            medicines,
            prePatientId,
            preAppointmentId,
            todayStr,
            errors: [],
            formData: {
                invoice_number: autoInvoiceNum,
                patient_id: prePatientId,
                appointment_id: preAppointmentId,
                invoice_date: todayStr
            },
            currentUser: req.session.user
        });

    } catch (err) {
        console.error('Create invoice view error:', err);
        res.redirect('/billing');
    }
});

// -------------------------------------------------
// POST /billing/create — Save Invoice & Line Items
// -------------------------------------------------
router.post('/create', [
    body('patient_id').notEmpty().withMessage('Patient selection is required'),
    body('invoice_date').notEmpty().isISO8601().withMessage('Valid invoice date is required')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        const patients = await queryAll(`SELECT id, patient_uid, first_name, last_name FROM patients WHERE is_active = 1 ORDER BY first_name ASC`) || [];
        const appointments = await queryAll(`SELECT a.id, a.appointment_number, a.appointment_date, p.patient_uid, p.first_name, p.last_name, doc.consultation_fee, u.full_name as doctor_name FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN doctors doc ON a.doctor_id = doc.id JOIN users u ON doc.user_id = u.id ORDER BY a.appointment_date DESC`) || [];
        const medicines = await queryAll(`SELECT id, medicine_code, name, unit_price, stock_quantity FROM medicines WHERE is_active = 1 AND stock_quantity > 0 ORDER BY name ASC`) || [];

        return res.render('billing/create', {
            title: 'Generate Itemized Patient Invoice',
            activeMenu: 'billing',
            autoInvoiceNum: req.body.invoice_number || await generateInvoiceNumber(),
            patients,
            appointments,
            medicines,
            prePatientId: req.body.patient_id || '',
            preAppointmentId: req.body.appointment_id || '',
            todayStr: new Date().toISOString().split('T')[0],
            errors: errors.array(),
            formData: req.body,
            currentUser: req.session.user
        });
    }

    const {
        invoice_number, patient_id, appointment_id, invoice_date, discount_amount,
        paid_amount, payment_method, notes, item_types, item_descriptions, item_quantities, item_unit_prices
    } = req.body;

    try {
        const invNum = invoice_number && invoice_number.trim() ? invoice_number.trim() : await generateInvoiceNumber();

        // Calculate item totals
        let totalAmount = 0;
        const lineItems = [];

        if (item_descriptions) {
            const types = Array.isArray(item_types) ? item_types : [item_types];
            const descs = Array.isArray(item_descriptions) ? item_descriptions : [item_descriptions];
            const qtys = Array.isArray(item_quantities) ? item_quantities : [item_quantities];
            const prices = Array.isArray(item_unit_prices) ? item_unit_prices : [item_unit_prices];

            for (let i = 0; i < descs.length; i++) {
                if (descs[i] && descs[i].trim()) {
                    const qty = parseInt(qtys[i]) || 1;
                    const price = parseFloat(prices[i]) || 0;
                    const amt = qty * price;
                    totalAmount += amt;
                    lineItems.push({
                        type: types[i] || 'Other',
                        description: descs[i].trim(),
                        quantity: qty,
                        unit_price: price,
                        amount: amt
                    });
                }
            }
        }

        const discount = parseFloat(discount_amount) || 0.00;
        const netAmount = Math.max(0, totalAmount - discount);
        const paid = parseFloat(paid_amount) || 0.00;

        let status = 'Unpaid';
        if (paid >= netAmount && netAmount > 0) {
            status = 'Paid';
        } else if (paid > 0) {
            status = 'Partially Paid';
        }

        const result = await execute(`
            INSERT INTO billing (
                invoice_number, patient_id, appointment_id, total_amount, discount_amount,
                net_amount, paid_amount, payment_status, payment_method, invoice_date, notes, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            invNum,
            patient_id,
            appointment_id ? appointment_id : null,
            totalAmount,
            discount,
            netAmount,
            paid,
            status,
            payment_method ? payment_method : null,
            invoice_date,
            notes ? notes.trim() : null,
            req.session.user.id,
            getSLTimestamp()
        ]);

        const billingId = result.lastInsertRowid;

        // Insert line items
        for (const item of lineItems) {
            await execute(`
                INSERT INTO billing_items (billing_id, item_type, description, quantity, unit_price, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [billingId, item.type, item.description, item.quantity, item.unit_price, item.amount, getSLTimestamp()]);
        }

        await auditLog(req.session.user.id, 'INVOICE_GENERATED', 'billing', billingId, `Generated Invoice ${invNum} for patient ID #${patient_id} (Net: LKR ${netAmount.toFixed(2)}, Status: ${status})`, req.ip);

        req.session.successMessage = `Invoice ${invNum} generated successfully!`;
        res.redirect(`/billing/invoice/${billingId}`);

    } catch (err) {
        console.error('Create invoice error:', err);
        req.session.errorMessage = 'An error occurred while generating the invoice.';
        res.redirect('/billing');
    }
});

// -------------------------------------------------
// GET /billing/invoice/:id — Printable Receipt / Invoice View
// -------------------------------------------------
router.get('/invoice/:id', async (req, res) => {
    const invId = req.params.id;

    try {
        const invoice = await queryOne(`
            SELECT b.*, 
                   p.patient_uid, p.first_name as patient_first_name, p.last_name as patient_last_name, p.address, p.city, p.phone as patient_phone, p.nic_number,
                   u.full_name as creator_name,
                   a.appointment_number, doc_u.full_name as doctor_name
            FROM billing b
            JOIN patients p ON b.patient_id = p.id
            LEFT JOIN users u ON b.created_by = u.id
            LEFT JOIN appointments a ON b.appointment_id = a.id
            LEFT JOIN doctors doc ON a.doctor_id = doc.id
            LEFT JOIN users doc_u ON doc.user_id = doc_u.id
            WHERE b.id = ? OR b.invoice_number = ?
        `, [invId, invId]);

        if (!invoice) {
            req.session.errorMessage = `Invoice "${invId}" not found.`;
            return res.redirect('/billing');
        }

        const items = await queryAll(`SELECT * FROM billing_items WHERE billing_id = ? ORDER BY id ASC`, [invoice.id]) || [];

        res.render('billing/invoice', {
            title: `Invoice ${invoice.invoice_number}`,
            activeMenu: 'billing',
            invoice,
            items,
            currentUser: req.session.user,
            success: req.session.successMessage || null,
            error: req.session.errorMessage || null
        });
        delete req.session.successMessage;
        delete req.session.errorMessage;

    } catch (err) {
        console.error('View invoice error:', err);
        res.redirect('/billing');
    }
});

// -------------------------------------------------
// POST /billing/payment/:id — Record Invoice Payment
// -------------------------------------------------
router.post('/payment/:id', async (req, res) => {
    const invId = req.params.id;
    const { amount, payment_method, notes } = req.body;

    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
        req.session.errorMessage = 'Please enter a valid positive payment amount.';
        return res.redirect(`/billing/invoice/${invId}`);
    }

    try {
        const invoice = await queryOne(`SELECT * FROM billing WHERE id = ?`, [invId]);
        if (!invoice) {
            req.session.errorMessage = 'Invoice record not found.';
            return res.redirect('/billing');
        }

        const newPaidTotal = invoice.paid_amount + paymentAmount;
        let newStatus = 'Unpaid';
        if (newPaidTotal >= invoice.net_amount) {
            newStatus = 'Paid';
        } else if (newPaidTotal > 0) {
            newStatus = 'Partially Paid';
        }

        await execute(`
            UPDATE billing SET
                paid_amount = ?,
                payment_status = ?,
                payment_method = COALESCE(?, payment_method),
                notes = COALESCE(?, notes)
            WHERE id = ?
        `, [newPaidTotal, newStatus, payment_method ? payment_method : null, notes ? notes.trim() : null, invId]);

        await auditLog(req.session.user.id, 'INVOICE_PAYMENT_RECORDED', 'billing', invId, `Recorded payment of LKR ${paymentAmount.toFixed(2)} on Invoice ${invoice.invoice_number} (New Status: ${newStatus})`, req.ip);

        req.session.successMessage = `Payment of LKR ${paymentAmount.toFixed(2)} recorded successfully for Invoice ${invoice.invoice_number}!`;
        res.redirect(`/billing/invoice/${invId}`);

    } catch (err) {
        console.error('Record payment error:', err);
        req.session.errorMessage = 'Failed to record payment.';
        res.redirect(`/billing/invoice/${invId}`);
    }
});

module.exports = router;

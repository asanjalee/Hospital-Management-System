const fs = require('fs');

async function setup() {
    // ----------------------------------------------------
    // 1. Mount Admin Route in server.js
    // ----------------------------------------------------
    const serverPath = 'server.js';
    let serverCode = fs.readFileSync(serverPath, 'utf8');
    if (!serverCode.includes("const adminRoutes")) {
        serverCode = serverCode.replace(
            "// Root redirect",
            "// IT Administrator Dashboard\nconst adminRoutes = require('./routes/admin');\napp.use('/admin', adminRoutes);\n\n// Root redirect"
        );
        fs.writeFileSync(serverPath, serverCode);
        console.log('✅ Mounted /admin routes in server.js');
    }

    // ----------------------------------------------------
    // 2. Modify Database Migration for Refunds in db.js
    // ----------------------------------------------------
    const dbPath = 'database/db.js';
    let dbCode = fs.readFileSync(dbPath, 'utf8');
    if (!dbCode.includes("refund_amount DECIMAL")) {
        dbCode = dbCode.replace(
            /payment_method ENUM\('Cash', 'Card', 'Insurance', 'Online'\),/,
            "payment_method ENUM('Cash', 'Card', 'Insurance', 'Online'),\n            refund_amount DECIMAL(10,2) DEFAULT 0.00,\n            refund_reason TEXT,"
        );
        // Also add safe ALTER TABLE for existing DBs
        dbCode = dbCode.replace(
            "return pool;",
            "try { await p.query('ALTER TABLE billing ADD COLUMN refund_amount DECIMAL(10,2) DEFAULT 0.00;'); } catch(e) {}\n        try { await p.query('ALTER TABLE billing ADD COLUMN refund_reason TEXT;'); } catch(e) {}\n        return pool;"
        );
        fs.writeFileSync(dbPath, dbCode);
        console.log('✅ Added refund columns to db.js');
    }

    // ----------------------------------------------------
    // 3. Add Refund Route in billing.js
    // ----------------------------------------------------
    const billingPath = 'routes/billing.js';
    let billingCode = fs.readFileSync(billingPath, 'utf8');
    if (!billingCode.includes("router.post('/:id/refund'")) {
        const refundRoute = `
// Process Refund
router.post('/:id/refund', isAuthenticated, authorize('Administrator', 'Accountant'), async (req, res) => {
    try {
        const billingId = req.params.id;
        const { refund_amount, refund_reason } = req.body;
        
        const invoice = await queryOne('SELECT * FROM billing WHERE id = ?', [billingId]);
        if (!invoice) throw new Error('Invoice not found');
        
        const rAmount = parseFloat(refund_amount);
        if (rAmount <= 0) throw new Error('Refund amount must be greater than zero');
        if (rAmount > parseFloat(invoice.paid_amount) - parseFloat(invoice.refund_amount || 0)) {
            throw new Error('Refund amount cannot exceed total paid amount minus existing refunds');
        }
        
        const totalRefunded = parseFloat(invoice.refund_amount || 0) + rAmount;
        let newStatus = invoice.payment_status;
        
        if (totalRefunded >= invoice.paid_amount) {
            newStatus = 'Refunded';
        }
        
        await queryRun(
            'UPDATE billing SET refund_amount = ?, refund_reason = ?, payment_status = ? WHERE id = ?',
            [totalRefunded, refund_reason || invoice.refund_reason, newStatus, billingId]
        );
        
        // Log Audit
        await queryRun(
            'INSERT INTO audit_logs (user_id, action, module, details) VALUES (?, ?, ?, ?)',
            [req.session.user.id, 'REFUND_INVOICE', 'Billing', \`Processed refund of Rs \${rAmount} for Invoice #\${invoice.invoice_number}\`]
        );
        
        req.session.successMessage = 'Refund processed successfully.';
        res.redirect(\`/billing/view/\${billingId}\`);
    } catch (e) {
        console.error(e);
        req.session.errorMessage = e.message || 'Failed to process refund.';
        res.redirect(\`/billing/view/\${req.params.id}\`);
    }
});

module.exports = router;`;
        billingCode = billingCode.replace(/module.exports = router;/g, refundRoute);
        fs.writeFileSync(billingPath, billingCode);
        console.log('✅ Added refund route to billing.js');
    }

    // ----------------------------------------------------
    // 4. Update billing/view.ejs with Refund Button & Modal
    // ----------------------------------------------------
    const billingViewPath = 'views/billing/view.ejs';
    if(fs.existsSync(billingViewPath)) {
        let bv = fs.readFileSync(billingViewPath, 'utf8');
        
        // Add Refund Badge and display refund info
        if(!bv.includes('Refund Amount')) {
            bv = bv.replace(
                /<th class="text-end">Paid Amount<\/th>\s*<td class="text-end text-success fw-bold">([\s\S]*?)<\/td>/,
                `<th class="text-end">Paid Amount</th>\n<td class="text-end text-success fw-bold">$1</td>\n</tr>\n<% if(parseFloat(invoice.refund_amount) > 0) { %>\n<tr>\n<th class="text-end">Refund Amount</th>\n<td class="text-end text-danger fw-bold">-<%= Number(invoice.refund_amount).toFixed(2) %></td>\n</tr>\n<tr>\n<th class="text-end">Actual Net Revenue</th>\n<td class="text-end text-primary fw-bold"><%= Number(invoice.paid_amount - invoice.refund_amount).toFixed(2) %></td>\n<% } %>`
            );
            
            // Add Refund Button logically near Payment button
            bv = bv.replace(
                /<a href="\/billing\/print\/<%= invoice.id %>"/,
                `<% if (['Administrator', 'Accountant'].includes(currentUser.role_name) && parseFloat(invoice.paid_amount) > parseFloat(invoice.refund_amount || 0)) { %>
                <button type="button" class="btn btn-warning shadow-sm rounded-3 px-4 d-inline-flex align-items-center gap-2 fw-medium" data-bs-toggle="modal" data-bs-target="#refundModal">
                    <i class="bi bi-arrow-counterclockwise fs-5"></i> Process Refund
                </button>
            <% } %>\n            <a href="/billing/print/<%= invoice.id %>"`
            );
            
            // Append Refund Modal
            const refundModal = `
<!-- Refund Modal -->
<div class="modal fade" id="refundModal" tabindex="-1">
    <div class="modal-dialog">
        <div class="modal-content border-0 shadow">
            <div class="modal-header bg-warning border-0 text-dark">
                <h5 class="modal-title fw-bold"><i class="bi bi-arrow-counterclockwise me-2"></i>Process Refund</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <form action="/billing/<%= invoice.id %>/refund" method="POST">
                <div class="modal-body p-4">
                    <p class="text-muted mb-4">Refund partial or full amounts for Invoice <strong><%= invoice.invoice_number %></strong>.</p>
                    <div class="mb-3">
                        <label class="form-label fw-bold">Max Refundable Amount</label>
                        <input type="text" class="form-control bg-light text-success fw-bold" value="<%= Number(invoice.paid_amount - (invoice.refund_amount || 0)).toFixed(2) %>" readonly>
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-bold">Refund Amount <span class="text-danger">*</span></label>
                        <input type="number" name="refund_amount" step="0.01" min="0.01" max="<%= invoice.paid_amount - (invoice.refund_amount || 0) %>" class="form-control" required>
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-bold">Reason for Refund</label>
                        <textarea name="refund_reason" class="form-control" rows="2" placeholder="e.g. Service cancelled, Customer dissatisfaction"></textarea>
                    </div>
                </div>
                <div class="modal-footer bg-light border-0">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="submit" class="btn btn-warning fw-medium text-dark"><i class="bi bi-check-circle me-1"></i>Confirm Refund</button>
                </div>
            </form>
        </div>
    </div>
</div>
`;
            if(!bv.includes('id="refundModal"')) {
                bv = bv + '\n' + refundModal;
            }
            fs.writeFileSync(billingViewPath, bv);
            console.log('✅ Updated views/billing/view.ejs with Refund features');
        }
    }

}
setup();

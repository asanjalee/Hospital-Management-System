const { initDatabase, execute } = require('../database/db');

async function fixInvoices() {
    try {
        console.log('🔄 Initializing database pool...');
        await initDatabase();
        
        console.log('⚡ Executing dynamic recalculation for all existing billing records...');
        
        // Single atomic MySQL query that recalculates and overwrites all totals
        const sql = `
            UPDATE billing b
            JOIN (
                SELECT billing_id, SUM(amount) as actual_total
                FROM billing_items
                GROUP BY billing_id
            ) bi ON b.id = bi.billing_id
            SET 
                b.total_amount = bi.actual_total,
                b.net_amount = (bi.actual_total - IFNULL(b.discount_amount, 0))
        `;
        
        const result = await execute(sql);
        
        console.log(`✅ Successfully fixed and synced ${result.changes || result.affectedRows || 0} invoices mathematically backwards!`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Error fixing invoices:', err);
        process.exit(1);
    }
}

fixInvoices();

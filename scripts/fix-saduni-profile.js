const { execute, closeDatabase, initDatabase } = require('../database/db');

async function remapLogin() {
    try {
        await initDatabase();
        
        // Update the legacy generic receptionist account to Saduni's exact physical identity
        const result = await execute(
            `UPDATE users 
             SET email = ?, full_name = ?, username = ?
             WHERE email = ?`,
            [
                'sanduni@stgeorgehospital.lk', 
                'Saduni Perera', 
                'saduni.perera', 
                'reception@hospital.com'
            ]
        );
        
        if (result.changes > 0) {
            console.log('✅ Successfully re-mapped the legacy Receptionist login to Saduni Perera!');
        } else {
            console.log('⚠️ No changes made. Login may have already been re-mapped.');
        }

        await closeDatabase();
    } catch (err) {
        console.error('❌ Failed to remap user:', err);
    }
}

remapLogin();

const fs = require('fs');
const paths = ['dashboard', 'appointments', 'emr', 'laboratory', 'pharmacy', 'billing', 'staff', 'doctors', 'patients', 'reports'].map(x => 'views/' + (x === 'dashboard' ? 'dashboard.ejs' : x + '/index.ejs'));

paths.forEach(p => {
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');

    // 1. Remove flex-nowrap and overflow-auto artifacts
    c = c.replace(/flex-nowrap overflow-auto pb-2/g, '');
    c = c.replace(/flex-nowrap overflow-x-auto pb-2/g, '');
    c = c.replace(/flex-nowrap/g, '');
    c = c.replace(/overflow-auto/g, '');
    c = c.replace(/overflow-x-auto/g, '');
    
    // Clean up trailing spaces in row classes
    c = c.replace(/class="row g-(\d+) mb-(\d+)\s*"/g, 'class="row g-$1 mb-$2"');

    // 2. Adjust Grid for 4-card domains (Dashboard, Staff, Pharmacy, Laboratory, Billing, Appointments)
    // Make them 2 per row on md/lg, and 4 per row on xl.
    const col4x = /class="col-12 col-sm-6 col-md-3 col-lg-3 col-xl-3"/g;
    c = c.replace(col4x, 'class="col-12 col-md-6 col-lg-6 col-xl-3"');
    
    const col4x_2 = /class="col-12 col-sm-6 col-xl-3"/g;
    c = c.replace(col4x_2, 'class="col-12 col-md-6 col-lg-6 col-xl-3"');
    
    const col4x_3 = /class="col-12 col-sm-6 col-xl-4"/g; // Wait, we mapped them differently
    
    // 3. Adjust Grid for 3-card domains (EMR, Doctors)
    const col3x = /class="col-12 col-sm-6 col-md-4 col-lg-4 col-xl-4"/g;
    c = c.replace(col3x, 'class="col-12 col-md-6 col-lg-4 col-xl-4"');

    // 4. Force text-truncate on metric card titles so they don't break flex layouts
    c = c.replace(/class="text-muted small fw-medium"/g, 'class="text-muted small fw-medium text-truncate"');

    fs.writeFileSync(p, c);
    console.log('Restored natural wrap and optimized grid in ' + p);
});

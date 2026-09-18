const fs = require('fs'); 
const paths = ['dashboard', 'appointments', 'emr', 'laboratory', 'pharmacy', 'billing', 'staff', 'doctors', 'patients', 'reports'].map(x => 'views/' + (x === 'dashboard' ? 'dashboard.ejs' : x + '/index.ejs')); 

paths.forEach(p => { 
    if (!fs.existsSync(p)) return; 
    let c = fs.readFileSync(p, 'utf8'); 
    
    // Replace all matching row classes
    c = c.replace(/<div class="row g-(\d+) mb-(\d+)">/g, '<div class="row g-$1 mb-$2 flex-nowrap overflow-auto pb-2">');
    
    // Some might already have been replaced by the partial script, so fix duplicates safely
    c = c.replace(/flex-nowrap flex-nowrap/g, 'flex-nowrap');
    c = c.replace(/overflow-auto overflow-auto/g, 'overflow-auto');
    c = c.replace(/pb-2 pb-2/g, 'pb-2');
    c = c.replace(/overflow-x-auto/g, 'overflow-auto');
    
    fs.writeFileSync(p, c); 
    console.log('Fixed flex-nowrap globally in ' + p); 
});

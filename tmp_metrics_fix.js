const fs = require('fs');

// The directories with 4-card top metric grids
const paths = ['laboratory', 'pharmacy', 'billing', 'staff'].map(x => 'views/' + x + '/index.ejs');

paths.forEach(p => {
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');

    // Make sure we only touch the top metric cards grid. 
    // They start with <!-- Metric Cards --> or <!-- Metric KPI Cards -->
    // Convert the wrapper row:
    c = c.replace(/<!-- Metric[^>]*-->\s*<div class="row g-(\d+) mb-(\d+)">/g, '<!-- Metric KPI Cards -->\n    <div class="row row-cols-1 row-cols-md-2 row-cols-lg-4 g-$1 mb-$2">');
    
    // Replace the exact 4 widget column wrappers with just "col"
    c = c.replace(/<div class="col-12 col-md-6 col-lg-6 col-xl-3">/g, '<div class="col">');
    // Just in case they are still at the old state in some files:
    c = c.replace(/<div class="col-12 col-sm-6 col-xl-3">/g, '<div class="col">');
    
    // Inject flex-shrink:0 on the icons and min-width:0 on text so truncation mathematically works
    c = c.replace(/style="width: 52px; height: 52px;"/g, 'style="width: 52px; height: 52px; flex-shrink: 0;"');
    c = c.replace(/<div>\s*<div class="text-muted small fw-medium/g, '<div style="min-width: 0;">\n                        <div class="text-muted small fw-medium');

    fs.writeFileSync(p, c);
    console.log('Fixed 4-col KPI layout in ' + p);
});

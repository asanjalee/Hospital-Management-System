const fs = require('fs');

const paths = ['appointments', 'laboratory', 'pharmacy', 'billing', 'staff'].map(x => 'views/' + x + '/index.ejs');

paths.forEach(p => {
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');

    // Nuke the bootstrap rows completely for these KPI cards since Bootstrap breakpoints are causing 
    // vertical stacking due to the sidebar squeezing the viewport below 576px.
    c = c.replace(/<!-- Metric KPI Cards -->\s*<div class="row g-3 mb-4">/g, '<!-- Metric KPI Cards -->\n    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.5rem;">');
    
    // Also remove any column classes from the items because they are now direct children of CSS Grid
    c = c.replace(/<div class="col-12 col-sm-6 col-md-6 col-lg-6 col-xl-6">/g, '<div>');
    c = c.replace(/<div class="col-12 col-md-6 col-lg-6 col-xl-6">/g, '<div>');

    fs.writeFileSync(p, c);
    console.log('Applied strict 2x2 CSS Grid logic in ' + p);
});

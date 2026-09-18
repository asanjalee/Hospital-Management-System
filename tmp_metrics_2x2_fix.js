const fs = require('fs');

const paths = ['appointments', 'laboratory', 'pharmacy', 'billing', 'staff'].map(x => 'views/' + x + '/index.ejs');

paths.forEach(p => {
    if (!fs.existsSync(p)) return;
    let c = fs.readFileSync(p, 'utf8');

    // Remove row-cols logic completely and replace with standard row
    c = c.replace(/<div class="row row-cols-1[a-zA-Z0-9-\s]* mb-4">/g, '<div class="row g-3 mb-4">');

    // Some files might still have row g-3 mb-4, ensure we don't break them.
    // Let's replace the column classes to be explicitly col-12 col-sm-6 col-md-6 col-lg-6 col-xl-6
    // This forces exactly 50% width resulting in a perfect 2x2 balanced grid
    c = c.replace(/<div class="col">/g, '<div class="col-12 col-sm-6 col-md-6 col-lg-6 col-xl-6">');
    
    // In case there are older versions of classes
    c = c.replace(/<div class="col-12 col-md-6 col-lg-6 col-xl-3">/g, '<div class="col-12 col-sm-6 col-md-6 col-lg-6 col-xl-6">');
    c = c.replace(/<div class="col-12 col-sm-6 col-xl-3">/g, '<div class="col-12 col-sm-6 col-md-6 col-lg-6 col-xl-6">');

    fs.writeFileSync(p, c);
    console.log('Fixed exactly 2-by-2 grid layout globally across ' + p);
});

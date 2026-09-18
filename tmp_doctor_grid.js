const fs = require('fs');
const p = 'views/doctors/index.ejs';
if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');

    // 1. Ensure the metric KPI cards Grid is exactly col-md-4 col-lg-4 (33.3% spans per box for 3 items)
    c = c.replace(/class="col-[^"]*"/g, (match, offset) => {
        if (offset < 4000) return match; // Leave earlier things alone
        return match;
    });
    
    // Explicitly target Doctor Cards Grid wrapping structural block
    const originalBlock = `<div class=\"row g-3\">\r
            <% doctors.forEach(doc => { %>\r
                <div class=\"col-12 col-md-6 col-lg-4\">`;
                
    const replacementBlock = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1rem; align-items: stretch;">\r
            <% doctors.forEach(doc => { %>\r
                <div class="h-100">`;
                
    c = c.replace(/<div class=\"row g-3\">\s*<% doctors.forEach\(doc => \{\s*%>[\s]*<div class=\"col-12 col-md-6 col-lg-4\">/g, replacementBlock);
    
    c = c.replace(/<div class="row g-3">\r?\n\s*<% doctors.forEach\(doc => { %>\r?\n\s*<div class="col-12 col-md-6 col-lg-4">/g, `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1rem; align-items: stretch;">\n            <% doctors.forEach(doc => { %>\n                <div class="h-100">`);

    fs.writeFileSync(p, c);
    console.log('Applied custom grid logic!');
}

const fs = require('fs');
const path = require('path');

async function test() {
    const dir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    console.log('Dir exists:', fs.existsSync(dir));

    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    
    db.run('CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)');
    db.run("INSERT INTO test VALUES (1, 'hello')");
    
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(path.join(dir, 'test.db'), buffer);
    console.log('DB saved!');
    
    const res = db.exec('SELECT * FROM test');
    console.log('Query result:', JSON.stringify(res));
    
    db.close();
    console.log('DONE - sql.js works correctly!');
}

test().catch(e => console.error('ERROR:', e));

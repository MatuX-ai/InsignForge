const Database = require('better-sqlite3');
const db = new Database('data/insightforge.db');
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='executions'").get();
console.log('SCHEMA:', schema && schema.sql);
const rows = db.prepare('SELECT * FROM executions').all();
console.log('ROWS:', JSON.stringify(rows, null, 2));
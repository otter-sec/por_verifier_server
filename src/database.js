const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure database directory exists
const dbDir = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'verifications.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Initialize database schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proof_timestamp INTEGER NOT NULL,
    verification_timestamp INTEGER NOT NULL,
    valid BOOLEAN NOT NULL,
    file_hash TEXT NOT NULL,
    UNIQUE(file_hash, proof_timestamp)
  )`);
});

// Function to insert a new verification
function insertVerification(proofTimestamp, valid, fileHash) {
  return new Promise((resolve, reject) => {
    const verificationTimestamp = Date.now();
    const stmt = db.prepare(
      `INSERT INTO verifications (proof_timestamp, verification_timestamp, valid, file_hash) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(file_hash, proof_timestamp) DO UPDATE SET
       verification_timestamp = excluded.verification_timestamp,
       valid = excluded.valid
       RETURNING id`
    );
    
    stmt.get([proofTimestamp, verificationTimestamp, valid ? 1 : 0, fileHash], function(err, row) {
      if (err) {
        reject(err);
        return;
      }
      resolve([row.id, verificationTimestamp]);
    });
    
    stmt.finalize();
  });
}

// Function to find verification by different parameters
function findVerification(params) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT id, file_hash, proof_timestamp, verification_timestamp, valid FROM verifications WHERE ';
    let values = [];

    if (params.id) {
      query += 'id = ?';
      values.push(params.id);
    } else if (params.proofTimestamp) {
      query += 'proof_timestamp = ?';
      values.push(params.proofTimestamp);
    } else if (params.fileHash) {
      query += 'file_hash = ?';
      values.push(params.fileHash);
    } else {
      reject(new Error('Invalid search parameters'));
      return;
    }

    db.get(query, values, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (row) {
        // Convert SQLite integer boolean back to JS boolean
        row.valid = Boolean(row.valid);
      }
      resolve(row);
    });
  });
}

module.exports = {
  db,
  insertVerification,
  findVerification
}; 
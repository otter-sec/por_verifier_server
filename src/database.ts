import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure database directory exists
const dbDir: string = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath: string = path.join(dbDir, 'verifications.db');
const db: sqlite3.Database = new (sqlite3.verbose().Database)(dbPath, (err: Error | null) => {
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

interface Verification {
  id: number;
  file_hash: string;
  proof_timestamp: number;
  verification_timestamp: number;
  valid: boolean;
}

interface VerificationParams {
  id?: number;
  proofTimestamp?: number;
  fileHash?: string;
}

// Function to insert a new verification
export function insertVerification(
  proofTimestamp: number,
  valid: boolean,
  fileHash: string
): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const verificationTimestamp: number = Date.now();
    const stmt: sqlite3.Statement = db.prepare(
      `INSERT INTO verifications (proof_timestamp, verification_timestamp, valid, file_hash) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(file_hash, proof_timestamp) DO UPDATE SET
       verification_timestamp = excluded.verification_timestamp,
       valid = excluded.valid
       RETURNING id`
    );
    
    stmt.get([proofTimestamp, verificationTimestamp, valid ? 1 : 0, fileHash], function(err: Error | null, row: { id: number } | undefined) {
      if (err) {
        reject(err);
        return;
      }
      if (!row) {
        reject(new Error('No row returned from insert'));
        return;
      }
      resolve([row.id, verificationTimestamp]);
    });
    
    stmt.finalize();
  });
}

// Function to find verification by different parameters
export function findVerification(params: VerificationParams): Promise<Verification | undefined> {
  return new Promise((resolve, reject) => {
    let query: string = 'SELECT id, file_hash, proof_timestamp, verification_timestamp, valid FROM verifications WHERE ';
    let values: (number | string)[] = [];

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

    db.get(query, values, (err: Error | null, row: Verification | undefined) => {
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

export { db }; 
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { DB_DIR } from '../constants';
import { runMigrations } from "./migrations";


// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath: string = path.join(DB_DIR, 'verifications.db');
const db: sqlite3.Database = new (sqlite3.verbose().Database)(dbPath, (err: Error | null) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

// Run database migrations/Initialize database
runMigrations().catch(console.error);


interface Verification {
  id: number;
  file_hash: string;
  proof_timestamp: number;
  verification_timestamp: number | null;
  valid: boolean | null;
  balances: string | null;
  assets: string | null;
  proof_file_url: string | null;
}

interface VerificationParams {
  id?: number;
  proofTimestamp?: number;
  fileHash?: string;
}

interface VerificationListResponse {
  id: number;
  proofTimestamp: number;
  verificationTimestamp: number | null;
  fileHash: string;
  valid: boolean | null;
}

// Function to upsert a verification
export function upsertVerification(
  proofTimestamp: number,
  valid: boolean | null,
  fileHash: string,
  verificationTimestamp: number | null,
  assets: string | null = null,
  proofFileUrl: string | null = null
): Promise<number> {
  return new Promise((resolve, reject) => {
    // First, check if a verification with the same file_hash and proof_timestamp exists
    const selectStmt = db.prepare(
      'SELECT id, proof_file_url FROM verifications WHERE file_hash = ? AND proof_timestamp = ?'
    );
    
    selectStmt.get([fileHash, proofTimestamp], (err: Error | null, existingRow: { id: number; proof_file_url: string | null } | undefined) => {
      if (err) {
        selectStmt.finalize();
        reject(err);
        return;
      }
      
      if (existingRow) {
        // Record exists, perform UPDATE
        const finalProofFileUrl = proofFileUrl !== null ? proofFileUrl : existingRow.proof_file_url;
        
        const updateStmt = db.prepare(
          `UPDATE verifications SET 
           verification_timestamp = ?, 
           valid = ?, 
           proof_file_url = ? 
           WHERE id = ?`
        );
        
        updateStmt.run([verificationTimestamp, valid, finalProofFileUrl, existingRow.id], function(err: Error | null) {
          updateStmt.finalize();
          if (err) {
            reject(err);
            return;
          }
          resolve(existingRow.id);
        });
      } else {
        // Record doesn't exist, perform INSERT
        const insertStmt = db.prepare(
          `INSERT INTO verifications (
            proof_timestamp, verification_timestamp, valid, file_hash, assets, proof_file_url
          ) VALUES (?, ?, ?, ?, ?, ?)
          RETURNING id`
        );
        
        insertStmt.get([proofTimestamp, verificationTimestamp, valid, fileHash, assets, proofFileUrl], function(err: Error | null, row: { id: number } | undefined) {
          insertStmt.finalize();
          if (err) {
            reject(err);
            return;
          }
          if (!row) {
            reject(new Error('No row returned from insert'));
            return;
          }
          resolve(row.id);
        });
      }
      
      selectStmt.finalize();
    });
  });
}

// Function to find verification by different parameters
export function findVerification(params: VerificationParams): Promise<Verification | undefined> {
  return new Promise((resolve, reject) => {
    let query: string = 'SELECT id, file_hash, proof_timestamp, verification_timestamp, valid, assets, proof_file_url FROM verifications WHERE ';
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
      resolve(row);
    });
  });
}

// Function to get all verifications with pagination
export function getAllVerifications(page: number = 1, pageSize: number = 10): Promise<{ verifications: VerificationListResponse[], total: number }> {
  return new Promise((resolve, reject) => {
    const offset = (page - 1) * pageSize;
    
    // Get total count
    db.get('SELECT COUNT(*) as total FROM verifications', (err: Error | null, row: { total: number } | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      
      const total = row?.total || 0;
      
      // Get paginated results
      db.all<VerificationListResponse>(
        `SELECT 
          id,
          proof_timestamp as proofTimestamp,
          verification_timestamp as verificationTimestamp,
          file_hash as fileHash,
          valid
        FROM verifications 
        ORDER BY proof_timestamp DESC 
        LIMIT ? OFFSET ?`,
        [pageSize, offset],
        (err: Error | null, rows: VerificationListResponse[]) => {
          if (err) {
            reject(err);
            return;
          }

          rows.forEach((row) => {
            row.valid = row.valid === null ? null : Boolean(row.valid);
          });

          resolve({ verifications: rows, total });
        }
      );
    });
  });
}

// Function to delete a verification by ID
export function deleteVerification(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM verifications WHERE id = ?', [id], function(this: sqlite3.RunResult, err: Error | null) {
            if (err) {
                reject(err);
                return;
            }
            if (this.changes === 0) {
                reject(new Error('Verification not found'));
                return;
            }
            resolve();
        });
    });
}

export { db }; 
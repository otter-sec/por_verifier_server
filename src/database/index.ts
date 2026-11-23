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
  prover_version: string | null;
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
  proofFileUrl: string | null = null,
  proverVersion: string | null = null
): Promise<number> {
  return new Promise((resolve, reject) => {
    // First, check if a verification with the same file_hash and proof_timestamp exists
    const selectStmt = db.prepare(
      'SELECT id, proof_file_url, prover_version FROM verifications WHERE file_hash = ? AND proof_timestamp = ?'
    );
    
    selectStmt.get([fileHash, proofTimestamp], (err: Error | null, existingRow: { id: number; proof_file_url: string | null; prover_version: string | null } | undefined) => {
      if (err) {
        selectStmt.finalize();
        reject(err);
        return;
      }
      
      if (existingRow) {
        // Record exists, perform UPDATE
        const finalProofFileUrl = proofFileUrl !== null ? proofFileUrl : existingRow.proof_file_url;
        const finalProverVersion = proverVersion !== null ? proverVersion : existingRow.prover_version;
        
        const updateStmt = db.prepare(
          `UPDATE verifications SET 
           verification_timestamp = ?, 
           valid = ?, 
           proof_file_url = ?,
           prover_version = ?
           WHERE id = ?`
        );
        
        updateStmt.run([verificationTimestamp, valid, finalProofFileUrl, finalProverVersion, existingRow.id], function(err: Error | null) {
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
            proof_timestamp, verification_timestamp, valid, file_hash, assets, proof_file_url, prover_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id`
        );
        
        insertStmt.get([proofTimestamp, verificationTimestamp, valid, fileHash, assets, proofFileUrl, proverVersion], function(err: Error | null, row: { id: number } | undefined) {
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
    let query: string = 'SELECT id, file_hash, proof_timestamp, verification_timestamp, valid, assets, proof_file_url, prover_version FROM verifications WHERE ';
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
    db.get('SELECT COUNT(*) as total FROM verifications WHERE valid=true OR valid IS NULL', (err: Error | null, row: { total: number } | undefined) => {
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
          prover_version as proverVersion,
          valid
        FROM verifications 
        WHERE valid=true OR valid IS NULL
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

//////////////////////////////////
// Stocks proof of collateral   //
//////////////////////////////////

export interface StockVerification {
  id: number;
  file_hash: string;
  proof_timestamp: number;
  verification_timestamp: number | null;
  valid: boolean | null;
  proof_file_url: string | null;
  prover_version: string | null;
  ledger_balances: string | null;
  onchain_supplies: string | null;
  broker_positions: string | null;
}

const STOCK_COLUMNS =
  'id, file_hash, proof_timestamp, verification_timestamp, valid, proof_file_url, prover_version, ledger_balances, onchain_supplies, broker_positions';

// Columns a caller may write. Whitelisted because they are interpolated as
// SQL identifiers rather than bound as parameters.
const STOCK_WRITABLE = [
  'verification_timestamp', 'valid', 'proof_file_url', 'prover_version',
  'ledger_balances', 'onchain_supplies', 'broker_positions'
] as const;

export type StockVerificationFields = Partial<
  Record<(typeof STOCK_WRITABLE)[number], string | number | boolean | null>
>;

// Insert a stock verification keyed by (file_hash, proof_timestamp), or update it
// if it already exists. Only the fields passed are written, so each step of the
// proof of collateral fills in its own columns without touching the others.
export function upsertStockVerification(
  fileHash: string,
  proofTimestamp: number,
  fields: StockVerificationFields = {}
): Promise<number> {
  const cols = STOCK_WRITABLE.filter((c) => c in fields);
  const assignments = cols.length
    ? cols.map((c) => `${c} = excluded.${c}`).join(', ')
    : 'proof_timestamp = excluded.proof_timestamp'; // no-op when nothing to write

  return new Promise((resolve, reject) => {
    db.get<{ id: number }>(
      `INSERT INTO stock_verifications (file_hash, proof_timestamp${cols.map((c) => `, ${c}`).join('')})
       VALUES (?, ?${cols.map(() => ', ?').join('')})
       ON CONFLICT(file_hash, proof_timestamp) DO UPDATE SET ${assignments}
       RETURNING id`,
      [fileHash, proofTimestamp, ...cols.map((c) => fields[c] as any)],
      (err: Error | null, row: { id: number } | undefined) => {
        if (err) return reject(err);
        if (!row) return reject(new Error('No row returned from upsert'));
        resolve(row.id);
      }
    );
  });
}

// Find a stock verification by id, proof timestamp or file hash.
export function findStockVerification(
  params: VerificationParams
): Promise<StockVerification | undefined> {
  return new Promise((resolve, reject) => {
    const [column, value] = params.id
      ? ['id', params.id]
      : params.proofTimestamp
        ? ['proof_timestamp', params.proofTimestamp]
        : params.fileHash
          ? ['file_hash', params.fileHash]
          : [];

    if (!column) return reject(new Error('Invalid search parameters'));

    db.get<StockVerification>(
      `SELECT ${STOCK_COLUMNS} FROM stock_verifications WHERE ${column} = ?`,
      [value],
      (err: Error | null, row: StockVerification | undefined) => {
        if (err) return reject(err);
        resolve(row);
      }
    );
  });
}

export { db }; 
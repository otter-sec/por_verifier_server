import { assertValidPagination } from '../pagination';
import { getPool } from './pool';

export { getPool, closeDb } from './pool';
export { runMigrations } from './migrations';


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
export async function upsertVerification(
  proofTimestamp: number,
  valid: boolean | null,
  fileHash: string,
  verificationTimestamp: number | null,
  assets: string | null = null,
  proofFileUrl: string | null = null,
  proverVersion: string | null = null
): Promise<number> {
  // First, try to update the verification with the same file_hash and proof_timestamp
  // assets are kept as they are, proof_file_url and prover_version are only updated if new values are given
  const updateResult = await getPool().query<{ id: number }>(
    `UPDATE verifications SET
     verification_timestamp = $1,
     valid = $2,
     proof_file_url = COALESCE($3, proof_file_url),
     prover_version = COALESCE($4, prover_version)
     WHERE file_hash = $5 AND proof_timestamp = $6
     RETURNING id`,
    [verificationTimestamp, valid, proofFileUrl, proverVersion, fileHash, proofTimestamp]
  );

  if (updateResult.rows.length > 0) {
    return updateResult.rows[0].id;
  }

  // Record doesn't exist, perform INSERT
  const insertResult = await getPool().query<{ id: number }>(
    `INSERT INTO verifications (
      proof_timestamp, verification_timestamp, valid, file_hash, assets, proof_file_url, prover_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [proofTimestamp, verificationTimestamp, valid, fileHash, assets, proofFileUrl, proverVersion]
  );

  if (insertResult.rows.length === 0) {
    throw new Error('No row returned from insert');
  }
  return insertResult.rows[0].id;
}

// Function to find verification by different parameters
export async function findVerification(params: VerificationParams): Promise<Verification | undefined> {
  let query: string = 'SELECT id, file_hash, proof_timestamp, verification_timestamp, valid, assets, proof_file_url, prover_version FROM verifications WHERE ';
  let value: number | string;

  if (params.id) {
    query += 'id = $1';
    value = params.id;
  } else if (params.proofTimestamp) {
    query += 'proof_timestamp = $1';
    value = params.proofTimestamp;
  } else if (params.fileHash) {
    query += 'file_hash = $1';
    value = params.fileHash;
  } else {
    throw new Error('Invalid search parameters');
  }

  // Numbers that don't fit in a BIGINT can't match any row, and postgres would raise an error for them
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    return undefined;
  }

  // Several verifications may share a proof timestamp, return the oldest one (same behavior as with SQLite)
  query += ' ORDER BY id LIMIT 1';

  const result = await getPool().query<Verification>(query, [value]);
  return result.rows[0];
}

// Function to get all verifications with pagination
export async function getAllVerifications(page: number = 1, pageSize: number = 10): Promise<{ verifications: VerificationListResponse[], total: number }> {
  // Callers clamp untrusted input with parsePagination, anything out of range here is a bug
  assertValidPagination(page, pageSize);
  const offset = (page - 1) * pageSize;

  // Get total count
  const countResult = await getPool().query<{ total: number }>(
    'SELECT COUNT(*) as total FROM verifications WHERE valid=true OR valid IS NULL'
  );
  const total = countResult.rows[0]?.total || 0;

  // Get paginated results
  const result = await getPool().query<VerificationListResponse>(
    `SELECT
      id,
      proof_timestamp as "proofTimestamp",
      verification_timestamp as "verificationTimestamp",
      file_hash as "fileHash",
      prover_version as "proverVersion",
      valid
    FROM verifications
    WHERE valid=true OR valid IS NULL
    ORDER BY proof_timestamp DESC, id DESC
    LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );

  return { verifications: result.rows, total };
}

// Function to delete a verification by ID
export async function deleteVerification(id: number): Promise<void> {
  const result = await getPool().query('DELETE FROM verifications WHERE id = $1', [id]);
  if (result.rowCount === 0) {
    throw new Error('Verification not found');
  }
}

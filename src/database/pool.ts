import { Pool, PoolConfig, types } from 'pg';
import { parse, toClientConfig } from 'pg-connection-string';

// Timestamps are stored in milliseconds as BIGINT, which node-postgres returns as strings by default.
// Every value we store fits in Number.MAX_SAFE_INTEGER, so parse them as numbers instead.
types.setTypeParser(types.builtins.INT8, (value: string) => parseInt(value, 10));

// DATABASE_URL is parsed with libpq semantics, like other postgres clients (and node-postgres from v9):
// sslmode=require encrypts the connection without verifying the server certificate, verify-ca/verify-full
// verify it against the CA given with sslrootcert. Otherwise node-postgres treats require as verify-full,
// which fails with Cloud SQL's private CA.
// Settings missing from DATABASE_URL (e.g. the password) fall back to the standard PG* environment variables.
function getConnectionConfig(): PoolConfig {
  const url = process.env.DATABASE_URL;
  return url ? toClientConfig(parse(url, { useLibpqCompat: true })) : {};
}

let pool: Pool | null = null;

// The pool is created lazily so the connection settings can be loaded from .env before the first query.
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getConnectionConfig());
    pool.on('error', (err: Error) => {
      console.error('Unexpected database error:', err);
    });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

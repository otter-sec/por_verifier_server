// Copies the verifications from the SQLite database used by previous versions of the server into Postgres.
//
// Usage: DATABASE_URL=postgres://... npm run migrate:sqlite -- <path/to/verifications.db> [--dry-run]
//
// - ids are preserved, since they are exposed through the API and the web interface
// - it can be re-run with a newer copy of the SQLite database: missing rows are inserted, changed rows are updated
// - it aborts without changing anything if an id or (file_hash, proof_timestamp) pair refers to a different
//   verification in Postgres, which happens if the new deployment received verifications before the data was copied
// - with --dry-run the copy is done inside a transaction that is rolled back at the end
//   (the schema migrations are still applied, as the server would do on startup)

import sqlite3 from 'sqlite3';
import { getPool, closeDb, runMigrations } from '../database';

interface VerificationRow {
    id: number;
    proof_timestamp: number;
    verification_timestamp: number | null;
    valid: boolean | null;
    file_hash: string;
    assets: string | null;
    proof_file_url: string | null;
    prover_version: string | null;
}

// id must be the first column, the UPDATE statement below relies on it
const COLUMNS: (keyof VerificationRow)[] = [
    'id', 'proof_timestamp', 'verification_timestamp', 'valid', 'file_hash', 'assets', 'proof_file_url', 'prover_version'
];

function readSqliteVerifications(dbPath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err: Error | null) => {
            if (err) {
                reject(err);
                return;
            }
            db.all(`SELECT ${COLUMNS.join(', ')} FROM verifications ORDER BY id`, (err: Error | null, rows: any[]) => {
                db.close();
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    });
}

// SQLite is loosely typed, so check every value fits the Postgres schema instead of silently converting it
function toVerificationRow(row: any): VerificationRow {
    const fail = (message: string) => {
        throw new Error(`SQLite verification ${row.id}: ${message}`);
    };

    for (const column of ['id', 'proof_timestamp'] as const) {
        if (!Number.isSafeInteger(row[column])) fail(`${column} is not an integer (${row[column]})`);
    }
    if (row.verification_timestamp !== null && !Number.isSafeInteger(row.verification_timestamp)) {
        fail(`verification_timestamp is not an integer (${row.verification_timestamp})`);
    }
    // booleans are stored as 0/1 in SQLite
    if (![0, 1, null].includes(row.valid)) fail(`valid is not a boolean (${row.valid})`);
    if (typeof row.file_hash !== 'string') fail(`file_hash is not a string (${row.file_hash})`);
    for (const column of ['assets', 'proof_file_url', 'prover_version'] as const) {
        if (row[column] !== null && typeof row[column] !== 'string') fail(`${column} is not a string (${row[column]})`);
    }

    return { ...row, valid: row.valid === null ? null : Boolean(row.valid) };
}

const verificationKey = (row: VerificationRow): string => `${row.file_hash}:${row.proof_timestamp}`;

function describeTarget(): string {
    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        return `${url.host}${url.pathname}`;
    }
    return `${process.env.PGHOST || 'localhost'}/${process.env.PGDATABASE || ''}`;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const sqlitePath = args.find(arg => !arg.startsWith('--'));

    if (!sqlitePath) {
        console.error('Usage: DATABASE_URL=postgres://... npm run migrate:sqlite -- <path/to/verifications.db> [--dry-run]');
        process.exit(1);
    }

    const sqliteRows = (await readSqliteVerifications(sqlitePath)).map(toVerificationRow);
    console.log(`Read ${sqliteRows.length} verifications from ${sqlitePath}`);

    console.log(`Migrating to postgres at ${describeTarget()}${dryRun ? ' (dry run)' : ''}`);
    await runMigrations();

    const client = await getPool().connect();
    try {
        await client.query('BEGIN');

        // Block writes from running servers while copying, reads are still allowed
        await client.query('LOCK TABLE verifications IN EXCLUSIVE MODE');

        const existingRows = (await client.query<VerificationRow>(`SELECT ${COLUMNS.join(', ')} FROM verifications`)).rows;
        const existingById = new Map(existingRows.map(row => [row.id, row]));
        const existingByKey = new Map(existingRows.map(row => [verificationKey(row), row]));

        const inserted: number[] = [];
        const updated: number[] = [];
        let unchanged = 0;

        for (const row of sqliteRows) {
            const existing = existingById.get(row.id);
            const values = COLUMNS.map(column => row[column]);

            if (!existing) {
                const conflicting = existingByKey.get(verificationKey(row));
                if (conflicting) {
                    throw new Error(
                        `SQLite verification ${row.id} (file_hash=${row.file_hash}, proof_timestamp=${row.proof_timestamp}) ` +
                        `already exists in postgres with id ${conflicting.id}`
                    );
                }
                await client.query(
                    `INSERT INTO verifications (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`,
                    values
                );
                inserted.push(row.id);
            } else if (verificationKey(existing) !== verificationKey(row)) {
                throw new Error(
                    `Id ${row.id} refers to different verifications: ` +
                    `SQLite has file_hash=${row.file_hash}, proof_timestamp=${row.proof_timestamp}, ` +
                    `postgres has file_hash=${existing.file_hash}, proof_timestamp=${existing.proof_timestamp}`
                );
            } else if (COLUMNS.some(column => existing[column] !== row[column])) {
                await client.query(
                    `UPDATE verifications SET ${COLUMNS.slice(1).map((column, i) => `${column} = $${i + 2}`).join(', ')} WHERE id = $1`,
                    values
                );
                updated.push(row.id);
            } else {
                unchanged++;
            }
        }

        // Make sure new verifications get ids after the copied ones
        await client.query(
            `SELECT setval(pg_get_serial_sequence('verifications', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM verifications`
        );

        const sqliteIds = new Set(sqliteRows.map(row => row.id));
        const onlyInPostgres = existingRows.filter(row => !sqliteIds.has(row.id)).map(row => row.id);

        await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');

        console.log(`Inserted: ${inserted.length}`);
        console.log(`Updated: ${updated.length}${updated.length > 0 ? ` (ids: ${updated.join(', ')})` : ''}`);
        console.log(`Unchanged: ${unchanged}`);
        if (onlyInPostgres.length > 0) {
            console.log(`Only in postgres (left untouched): ${onlyInPostgres.length} (ids: ${onlyInPostgres.join(', ')})`);
        }
        console.log(dryRun ? 'Dry run, no verifications were changed' : 'Migration completed');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

main()
    .catch((error) => {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    })
    .finally(() => closeDb());

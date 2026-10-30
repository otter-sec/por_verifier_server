import { PoolClient } from 'pg';
import { getPool } from './pool';
import { migrations } from './migrations/index';

interface MigrationRow {
    migration_id: string;
}

// Ensure migrations table exists
async function ensureMigrationsTable(client: PoolClient): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS migration_metadata (
            migration_id TEXT PRIMARY KEY,
            timestamp BIGINT NOT NULL
        )
    `);
}

// Get executed migrations
async function getExecutedMigrations(client: PoolClient): Promise<string[]> {
    const result = await client.query<MigrationRow>('SELECT migration_id FROM migration_metadata ORDER BY migration_id');
    return result.rows.map(row => row.migration_id);
}

// Record migration execution
async function recordMigration(client: PoolClient, migrationId: string): Promise<void> {
    await client.query(
        'INSERT INTO migration_metadata (migration_id, timestamp) VALUES ($1, $2)',
        [migrationId, Date.now()]
    );
}

// Run migrations
// All pending migrations are applied in a single transaction, so either all of them are applied or none
export async function runMigrations(): Promise<void> {
    const client = await getPool().connect();

    try {
        await client.query('BEGIN');

        // Several instances may start at the same time, this lock makes sure only one of them runs the migrations.
        // It is released automatically when the transaction ends.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('por_verifier_server_migrations'))`);

        await ensureMigrationsTable(client);
        const executedMigrations = await getExecutedMigrations(client);

        for (const migration of migrations) {
            if (!executedMigrations.includes(migration.id)) {
                console.log(`Running migration ${migration.id}`);
                await migration.up(client);
                await recordMigration(client, migration.id);
                console.log(`Completed migration ${migration.id}`);
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        // ignore rollback errors so the original error is the one reported
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

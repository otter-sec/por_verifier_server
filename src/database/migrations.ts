import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { DB_DIR } from '../constants';
import { migrations, Migration } from './migrations/index';

interface MigrationRow {
    migration_id: string;
}

// Ensure migrations table exists
async function ensureMigrationsTable(db: sqlite3.Database): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS migration_metadata (
                migration_id TEXT PRIMARY KEY,
                timestamp INTEGER NOT NULL
            )
        `, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Get executed migrations
async function getExecutedMigrations(db: sqlite3.Database): Promise<string[]> {
    return new Promise((resolve, reject) => {
        db.all<MigrationRow>('SELECT migration_id FROM migration_metadata ORDER BY migration_id', (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.migration_id));
        });
    });
}

// Record migration execution
async function recordMigration(db: sqlite3.Database, migrationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO migration_metadata (migration_id, timestamp) VALUES (?, ?)',
            [migrationId, Date.now()],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

// Run migrations
export async function runMigrations(): Promise<void> {
    const dbPath = path.join(DB_DIR, 'verifications.db');
    const db = new sqlite3.Database(dbPath);

    try {
        await ensureMigrationsTable(db);
        const executedMigrations = await getExecutedMigrations(db);

        for (const migration of migrations) {
            if (!executedMigrations.includes(migration.id)) {
                console.log(`Running migration ${migration.id}`);
                await migration.up(db);
                await recordMigration(db, migration.id);
                console.log(`Completed migration ${migration.id}`);
            }
        }
    } finally {
        db.close();
    }
} 
import sqlite3 from 'sqlite3';

export const migration = {
    id: '000_create_verifications_table',
    up: async (db: sqlite3.Database): Promise<void> => {
        return new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS verifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    proof_timestamp INTEGER NOT NULL,
                    verification_timestamp INTEGER,
                    valid BOOLEAN,
                    file_hash TEXT NOT NULL,
                    UNIQUE(file_hash, proof_timestamp)
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}; 
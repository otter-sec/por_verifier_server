import sqlite3 from 'sqlite3';

export const migration = {
    id: '004_create_stock_verifications_table',
    up: async (db: sqlite3.Database): Promise<void> => {
        return new Promise((resolve, reject) => {
            db.run(`
                CREATE TABLE IF NOT EXISTS stock_verifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    proof_timestamp INTEGER NOT NULL,
                    verification_timestamp INTEGER,
                    valid BOOLEAN,
                    file_hash TEXT NOT NULL,
                    proof_file_url TEXT,
                    prover_version TEXT,
                    -- step 1: stock balances from the PoR proof (internal ledger)
                    ledger_balances TEXT,
                    -- step 2: Token-2022 total supply per enabled mint
                    onchain_supplies TEXT,
                    -- step 3: RQD end-of-day broker positions
                    broker_positions TEXT,
                    UNIQUE(file_hash, proof_timestamp)
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};

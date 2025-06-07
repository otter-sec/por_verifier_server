import sqlite3 from 'sqlite3';

export const migration = {
    id: '003_add_prover_version_column',
    up: async (db: sqlite3.Database): Promise<void> => {
        return new Promise((resolve, reject) => {
            db.run('ALTER TABLE verifications ADD COLUMN prover_version TEXT', (err) => {
                if (err) {
                    // If column already exists, ignore the error
                    if (err.message.includes('duplicate column name')) {
                        console.log('Column prover_version already exists, skipping...');
                    } else {
                        reject(err);
                        return;
                    }
                }
                resolve();
            });
        });
    }
}; 
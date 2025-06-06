import sqlite3 from 'sqlite3';

export const migration = {
    id: '002_add_proof_file_url_column',
    up: async (db: sqlite3.Database): Promise<void> => {
        return new Promise((resolve, reject) => {
            db.run('ALTER TABLE verifications ADD COLUMN proof_file_url TEXT', (err) => {
                if (err) {
                    // If column already exists, ignore the error
                    if (err.message.includes('duplicate column name')) {
                        console.log('Column proof_file_url already exists, skipping...');
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
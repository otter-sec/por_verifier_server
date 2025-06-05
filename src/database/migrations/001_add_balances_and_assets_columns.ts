import sqlite3 from 'sqlite3';

export const migration = {
    id: '001_add_balances_and_assets_columns',
    up: async (db: sqlite3.Database): Promise<void> => {
        return new Promise((resolve, reject) => {
            db.run('ALTER TABLE verifications ADD COLUMN assets TEXT', (err) => {
                if (err) {
                    // If column already exists, ignore the error
                    if (err.message.includes('duplicate column name')) {
                        console.log('Column assets already exists, skipping...');
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
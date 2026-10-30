import fs from 'fs';
import path from 'path';

// Tests drop the database tables when they finish, so never run them against DATABASE_URL
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/por_verifier_test';

// Increase timeout for all tests
jest.setTimeout(10000);

// Clean up temp files after each test
const TEMP_DIR = path.join('/var/tmp', 'por');

afterEach(() => {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}); 
import fs from 'fs';
import path from 'path';

// Increase timeout for all tests
jest.setTimeout(10000);

// Clean up temp files after each test
const TEMP_DIR = path.join('/tmp', 'por');

afterEach(() => {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}); 
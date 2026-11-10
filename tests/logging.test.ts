import request from 'supertest';
import app from '../src/index';

// Regression test for access-log forging through the Basic auth username (GHSA-4vj7-5mj6-jm8m and later morgan fixes):
// request-derived values must not be able to start a new log line. These tests don't need the database.

async function captureAccessLog(username: string): Promise<string> {
    let output = '';
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        output += chunk.toString();
        return true;
    });
    try {
        await request(app)
            .get('/health')
            .set('Authorization', 'Basic ' + Buffer.from(`${username}:pw`).toString('base64'))
            .expect(200);
        // morgan logs when the response finishes, give it a moment
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
        spy.mockRestore();
    }
    return output;
}

describe('access log', () => {
    it.each([
        'alice\nFORGED_LOG_ENTRY',
        'alice\r\nFORGED_LOG_ENTRY',
        'alice\u2028FORGED_LOG_ENTRY',
        'alice" 200 1 "-" "-"\nFORGED_LOG_ENTRY',
    ])('keeps a forged username on a single line: %j', async (username) => {
        const output = await captureAccessLog(username);
        const lines = output.split(/\r\n|\r|\n|\u2028|\u2029/).filter(Boolean);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('"GET /health HTTP/1.1" 200');
        expect(lines[0]).not.toMatch(/^FORGED/);
    });
});

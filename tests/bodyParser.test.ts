import http from 'http';
import { AddressInfo } from 'net';
import zlib from 'zlib';
import app from '../src/index';

// Regression test for GHSA-27r3-jxmh-p828: a valid compressed body followed by trailing garbage used to raise an
// uncaught decoder error in body-parser after the response was sent, crashing the process.
// These tests don't touch the database.

function rawRequest(port: number, path: string, headers: http.OutgoingHttpHeaders, body?: Buffer): Promise<number> {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers }, (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
        });
        req.on('error', reject);
        req.end(body);
    });
}

describe('compressed request bodies', () => {
    let server: http.Server;
    let port: number;
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => { uncaught.push(err); };

    beforeAll(async () => {
        process.on('uncaughtException', onUncaught);
        server = await new Promise<http.Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        process.off('uncaughtException', onUncaught);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('installs a body-parser release that is not affected by GHSA-27r3-jxmh-p828', () => {
        const { version } = require('body-parser/package.json') as { version: string };
        const [major, minor, patch] = version.split('.').map(Number);
        expect(major > 1 || (major === 1 && (minor > 20 || (minor === 20 && patch >= 9)))).toBe(true);
    });

    it.each(['gzip', 'deflate', 'br'])('rejects %s bodies with trailing garbage without crashing', async (encoding) => {
        const json = Buffer.from(JSON.stringify({ url: 'http://example.com/proof.zip' }));
        const compressed = encoding === 'gzip' ? zlib.gzipSync(json)
            : encoding === 'deflate' ? zlib.deflateSync(json)
            : zlib.brotliCompressSync(json);
        const body = Buffer.concat([compressed, Buffer.from('trailing-garbage-that-is-not-compressed')]);

        // Any path works: the JSON parser runs before routing and authentication
        const status = await rawRequest(port, '/no-such-route', {
            'Content-Type': 'application/json',
            'Content-Encoding': encoding,
            'Content-Length': body.length,
        }, body);
        expect(status).toBe(415);

        // Give any late decoder errors a chance to surface, then make sure the server still answers
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(uncaught).toEqual([]);
        expect(await rawRequest(port, '/health', {})).toBe(200);
    });
});

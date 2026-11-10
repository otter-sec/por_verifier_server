import http from 'http';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import * as utils from '../src/utils';
import { downloadAndUnzip } from '../src/verifier';

// The proof download fetches an attacker-chosen URL. Its SSRF protections are implemented by the service itself
// (scheme check, private address check, pinned DNS lookup, no redirects, no proxy, size limit), not by axios defaults,
// so they are tested here to catch regressions when axios is upgraded. These tests don't need the database.

const ZIP_PATH = path.join(__dirname, 'test_data.zip');
const ZIP_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(ZIP_PATH)).digest('hex');
const MAX_SIZE = 150 * 1024 * 1024;

describe('downloadAndUnzip', () => {
    let server: http.Server;
    let base: string;
    let port: number;
    const hits: string[] = [];

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            hits.push(req.url || '');
            if (req.url === '/proof.zip') {
                res.setHeader('Content-Type', 'application/zip');
                fs.createReadStream(ZIP_PATH).pipe(res);
            } else if (req.url === '/redirect') {
                res.writeHead(302, { Location: '/proof.zip' }).end();
            } else if (req.url === '/huge') {
                // stream past the size limit until the client gives up
                const chunk = Buffer.alloc(1024 * 1024);
                let sent = 0;
                const write = () => {
                    while (sent <= MAX_SIZE + chunk.length) {
                        sent += chunk.length;
                        if (!res.write(chunk)) return void res.once('drain', write);
                    }
                    res.end();
                };
                res.on('close', () => { sent = Infinity; });
                write();
            } else {
                res.writeHead(404).end();
            }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
        base = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => { hits.length = 0; });
    afterEach(() => jest.restoreAllMocks());

    it('downloads and hashes the proof', async () => {
        const { fileHash, extractPath } = await downloadAndUnzip(`${base}/proof.zip`);
        expect(fileHash).toBe(ZIP_SHA256);
        expect(fs.existsSync(path.join(extractPath, 'final_proof.json'))).toBe(true);
    });

    it.each([
        'ftp://127.0.0.1/proof.zip',
        'file:///etc/passwd',
        'data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
        'httpx://127.0.0.1/proof.zip',
    ])('rejects non-http(s) URL %s', async (url) => {
        await expect(downloadAndUnzip(url)).rejects.toThrow('Invalid URL');
    });

    it('rejects private addresses outside of development and test', async () => {
        const nodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await expect(downloadAndUnzip(`${base}/proof.zip`)).rejects.toThrow('Invalid IP address');
            await expect(downloadAndUnzip(`http://localhost:${port}/proof.zip`)).rejects.toThrow('Invalid IP address');
        } finally {
            process.env.NODE_ENV = nodeEnv;
        }
        expect(hits).toEqual([]);
    });

    it('connects to the validated address instead of resolving the hostname again', async () => {
        // the hostname can't be resolved, so the download only works if the pinned lookup is used
        jest.spyOn(utils, 'resolveAndValidateUrl').mockResolvedValue(['127.0.0.1', 4]);
        const { fileHash } = await downloadAndUnzip(`http://pinned.invalid:${port}/proof.zip`);
        expect(fileHash).toBe(ZIP_SHA256);
    });

    it('does not follow redirects', async () => {
        await expect(downloadAndUnzip(`${base}/redirect`)).rejects.toThrow();
        expect(hits).toEqual(['/redirect']);
    });

    it('ignores proxies configured in the environment', async () => {
        // A proxy would resolve the hostname itself, bypassing the pinned lookup. The fake proxy records any request
        // it gets. The hostname isn't in NO_PROXY, so the download only succeeds if it connects to the pinned address
        // directly, both when axios reads the proxy from the environment and when node does (NODE_USE_ENV_PROXY=1).
        const proxyHits: string[] = [];
        const proxy = http.createServer((req, res) => { proxyHits.push(req.url || ''); res.writeHead(502).end(); });
        await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
        const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

        const saved = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
        process.env.HTTP_PROXY = process.env.http_proxy = proxyUrl;
        delete process.env.NO_PROXY;
        delete process.env.no_proxy;
        jest.spyOn(utils, 'resolveAndValidateUrl').mockResolvedValue(['127.0.0.1', 4]);
        try {
            const { fileHash } = await downloadAndUnzip(`http://proxied.invalid:${port}/proof.zip`);
            expect(fileHash).toBe(ZIP_SHA256);
            expect(proxyHits).toEqual([]);
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            await new Promise<void>((resolve) => proxy.close(() => resolve()));
        }
    });

    it('stops downloading responses larger than 150MB', async () => {
        await expect(downloadAndUnzip(`${base}/huge`)).rejects.toThrow(/maxContentLength/);
    }, 30000);
});

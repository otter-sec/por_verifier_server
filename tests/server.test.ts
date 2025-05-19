import request from 'supertest';
import fs from 'fs';
import path from 'path';
import express, { Express } from 'express';
import app from '../src/index';

interface VerificationResponse {
    id: number;
    valid: boolean;
    fileHash: string;
    proofTimestamp: number;
    verificationTimestamp: number;
}

declare global {
    var testData: VerificationResponse;
    namespace NodeJS {
        interface Global {
            testData: VerificationResponse;
        }
    }
}

describe('Verification Server', () => {
    let mockServer: ReturnType<Express['listen']>;
    let mockServerUrl: string;
    let mockServerUrl2: string;
    const TEST_PORT = 4000;

    // Setup mock server and test files
    beforeAll(async () => {
        // Setup mock HTTP server to serve the zip file
        const mockApp = express();
        mockApp.get('/proof.zip', (req, res) => {
            res.sendFile(path.join(__dirname, 'test_data.zip'));
        });

        mockApp.get('/proof2.zip', (req, res) => {
            res.sendFile(path.join(__dirname, 'test_data2.zip'));
        });

        await new Promise<void>(resolve => {
            mockServer = mockApp.listen(TEST_PORT, () => {
                mockServerUrl = `http://localhost:${TEST_PORT}/proof.zip`;
                mockServerUrl2 = `http://localhost:${TEST_PORT}/proof2.zip`;
                resolve();
            });
        });

        // set the API key in the environment
        process.env.API_KEY = 'test-api-key';
    });

    // Cleanup after tests
    afterAll(done => {
        // remove the database file
        fs.unlinkSync(path.join(__dirname, '../data/verifications.db'));

        mockServer.close(done);
    });

    describe('POST /verify', () => {
        it('should verify a valid proof from HTTP URL', async () => {
            const response = await request(app)
                .post('/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: mockServerUrl
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('id');
            expect(response.body).toHaveProperty('valid');
            expect(response.body).toHaveProperty('fileHash');
            expect(response.body).toHaveProperty('proofTimestamp');

            // Store these for later tests
            global.testData = response.body as VerificationResponse;
        });

        it('should return 400 if URL is missing', async () => {
            const response = await request(app)
                .post('/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });

        it('should return 500 if URL is invalid', async () => {
            const response = await request(app)
                .post('/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: 'invalid-url'
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error');
        });

        it('should return 500 if URL is not accessible', async () => {
            const response = await request(app)
                .post('/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: 'http://localhost:9999/nonexistent.zip'
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error');
        });
    });

    describe('GET /verification', () => {
        it('should find verification by ID', async () => {
            const response = await request(app)
                .get(`/verification?id=${global.testData.id}`);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject(global.testData);
        });

        it('should find verification by file hash', async () => {
            const response = await request(app)
                .get(`/verification?fileHash=${global.testData.fileHash}`);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject(global.testData);
        });

        it('should find verification by proof timestamp', async () => {
            const response = await request(app)
                .get(`/verification?proofTimestamp=${global.testData.proofTimestamp}`);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject(global.testData);
        });

        it('should return 404 for non-existent ID', async () => {
            const response = await request(app)
                .get('/verification?id=999999');

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
        });

        it('should return 400 if no search parameter is provided', async () => {
            const response = await request(app)
                .get('/verification');

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });
    });

    describe('Concurrent verifications', () => {
        it('should handle concurrent verification requests properly', async () => {
            // create 2 concurrent requests using test_data.zip and test_data2.zip
            const requests = [
                request(app)
                    .post('/verify')
                    .set('Authorization', `Bearer ${process.env.API_KEY}`)
                    .send({
                        url: mockServerUrl
                    }),
                request(app)
                    .post('/verify')
                    .set('Authorization', `Bearer ${process.env.API_KEY}`)
                    .send({
                        url: mockServerUrl2
                    })
            ];

            const responses = await Promise.all(requests);
            
            // All requests should succeed
            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body).toHaveProperty('id');
                expect(response.body).toHaveProperty('valid');
            });

            // Both verifications should have different IDs
            const ids = responses.map(r => r.body.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(responses.length);
        });
    });

    describe('POST /verify with UPSERT behavior', () => {
        let firstResponse: VerificationResponse;

        it('should create initial verification', async () => {
            const response = await request(app)
                .post('/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: mockServerUrl
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('id');
            expect(response.body).toHaveProperty('valid');
            expect(response.body).toHaveProperty('fileHash');
            expect(response.body).toHaveProperty('proofTimestamp');

            firstResponse = response.body as VerificationResponse;
        });

        it('should update existing verification with same file_hash and proof_timestamp', async () => {
            // Make second request with same URL
            const response = await request(app)
                .post('/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: mockServerUrl
                });

            expect(response.status).toBe(200);
            expect(response.body.fileHash).toBe(firstResponse.fileHash);
            expect(response.body.proofTimestamp).toBe(firstResponse.proofTimestamp);
            expect(response.body.verificationTimestamp).not.toBe(firstResponse.verificationTimestamp);
            
            // Verify through GET endpoint
            const verifyResponse = await request(app)
                .get(`/verification?fileHash=${response.body.fileHash}`);
            
            expect(verifyResponse.status).toBe(200);
            expect(verifyResponse.body.fileHash).toBe(firstResponse.fileHash);
            expect(verifyResponse.body.proofTimestamp).toBe(firstResponse.proofTimestamp);
            expect(verifyResponse.body.verificationTimestamp).toBe(response.body.verificationTimestamp);
        });
    });
}); 
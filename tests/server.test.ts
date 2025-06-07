import request from 'supertest';
import fs from 'fs';
import path from 'path';
import express, { Express } from 'express';
import app from '../src/index';
import { verificationQueue } from '../src/queue';

interface VerificationResponse {
    id: number;
    valid: boolean | null;
    fileHash: string;
    proofTimestamp: number;
    verificationTimestamp: number | null;
}

// Helper function to wait for verification to complete
async function waitForVerification(id: number, maxAttempts = 10, delay = 1000): Promise<VerificationResponse> {
    for (let i = 0; i < maxAttempts; i++) {
        const response = await request(app)
            .get(`/api/verification?id=${id}`)
            .expect(200);
        
        const verification = response.body as VerificationResponse;
        if (verification.valid !== null && verification.verificationTimestamp !== null) {
            return verification;
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Verification did not complete in time');
}

async function waitForSecondVerification(id: number, verificationTimestamp: number, maxAttempts = 10, delay = 1000): Promise<VerificationResponse> {
    for (let i = 0; i < maxAttempts; i++) {
        const response = await request(app)
            .get(`/api/verification?id=${id}&verificationTimestamp=${verificationTimestamp}`)
            .expect(200);
        const verification = response.body as VerificationResponse;
        if (verification.valid !== null && verification.verificationTimestamp !== null) {
            if (verification.verificationTimestamp > verificationTimestamp) {
                return verification;
            }
        }
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    throw new Error('Verification did not complete in time');
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

    // Helper function to wait for queue to be empty
    async function waitForQueueEmpty(maxAttempts = 30, delay = 1000): Promise<void> {
        for (let i = 0; i < maxAttempts; i++) {
            const queueLength = verificationQueue.getQueueLength();
            const activeJobs = verificationQueue.getActiveJobs();
            
            if (queueLength === 0 && activeJobs === 0) {
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        throw new Error('Queue did not empty in time');
    }

    // Cleanup after tests
    afterAll((done) => {
        // Use an IIFE to handle async operations
        (async () => {
            try {
                // Wait for all jobs to complete
                await waitForQueueEmpty();
                
                // remove the database file if it exists
                if (fs.existsSync('/db/verifications.db')) {
                    fs.unlinkSync('/db/verifications.db');
                }

                mockServer.close(done);
            } catch (error) {
                console.error('Error during cleanup:', error);
                mockServer.close(done);
            }
        })();
    });

    describe('POST /verify', () => {
        it('should create initial verification entry and return pending status', async () => {
            const response = await request(app)
                .post('/api/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: mockServerUrl
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('id');
            expect(response.body.valid).toBeNull();
            expect(response.body.verificationTimestamp).toBeNull();
            expect(response.body).toHaveProperty('fileHash');
            expect(response.body).toHaveProperty('proofTimestamp');

            // Store these for later tests
            global.testData = response.body as VerificationResponse;
        });

        it('should return 400 if URL is missing', async () => {
            const response = await request(app)
                .post('/api/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({});

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });

        it('should return 500 if URL is invalid', async () => {
            const response = await request(app)
                .post('/api/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: 'invalid-url'
                });

            expect(response.status).toBe(500);
            expect(response.body).toHaveProperty('error');
        });

        it('should return 500 if URL is not accessible', async () => {
            const response = await request(app)
                .post('/api/verify')
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
            const initialResponse = await request(app)
                .get(`/api/verification?id=${global.testData.id}`);

            expect(initialResponse.status).toBe(200);
            expect(initialResponse.body.valid)
            expect(initialResponse.body.verificationTimestamp)
            expect(initialResponse.body.fileHash).toBe(global.testData.fileHash);
            expect(initialResponse.body.proofTimestamp).toBe(global.testData.proofTimestamp);
        });

        it('should find verification by file hash and wait for completion', async () => {
            const verification = await waitForVerification(global.testData.id);
            const response = await request(app)
                .get(`/api/verification?fileHash=${verification.fileHash}`);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject(verification);
        });

        it('should find verification by proof timestamp and wait for completion', async () => {
            const verification = await waitForVerification(global.testData.id);
            const response = await request(app)
                .get(`/api/verification?proofTimestamp=${verification.proofTimestamp}`);

            expect(response.status).toBe(200);
            expect(response.body).toMatchObject(verification);
        });

        it('should return 404 for non-existent ID', async () => {
            const response = await request(app)
                .get('/api/verification?id=999999');

            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('error');
        });

        it('should return 400 if no search parameter is provided', async () => {
            const response = await request(app)
                .get('/api/verification');

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error');
        });
    });

    describe('Concurrent verifications', () => {
        it('should handle concurrent verification requests properly', async () => {
            // create 2 concurrent requests using test_data.zip and test_data2.zip
            const requests = [
                request(app)
                    .post('/api/verify')
                    .set('Authorization', `Bearer ${process.env.API_KEY}`)
                    .send({
                        url: mockServerUrl
                    }),
                request(app)
                    .post('/api/verify')
                    .set('Authorization', `Bearer ${process.env.API_KEY}`)
                    .send({
                        url: mockServerUrl2
                    })
            ];

            const responses = await Promise.all(requests);
            
            // All requests should succeed and return pending status
            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body).toHaveProperty('id');
                expect(response.body.valid).toBeNull();
                expect(response.body.verificationTimestamp).toBeNull();
            });

            // Both verifications should have different IDs
            const ids = responses.map(r => r.body.id);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(responses.length);

            // Wait for both verifications to complete
            const completedVerifications = await Promise.all(
                ids.map(id => waitForVerification(id))
            );

            // Verify both completed successfully
            completedVerifications.forEach(verification => {
                expect(verification.valid).not.toBeNull();
                expect(verification.verificationTimestamp).not.toBeNull();
            });
        });
    });

    describe('POST /verify with UPSERT behavior', () => {
        let firstResponse: VerificationResponse;

        it('should create initial verification', async () => {
            const response = await request(app)
                .post('/api/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: mockServerUrl
                });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('id');
            expect(response.body.valid).toBeNull();
            expect(response.body.verificationTimestamp).toBeNull();
            expect(response.body).toHaveProperty('fileHash');
            expect(response.body).toHaveProperty('proofTimestamp');

            firstResponse = response.body as VerificationResponse;
        });

        it('should update existing verification with same file_hash and proof_timestamp', async () => {
            // Wait for first verification to complete
            const firstCompleted = await waitForVerification(firstResponse.id);

            // Make second request with same URL
            const response = await request(app)
                .post('/api/verify')
                .set('Authorization', `Bearer ${process.env.API_KEY}`)
                .send({
                    url: mockServerUrl
                });

            expect(response.status).toBe(200);
            expect(response.body.id).toBe(firstResponse.id);
            expect(response.body.fileHash).toBe(firstResponse.fileHash);
            expect(response.body.proofTimestamp).toBe(firstResponse.proofTimestamp);
            expect(response.body.valid).toBeNull();
            expect(response.body.verificationTimestamp).toBeNull();

            // Wait for re-verification to complete
            const secondCompleted = await waitForSecondVerification(response.body.id, firstCompleted.verificationTimestamp!);
            
            // Verify through GET endpoint
            const verifyResponse = await request(app)
                .get(`/api/verification?fileHash=${response.body.fileHash}`);
            
            expect(verifyResponse.status).toBe(200);
            expect(verifyResponse.body.fileHash).toBe(firstResponse.fileHash);
            expect(verifyResponse.body.proofTimestamp).toBe(firstResponse.proofTimestamp);
            expect(verifyResponse.body.verificationTimestamp).toBeGreaterThan(firstCompleted.verificationTimestamp!);
        });
    });
});

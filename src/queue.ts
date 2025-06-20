import { EventEmitter } from 'events';
import { verifyProof, downloadAndUnzip } from './verifier';
import { upsertVerification, findVerification } from './database';
import { invalidateCacheEntries } from './middlewares/cache';
import fs from 'fs';
import path from 'path';

export interface VerificationJob {
    id: number;
    extractPath: string;
    zipPath: string;
    fileHash: string;
    proofTimestamp: number;
    url: string; // Add URL to the job interface
}

class VerificationQueue extends EventEmitter {
    private queue: VerificationJob[] = [];
    private isProcessing: boolean = false;
    private concurrency: number = 2; // Number of jobs to process concurrently
    private activeJobs: number = 0;

    constructor() {
        super();
        // Start processing jobs when they are added
        this.on('jobAdded', () => this.processNextJob());
    }

    async addJob(job: VerificationJob): Promise<void> {
        this.queue.push(job);
        this.emit('jobAdded');
    }

    private async processNextJob(): Promise<void> {
        if (this.isProcessing || this.activeJobs >= this.concurrency || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        const job = this.queue.shift()!;
        this.activeJobs++;

        console.log("Starting to process job: ", job.id);
        console.log("Extract path: ", job.extractPath);
        console.log("Zip path: ", job.zipPath);
        console.log("File hash: ", job.fileHash);
        console.log("Proof timestamp: ", job.proofTimestamp);
        console.log("URL: ", job.url);

        try {
            // Check if extractPath exists, if not, re-download and extract
            if (!fs.existsSync(job.extractPath)) {
                console.log("Extract path does not exist, re-downloading and extracting");
                const { extractPath, zipPath } = await downloadAndUnzip(job.url);
                job.extractPath = extractPath;
                job.zipPath = zipPath;
            }

            // Process the verification
            const { valid } = await verifyProof(job.extractPath);

            // Update the database with the verification result
            const verificationTimestamp = Date.now();
            await upsertVerification(job.proofTimestamp, valid, job.fileHash, verificationTimestamp);
            
            // Invalidate cache entries
            invalidateCacheEntries(job.id, job.proofTimestamp, job.fileHash);

            // Clean up files
            try {
                fs.rmSync(job.extractPath, { recursive: true });
                fs.rmSync(job.zipPath);
            } catch (error) {
                console.error('Error cleaning up files:', error);
            }

            console.log("Successfully processed job: ", job.id);

        } catch (error) {
            console.error('Error processing verification job:', error);
            // Update database to mark verification as failed
            await upsertVerification(job.proofTimestamp, false, job.fileHash, Date.now());
        } finally {
            this.activeJobs--;
            this.isProcessing = false;
            // Process next job if there are any
            this.processNextJob();
        }
    }

    getQueueLength(): number {
        return this.queue.length;
    }

    getActiveJobs(): number {
        return this.activeJobs;
    }
}

// Export a singleton instance
export const verificationQueue = new VerificationQueue(); 
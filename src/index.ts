import express, { Request, Response, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { authMiddleware } from "./middlewares/auth";
import { insertVerification, findVerification } from "./database";
import { downloadAndUnzip, verifyProof } from "./verifier";
import { cacheMiddleware, invalidateCacheEntries } from "./middlewares/cache";
import { VerificationResponse, VerificationQuery } from "./types/verification";

// parse .env if it exists
if (fs.existsSync('.env')) {
    const env = require('dotenv').config();
    if (env.error) {
        console.error('Error loading .env file:', env.error);
    }
}

const app = express();
app.use(express.json());

// Mutex-like lock mechanism
let isVerifying = false;
const verificationQueue: Array<() => void> = [];

function acquireLock(): Promise<void> {
    return new Promise((resolve) => {
        if (!isVerifying) {
            isVerifying = true;
            resolve();
        } else {
            verificationQueue.push(resolve);
        }
    });
}

function releaseLock(): void {
    const nextResolver = verificationQueue.shift();
    if (nextResolver) {
        nextResolver();
    } else {
        isVerifying = false;
    }
}

//////////////////
/*====ROUTES====*/

// Authentication is needed for verifying a proof
app.post("/verify", authMiddleware, (async (req: Request, res: Response) => {
    try {
        const { url } = req.body as { url?: string };
        if (!url) {
            return res.status(400).json({ error: "URL is required" });
        }

        // Acquire lock before proceeding
        await acquireLock();

        try {
            // Download and unzip the file
            const { extractPath, fileHash, zipPath } = await downloadAndUnzip(url);

            // Verify the files
            const { valid, proofTimestamp } = await verifyProof(extractPath);

            // Check if it exists by file hash and proof timestamp and validate if update is valid
            // if the verification already exists, we can update the verification (only valid and verification_timestamp fields)
            // however, for update to be valid, the file hash and proof timestamp should match the existing verification OR the existing verification is invalid
            // it is not possible to update the file hash or proof timestamp of a valid verification
            const existingVerificationFileHash = await findVerification({
                fileHash,
            });
            if (existingVerificationFileHash && existingVerificationFileHash.proof_timestamp !== proofTimestamp && existingVerificationFileHash.valid) {
                throw new Error("Proof timestamp mismatch with existing valid verification");
            }

            const existingVerificationProofTimestamp = await findVerification({
                proofTimestamp,
            });
            if (existingVerificationProofTimestamp && existingVerificationProofTimestamp.file_hash !== fileHash && existingVerificationProofTimestamp.valid) {
                throw new Error("File hash mismatch with existing valid verification");
            }
            
            // Store the result in the database
            const verificationTimestamp = Date.now();
            const id = await insertVerification(proofTimestamp, valid, fileHash, verificationTimestamp);

            // Clean up
            fs.rmSync(extractPath, { recursive: true });
            fs.rmSync(path.join(zipPath));

            // Invalidate the cache if the verification was updated/created
            invalidateCacheEntries(id, proofTimestamp, fileHash);

            const response: VerificationResponse = {
                id,
                valid,
                fileHash,
                proofTimestamp,
                verificationTimestamp,
            };
            res.json(response);

        } catch(error) {
            console.error("Error:", error);
        } finally {
            // Always release the lock, even if an error occurred
            releaseLock();
        }
    } catch (error) {
        console.error("Error:", error);
    }
}) as RequestHandler);

// No authentication needed for getting a verification but we add LRU cache middleware
app.get("/verification", cacheMiddleware, (async (req: Request<{}, {}, {}, VerificationQuery>, res: Response) => {
    try {
        const { id, proofTimestamp, fileHash } = req.query;

        if (!id && !proofTimestamp && !fileHash) {
            return res.status(400).json({
                error: "One of id, proofTimestamp, or fileHash is required",
            });
        }

        const result = await findVerification({
            id: id ? parseInt(id, 10) : undefined,
            proofTimestamp: proofTimestamp ? parseInt(proofTimestamp, 10) : undefined,
            fileHash,
        });

        if (!result) {
            return res.status(404).json({ error: "Verification not found" });
        }

        const response: VerificationResponse = {
            valid: Boolean(result.valid),
            fileHash: result.file_hash,
            verificationTimestamp: parseInt(result.verification_timestamp.toString()),
            proofTimestamp: parseInt(result.proof_timestamp.toString()),
            id: result.id,
        };

        res.json(response);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}) as RequestHandler);

//////////////////

const PORT = process.env.PORT || 3000;

// Create a function to start the server
export function startServer(): ReturnType<typeof app.listen> {
    return app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// Only start the server if this file is run directly
if (require.main === module) {
    startServer();
}

// Export the app for testing
export default app; 
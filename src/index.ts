import express, { Request, Response, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { authMiddleware } from "./middlewares/auth";
import { findVerification, upsertVerification } from "./database";
import { downloadAndUnzip } from "./verifier";
import { cacheMiddleware } from "./middlewares/cache";
import { VerificationResponse, VerificationQuery } from "./types/verification";
import { verificationQueue as queue } from "./queue";

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

            // Read the proof timestamp from final_proof.json
            const finalProofPath = path.join(extractPath, "final_proof.json");
            const finalProofContent = JSON.parse(
                fs.readFileSync(finalProofPath, "utf-8")
            );
            const proofTimestamp = finalProofContent.timestamp;

            // Check if it exists by file hash and proof timestamp
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
            
            // Store initial entry in the database with null values for valid and verificationTimestamp
            let id: number;
            if (!existingVerificationFileHash || !existingVerificationProofTimestamp) {
                id = await upsertVerification(proofTimestamp, null, fileHash, null);
            } else {
                id = existingVerificationFileHash?.id ?? existingVerificationProofTimestamp?.id;
            }

            // Add job to queue for background processing
            queue.addJob({
                id,
                extractPath,
                zipPath,
                fileHash,
                proofTimestamp
            }).catch((error: Error) => {
                console.error('Error adding job to queue:', error);
            });

            // Return the initial entry
            const response: VerificationResponse = {
                id,
                valid: null,
                fileHash,
                proofTimestamp,
                verificationTimestamp: null
            };
            res.json(response);

        } catch(error) {
            console.error("Error:", error);
            res.status(500).json({ error: "Internal server error" });
        } finally {
            // Always release the lock, even if an error occurred
            releaseLock();
        }
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
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
            valid: result.valid === null ? null : Boolean(result.valid),
            fileHash: result.file_hash,
            verificationTimestamp: result.verification_timestamp === null ? null : parseInt(result.verification_timestamp.toString()),
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
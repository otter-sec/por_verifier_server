import express, { Request, Response, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import expressLayouts from 'express-ejs-layouts';
import { authMiddleware } from "./middlewares/auth";
import { adminAuthMiddleware } from "./middlewares/adminAuth";
import { findVerification, upsertVerification, getAllVerifications, deleteVerification } from "./database";
import { downloadAndUnzip } from "./verifier";
import { cacheMiddleware, invalidateCacheEntries } from "./middlewares/cache";
import { VerificationResponse, VerificationQuery } from "./types/verification";
import { verificationQueue as queue } from "./queue";
import { parseFinalProof, formatMoney, getProverVersion } from "./utils";
import { exec } from "child_process";

let curProverVersion = getProverVersion();

// parse .env if it exists
if (fs.existsSync('.env')) {
    const env = require('dotenv').config();
    if (env.error) {
        console.error('Error loading .env file:', env.error);
    }
}

const app = express();

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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

// View routes (before API routes)
// app.get('/', cacheMiddleware, async (req: Request, res: Response) => {
app.get('/', async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 20;
        
        // Ensure reasonable limits
        const validPage = Math.max(1, page);
        const validPageSize = Math.min(Math.max(1, pageSize), 100);
        
        const result = await getAllVerifications(validPage, validPageSize);
        const totalPages = Math.ceil(result.total / validPageSize);
        
        res.render('verifications', { 
            title: 'All proofs',
            verifications: result.verifications,
            total: result.total,
            currentPage: validPage,
            pageSize: validPageSize,
            totalPages: totalPages,
            hasNextPage: validPage < totalPages,
            hasPrevPage: validPage > 1
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).render('error', { title: 'Error - POR Verifier', error: 'Internal server error' });
    }
});

// app.get('/verification/:identifier', cacheMiddleware, async (req: Request, res: Response) => {
app.get('/verification/:identifier', async (req: Request, res: Response) => {
    try {
        const identifier = req.params.identifier;
        let verificationQuery: any = {};

        // Determine the type of identifier
        if (/^\d+$/.test(identifier)) {
            const numericValue = parseInt(identifier);
            
            verificationQuery.proofTimestamp = numericValue;
        } else {
            // If it contains non-digits, treat as fileHash
            verificationQuery.fileHash = identifier;
        }

        let verification = await findVerification(verificationQuery);
        
        if (!verification) {
            return res.status(404).render('error', { title: 'Error - POR Verifier', error: 'Verification not found' });
        }

        // Parse assets if they exist
        let assets = null;
        if (verification.assets) {
            assets = JSON.parse(verification.assets);
        }

        res.render('verification-detail', { 
            title: `Proof ${verification.proof_timestamp} - PoR Verifier`,
            verification: {
                ...verification,
                valid: verification.valid === null ? null : Boolean(verification.valid),
                verification_timestamp: verification.verification_timestamp === null ? null : parseInt(verification.verification_timestamp.toString()),
                proof_timestamp: parseInt(verification.proof_timestamp.toString()),
            },
            assets,
            formatMoney
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).render('error', { title: 'Error - POR Verifier', error: 'Internal server error' });
    }
});

// Create API router
const apiRouter = express.Router();

// Authentication is needed for verifying a proof
apiRouter.post("/verify", authMiddleware, (async (req: Request, res: Response) => {
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

            // Read and parse the final proof
            const finalProofPath = path.join(extractPath, "final_proof.json");
            const finalProofContent = JSON.parse(
                fs.readFileSync(finalProofPath, "utf-8")
            );
            
            const { proofTimestamp, assets, proverVersion } = parseFinalProof(finalProofContent);

            if (curProverVersion !== proverVersion) {
                res.status(400).json({ error: "Prover version mismatch from the proof and the current prover version" });
                return;
            }

            // Store the assets data as JSON string
            const assetsStr = JSON.stringify(assets);

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
            let existingAssets: string | null = null;

            if (!existingVerificationFileHash || !existingVerificationProofTimestamp) {
                id = await upsertVerification(proofTimestamp, null, fileHash, null, assetsStr, url, proverVersion);
            } else {
                const existingVerification = existingVerificationFileHash || existingVerificationProofTimestamp;
                id = existingVerification.id;
                existingAssets = existingVerification.assets;
            }

            // Add job to queue for background processing
            queue.addJob({
                id,
                extractPath,
                zipPath,
                fileHash,
                proofTimestamp,
                url
            }).catch((error: Error) => {
                console.error('Error adding job to queue:', error);
            });

            // Return the initial entry
            const response: VerificationResponse = {
                id,
                valid: null,
                fileHash,
                proofTimestamp,
                verificationTimestamp: null,
                proverVersion,
                assets: existingAssets ? JSON.parse(existingAssets) : assets
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
apiRouter.get("/verification", cacheMiddleware, (async (req: Request<{}, {}, {}, VerificationQuery>, res: Response) => {
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

        const response: VerificationResponse & { balances?: any, assets?: any } = {
            valid: result.valid === null ? null : Boolean(result.valid),
            fileHash: result.file_hash,
            verificationTimestamp: result.verification_timestamp === null ? null : parseInt(result.verification_timestamp.toString()),
            proofTimestamp: parseInt(result.proof_timestamp.toString()),
            id: result.id,
            proverVersion: result.prover_version,
        };

        // Parse and include balances and assets if they exist
        if (result.balances) {
            response.balances = JSON.parse(result.balances);
        }
        if (result.assets) {
            response.assets = JSON.parse(result.assets);
        }

        res.json(response);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}) as RequestHandler);

// Get all verifications with pagination
apiRouter.get("/verifications", cacheMiddleware, (async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 10;

        const result = await getAllVerifications(page, pageSize);
        res.json(result);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}) as RequestHandler);

apiRouter.get("/prover-version", (async (req: Request, res: Response) => {
    res.status(200).json({ proverVersion: curProverVersion });
}) as RequestHandler);

// Admin routes
const adminRouter = express.Router();
adminRouter.use(adminAuthMiddleware);

// Delete a verification
adminRouter.post("/verifications/:id/delete", (async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            res.status(400).json({ error: "Invalid verification ID" });
            return;
        }

        const verification = await findVerification({ id });
        if (!verification) {
            res.status(404).json({ error: "Verification not found" });
            return;
        }

        await deleteVerification(id);

        // invalidate cache
        invalidateCacheEntries(verification.id, verification.proof_timestamp, verification.file_hash);

        res.status(200).json({ message: "Verification deleted successfully" });
    } catch (error) {
        console.error("Error:", error);
        if (error instanceof Error && error.message === 'Verification not found') {
            res.status(404).json({ error: "Verification not found" });
        } else {
            res.status(500).json({ error: "Internal server error" });
        }
    }
}) as RequestHandler);

// Update prover version
adminRouter.post("/update-prover", (async (_req: Request, res: Response) => {
        exec(`sudo /update-prover.sh`, (error, _stdout, _stderr) => {
            if (error) {
                console.error("Error:", error);
            } else {
                curProverVersion = getProverVersion();
                console.log(`Prover version updated to: ${curProverVersion}`);
            }
        });

        res.status(200).json({ message: `Starting to update prover version...` });
}) as RequestHandler);

// Mount API router under /api prefix
app.use('/api', apiRouter);

// Mount admin routes
app.use("/api/admin", adminRouter);

//////////////////

const PORT = process.env.PORT || 3000;

// Create a function to start the server
export function startServer(): ReturnType<typeof app.listen> {
    return app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`Current prover version: ${curProverVersion}`);
    });
}

// Only start the server if this file is run directly
if (require.main === module) {
    startServer();
}

// Export the app for testing
export default app; 
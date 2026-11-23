import express, { Request, Response, RequestHandler } from 'express';
import { adminAuthMiddleware } from './middlewares/adminAuth';
import { upsertStockVerification, findStockVerification } from './database';
import { parseFinalProof } from './utils';
import { acquireLock, releaseLock } from './lock';
import { downloadAndUnzip } from './verifier';
import { stockVerificationQueue } from './stocksProcessor';
import fs from 'fs';
import path from 'path';

const stockRouter = express.Router();
const adminStockRouter = express.Router();

// Verify stocks proof of collateral
stockRouter.post("/stocks/verify", (async (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    if (!url) {
        console.log("URL not provided");
        res.status(400).json({ error: "URL is required" });
        return;
    }

    // Acquire lock before proceeding
    await acquireLock();

    try {
        console.log("Downloading proof from URL: ", url);
        // Download and unzip the file
        const { extractPath, fileHash, zipPath } = await downloadAndUnzip(url);

        const finalProof = JSON.parse(
            fs.readFileSync(path.join(extractPath, "final_proof.json"), "utf-8")
        );
        const { proofTimestamp, assets, proverVersion } = parseFinalProof(finalProof);

        // Reject a resubmission that contradicts an already valid verification
        const existing = await findStockVerification({ fileHash });
        if (existing && existing.valid && existing.proof_timestamp !== proofTimestamp) {
            res.status(400).json({ error: "Proof timestamp mismatch with existing valid verification" });
            return;
        }

        // Store the entry with a null result; the queue fills it in
        const id = await upsertStockVerification(fileHash, proofTimestamp, {
            valid: null,
            verification_timestamp: null,
            ledger_balances: JSON.stringify(assets),
            proof_file_url: url,
            prover_version: proverVersion
        });

        await stockVerificationQueue.addJob({
            id, extractPath, zipPath, fileHash, proofTimestamp, url, proverVersion
        });

        res.json({
            id,
            valid: null,
            fileHash,
            proofTimestamp,
            verificationTimestamp: null,
            proverVersion,
            ledgerBalances: assets
        });
    } catch (error) {
        console.error("Error processing stock proof:", error);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        // Release lock after processing
        releaseLock();
    }
}) as RequestHandler);




// ADMIN ROUTES

adminStockRouter.use(adminAuthMiddleware);

export { stockRouter, adminStockRouter };

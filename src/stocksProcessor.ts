import { EventEmitter } from 'events';
import { verifyProof, downloadAndUnzip } from './verifier';
import { upsertStockVerification } from './database';
import fs from 'fs';
import { getProverVersion, isVersionNewer, updateProver } from './utils';
import { STOCK_PROGRAM_ID, CONFIG_DISCRIMINATOR, CONFIG_SIZE } from './constants';
import { rpc, base58 } from './solana';
import BigNumber from 'bignumber.js';


export interface TokenizedStock {
    mint: string;
    totalSupply: string;
}

// Map every tokenized stock ticker to its external Token-2022 mint and the tokens
// in circulation. Throws if two mints claim the same ticker, or if a mint has no ticker.
async function fetchTokenizedStockMints(): Promise<Record<string, TokenizedStock>> {
    const accounts = await rpc<any[]>("getProgramAccounts", [STOCK_PROGRAM_ID, {
        encoding: "base64",
        commitment: "finalized",
        filters: [{ memcmp: { offset: 0, bytes: CONFIG_DISCRIMINATOR } }, { dataSize: CONFIG_SIZE }]
    }]);

    const mints = accounts.map((a) => base58(Buffer.from(a.account.data[0], "base64").subarray(40, 72)));
    const stocks: Record<string, TokenizedStock> = Object.create(null);

    // getMultipleAccounts accepts at most 100 keys per call
    for (let i = 0; i < mints.length; i += 100) {
        const chunk = mints.slice(i, i + 100);
        const { value } = await rpc<{ value: any[] }>("getMultipleAccounts", [
            chunk, { encoding: "jsonParsed", commitment: "finalized" }
        ]);

        value.forEach((account, j) => {
            const info = account?.data?.parsed?.info;
            const extension = (name: string) =>
                info?.extensions?.find((e: any) => e.extension === name)?.state;

            const ticker = extension("tokenMetadata")?.symbol;
            if (!ticker) throw new Error(`Mint ${chunk[j]} has no ticker`);
            if (stocks[ticker]) throw new Error(`Duplicate ticker ${ticker}: ${stocks[ticker].mint} and ${chunk[j]}`);

            // Token-2022 scaled UI amount: circulating = raw / 10^decimals * multiplier.
            // The pending multiplier takes over once its effective timestamp passes.
            const scaled = extension("scaledUiAmountConfig");
            const multiplier = !scaled
                ? "1"
                : Date.now() / 1000 >= Number(scaled.newMultiplierEffectiveTimestamp)
                    ? scaled.newMultiplier
                    : scaled.multiplier;

            stocks[ticker] = {
                mint: chunk[j],
                totalSupply: BigNumber(info.supply).shiftedBy(-info.decimals).multipliedBy(multiplier).toFixed()
            };
        });
    }

    return stocks;
}

// Step 1 of the proof of collateral: verify the PoR proof of the internal ledger.
// Returns whether the proof verified, and records the result on the job's row.
async function verifyInternalLedger(job: StockVerificationJob): Promise<boolean> {
    // Re-download if the extracted proof is already gone
    if (!fs.existsSync(job.extractPath)) {
        const { extractPath, zipPath } = await downloadAndUnzip(job.url);
        job.extractPath = extractPath;
        job.zipPath = zipPath;
    }

    if (isVersionNewer(job.proverVersion, getProverVersion())) {
        console.log("Updating prover to", job.proverVersion);
        await updateProver(job.proverVersion);
    }

    const { valid } = await verifyProof(job.extractPath);
    await upsertStockVerification(job.fileHash, job.proofTimestamp, { valid, verification_timestamp: Date.now() });

    try {
        fs.rmSync(job.extractPath, { recursive: true });
        fs.rmSync(job.zipPath);
    } catch (error) {
        console.error('Error cleaning up files:', error);
    }

    console.log("Successfully processed stock job: ", job.id);
    return valid;
}


export interface StockVerificationJob {
    id: number;
    proverVersion: string;
    extractPath: string;
    zipPath: string;
    fileHash: string;
    proofTimestamp: number;
    url: string;
}

class StockVerificationQueue extends EventEmitter {
    private queue: StockVerificationJob[] = [];
    private isProcessing: boolean = false;

    constructor() {
        super();
        this.on('jobAdded', () => this.processNextJob());
    }

    async addJob(job: StockVerificationJob): Promise<void> {
        this.queue.push(job);
        this.emit('jobAdded');
    }

    // Verify the next stock verification job in the queue
    private async processNextJob(): Promise<void> {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;
        const job = this.queue.shift()!;

        console.log("Starting to process stock job: ", job.id, job.fileHash, job.proofTimestamp);

        try {
            // Step 1: verify the PoR proof of the internal ledger
            try {
                await verifyInternalLedger(job);
            } catch (error) {
                console.error('Error processing stock verification job:', error);
                await upsertStockVerification(job.fileHash, job.proofTimestamp, { valid: false, verification_timestamp: Date.now() });
                return; // runs finally
            }

            // Step 2: fetch tokenized stocks mints and their circulating supplies
            try {
                const mints = await fetchTokenizedStockMints();
                await upsertStockVerification(job.fileHash, job.proofTimestamp, { onchain_supplies: JSON.stringify(mints) });
            } catch (error) {
                console.error('Error fetching tokenized stock mints, you can try again:', error);
                await upsertStockVerification(job.fileHash, job.proofTimestamp, { valid: false, verification_timestamp: Date.now(), onchain_supplies: null });
                return; // runs finally
            }

            // Step 3: 
        } finally {
            // Runs after either success or failure of the above steps - including after `return` statements.
            this.isProcessing = false;
            this.processNextJob();
        }
    }

    getQueueLength(): number {
        return this.queue.length;
    }
}

export const stockVerificationQueue = new StockVerificationQueue();

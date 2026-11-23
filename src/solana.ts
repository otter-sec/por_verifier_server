import axios from "axios";
import { RPC_URL } from "./constants";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";


export function base58(bytes: Buffer): string {
    let value = 0n;
    for (const byte of bytes) value = value * 256n + BigInt(byte);

    let encoded = "";
    for (; value > 0n; value /= 58n) encoded = BASE58[Number(value % 58n)] + encoded;

    // base58 writes each leading zero byte as "1"
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    return "1".repeat(zeros) + encoded;
}

// Wait before each retry: 1s, then 2s, then 4s
const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const body = { jsonrpc: "2.0", id: 1, method, params };

    for (let attempt = 0; ; attempt++) {
        let response;
        try {
            response = await axios.post(RPC_URL, body, { timeout: 30_000 });
        } catch (error) {
            // Network failures, timeouts, 429s and 5xx are worth another go
            if (attempt >= RETRY_BACKOFF_MS.length) throw error;

            const wait = RETRY_BACKOFF_MS[attempt];
            console.warn(
                `RPC ${method} failed (attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length + 1}), retrying in ${wait}ms:`,
                error instanceof Error ? error.message : error
            );
            await sleep(wait);
            continue;
        }

        // A JSON-RPC error is the node rejecting the request itself, so retrying
        // would just get the same answer
        const { data } = response;
        if (data.error) throw new Error(`RPC error ${data.error.code}: ${data.error.message}`);
        return data.result;
    }
}
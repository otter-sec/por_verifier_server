import { Request, Response, RequestHandler } from "express";
import { LRUCache } from "lru-cache";
import { VerificationResponse, VerificationQuery } from "../types/verification";

// Create LRU cache for verification results
const verificationCache = new LRUCache<string, VerificationResponse>({
    max: 500, // Maximum number of items to store
    ttl: 1000 * 60 * 60, // Time to live: 1 hour
});

// must be the same order from the SQL query in database.ts (id, proof_timestamp, file_hash)
const calculateCacheKey = (id?: string | number, proofTimestamp?: string | number, fileHash?: string): string => {
    if (id) return `id:${id}`;
    if (proofTimestamp) return `timestamp:${proofTimestamp}`;
    if (fileHash) return `hash:${fileHash}`;
    return '';
};

// Cache middleware for /verification endpoint
export const cacheMiddleware: RequestHandler = async (req: Request<{}, {}, {}, VerificationQuery>, res: Response, next) => {
    const { id, proofTimestamp, fileHash } = req.query;
    if (!id && !proofTimestamp && !fileHash) {
        return next();
    }

    const cacheKey = calculateCacheKey(id, proofTimestamp, fileHash);
    if (!cacheKey) return next();

    const cachedResult = verificationCache.get(cacheKey);
    if (cachedResult) {
        return res.json(cachedResult);
    }

    // Add cache setter to response
    const originalJson = res.json;
    res.json = function (body: VerificationResponse) {
        verificationCache.set(cacheKey, body);
        return originalJson.call(this, body);
    };

    next();
};

export const invalidateCacheEntry = (key: string): void => {
    verificationCache.delete(key);
};

export const invalidateCacheEntries = (id?: string | number, proofTimestamp?: string | number, fileHash?: string): void => {
    // Generate all possible cache keys that need to be invalidated
    const keysToInvalidate = [
        id && calculateCacheKey(id),
        proofTimestamp && calculateCacheKey(undefined, proofTimestamp),
        fileHash && calculateCacheKey(undefined, undefined, fileHash)
    ].filter(Boolean) as string[];

    // Delete each key if it exists in the cache
    keysToInvalidate.forEach(key => {
        if (verificationCache.has(key)) {
            verificationCache.delete(key);
        }
    });
};
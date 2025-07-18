import { Request, Response, RequestHandler } from "express";
import { LRUCache } from "lru-cache";

type CacheValue = {
    body: any;
    headers: Record<string, string>;
}

// Create LRU cache for verification results
const cache = new LRUCache<string, CacheValue>({
    max: 100, // Maximum number of items to store
    ttl: 1000 * 60 * 60, // Time to live: 1 hour
});


const calculateCacheKey = (path: string, query: Record<string, string>): string => {
    let cacheKey = '';

    if (path === '/api/verification') {
        const { id, proofTimestamp, fileHash } = query;
        if (id) cacheKey += `id:${id}`;
        if (proofTimestamp) cacheKey += `timestamp:${proofTimestamp}`;
        if (fileHash) cacheKey += `hash:${fileHash}`;
    } else if (Object.keys(query || {}).length === 0) {
        cacheKey = path;
    } else {
        cacheKey = path;
        cacheKey += `?${Object.entries(query).map(([key, value]) => `${key}=${value}`).join('&')}`;
    }

    return cacheKey;
};

// Cache middleware
export const cacheMiddleware: RequestHandler = async (req: Request, res: Response, next) => {
    // if the request is not a GET request, skip the cache
    if (req.method !== 'GET') {
        return next();
    }

    const cacheKey = calculateCacheKey(req.baseUrl + req.path, req.query as Record<string, string>);
    if (!cacheKey) return next();

    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        res.set(cachedResult.headers);
        res.set("X-Cache", "HIT");
        return res.send(cachedResult.body);
    }

    // Add cache setter to response
    const originalJson = res.json;
    res.json = function (body: any) {
        const cacheValue: CacheValue = {
            body,
            headers: res.getHeaders() as Record<string, string>
        };
        cache.set(cacheKey, cacheValue);
        res.set("X-Cache", "MISS");
        return originalJson.call(this, body);
    };


    // Cache the response body with res.send
    // res.render uses res.send internally
    const originalSend = res.send;
    res.send = function (body: any) {
        const cacheValue: CacheValue = {
            body,
            headers: res.getHeaders() as Record<string, string>
        };
        cache.set(cacheKey, cacheValue);
        res.set("X-Cache", "MISS");
        return originalSend.call(this, body);
    };

    next();
};

export const invalidateCacheEntry = (key: string): void => {
    cache.delete(key);
};

export const invalidateCacheEntries = (id: string | number, proofTimestamp: string | number, fileHash: string): void => {
    
    // /api/verification cache
    const cacheKeyId = calculateCacheKey("/api/verification", { id: id.toString() });
    const cacheKeyTimestamp = calculateCacheKey("/api/verification", { proofTimestamp: proofTimestamp.toString() });
    const cacheKeyHash = calculateCacheKey("/api/verification", { fileHash: fileHash.toString() });

    cache.delete(cacheKeyId);
    cache.delete(cacheKeyTimestamp);
    cache.delete(cacheKeyHash);

    // other caches

    const cacheKeys = [
        `/verification/${proofTimestamp}`,
        `/verification/${fileHash}`,
    ]

    cacheKeys.forEach(key => {
        cache.delete(key);
    });

    invalidateGlobalCacheEntries();
};

export const invalidateGlobalCacheEntries = (): void => {
    cache.delete('/');
    cache.forEach((value, key) => {
        if (key.startsWith('/api/verifications') || key.startsWith('/?')) {
            cache.delete(key);
        }
    });
}
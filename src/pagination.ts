export const MAX_PAGE_SIZE = 100;
// Keeps (page - 1) * pageSize a safe integer for every allowed page size
export const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_PAGE_SIZE);

export type Pagination = { page: number; pageSize: number };

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
    const value = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(value) || value === 0) return fallback;
    return Math.min(Math.max(min, value), max);
}

// Parses the page/pageSize query parameters, clamping them to 1 <= page <= MAX_PAGE and 1 <= pageSize <= MAX_PAGE_SIZE.
// Missing, zero or unparseable values fall back to page 1 and the given default page size.
export function parsePagination(query: Record<string, unknown>, defaultPageSize: number): Pagination {
    return {
        page: clampInt(query.page, 1, 1, MAX_PAGE),
        pageSize: clampInt(query.pageSize, defaultPageSize, 1, MAX_PAGE_SIZE),
    };
}

export function assertValidPagination(page: number, pageSize: number): void {
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) {
        throw new RangeError(`Invalid page: ${page}`);
    }
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw new RangeError(`Invalid page size: ${pageSize}`);
    }
}

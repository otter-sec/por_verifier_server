import request from 'supertest';
import { parsePagination, assertValidPagination, MAX_PAGE, MAX_PAGE_SIZE } from '../src/pagination';

// The listing routes are tested against a mocked database, so these tests don't need postgres
jest.mock('../src/database', () => ({
    ...jest.requireActual('../src/database'),
    getAllVerifications: jest.fn(async () => ({ verifications: [], total: 0 })),
}));
import { getAllVerifications } from '../src/database';
import app from '../src/index';

const mockedGetAll = getAllVerifications as jest.MockedFunction<typeof getAllVerifications>;

describe('parsePagination', () => {
    it.each([
        [{}, { page: 1, pageSize: 10 }],
        [{ page: '3', pageSize: '25' }, { page: 3, pageSize: 25 }],
        [{ pageSize: '-1' }, { page: 1, pageSize: 1 }],
        [{ pageSize: '0' }, { page: 1, pageSize: 10 }],
        [{ pageSize: '1000000' }, { page: 1, pageSize: MAX_PAGE_SIZE }],
        [{ pageSize: 'abc', page: 'xyz' }, { page: 1, pageSize: 10 }],
        [{ page: '-5' }, { page: 1, pageSize: 10 }],
        [{ page: '99999999999999999999' }, { page: MAX_PAGE, pageSize: 10 }],
        [{ page: ['2', '3'], pageSize: ['-1'] }, { page: 1, pageSize: 10 }],
    ])('parses %j', (query, expected) => {
        expect(parsePagination(query, 10)).toEqual(expected);
    });
});

describe('assertValidPagination', () => {
    it.each([[1, -1], [1, 0], [1, MAX_PAGE_SIZE + 1], [0, 10], [1.5, 10], [MAX_PAGE + 1, 10], [1, NaN]])(
        'rejects page=%p pageSize=%p', (page, pageSize) => {
            expect(() => assertValidPagination(page, pageSize)).toThrow(RangeError);
        });

    it('accepts the bounds', () => {
        expect(() => assertValidPagination(1, 1)).not.toThrow();
        expect(() => assertValidPagination(MAX_PAGE, MAX_PAGE_SIZE)).not.toThrow();
    });
});

describe('listing routes cap the page size', () => {
    beforeEach(() => mockedGetAll.mockClear());

    it.each(['-1', '1000000'])('GET /api/verifications?pageSize=%s', async (pageSize) => {
        await request(app).get(`/api/verifications?pageSize=${pageSize}`).expect(200);
        const [, size] = mockedGetAll.mock.calls[0];
        expect(size).toBeGreaterThanOrEqual(1);
        expect(size).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });

    it.each(['-1', '1000000'])('GET /?pageSize=%s', async (pageSize) => {
        await request(app).get(`/?pageSize=${pageSize}`).expect(200);
        const [, size] = mockedGetAll.mock.calls[0];
        expect(size).toBeGreaterThanOrEqual(1);
        expect(size).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });
});

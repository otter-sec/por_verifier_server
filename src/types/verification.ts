export interface VerificationResponse {
    id: number;
    valid: boolean | null;
    fileHash: string;
    proofTimestamp: number;
    verificationTimestamp: number | null;
    proverVersion?: string | null;
    assets?: {
        [key: string]: {
            price: string;
            balance: string;
        };
    };
}

export interface VerificationQuery {
    id?: string;
    proofTimestamp?: string;
    fileHash?: string;
}

export interface VerificationListResponse {
    id: number;
    proofTimestamp: number;
    verificationTimestamp: number | null;
    fileHash: string;
    valid: boolean | null;
    proverVersion?: string | null;
}

export interface PaginatedResponse<T> {
    verifications: T[];
    total: number;
} 
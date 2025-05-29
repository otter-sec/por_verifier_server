export interface VerificationResponse {
    id: number;
    valid: boolean | null;
    fileHash: string;
    proofTimestamp: number;
    verificationTimestamp: number | null;
}

export interface VerificationQuery {
    id?: string;
    proofTimestamp?: string;
    fileHash?: string;
} 
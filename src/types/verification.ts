export interface VerificationResponse {
    id: number;
    valid: boolean;
    fileHash: string;
    proofTimestamp: number;
    verificationTimestamp: number;
}

export interface VerificationQuery {
    id?: string;
    proofTimestamp?: string;
    fileHash?: string;
} 
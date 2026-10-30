import { PoolClient } from 'pg';
import { migration as createVerificationsTable } from './000_create_verifications_table';

export interface Migration {
    id: string;
    up: (client: PoolClient) => Promise<void>;
}

export const migrations: Migration[] = [
    createVerificationsTable
].sort((a, b) => a.id.localeCompare(b.id));

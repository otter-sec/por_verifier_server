import { migration as createVerificationsTable } from './000_create_verifications_table';
import { migration as addBalancesAndAssetsColumns } from './001_add_balances_and_assets_columns';

export interface Migration {
    id: string;
    up: (db: any) => Promise<void>;
}

export const migrations: Migration[] = [
    createVerificationsTable,
    addBalancesAndAssetsColumns
].sort((a, b) => a.id.localeCompare(b.id)); 
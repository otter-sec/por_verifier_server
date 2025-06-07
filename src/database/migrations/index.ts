import { migration as createVerificationsTable } from './000_create_verifications_table';
import { migration as addBalancesAndAssetsColumns } from './001_add_balances_and_assets_columns';
import { migration as addProofFileUrlColumn } from './002_add_proof_file_url_column';
import { migration as addProverVersionColumn } from './003_add_prover_version_column';

export interface Migration {
    id: string;
    up: (db: any) => Promise<void>;
}

export const migrations: Migration[] = [
    createVerificationsTable,
    addBalancesAndAssetsColumns,
    addProofFileUrlColumn,
    addProverVersionColumn
].sort((a, b) => a.id.localeCompare(b.id)); 
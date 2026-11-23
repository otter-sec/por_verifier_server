import path from 'path';

// ZK field order --> Goldilocks field
export const ZK_FIELD_ORDER = 2**64 - 2**32 + 1;

// We use /var/tmp instead of /tmp because /tmp is a RAM disk and we don't want to consume too much RAM
export const TEMP_DIR: string = path.join("/var/tmp", "por"); 

export const DB_DIR: string = path.join("/db"); 

/* Solana related constants for the tokenized stocks proof of collateral */
// Backpack's stock-facility program and its MintExternalConfig accounts:
// 8 bytes discriminator | 32 internal mint | 32 external mint | 8 cached quantity
export const STOCK_PROGRAM_ID = "FewRXXTzV2WwigvTQNsVanhEmCM9wzfNvoT1divNtbVH";
export const CONFIG_DISCRIMINATOR = "R2qkYcuWv9K";
export const CONFIG_SIZE = 80;
export const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
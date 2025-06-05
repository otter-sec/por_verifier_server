import path from 'path';

// ZK field order --> Goldilocks field
export const ZK_FIELD_ORDER = 2**64 - 2**32 + 1;

// We use /var/tmp instead of /tmp because /tmp is a RAM disk and we don't want to consume too much RAM
export const TEMP_DIR: string = path.join("/var/tmp", "por"); 

export const DB_DIR: string = path.join("/db"); 
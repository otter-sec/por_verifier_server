import path from 'path';

// We use /var/tmp instead of /tmp because /tmp is a RAM disk and we don't want to consume too much RAM
export const TEMP_DIR: string = path.join("/var/tmp", "por"); 

export const DB_DIR: string = path.join("/db", "por"); 
import crypto from "crypto";
import unzipper from "unzipper";
import { promisify } from "util";
import { exec } from "child_process";
import { resolveAndValidateUrl } from "./utils";
import axios, { AxiosRequestConfig, LookupAddress, AddressFamily } from "axios";
import fs from "fs";
import path from "path";
import { TEMP_DIR } from "./constants";

const execAsync = promisify(exec);

interface DownloadResult {
    extractPath: string;
    fileHash: string;
    zipPath: string;
}

interface VerificationResult {
    valid: boolean;
    proofTimestamp: number;
}

interface FinalProof {
    timestamp: number;
    [key: string]: any;
}

export async function downloadAndUnzip(url: string): Promise<DownloadResult> {
    let fileBuffer: Buffer;
    // Handle HTTP URL
    if (!url.startsWith("http")) {
        throw new Error("Invalid URL");
    }

    // we validate and resolve the url to an ip address to prevent dns rebinding attacks
    const [resolvedIp, ipFamily] = await resolveAndValidateUrl(url);
    const customLookup = (_hostname: string, _options: object, callback: (err: Error | null, address: LookupAddress | LookupAddress[], family?: AddressFamily) => void) => 
        callback(null, [{ address: resolvedIp, family: ipFamily as AddressFamily }], ipFamily as AddressFamily);

    const config: AxiosRequestConfig = {
        method: "get",
        url: url,
        responseType: "arraybuffer",
        timeout: 120 * 1000, // 2 minutes --> the files are usually big and can take a while to download
        maxRedirects: 0,
        lookup: customLookup,
        maxBodyLength: 150 * 1024 * 1024, // 150MB
        maxContentLength: 150 * 1024 * 1024, // 150MB
    };

    // Ideally we should check uncompressed size to prevent DoS attacks
    // but we assume the client (which is a CEX) won't send a malicious file
    // since it would DoS their own features

    const response = await axios(config);
    fileBuffer = Buffer.from(response.data);

    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    const timestamp = Date.now();

    const zipPath = path.join(TEMP_DIR, `download-${timestamp}.zip`);
    const extractPath = path.join(TEMP_DIR, `extracted-${timestamp}`);
    
    if (fs.existsSync(extractPath)) {
        fs.rmSync(extractPath, { recursive: true });
    }
    fs.mkdirSync(extractPath);

    // Save the zip file
    fs.writeFileSync(zipPath, fileBuffer);

    // Calculate file hash
    const hashSum = crypto.createHash("sha256");
    hashSum.update(fileBuffer);
    const fileHash = hashSum.digest("hex");

    // Extract the zip file
    await fs
        .createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractPath }))
        .promise();

    return { extractPath, fileHash, zipPath };
}

export async function verifyProof(extractPath: string): Promise<VerificationResult> {
    // Read the proof timestamp from final_proof.json
    const finalProofPath = path.join(extractPath, "final_proof.json");
    const finalProofContent: FinalProof = JSON.parse(
        fs.readFileSync(finalProofPath, "utf-8")
    );
    const proofTimestamp = finalProofContent.timestamp;

    // Change to the extract directory and run the verification
    process.chdir(extractPath);
    try {
        await execAsync("plonky2_por verify");
        return { valid: true, proofTimestamp };
    } catch (error) {
        return { valid: false, proofTimestamp };
    }
} 
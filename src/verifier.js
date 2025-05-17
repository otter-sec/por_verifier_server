const crypto = require("crypto");
const unzipper = require("unzipper");
const { promisify } = require("util");
const { exec } = require("child_process");
const { resolveAndValidateUrl } = require("./utils");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { TEMP_DIR } = require("./constants");

const execAsync = promisify(exec);

async function downloadAndUnzip(url) {
  let fileBuffer;
  // Handle HTTP URL
  if (!url.startsWith("http")) {
    throw new Error("Invalid URL");
  }

  // we validate and resolve the url to an ip address to prevent dns rebinding attacks
  let [resolvedIp, ipFamily] = await resolveAndValidateUrl(url);
  const customLookup = (_hostname, _options, callback) => callback(null, resolvedIp, ipFamily);

  const response = await axios({
    method: "get",
    url: url,
    responseType: "arraybuffer",
    timeout: 120 * 1000, // 2 minutes --> the files are usually big and can take a while to download
    maxRedirects: 0,
    lookup: customLookup
  });
  fileBuffer = Buffer.from(response.data);

  // Ensure temp directory exists
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const zipPath = path.join(TEMP_DIR, "download.zip");
  const extractPath = path.join(TEMP_DIR, "extracted");
  
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

  return { extractPath, fileHash };
}

async function verifyProof(extractPath) {
  // Read the proof timestamp from final_proof.json
  const finalProofPath = path.join(extractPath, "final_proof.json");
  const finalProofContent = JSON.parse(
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

module.exports = {
    downloadAndUnzip,
    verifyProof
}
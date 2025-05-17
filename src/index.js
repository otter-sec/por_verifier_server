const express = require("express");
const fs = require("fs");
const path = require("path");
const { authMiddleware } = require("./auth");
const { insertVerification, findVerification } = require("./database");
const { downloadAndUnzip, verifyProof } = require("./verifier");
const { TEMP_DIR } = require("./constants");

const app = express();
app.use(express.json());

// Mutex-like lock mechanism
let isVerifying = false;
const verificationQueue = [];

function acquireLock() {
  return new Promise((resolve) => {
    if (!isVerifying) {
      isVerifying = true;
      resolve();
    } else {
      verificationQueue.push(resolve);
    }
  });
}

function releaseLock() {
  const nextResolver = verificationQueue.shift();
  if (nextResolver) {
    nextResolver();
  } else {
    isVerifying = false;
  }
}

//////////////////
/*====ROUTES====*/

// Authentication is needed for verifying a proof
app.post("/verify", authMiddleware, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Acquire lock before proceeding
    await acquireLock();

    try {
      // Download and unzip the file
      const { extractPath, fileHash } = await downloadAndUnzip(url);

      // Verify the files
      const { valid, proofTimestamp } = await verifyProof(extractPath);

      // Check if it exists by file hash and proof timestamp and validate if update is valid
      // if the verification already exists, we can update the verification (only valid and verification_timestamp fields)
      // however, for update to be valid, the file hash and proof timestamp should match the existing verification OR the existing verification is invalid
      // it is not possible to update the file hash or proof timestamp of a valid verification
      const existingVerificationFileHash = await findVerification({
        fileHash,
      });
      if (existingVerificationFileHash && existingVerificationFileHash.proof_timestamp !== proofTimestamp && existingVerificationFileHash.valid) {
        throw new Error("Proof timestamp mismatch with existing valid verification");
      }

      const existingVerificationProofTimestamp = await findVerification({
        proofTimestamp,
      });
      if (existingVerificationProofTimestamp && existingVerificationProofTimestamp.file_hash !== fileHash && existingVerificationProofTimestamp.valid) {
        throw new Error("File hash mismatch with existing valid verification");
      }
      
      // Store the result in the database
      const [id, verificationTimestamp] = await insertVerification(proofTimestamp, valid, fileHash);

      // Clean up
      fs.rmSync(extractPath, { recursive: true });
      fs.rmSync(path.join(TEMP_DIR, "download.zip"));

      res.json({
        id,
        valid,
        fileHash,
        proofTimestamp,
        verificationTimestamp,
      });
    } finally {
      // Always release the lock, even if an error occurred
      releaseLock();
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// No authentication needed for getting a verification
app.get("/verification", async (req, res) => {
  try {
    const { id, proofTimestamp, fileHash } = req.query;

    if (!id && !proofTimestamp && !fileHash) {
      return res.status(400).json({
        error: "One of id, proofTimestamp, or fileHash is required",
      });
    }

    const result = await findVerification({
      id,
      proofTimestamp,
      fileHash,
    });

    const response = {}
    if (result) {
      // Convert SQLite integer boolean back to JS boolean
      response.valid = Boolean(result.valid);
      response.fileHash = result.file_hash;
      response.verificationTimestamp = parseInt(result.verification_timestamp);
      response.proofTimestamp = parseInt(result.proof_timestamp);
      response.id = result.id;
    } else {
      return res.status(404).json({ error: "Verification not found" });
    }

    res.json(response);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


//////////////////

const PORT = process.env.PORT || 3000;
// Only start the server if this file is run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Export for testing
module.exports = app;

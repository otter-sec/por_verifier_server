# Plonky2 PoR Verification Server

This is an Express server that provides HTTP endpoints for verifying Plonky2 PoR proofs and querying verification results.

## Installation

To run the server, simply run:

```bash
docker build . -t verifier_por
docker run verifier_por:latest
```

## Usage

### Authentication

API Key is defined in a environment variable and should be present in the Authorization header in POST requests:

```http
POST /verify HTTP1.1
Host: localhost:3000
Authorization: Bearer <API_KEY>

<body>
```

### API Endpoints

#### 1. Verify Proof Files

**POST /verify**

Verifies proof files from a zip file hosted on S3.

Request body:
```json
{
  "url": "https://your-s3-bucket.s3.amazonaws.com/proof-files.zip"
}
```

The zip file should contain:
- `merkle_tree.json`
- `final_proof.json`

Response:
```json
{
  "id": 1,
  "valid": true,
  "fileHash": "<sha256 hash of zip file>",
  "proofTimestamp": "<timestamp from final proof file>",
  "verificationTimestamp": "<timestamp of verification (now)>"
}
```

#### 2. Query Verification

**GET /verification**

Query a verification result using one of these parameters:
- `id`: The verification ID
- `proofTimestamp`: The proof timestamp
- `fileHash`: The SHA-256 hash of the zip file

Example:
```
GET /verification?id=1
GET /verification?proofTimestamp=1747444974000
GET /verification?fileHash=abc123...
```

Response:
```json
{
  "id": 1,
  "proofTimestamp": "1747222224000",
  "verificationTimestamp": "1747555554000",
  "valid": true,
  "fileHash": "abc123..."
}
```

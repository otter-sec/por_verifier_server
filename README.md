# PoR Verifier Server

A server for verifying Proof of Reserve (PoR) proofs using Zero-Knowledge technology. This server provides both a web interface and a REST API for managing and verifying proofs.

## Features

- Web interface for viewing verification status and details
- REST API for programmatic access
- Support for multiple proof versions

## API Endpoints

### Public API Endpoints

#### GET `/api/verification`
Get verification details by ID, proof timestamp, or file hash.

**Query Parameters:**
- `id` (optional): Verification ID
- `proofTimestamp` (optional): Proof timestamp
- `fileHash` (optional): File hash (SHA256)

**Response:**
```json
{
    "valid": "boolean | null",
    "fileHash": "string",
    "verificationTimestamp": "number | null",
    "proofTimestamp": "number",
    "id": "number",
    "proverVersion": "string",
    "assets": {
      "<asset_name>": {
        "price": "string",
        "balance": "string",
        "usd_balance": "string"
      }
    }
}
```

#### GET `/api/verifications`
Get a paginated list of all verifications.

**Query Parameters:**
- `page` (optional, default: 1): Page number
- `pageSize` (optional, default: 10): Number of items per page

**Response:**
```json
{
    "verifications": "array",
    "total": "number"
}
```

#### GET `/api/prover-version`
Get the current prover version.

**Response:**
```json
{
    "proverVersion": "string"
}
```

### Protected API Endpoints (Requires API Key)

#### POST `/api/verify`
Verify a new proof.

**Headers:**
- `Authorization: Bearer <API_KEY>`

**Request Body:**
```json
{
    "url": "<URL to the proof file>"
}
```

**Response:**
```json
{
    "id": "number",
    "valid": "boolean | null",
    "fileHash": "string",
    "verificationTimestamp": "number | null",
    "proofTimestamp": "number",
    "proverVersion": "string"
}
```

### Admin API Endpoints (Requires Admin API Key)

#### POST `/api/admin/verifications/:id/delete`
Delete a verification. This is used in production if an error occurs with a verification and it needs to be removed for some reason.

**Headers:**
- `Authorization: Bearer <ADMIN_API_KEY>`

**Response:**
```json
{
    "message": "Verification deleted successfully"
}
```

#### POST `/api/admin/update-prover`
Update the prover version. Downloads and installs the latest release of [PoRv2](https://github.com/otter-sec/por_v2)

**Headers:**
- `Authorization: Bearer <ADMIN_API_KEY>`

**Response:**
```json
{
    "message": "Starting to update prover version..."
}
```

## Web Interface Endpoints

### GET `/`
Main page showing a list of all verifications with pagination.

**Query Parameters:**
- `page` (optional, default: 1): Page number
- `pageSize` (optional, default: 20): Number of items per page

### GET `/verification/:identifier`
View details of a specific verification.

**Parameters:**
- `identifier`: Can be either a proof timestamp or a file hash

## Environment Variables

- `PORT` (optional, default: 3000): Server port
- `API_KEY`: API key for protected endpoints
- `ADMIN_API_KEY`: API key for admin endpoints


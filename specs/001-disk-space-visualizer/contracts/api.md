# API Contract: Local Disk Viewer Service

All endpoints are served from `http://127.0.0.1:<port>`.

Mutating endpoints require:

- `Content-Type: application/json`
- `X-Disk-Viewer-Token: <token from /api/session>`
- Local `Origin` or no `Origin`

## GET /api/session

Returns runtime metadata for the UI.

```json
{
  "token": "session-token",
  "homePath": "/Users/example",
  "suggestedRoots": [
    { "label": "Macintosh HD", "path": "/" },
    { "label": "Home", "path": "/Users/example" },
    { "label": "Downloads", "path": "/Users/example/Downloads" }
  ]
}
```

## POST /api/scan

Request:

```json
{
  "rootPath": "/Users/example/Downloads"
}
```

Response `200`:

```json
{
  "scan": {
    "id": "scan-id",
    "rootPath": "/Users/example/Downloads",
    "status": "completed",
    "totalSize": 12345,
    "entryCount": 10,
    "errorCount": 0,
    "root": {}
  }
}
```

Errors:

- `400` invalid path or non-directory.
- `403` request rejected by local safety checks.
- `500` unexpected scan failure.

## POST /api/scan/start

Starts a background scan and returns immediately with a scan job id.

Request:

```json
{
  "rootPath": "/"
}
```

Response `202`:

```json
{
  "scanId": "scan-id",
  "status": "running",
  "progress": {
    "scanId": "scan-id",
    "status": "running",
    "phase": "Queued",
    "entriesScanned": 0,
    "filesScanned": 0,
    "directoriesScanned": 0,
    "errors": 0,
    "bytesScanned": 0,
    "currentPath": "/"
  }
}
```

## GET /api/scan/{scanId}/progress

Returns live progress for a background scan. Requires `X-Disk-Viewer-Token`.

Response while running:

```json
{
  "scanId": "scan-id",
  "status": "running",
  "progress": {
    "phase": "Scanning",
    "entriesScanned": 1200,
    "filesScanned": 900,
    "directoriesScanned": 300,
    "errors": 2,
    "bytesScanned": 123456789,
    "currentPath": "/Users/example/Downloads"
  }
}
```

Response when complete includes a compact scan summary. The full scan tree is
kept server-side so the API does not attempt to serialize millions of entries in
one response.

```json
{
  "scanId": "scan-id",
  "status": "completed",
  "progress": {
    "phase": "Completed"
  },
  "scan": {
    "id": "scan-id",
    "rootPath": "/",
    "status": "completed",
    "totalSize": 123456789,
    "entryCount": 1200,
    "errorCount": 0,
    "root": {
      "path": "/",
      "type": "directory",
      "size": 123456789,
      "childCount": 12
    }
  }
}
```

## GET /api/scan/{scanId}/entries

Returns a bounded, sorted page of scan entries. Requires
`X-Disk-Viewer-Token`.

Query parameters:

- `mode`: `tree`, `files`, or `all`.
- `sort`: `size`, `name`, or `type`.
- `direction`: `desc` or `asc`.
- `offset`: zero-based offset.
- `limit`: max entries to return.

Response `200`:

```json
{
  "scanId": "scan-id",
  "mode": "files",
  "sortKey": "size",
  "direction": "desc",
  "offset": 0,
  "limit": 500,
  "total": 5371455,
  "entries": [
    {
      "path": "/Users/example/Downloads/large.zip",
      "name": "large.zip",
      "type": "file",
      "extension": ".zip",
      "size": 123456789,
      "percentOfParent": 14.6,
      "percentOfTotal": 2.3,
      "depth": 3
    }
  ]
}
```

## POST /api/cleanup

Request:

```json
{
  "scanId": "scan-id",
  "paths": ["/Users/example/Downloads/large.zip"]
}
```

Response `200`:

```json
{
  "operation": {
    "id": "cleanup-id",
    "scanId": "scan-id",
    "moved": [
      { "path": "/Users/example/Downloads/large.zip", "trashPath": "/Users/example/.Trash/large.zip" }
    ],
    "failed": [],
    "totalMovedSize": 12345
  }
}
```

Errors:

- `400` missing scan, empty selection, or invalid request body.
- `403` path outside scan root or token/origin rejected.
- `409` path no longer exists or was not in scan results.

## POST /api/reveal

Reveals one scanned entry in Finder. Requires `X-Disk-Viewer-Token` and a local
origin. The path must be inside the active scan root and present in that scan.

Request:

```json
{
  "scanId": "scan-id",
  "path": "/Users/example/Downloads/large.zip"
}
```

Response `200`:

```json
{
  "reveal": {
    "scanId": "scan-id",
    "path": "/Users/example/Downloads/large.zip",
    "type": "file",
    "revealedAt": "2026-07-05T19:30:00.000Z"
  }
}
```

Errors:

- `400` scan session missing or path not found in scan results.
- `403` path outside active scan root or token/origin rejected.
- `501` Finder reveal is not available on this operating system.

## GET /api/health

Response `200`:

```json
{ "ok": true }
```

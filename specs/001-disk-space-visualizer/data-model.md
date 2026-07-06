# Data Model: Mac Disk Space Visualizer

## ScanSession

- `id`: Unique scan identifier.
- `rootPath`: Absolute local path scanned by the user.
- `status`: `completed` or `partial`.
- `startedAt`: ISO timestamp.
- `completedAt`: ISO timestamp.
- `totalSize`: Aggregate scanned byte size.
- `entryCount`: Number of entries discovered.
- `errorCount`: Number of skipped or inaccessible entries.
- `root`: Root `FilesystemEntry`.
- `errors`: List of `ScanError`.

## FilesystemEntry

- `id`: Stable identifier for the entry within a scan session.
- `path`: Absolute path.
- `name`: Display name.
- `type`: `file`, `directory`, `symlink`, or `other`.
- `size`: Byte size attributed to this entry.
- `childCount`: Number of direct children for directories.
- `children`: Child entries included in results.
- `partial`: Whether this entry has incomplete totals.
- `errors`: Errors attached to this entry.

## Selection

- `scanId`: The scan session the selection belongs to.
- `paths`: Absolute selected paths.
- `totalSize`: Aggregate selected size from the current scan.
- `itemCount`: Number of selected entries.
- `invalidPaths`: Paths rejected because they are outside the scan root or missing.

## CleanupOperation

- `id`: Unique cleanup attempt identifier.
- `scanId`: Associated scan session.
- `requestedPaths`: Paths requested by the user.
- `moved`: Items successfully moved to Trash.
- `failed`: Items that could not be moved.
- `totalMovedSize`: Aggregate size of moved items according to the scan.
- `completedAt`: ISO timestamp.

## ScanError

- `path`: Path that could not be scanned or moved.
- `code`: Machine-readable reason.
- `message`: User-facing explanation.

## Validation Rules

- `rootPath` must resolve to an existing local directory.
- Cleanup paths must resolve under the scan session root.
- Cleanup paths must be present in the active scan results.
- Cleanup must not operate on the scan root itself unless explicitly selected and
  confirmed by the user.
- Symlinks are reported but not followed during recursive traversal in v1.

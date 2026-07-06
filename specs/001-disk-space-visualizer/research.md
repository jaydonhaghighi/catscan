# Research: Mac Disk Space Visualizer

## Decision: Local Node service with static frontend

**Rationale**: Node is already available locally, provides reliable filesystem APIs,
and can serve a browser UI without packaging a native app in the MVP. Static assets
avoid a build step and keep the repo small.

**Alternatives considered**:
- Swift/AppKit native app: better Mac-native folder picking, but slower to scaffold
  and test in this empty repo.
- Electron: good desktop packaging, but heavy for the first slice.
- Python web service: feasible, but Node keeps frontend/server in one language.

## Decision: In-memory scan sessions

**Rationale**: The feature does not require history or multi-user state. Keeping scan
results in memory avoids storing private paths on disk.

**Alternatives considered**:
- SQLite cache: useful for history, but adds persistence of sensitive metadata.
- Flat-file cache: simple, but has the same privacy drawback as SQLite.

## Decision: Trash-first cleanup with test override

**Rationale**: Moving selected items into a Trash directory is safer than permanent
unlinking. A `DISK_VIEWER_TRASH_DIR` override lets tests validate movement using
temporary directories instead of real user folders.

**Alternatives considered**:
- Permanent delete: rejected by constitution for v1.
- Finder AppleScript delete: more Mac-native, but harder to test deterministically.

## Decision: Explicit path validation for every cleanup request

**Rationale**: Delete requests are sensitive. Every requested path must resolve under
the active scan root and must correspond to an item in the current scan results.

**Alternatives considered**:
- Trusting frontend-selected paths: rejected because localhost services can receive
  crafted requests.

## Decision: Local request hardening

**Rationale**: The service binds to `127.0.0.1`, serves a per-session token to the UI,
checks local origins for mutating requests, and only accepts JSON bodies for API
mutations.

**Alternatives considered**:
- No request hardening: simpler, but local services can be targeted by browser pages.

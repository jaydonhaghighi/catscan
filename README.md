<p align="center">
  <img src="src/public/assets/catscan-logo.png" alt="catscan" width="520">
</p>

catscan is a local-first Mac disk usage visualizer.

I made this because I could not find a good, simple way to see exactly what was
taking up so much space on my MacBook, and I did not want to pay just to answer
that question. catscan scans your drive locally, shows the largest files and
folders visually, and lets you inspect the hierarchy before deciding what to
delete.

The main view can scan `/` for the whole drive. It shows a file structure tree
with percent-of-parent bars and a compact square mosaic where file size is
represented visually.

During scans, the app shows live progress with entries scanned, files scanned,
bytes discovered, errors, and the current path being traversed.

Large full-drive scans keep the complete scan data server-side and render
bounded pages in the browser. The square mosaic uses extension-based colors and
represents larger files with more square cells. The table loads sorted hierarchy
pages without sending the entire filesystem tree as one JSON response.

Each visible table row includes a Finder button that reveals that scanned item
in Finder.

## Run In A Browser

```sh
npm install
npm start
```

Open the printed `http://127.0.0.1:5179` URL.

## Run As A Mac App

For local development, launch catscan in an Electron window:

```sh
npm install
npm run desktop
```

To create a local `.app` bundle:

```sh
npm run pack:mac
open dist/mac*/catscan.app
```

To create a DMG for sharing:

```sh
npm run dist:mac
```

This creates separate Apple Silicon and Intel builds. To build only one:

```sh
npm run dist:mac:arm64
npm run dist:mac:x64
```

The generated app starts the local catscan server internally and opens the UI in
its own window. Users do not need to run `npm start` or open a terminal.

For full-drive scans on macOS, catscan can open Full Disk Access settings. macOS
still requires the user to manually grant access to the catscan app, then restart
catscan before scanning again.

The local build is unsigned. A Mac may require right-clicking the app and
choosing Open. For broad public distribution, sign and notarize the app with an
Apple Developer ID.

## Logs

When the app is started from this Codex workspace, server output is written to:

```sh
/tmp/disk-viewer-server.log
```

Watch it during a full-drive scan with:

```sh
tail -f /tmp/disk-viewer-server.log
```

The server logs JSON events for scan start, periodic progress, scan completion,
scan failures, and final JSON serialization. The useful event names are:

- `scan.progress`: scanner is still walking files.
- `scan.finalize.complete`: traversal and final indexing finished.
- `response.serialize.start`: the server started building the final response.
- `response.serialize.complete`: the final response was built and sent.

For very large scans, tune logging frequency with `SCAN_LOG_INTERVAL_MS` and
`SCAN_LOG_ENTRY_INTERVAL`.

## Test

```sh
npm test
```

The tests use temporary fixtures and a test Trash directory override. They do not
operate on real user folders.

## Safety Model

- The service binds to loopback by default.
- Scan data stays in memory and is not uploaded.
- Scans start from an explicit local root path.
- Cleanup requests require a local session token.
- Cleanup paths must be inside the active scan root and present in scan results.
- Selected items are moved to Trash, not permanently deleted.

## Spec Kit Workflow

The feature artifacts live in `specs/001-disk-space-visualizer/`:

- `spec.md`: user-facing requirements
- `plan.md`: implementation plan
- `tasks.md`: execution checklist
- `contracts/api.md`: local service API
- `quickstart.md`: validation guide

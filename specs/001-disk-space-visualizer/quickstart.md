# Quickstart: Mac Disk Space Visualizer

## Prerequisites

- macOS
- Node.js 20 or newer

## Run Locally

```sh
npm install
npm start
```

Open the printed localhost URL in a browser.

## Validate Scanner

1. Create a temporary folder with nested files of known sizes.
2. Enter that folder path in the scan field, or keep `/` to scan the whole drive.
3. Start the scan.
4. Confirm the progress panel updates while scanning.
5. Confirm the total size, largest entries, and file list match the fixture.

## Validate All-Files Square View

1. Create a temporary folder with files in multiple nested folders and different sizes.
2. Start a scan for that folder.
3. Confirm the Files table shows every file sorted largest to smallest.
4. Confirm File Squares shows one square per scanned file, also largest first.
5. Switch to All to confirm folders are still inspectable.

## Validate Safe Cleanup

1. Scan a temporary folder.
2. Select one file from the results.
3. Choose the cleanup action.
4. Confirm the dialog shows one item and the expected selected size.
5. Confirm cleanup.
6. Verify the selected file was moved to Trash and unselected files remain.

## Automated Validation

```sh
npm test
```

Expected result: scanner, path safety, API contract, and cleanup-flow tests pass.

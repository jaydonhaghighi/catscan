# Feature Specification: Mac Disk Space Visualizer

**Feature Branch**: `001-disk-space-visualizer`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Build a local Mac service that scans selected folders, breaks down exactly what is taking up space, visualizes file and folder sizes, lets me select files, and safely delete them."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Scan and understand storage usage (Priority: P1)

As a Mac user running out of space, I want to scan a folder and see which folders and
files consume the most storage so I can understand what is worth cleaning up.

**Why this priority**: This is the core value of the product and produces a useful
MVP even before deletion is available.

**Independent Test**: Scan a test folder with known nested file sizes and verify the
largest folders/files, total size, skipped entries, and permission errors are shown
accurately.

**Acceptance Scenarios**:

1. **Given** a selected folder with nested files, **When** the user starts a scan,
   **Then** the app shows total scanned size and ranks the largest entries.
2. **Given** a folder contains inaccessible entries, **When** the scan completes,
   **Then** the app lists the inaccessible entries separately and labels the scan as
   partial.
3. **Given** a folder contains many small files and a few large files, **When** the
   user reviews results, **Then** the user can identify the largest contributors
   without manually opening Finder.

---

### User Story 2 - Visualize and navigate the breakdown (Priority: P2)

As a Mac user, I want an interactive visualization and file list so I can move from
high-level storage categories to the exact paths taking up space.

**Why this priority**: Visualization makes the scanner actionable and helps users
compare folders quickly.

**Independent Test**: Load known scan results and verify the visualization, tree/list
navigation, sorting, and selected path details match the underlying storage data.

**Acceptance Scenarios**:

1. **Given** completed scan results, **When** the user opens the visualization,
   **Then** each visible region or row represents a real path and size.
2. **Given** completed scan results, **When** the user reviews files, **Then** every
   scanned file is visible in a largest-to-smallest list.
3. **Given** the user sorts by size, name, or type, **When** sorting is applied,
   **Then** the displayed ordering updates without changing the underlying totals.

---

### User Story 3 - Select and safely delete files (Priority: P3)

As a Mac user, I want to select files or folders from the results and move them to
Trash after confirming the action so I can reclaim space safely.

**Why this priority**: Cleanup completes the workflow, but it must come after users
can trust the scan and visualization.

**Independent Test**: Use a temporary folder fixture, select known files, confirm the
action, and verify only selected items inside the scan root are moved to Trash while
the UI updates totals.

**Acceptance Scenarios**:

1. **Given** one or more selected items, **When** the user opens the delete
   confirmation, **Then** the dialog shows item count, total selected size, and the
   selected paths or a clear summary.
2. **Given** the user confirms deletion, **When** the operation succeeds, **Then**
   selected items are moved to Trash and the scan results reflect the removed space.
3. **Given** a selected item no longer exists or cannot be moved, **When** deletion is
   attempted, **Then** the app reports the failed item and does not claim full
   success.

---

### Edge Cases

- The selected scan root is empty.
- The selected scan root contains symlinks, package directories, or hidden files.
- Files are changed, moved, or deleted by another process during scanning.
- The scan encounters protected macOS locations or permission-denied entries.
- The user selects a folder with thousands of descendants.
- A delete request includes a path outside the current scan root.
- Trash movement fails because of permissions, locked files, or unavailable volume
  behavior.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow the user to choose or enter a local folder to scan.
- **FR-002**: System MUST scan files and folders under the selected root and compute
  aggregate sizes for each displayed folder.
- **FR-003**: System MUST show the largest space consumers in both visual and tabular
  forms.
- **FR-003a**: System MUST provide a file-focused view that shows every scanned file
  from largest to smallest.
- **FR-003b**: System MUST visualize scanned files as a textless square-cell
  mosaic whose cell counts scale by file size and whose order follows largest to
  smallest.
- **FR-003c**: System MUST color file mosaic cells by file extension and use black
  borders with no spacing between adjacent cells.
- **FR-003d**: System MUST provide a tree view with hierarchy indentation and a
  percent-of-parent space bar for each displayed entry.
- **FR-004**: System MUST disclose skipped, inaccessible, or partially scanned paths.
- **FR-005**: System MUST let users inspect a displayed item's path, type, size, and
  child count when available.
- **FR-006**: System MUST let users select one or more displayed files or folders for
  cleanup.
- **FR-007**: System MUST show an explicit confirmation before moving selected items
  to Trash.
- **FR-008**: System MUST move selected items to Trash by default rather than
  permanently deleting them.
- **FR-009**: System MUST prevent cleanup actions for paths outside the active scan
  root.
- **FR-010**: System MUST refresh displayed totals after successful cleanup.
- **FR-011**: System MUST keep scan data and file metadata local to the user's Mac.
- **FR-012**: System MUST provide clear error messages for scan and cleanup failures.
- **FR-013**: System MUST remain usable when scans are partial due to permissions or
  files changing during traversal.
- **FR-014**: System MUST provide a way to rescan the current root after cleanup or
  external file changes.
- **FR-015**: System MUST show live scan progress while traversal is running,
  including entries scanned, files scanned, bytes discovered, errors, and current
  path.

### Key Entities *(include if feature involves data)*

- **Scan Session**: A single scan of a selected local root, including status, totals,
  started/completed times, and any errors.
- **Filesystem Entry**: A file or folder discovered during scanning, including path,
  name, type, size, child count, and accessibility state.
- **Selection**: The set of entries the user has chosen for cleanup, including total
  selected size and validation status.
- **Cleanup Operation**: A user-confirmed move-to-Trash attempt, including requested
  entries, successful moves, failures, and resulting space estimate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can identify the top 20 largest entries in a selected folder in
  under 30 seconds for a 10,000-file test tree.
- **SC-002**: For test fixtures with known file sizes, displayed aggregate sizes are
  within 1% of expected totals or clearly marked partial.
- **SC-003**: A user can select files and complete a safe cleanup confirmation in
  under 60 seconds after scan results load.
- **SC-004**: Cleanup operations never move unselected files and never move files
  outside the active scan root in automated validation.
- **SC-005**: Permission errors and skipped paths are visible from the main results
  view without requiring logs or developer tools.

## Assumptions

- The first version runs locally on macOS and is used by one person at a time.
- The default cleanup action is moving items to Trash; permanent deletion is out of
  scope for v1.
- The app may start with a local browser UI rather than a packaged native Mac app.
- The first version defaults to scanning the whole local drive at `/`, but permission
  protected locations may still appear as partial results.
- No cloud sync, accounts, or multi-device features are required for v1.

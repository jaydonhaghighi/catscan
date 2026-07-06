# Tasks: Mac Disk Space Visualizer

**Input**: Design documents from `/specs/001-disk-space-visualizer/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Required by constitution for scanner traversal, aggregation, permission handling, path validation, API contract, and Trash movement.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and baseline local app structure

- [X] T001 Create Node project metadata in package.json
- [X] T002 Create repository ignore rules in .gitignore
- [X] T003 [P] Create source directories src/server/ and src/public/
- [X] T004 [P] Create test directories tests/unit/, tests/contract/, and tests/integration/

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before user stories

- [X] T005 [P] Implement path safety helpers in src/server/security.js
- [X] T006 [P] Implement Trash movement helper with test override support in src/server/trash.js
- [X] T007 [P] Add path safety unit tests in tests/unit/security.test.js
- [X] T008 [P] Add Trash movement unit tests in tests/unit/trash.test.js
- [X] T009 Implement local HTTP app shell, static serving, JSON parsing, session token, and health endpoint in src/server/app.js
- [X] T010 Add API health/session contract tests in tests/contract/api.test.js

**Checkpoint**: Foundation ready - scan and cleanup stories can use shared local service and safety helpers

---

## Phase 3: User Story 1 - Scan and understand storage usage (Priority: P1) MVP

**Goal**: Scan an explicit local folder and show accurate aggregate size results with partial-scan errors.

**Independent Test**: Scan a temporary nested fixture and verify totals, ranking, and inaccessible/skipped reporting.

### Tests for User Story 1

- [X] T011 [P] [US1] Add scanner unit tests for nested size aggregation in tests/unit/scanner.test.js
- [X] T012 [P] [US1] Add scan API contract tests in tests/contract/api.test.js

### Implementation for User Story 1

- [X] T013 [US1] Implement filesystem scanner in src/server/scanner.js
- [X] T014 [US1] Add POST /api/scan endpoint in src/server/app.js
- [X] T015 [US1] Create initial scan UI shell in src/public/index.html
- [X] T016 [US1] Add scan UI styling in src/public/styles.css
- [X] T017 [US1] Connect frontend scan flow to /api/session and /api/scan in src/public/app.js

**Checkpoint**: User can scan a local folder and inspect total/largest entries without cleanup enabled

---

## Phase 4: User Story 2 - Visualize and navigate the breakdown (Priority: P2)

**Goal**: Render scan results as an interactive visual breakdown and sortable file list.

**Independent Test**: Load known scan results and verify the visualization and table represent the same paths and sizes.

### Tests for User Story 2

- [X] T018 [P] [US2] Add frontend data transformation tests for flattening and sorting in tests/unit/ui-data.test.js

### Implementation for User Story 2

- [X] T019 [US2] Extract reusable result transformation helpers in src/public/ui-data.js
- [X] T020 [US2] Implement treemap visualization rendering in src/public/app.js
- [X] T021 [US2] Implement sortable result table and focused path details in src/public/app.js
- [X] T022 [US2] Refine responsive visualization and table layout in src/public/styles.css

**Checkpoint**: User can visually identify and navigate the largest folders/files

---

## Phase 5: User Story 3 - Select and safely delete files (Priority: P3)

**Goal**: Select displayed items and move them to Trash with confirmation and result reporting.

**Independent Test**: Use a temporary fixture, select one file, confirm cleanup, and verify only the selected file moves to the test Trash directory.

### Tests for User Story 3

- [X] T023 [P] [US3] Add cleanup API contract tests in tests/contract/api.test.js
- [X] T024 [P] [US3] Add cleanup flow integration tests in tests/integration/cleanup-flow.test.js

### Implementation for User Story 3

- [X] T025 [US3] Implement scan entry lookup and post-cleanup result update in src/server/scanner.js
- [X] T026 [US3] Add POST /api/cleanup endpoint with token/origin/path validation in src/server/app.js
- [X] T027 [US3] Add selection state and selected-size summary in src/public/app.js
- [X] T028 [US3] Add cleanup confirmation dialog and result handling in src/public/app.js
- [X] T029 [US3] Style selection and confirmation states in src/public/styles.css

**Checkpoint**: User can safely move selected scan items to Trash and see updated totals

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validation, documentation, and final usability checks

- [X] T030 [P] Add README with run, test, safety, and Spec Kit workflow notes in README.md
- [X] T031 Run npm test and fix failures
- [X] T032 Run the local service and verify health endpoint
- [X] T033 Review UI text, layout, and mobile responsiveness in src/public/
- [X] T034 Verify quickstart.md matches implemented commands

---

## Phase 7: All-Files Square View

**Purpose**: Make every scanned file visible, sorted largest to smallest, with a square tile visual

- [X] T035 Add all-files flattening and square span helpers in src/public/ui-data.js
- [X] T036 Add unit coverage for all-files flattening and square span helpers in tests/unit/ui-data.test.js
- [X] T037 Replace top-level map with all-files square visualization in src/public/app.js
- [X] T038 Add Files/All table mode controls in src/public/index.html
- [X] T039 Style square grid and table mode controls in src/public/styles.css

---

## Phase 8: Live Scan Progress

**Purpose**: Show useful scan progress while whole-drive traversal is running

- [X] T040 Add scanner progress callbacks in src/server/scanner.js
- [X] T041 Add background scan start and progress endpoints in src/server/app.js
- [X] T042 Add progress panel markup and styling in src/public/index.html and src/public/styles.css
- [X] T043 Poll scan progress and render live counts in src/public/app.js
- [X] T044 Add scanner and API progress tests in tests/unit/scanner.test.js and tests/contract/api.test.js

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): No dependencies.
- Foundational (Phase 2): Depends on Setup completion; blocks all user stories.
- User Story 1 (Phase 3): Depends on Foundational and delivers the MVP.
- User Story 2 (Phase 4): Depends on User Story 1 scan data.
- User Story 3 (Phase 5): Depends on User Story 1 scan data and Foundational Trash safety.
- Polish (Phase 6): Depends on desired user stories being complete.

### User Story Dependencies

- User Story 1 (P1): No dependency on other stories after foundation.
- User Story 2 (P2): Uses scan result data from User Story 1.
- User Story 3 (P3): Uses scan result data and safety helpers from earlier phases.

### Parallel Opportunities

- T003 and T004 can run in parallel.
- T005 through T008 can run in parallel after setup.
- T011 and T012 can run in parallel.
- T023 and T024 can run in parallel.
- Documentation and UI review can run while tests are being fixed.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases.
2. Complete User Story 1.
3. Validate scanning on temporary fixtures and a small real folder.

### Incremental Delivery

1. Add visualization and navigation after scan results are trustworthy.
2. Add cleanup only after API path safety and Trash tests are passing.
3. Run full quickstart validation before considering the feature complete.

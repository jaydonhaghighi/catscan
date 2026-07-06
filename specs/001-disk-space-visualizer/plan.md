# Implementation Plan: Mac Disk Space Visualizer

**Branch**: `001-disk-space-visualizer` | **Date**: 2026-07-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-disk-space-visualizer/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a local-only macOS disk usage viewer that scans an explicit root directory,
aggregates file/folder sizes, visualizes the largest entries, and moves selected
items to Trash after confirmation. The MVP uses a loopback Node.js service with a
static browser UI, no database, and automated tests around scanner aggregation,
path validation, permission/partial-scan handling, and Trash-safe cleanup behavior.

## Technical Context

**Language/Version**: JavaScript on Node.js 23.7.0 locally; target Node.js >=20

**Primary Dependencies**: Node built-in `http`, `fs/promises`, `path`, `crypto`, `child_process`, static HTML/CSS/JS; no runtime npm dependencies for MVP

**Storage**: In-memory scan sessions only; no database or persisted scan metadata

**Testing**: Node built-in test runner (`node --test`)

**Target Platform**: macOS local machine, browser UI served from loopback

**Project Type**: Local web service + frontend application

**Performance Goals**: Scan a 10,000-file fixture in under 30 seconds; render top results interactively without UI layout shift

**Constraints**: Local-only operation; bind to `127.0.0.1`; reject cleanup paths outside active scan root; default cleanup moves to Trash; no real user folders in automated tests

**Scale/Scope**: Single-user local app; v1 scans one selected root at a time and displays top nested entries

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Confirm the plan satisfies the Disk Viewer Constitution:

- Local-only user data: PASS. The service binds to loopback and does not upload or persist metadata.
- User-controlled scope: PASS. The UI scans typed/chosen local roots and reports skipped/errors.
- Safe deletion: PASS. Cleanup requires explicit selection and confirmation; API moves to Trash only.
- Explainable accounting: PASS. Tree/list entries carry concrete paths, sizes, type, child count, and partial flags.
- Tested scanner/delete paths: PASS. Tests will use temporary fixtures and test Trash directory overrides only.

## Project Structure

### Documentation (this feature)

```text
specs/001-disk-space-visualizer/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── app.js
│   ├── scanner.js
│   ├── security.js
│   └── trash.js
└── public/
    ├── index.html
    ├── styles.css
    └── app.js

tests/
├── contract/
│   └── api.test.js
├── integration/
│   └── cleanup-flow.test.js
└── unit/
    ├── scanner.test.js
    ├── security.test.js
    └── trash.test.js
```

**Structure Decision**: Use a single Node project with server modules, static frontend
assets, and Node test suites. This keeps the MVP local, dependency-light, and easy to
run from the repository root.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

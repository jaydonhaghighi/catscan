<!--
Sync Impact Report
Version change: N/A -> 1.0.0
Modified principles: Initial constitution
Added sections: Safety & Privacy Constraints; Development Workflow
Removed sections: None
Templates requiring updates:
- .specify/templates/plan-template.md: updated
- .specify/templates/spec-template.md: reviewed, no update required
- .specify/templates/tasks-template.md: updated
Follow-up TODOs: None
-->

# Disk Viewer Constitution

## Core Principles

### I. Local-Only User Data
The application MUST keep file inventory, scan results, and deletion choices on the
user's Mac. It MUST NOT upload paths, filenames, file contents, or storage metadata
to any external service. Any future network feature MUST be opt-in and documented in
the feature spec before implementation.

### II. User-Controlled Scope
Scanning MUST start only from a user-selected root or an explicitly configured local
default. The UI MUST disclose skipped folders, permission errors, and partial results
without treating them as successful scans. The scanner MUST avoid crossing into
unexpected volumes or protected system locations unless the user explicitly chooses
that scope.

### III. Safe Deletion Is Non-Negotiable
Destructive actions MUST require explicit item selection and confirmation that shows
the number of items and total selected size. The default removal behavior MUST move
items to Trash rather than permanently unlinking them. Permanent deletion may only be
added as a separately specified feature with stronger confirmation and test coverage.

### IV. Explainable Space Accounting
Size summaries MUST distinguish files, folders, inaccessible entries, and skipped
entries. Visualizations MUST let users trace every displayed total back to concrete
filesystem paths. Approximate or partial totals MUST be labeled clearly.

### V. Tested Scanner and Delete Paths
Scanner traversal, size aggregation, permission-error handling, path validation, and
Trash movement MUST have automated tests. Tests MUST use temporary directories and
fixtures only; they MUST NOT operate on real user folders.

## Safety & Privacy Constraints

- The app MUST bind any local service to loopback by default.
- The app MUST reject delete requests for paths outside the current scan root.
- The app MUST guard against symlink traversal surprises and path traversal input.
- The UI MUST never hide permission failures behind a generic success state.
- The app SHOULD remain useful when scanning large home directories with partial
  permissions.

## Development Workflow

- Each user story MUST be independently demonstrable from the generated Spec Kit
  quickstart.
- Feature work MUST keep the implementation local-first and must document any new
  storage, network, or deletion behavior in the plan before code changes.
- Automated tests MUST run before a feature is considered complete.
- Accessibility and responsive layout checks are required for any user-facing view.

## Governance

This constitution supersedes other project guidance. Amendments require updating this
file, documenting the reason for the version change, and reviewing active specs,
plans, and task lists for conflicts. Versioning follows semantic versioning: MAJOR
for incompatible governance changes, MINOR for new principles or materially expanded
requirements, and PATCH for clarifications.

**Version**: 1.0.0 | **Ratified**: 2026-07-05 | **Last Amended**: 2026-07-05

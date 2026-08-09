---
name: timesheet-manual-validation
description: Use for every implementation, bug fix, refactor, UI, API, or feature task in the Timesheet 2.0 repository. Enforces the project owner's preference to personally test all changes and prevents automatic browser testing, builds, and validation commands unless explicitly requested in the current prompt.
---

# Timesheet Manual Validation

Apply this skill to all code changes in the Timesheet 2.0 repository.

## Required workflow

1. Inspect the relevant source files and implement the requested change.
2. Do not use Browser, Computer Use, Playwright, screenshots, or other UI automation to preview, inspect, or test the application.
3. Do not start a development or preview server for validation.
4. Do not run build, test, typecheck, lint, formatting-check, or other project validation commands.
5. A validation command may run only when the user explicitly requests that specific validation in the current prompt. Do not infer permission from an earlier task or from a general request to implement or fix something.
6. Do not claim the feature passed tests or visual verification. State that automated validation was intentionally skipped because the project owner will test the feature personally.
7. End the handoff with a concise summary of changed files and any manual testing notes the owner should know.

Read-only source inspection and targeted code edits remain allowed. This skill changes validation behavior only; it does not reduce implementation quality or the requirement to reason carefully about the change.

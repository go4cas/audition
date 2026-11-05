# Audition — Notes

Decisions, findings and answers that feed `docs/SPEC.md`. The spec stays the source of truth; the Requirements thread folds these decisions into it.

## Interview decisions (Nov 5, 2026)

### Topic 1: Phase 1 scope edges

- **D1.4 Phase 2 fields exist from T0.** T0 creates the Phase 2 fields as nullable and unused in Phase 1: `workspaces.composer_contender`, `tasks.composed_prompt`, `runs.schedule`, verdict method `outcome` and `verdicts.due_at`. Later phases then add behaviour without a schema change.
- **D1.5 MCP surface in Phase 1.** Three tools: read castings, read the leaderboard (both read-only scope), and write attempt reports (scoped by a single-use report token).

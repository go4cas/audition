# Audition — Notes

Decisions, findings and answers that feed `docs/SPEC.md`. The spec stays the source of truth; the Requirements thread folds these decisions into it.

## Interview decisions (Nov 5, 2026)

### Topic 0: Lean Phase 1 (supersedes parts of topic 1)

Cas asked to step back and avoid complexity. Phase 1 goal: create a workspace with stages, roles and tasks; pick one or more contenders (linked to a connected model, agent, harness or app) to compete on tasks; judge their outputs to find the best contender per role.

- **D0.1 Manual return for non-API contenders.** Audition shows the prompt to copy; you paste or upload the result back. No report tokens, no agent self-report in Phase 1.
- **D0.2 Confidence ranges stay** on the leaderboard, next to the attempt count.

### Topic 1: Phase 1 scope edges

- **D1.4 Phase 2 fields exist from T0.** T0 creates the Phase 2 fields as nullable and unused in Phase 1: `workspaces.composer_contender`, `tasks.composed_prompt`, `runs.schedule`, verdict method `outcome` and `verdicts.due_at`. Later phases then add behaviour without a schema change.
- **D1.5 MCP surface in Phase 1.** Three tools: read castings, read the leaderboard (both read-only scope), and write attempt reports (scoped by a single-use report token).

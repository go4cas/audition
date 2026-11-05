# Audition — Notes

Decisions, findings and answers that feed `docs/SPEC.md`. The spec stays the source of truth; the Requirements thread folds these decisions into it.

## Interview decisions (Nov 5, 2026)

### Topic 0: Lean Phase 1 (supersedes parts of topic 1)

Cas asked to step back and avoid complexity. Phase 1 goal: create a workspace with stages, roles and tasks; pick one or more contenders (linked to a connected model, agent, harness or app) to compete on tasks; judge their outputs to find the best contender per role.

- **D0.1 Manual return for non-API contenders.** Audition shows the prompt to copy; you paste or upload the result back. No report tokens, no agent self-report in Phase 1.
- **D0.2 Confidence ranges stay** on the leaderboard, next to the attempt count.
- **D0.3 Generic handoff template only.** One copy-ready block: role context, task prompt (with commit/repo if relevant), rubric, and "when done, reply with" instructions. The coding-harness and app templates are deferred. Example: `prompt-examples.md` (project files, interview folder).
- **D0.4 Check results travel in the output.** The generic template asks the agent to include build/test/lint results and screenshots in its reply. You paste the reply and upload screenshots; the blind judging screen shows text and images together. Results are self-claimed; Audition runs nothing.
- **D0.5 Fitness stays, with partial data handled.** Weights per workspace, default quality only. The leaderboard shows cost and latency per contender where known and "N/A" where unknown. The cost and latency terms of fitness apply only when every contender in that role has them; otherwise fitness is quality only and the leaderboard says so.
- **D0.6 Deferred from Phase 1:** report tokens and agent self-report, the coding-harness and app templates, platform-run objective checks and screenshot capture, MCP, the stale-attempt cron.

### Topic 2: Records, versioning and runs

- **D2.3 Used records are read-only.** Once a task or contender has been in a run it cannot be edited; "duplicate and edit" creates a new version. Role rubrics may change, but each verdict stores a snapshot of the rubric it was scored against.
- **D2.4 Repetitions** default to 1 per run, maximum 5, set per run.

### Topic 1: Phase 1 scope edges

- **D1.4 Phase 2 fields exist from T0.** T0 creates the Phase 2 fields as nullable and unused in Phase 1: `workspaces.composer_contender`, `tasks.composed_prompt`, `runs.schedule`, verdict method `outcome` and `verdicts.due_at`. Later phases then add behaviour without a schema change.
- ~~D1.5 MCP surface in Phase 1~~ Superseded by D0.6: MCP is deferred.

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

- **D2.1 Entity hierarchy.** Workspace → Stage (optional) → Role (owns rubric) → Task. Separately, Connection (provider + credential, or "Manual") → Contender. A Run is one role + some of its tasks + some contenders + a repetition count; it creates one Attempt per task × contender × repetition. Verdicts judge attempts; the leaderboard rolls verdicts up per role × contender; a Casting (champion) is the contender you confirm for a role. Contenders are picked per run, not attached to tasks.
- **D2.2 Contender = exact configuration.** Connection + model + settings (reasoning level, temperature, system prompt, etc.). "Opus 5.5 High 0.6" and "Opus 5.5 Medium 0.2" are two contenders. Same for agents and apps ("Claude Code, Opus, plan mode"). Contenders have friendly names; the leaderboard can group rows by model. Connections and contenders are global (shared across workspaces) — recommended default, not objected to.
- **D2.3 Used records are read-only.** Once a task or contender has been in a run it cannot be edited; "duplicate and edit" creates a new version. Role rubrics may change, but each verdict stores a snapshot of the rubric it was scored against.
- **D2.4 No repetitions field; "Run again" instead.** (Replaces an earlier "default 1, max 5".) A finished run has a "Run again" button that creates a new run with the same role, tasks and contenders. Reruns add outputs; nothing is overwritten, and the leaderboard averages every scored output. The minimum-attempts rule (D3.5) guards against a lucky single result.
- **D2.5 UI wording.** Screens say "outputs"; "attempt" stays the internal record name.

### Topic 3: Judging and champions

Cas asked for judging simple enough for non-technical users.

- **D3.1 Rubric scoring is the only method in Phase 1.** Each role has a few criteria with weights. The judge gives each output 1–5 stars per criterion; Audition computes the weighted score. Pairwise (A-vs-B) judging is dropped from Phase 1.
- **D3.2 One judging screen per task.** All contenders' outputs for a task are shown side by side, unlabelled and shuffled ("Output A, B, C"), and each gets stars per criterion. The best output is the highest score.
- **D3.3 One judge per run: "Me" or "AI".** The AI judge is a contender chosen in workspace settings and gives stars plus a one-line reason per criterion.
- **D3.4 The owner can always override.** On any AI-judged output, the owner can change the stars; the owner's scores then count and the AI's are kept in history.
- **D3.5 Champion suggestion.** The leaderboard averages each contender's scores per role across all runs. Once a contender has at least 5 scored attempts (minimum set per workspace) and averages above the role's pass mark, the top one is marked "Suggested champion" and the owner confirms it. Below the minimum: "not enough data yet".

### Topic 1: Phase 1 scope edges

- **D1.4 Phase 2 fields exist from T0.** T0 creates the Phase 2 fields as nullable and unused in Phase 1: `workspaces.composer_contender`, `tasks.composed_prompt`, `runs.schedule`, verdict method `outcome` and `verdicts.due_at`. Later phases then add behaviour without a schema change.
- ~~D1.5 MCP surface in Phase 1~~ Superseded by D0.6: MCP is deferred.

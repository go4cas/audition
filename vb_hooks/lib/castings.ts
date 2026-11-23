// Champion changes for a role (TECH-SPEC §11a). Every change adds a casting
// record through the records API, so the castings collection is the history
// and Vaultbase's record history keeps every edit to one (trial → kept).
//   - crown: Make champion. A contender that replaces another champion starts
//     "on trial"; a role's first champion doesn't, as there is no one to go
//     back to.
//   - keep: end the trial of the current champion.
//   - restore: bring back the champion before the current one, with an
//     optional note. It skips the qualify check: the owner's real-world
//     verdict is the reason.
import { castingInfo, roleBoard, type BoardDeps, type CastingInfo } from "./fitness.ts";
import { RunError } from "./runs.ts";
import { insertRecord, updateRecord, type Store } from "./store.ts";

export type CastDeps = BoardDeps & Store;

const now = () => Math.floor(Date.now() / 1000);

function note(v: unknown, what: string): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new RunError(422, `${what} must be text.`);
  return v.trim();
}

async function add(deps: CastDeps, data: Record<string, unknown>): Promise<CastingInfo> {
  const id = await insertRecord(deps, "castings", { ...data, confirmed: true });
  const rec = await deps.find("castings", id);
  return castingInfo(rec ?? { id, ...data });
}

/** Make a qualifying contender the role's champion. */
export async function crown(deps: CastDeps, body: { role?: unknown; contender?: unknown; rationale?: unknown }): Promise<CastingInfo> {
  if (typeof body.role !== "string" || typeof body.contender !== "string" || !body.role || !body.contender) {
    throw new RunError(422, "role and contender are required.");
  }
  const rationale = note(body.rationale, "rationale");
  const board = await roleBoard(deps, body.role);
  if (!board) throw new RunError(404, "That role does not exist.");
  const row = board.rows.find((r) => r.contender === body.contender);
  if (!row || !row.qualifies) {
    const why = !row
      ? "it has no scored outputs for this role"
      : !row.enough_data
        ? `it has ${row.n} scored outputs and needs at least the workspace minimum`
        : `its average ${row.mean_score} is not above the role's pass mark`;
    throw new RunError(422, `That contender doesn't qualify as champion: ${why}.`);
  }
  const replaces = board.casting && board.casting.contender !== body.contender;
  return add(deps, {
    role: body.role, contender: body.contender, since: now(), rationale,
    suggested_by: board.suggested === body.contender ? "system" : "human",
    trial: !!replaces, restored: false,
  });
}

/** End the current champion's trial. */
export async function keep(deps: CastDeps, roleId: string): Promise<CastingInfo> {
  const board = await roleBoard(deps, roleId);
  if (!board) throw new RunError(404, "That role does not exist.");
  if (!board.casting) throw new RunError(422, "This role has no champion yet.");
  if (!board.casting.trial) throw new RunError(422, "The champion is not on trial.");
  const rec = await updateRecord(deps, "castings", board.casting.id, { trial: false });
  return castingInfo(rec);
}

/** Bring back the champion before the current one. */
export async function restore(deps: CastDeps, roleId: string, body: { rationale?: unknown }): Promise<CastingInfo> {
  const rationale = note(body.rationale, "rationale");
  const board = await roleBoard(deps, roleId);
  if (!board) throw new RunError(404, "That role does not exist.");
  if (!board.previous) throw new RunError(422, "There is no earlier champion to restore.");
  return add(deps, {
    role: roleId, contender: board.previous, since: now(), rationale,
    suggested_by: "human", trial: false, restored: true,
  });
}

// Types for hook files. Written by Vaultbase; safe to commit, regenerated if deleted.
declare module "vaultbase" {
  type Rec = Record<string, any>;
  export interface Auth { id: string; type: "user" | "admin"; email?: string; collection?: string; anonymous?: boolean }
  /** helpers.find, query, enqueue, notify, email, http, db, ... (see the docs). */
  export type Helpers = Rec;
  export interface HookContext { record: Rec; existing: Rec | null; auth: Auth | null; helpers: Helpers }
  export interface RouteContext {
    req: Request; method: string; path: string; params: Record<string, string>; query: Record<string, string>;
    body: unknown; auth: Auth | null; helpers: Helpers; set: { status: number; headers: Record<string, string> };
  }
  export interface JobContext { helpers: Helpers; scheduledAt: number }
  export interface WorkerContext { payload: any; attempt: number; queue: string; jobId: string; helpers: Helpers }
  type HookEvent = "beforeCreate" | "afterCreate" | "beforeUpdate" | "afterUpdate" | "beforeDelete" | "afterDelete";
  export function defineHook(def: { name?: string; collection?: string; event: HookEvent; enabled?: boolean; run(ctx: HookContext): unknown }): unknown;
  export function defineRoute(def: { name?: string; method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; path: string; requireAuth?: boolean; enabled?: boolean; handle(ctx: RouteContext): unknown }): unknown;
  export function defineJob(def: { name?: string; cron: string; mode?: string; enabled?: boolean; run(ctx: JobContext): unknown }): unknown;
  export function defineWorker(def: { name?: string; queue: string; concurrency?: number; retries?: number; backoff?: "exponential" | "fixed"; retryDelayMs?: number; enabled?: boolean; run(ctx: WorkerContext): unknown }): unknown;
}

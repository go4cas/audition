// GET /api/custom/push: whether push alerts can be turned on for a device,
// and OneSignal's public App ID (docs/PUSH-ALERTS.md). The Alerts page reads it.
import { defineRoute } from "vaultbase";
import { pushConfig } from "../lib/push.ts";
import { ownerRoute } from "../lib/runs.ts";

export default defineRoute({
  name: "push",
  method: "GET",
  path: "/push",
  requireAuth: true,
  handle: (ctx) => ownerRoute(ctx, async () => pushConfig(ctx.helpers.sql)),
});

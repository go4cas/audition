// The four reference workspaces (SPEC "Reference workspace content"), the
// seeded connections and contenders, and the generic handoff template.
// Seeding is idempotent by name: running it twice creates nothing new.
import { join } from "node:path";
import { call } from "../scripts/lib/vaultbase.ts";

// AUDITION_SEED_FIXTURES: where the fixtures are when the seed runs from the
// compiled setup tool in a release bundle (scripts/bundle.ts).
const FIXTURES = process.env["AUDITION_SEED_FIXTURES"] || join(import.meta.dir, "fixtures");

/** The demo repo for the Software Factory coding tasks (open question O2). */
export const DEMO_REPO = "github.com/go4cas/audition-factory-demo";
// First commit of go4cas/audition-factory-demo (Cas pushed fixtures/factory-demo/ on Nov 7, 2026).
export const DEMO_COMMIT = "9c4bb7aef4c84adaf7b5aa523c1e56f9fada8a55";

type Rec = Record<string, unknown> & { id: string };
type Criterion = [name: string, weight: number, guidance: string];

interface TaskDef { title: string; prompt: string; output_type?: string; base_ref?: boolean; attachments?: string[] }
interface RoleDef { stage?: string; name: string; description: string; rubric: Criterion[]; pass_mark: number; output_type: string; outcome_after_days?: number; tasks: TaskDef[] }
interface WorkspaceDef {
  name: string; description: string; judge: "me" | "ai"; weights: { quality: number; tokens: number; time: number };
  stages: string[]; roles: RoleDef[];
  /** The contenders the SPEC's "Reference workspaces" table names for this workspace, when it names them. Not seeded as data; the end-to-end test runs them as-is. */
  contenders?: string[];
}

export const CONNECTIONS = [
  { name: "Mock", provider: "mock", notes: "In-process test provider. Makes no network calls." },
  { name: "Manual", provider: "manual", notes: "Copy the prompt into another tool and paste the result back." },
];

export const CONTENDERS = [
  { name: "Mock Steady", connection: "Mock", model: "mock-steady", behaviour: "steady" },
  { name: "Mock Erratic", connection: "Mock", model: "mock-erratic", behaviour: "erratic" },
  { name: "Mock Judge", connection: "Mock", model: "mock-judge", behaviour: "judge" },
  { name: "Mock Image", connection: "Mock", model: "mock-image", behaviour: "image" },
  { name: "Claude Code (manual)", connection: "Manual" },
  { name: "Codex (manual)", connection: "Manual" },
  { name: "ChatGPT (manual)", connection: "Manual" },
  { name: "Perplexity (manual)", connection: "Manual" },
  { name: "Midjourney (manual)", connection: "Manual" },
];

export const GENERIC_TEMPLATE = {
  name: "Generic",
  kind: "generic",
  body: [
    "You are acting as: {{role.name}}.",
    "Role description: {{role.description}}",
    "",
    "TASK: {{task.title}}",
    "{{task.prompt}}",
    "{{#if task.base_ref}}",
    "Work in the repository {{task.base_ref.repo}}, starting from commit {{task.base_ref.commit}}.",
    "{{/if}}{{#if attachments_text}}",
    "Attached files: {{attachments_text}}",
    "{{/if}}",
    "You will be judged on:",
    "{{rubric_text}}",
    "",
    "{{return_instructions}}",
  ].join("\n"),
  // One line per output type; lib/handoff.ts (T2) picks the task's line.
  return_instructions: [
    "text: WHEN DONE, reply with your answer only.",
    "image: WHEN DONE, return the image files and a one-line description of each.",
    "file: WHEN DONE, return the files and a short summary of what each contains.",
    "code: WHEN DONE, reply with: a short summary of what you built; the branch name or diff; build, test and lint results (pass or fail, with counts); any screenshots, as files.",
  ].join("\n"),
};

const g = (s: string) => s; // guidance, kept short and plain

export const WORKSPACES: WorkspaceDef[] = [
  {
    name: "Software Factory",
    description: "Research, spec, back-end and UI work on a small demo app. Coding outputs report their own build and test results.",
    judge: "ai",
    weights: { quality: 70, tokens: 20, time: 10 },
    stages: ["Research", "Spec", "Back-end", "UI"],
    roles: [
      {
        stage: "Research", name: "Researcher", description: "Compares options and recommends one, with sources.", pass_mark: 3.5, output_type: "text",
        rubric: [["Accuracy", 40, g("Facts are correct and current.")], ["Relevance to the question", 25, g("Answers what was asked, nothing padded.")], ["Clear recommendation", 20, g("Ends with one recommendation and why.")], ["Sources cited", 15, g("Names where each claim comes from.")]],
        tasks: [
          { title: "Compare three ways to store user settings in a small web app and recommend one", prompt: "<p>Compare three ways to store user settings in a small web app and recommend one.</p>" },
          { title: "Summarise the trade-offs of SQLite versus Postgres for a single-user app", prompt: "<p>Summarise the trade-offs of SQLite versus Postgres for a single-user app.</p>" },
        ],
      },
      {
        stage: "Spec", name: "Spec writer", description: "Turns a rough idea into a short, testable spec.", pass_mark: 3.5, output_type: "text",
        rubric: [["Completeness", 35, g("Covers every part of the idea.")], ["Testable acceptance criteria", 30, g("Each criterion can be checked as pass or fail.")], ["Clarity", 20, g("Plain words, no ambiguity.")], ["Scope discipline", 15, g("Adds nothing that wasn't asked for.")]],
        tasks: [
          { title: "Write a one-page spec for a settings screen with Profile, Notifications and Danger zone", prompt: "<p>Write a one-page spec for a settings screen with three sections: Profile, Notifications and Danger zone.</p>" },
        ],
      },
      {
        stage: "Back-end", name: "Back-end engineer", description: "Builds small, tested server features.", pass_mark: 3.5, output_type: "code",
        rubric: [["Correctness", 40, g("Does what the task asks, including edge cases.")], ["Tests included and passing", 25, g("New tests cover the change and pass.")], ["Code quality", 20, g("Readable, small, consistent with the repo.")], ["Error handling", 15, g("Bad input gets a clear error, not a crash.")]],
        tasks: [
          { title: "Add a REST endpoint that saves and reads user settings, with tests", prompt: "<p>Add a REST endpoint that saves and reads user settings (<code>PUT</code> and <code>GET /api/settings</code>), with tests.</p>", base_ref: true },
        ],
      },
      {
        stage: "UI", name: "UI engineer", description: "Builds accessible, responsive screens from a spec.", pass_mark: 3.5, output_type: "code",
        rubric: [["Matches the spec", 40, g("Every section and behaviour in the spec is there.")], ["Code quality", 30, g("Readable vanilla JS and CSS.")], ["Accessibility", 20, g("Labels, keyboard use and contrast.")], ["Responsiveness", 10, g("Works at 375 px with no sideways scroll.")]],
        tasks: [
          { title: "Build the settings screen from settings-spec.md and mockup.png, vanilla JS and CSS, usable at 375 px", prompt: "<p>Build the settings screen described in <code>settings-spec.md</code>, laid out as in <code>mockup.png</code>. Use vanilla JS and CSS. It must be usable at 375 px wide.</p>", base_ref: true, attachments: ["settings-spec.md", "mockup.png"] },
        ],
      },
    ],
  },
  {
    name: "Marketing Pipeline",
    description: "Social posts, brand copy and images for small brands.",
    judge: "me",
    weights: { quality: 100, tokens: 0, time: 0 },
    stages: [],
    roles: [
      {
        name: "Social post writer", description: "Short posts for a given channel and audience.", pass_mark: 3.5, output_type: "text",
        rubric: [["On brand voice", 30, g("Sounds like the brand, not generic.")], ["Hook in the first line", 30, g("The first line makes you read on.")], ["Clear call to action", 20, g("Says what to do next.")], ["Fits the channel's length", 20, g("Right length and format for the channel.")]],
        tasks: [
          { title: "Write three LinkedIn posts announcing a self-hosted note-taking app", prompt: "<p>Write three LinkedIn posts announcing a self-hosted note-taking app.</p>" },
          { title: "Write five posts for X about a spring sale at a coffee roaster", prompt: "<p>Write five posts for X about a spring sale at a coffee roaster.</p>" },
        ],
      },
      {
        name: "Brand copywriter", description: "Names, taglines and short brand copy.", pass_mark: 3.5, output_type: "text",
        rubric: [["Memorable", 35, g("Sticks after one reading.")], ["Fits the brand brief", 35, g("Matches the brand's character.")], ["Clear", 20, g("Easy to understand at a glance.")], ["Original", 10, g("Not a cliché.")]],
        tasks: [
          { title: "Propose five taglines and a 50-word About text for a coffee roaster called Ember & Oak", prompt: "<p>Propose five taglines and a 50-word About text for a coffee roaster called Ember &amp; Oak.</p>" },
        ],
      },
      {
        name: "Image maker", description: "Images from a brief.", pass_mark: 3.0, output_type: "image",
        rubric: [["Matches the brief", 40, g("Shows what the brief asks for.")], ["Visual quality", 30, g("Well composed and clean.")], ["On brand", 20, g("Warm, crafted, Ember & Oak.")], ["Usable as-is", 10, g("Could be posted without edits.")]],
        tasks: [
          { title: "Create a square social image for the Ember & Oak spring sale: warm tones, a coffee bag, no text", prompt: "<p>Create a square social image for the Ember &amp; Oak spring sale: warm tones, a coffee bag, no text.</p>" },
        ],
      },
    ],
  },
  {
    name: "Stock Review",
    description: "A short, balanced review of one listed company. One role, one contender.",
    judge: "ai",
    contenders: ["Mock Steady"],
    weights: { quality: 100, tokens: 0, time: 0 },
    stages: [],
    roles: [
      {
        name: "Stock analyst", description: "A short, balanced review of one listed company.", pass_mark: 3.5, output_type: "text",
        // Phase 2a: was the call right four weeks later?
        outcome_after_days: 28,
        rubric: [["Uses the facts given", 35, g("Works from the attached summary.")], ["Balanced risks and upside", 25, g("Names both sides fairly.")], ["Clear view with reasoning", 25, g("Buy, hold or sell, with reasons.")], ["Plain language", 15, g("No jargon a non-expert can't follow.")]],
        tasks: [
          { title: "Review the attached quarterly summary for Northwind Foods and give a buy, hold or sell view with three reasons", prompt: "<p>Review the attached quarterly summary for a fictional company, Northwind Foods, and give a buy, hold or sell view with three reasons.</p>", attachments: ["northwind-foods-q3.txt"] },
        ],
      },
    ],
  },
  {
    name: "Travel Research",
    description: "Practical travel plans with real places. Copy, paste, rate.",
    judge: "me",
    contenders: ["ChatGPT (manual)", "Perplexity (manual)"],
    weights: { quality: 100, tokens: 0, time: 0 },
    stages: [],
    roles: [
      {
        name: "Trip researcher", description: "Practical travel plans with real places.", pass_mark: 3.5, output_type: "text",
        rubric: [["Practical and realistic", 35, g("A plan you could actually follow.")], ["Matches the brief", 30, g("Fits the travellers, dates and budget.")], ["Specific places named", 20, g("Real places, not 'a nice café'.")], ["Easy to follow", 15, g("Clear order and timings.")]],
        tasks: [
          { title: "Plan three days in Lisbon in May for two adults who like food and walking, mid-range budget", prompt: "<p>Plan three days in Lisbon in May for two adults who like food and walking, on a mid-range budget.</p>" },
          { title: "Find the best way to get from Paris to Amsterdam with a bike, and what it costs", prompt: "<p>Find the best way to get from Paris to Amsterdam with a bike, and what it costs.</p>" },
        ],
      },
    ],
  },
];

const MIME: Record<string, string> = { ".md": "text/plain", ".txt": "text/plain", ".png": "image/png" };

export interface SeedReport { created: string[]; existing: number }

export async function seedReference(base: string, adminToken: string): Promise<SeedReport> {
  const report: SeedReport = { created: [], existing: 0 };
  const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  async function find(collection: string, filter: string): Promise<Rec | null> {
    const r = await call(base, "GET", `/api/v1/${collection}?perPage=1&filter=${encodeURIComponent(filter)}`, { token: adminToken });
    if (r.status !== 200) throw new Error(`seed: list ${collection} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.data[0] as Rec) ?? null;
  }
  async function ensure(collection: string, filter: string, data: Record<string, unknown>, label: string): Promise<Rec> {
    const found = await find(collection, filter);
    if (found) { report.existing++; return found; }
    const r = await call(base, "POST", `/api/v1/${collection}`, { token: adminToken, body: data });
    if (r.status !== 200) throw new Error(`seed: create ${collection} "${label}" failed: ${r.status} ${JSON.stringify(r.body)}`);
    report.created.push(`${collection}: ${label}`);
    return r.body.data as Rec;
  }
  // Fixtures go through the admin-only seed route, which uses lib/files.ts.
  // (Written while Vaultbase's upload endpoint refused multipart bodies, F9,
  // fixed in 0.41.1; moving off it is part B of docs/PLATFORM-UPGRADES.md.)
  async function attach(collection: string, rec: Rec, field: string, names: string[]): Promise<void> {
    for (const name of names) {
      const ext = name.slice(name.lastIndexOf("."));
      const data = Buffer.from(await Bun.file(join(FIXTURES, name)).arrayBuffer()).toString("base64");
      const r = await call(base, "POST", "/api/custom/seed/attach", {
        token: adminToken, body: { collection, id: rec.id, field, name, mime: MIME[ext] ?? "application/octet-stream", data },
      });
      if (r.status !== 200) throw new Error(`seed: attach ${name} failed: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  await ensure("handoff_templates", `name = "${q(GENERIC_TEMPLATE.name)}"`, GENERIC_TEMPLATE, GENERIC_TEMPLATE.name);

  const connections = new Map<string, Rec>();
  for (const c of CONNECTIONS) connections.set(c.name, await ensure("connections", `name = "${q(c.name)}"`, c, c.name));

  const contenders = new Map<string, Rec>();
  for (const c of CONTENDERS) {
    const conn = connections.get(c.connection)!;
    const data: Record<string, unknown> = { name: c.name, connection: conn.id };
    if (c.behaviour) Object.assign(data, { model: c.model, config: { mock: { behaviour: c.behaviour } }, max_output_tokens: 16000 });
    contenders.set(c.name, await ensure("contenders", `name = "${q(c.name)}"`, data, c.name));
  }

  for (const w of WORKSPACES) {
    const ws = await ensure("workspaces", `name = "${q(w.name)}"`, {
      name: w.name, description: w.description, default_judge: w.judge, min_outputs: 5, fitness_weights: w.weights,
      ...(w.judge === "ai" ? { judge_contender: contenders.get("Mock Judge")!.id } : {}),
    }, w.name);
    const stages = new Map<string, Rec>();
    for (const [i, name] of w.stages.entries()) {
      stages.set(name, await ensure("stages", `workspace = "${ws.id}" && name = "${q(name)}"`, { workspace: ws.id, name, order: i + 1 }, `${w.name} / ${name}`));
    }
    for (const r of w.roles) {
      const role = await ensure("roles", `workspace = "${ws.id}" && name = "${q(r.name)}"`, {
        workspace: ws.id, stage: r.stage ? stages.get(r.stage)!.id : null, name: r.name, description: r.description,
        rubric: r.rubric.map(([name, weight, guidance]) => ({ name, weight, guidance })),
        pass_mark: r.pass_mark, default_output_type: r.output_type,
        ...(r.outcome_after_days ? { outcome_after_days: r.outcome_after_days } : {}),
      }, `${w.name} / ${r.name}`);
      for (const t of r.tasks) {
        const before = report.created.length;
        const task = await ensure("tasks", `role = "${role.id}" && title = "${q(t.title)}"`, {
          role: role.id, title: t.title, prompt: t.prompt, output_type: t.output_type ?? r.output_type,
          base_ref: t.base_ref ? { repo: DEMO_REPO, commit: DEMO_COMMIT } : null,
        }, `${r.name} / ${t.title}`);
        if (t.attachments && report.created.length > before) await attach("tasks", task, "attachments", t.attachments);
      }
    }
  }
  return report;
}

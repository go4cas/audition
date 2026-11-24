// lib/handoff.ts without a server: the prompt pieces, the renderer copy and
// the file name checks (TECH-SPEC §9, F4, F6).
import { expect, test } from "bun:test";
import {
  htmlToText, renderPrompt, renderTemplate, returnInstructionsFor, rubricText,
  uploadTypeError,
} from "../vb_hooks/lib/handoff.ts";
import { deriveCost } from "../vb_hooks/lib/cost.ts";
import { runStatusFrom } from "../vb_hooks/lib/runs.ts";
import { GENERIC_TEMPLATE } from "../seed/reference.ts";

const role = { name: "Researcher", description: "Compares options.", rubric: [{ name: "Accuracy", weight: 60, guidance: "Facts are right." }, { name: "Clarity", weight: 40 }] };

test("the renderer copy behaves like Vaultbase's: {{path}}, one level of {{#if}}, no loops", () => {
  const vars = { a: true, name: "Ada", list: ["x"], nested: { repo: "r" }, empty: [] };
  expect(renderTemplate("{{#if a}}yes {{name}}{{/if}}", vars)).toBe("yes Ada");
  expect(renderTemplate("{{nested.repo}}|{{missing}}|{{#if empty}}no{{/if}}", vars)).toBe("r||");
  expect(renderTemplate("{{#each list}}[{{this}}]{{/each}}", vars)).toBe("{{#each list}}[]{{/each}}");
  // a value is never re-scanned, so a task that mentions {{x}} keeps it
  expect(renderTemplate("{{name}}", { name: "{{a}}" })).toBe("{{a}}");
});

test("editor HTML becomes plain text with line breaks", () => {
  expect(htmlToText("<p>Add <code>PUT</code> &amp; <b>GET</b>.</p><p>Second&nbsp;line<br>third</p>")).toBe("Add PUT & GET.\n\nSecond line\nthird");
  expect(htmlToText("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
  expect(htmlToText("<p>a</p><script>alert(1)</script><p>&#39;b&#x27;&lt;c&gt;</p>")).toBe("a\n\n'b'<c>");
});

test("the rubric is numbered with weights and guidance", () => {
  expect(rubricText(role.rubric)).toBe("1. Accuracy (60%): Facts are right.\n2. Clarity (40%)");
  expect(rubricText(JSON.stringify(role.rubric))).toBe(rubricText(role.rubric));
});

test("each output type gets its own return instructions from the seeded template", () => {
  const ri = GENERIC_TEMPLATE.return_instructions;
  expect(returnInstructionsFor(ri, "text")).toBe("WHEN DONE, reply with your answer only.");
  expect(returnInstructionsFor(ri, "image")).toBe("WHEN DONE, return the image files and a one-line description of each.");
  expect(returnInstructionsFor(ri, "file")).toBe("WHEN DONE, return the files and a short summary of what each contains.");
  expect(returnInstructionsFor(ri, "code")).toStartWith("WHEN DONE, reply with: a short summary of what you built;");
  expect(returnInstructionsFor("Reply in French.", "image")).toBe("Reply in French.");
  expect(returnInstructionsFor("", "file")).toBe("WHEN DONE, return the files and a short summary of what each contains.");
});

test("a task without base_ref or attachments has no repo or files line", () => {
  const p = renderPrompt({ template: GENERIC_TEMPLATE, role, task: { title: "Compare", prompt: "<p>Compare three.</p>", output_type: "text", base_ref: null } });
  expect(p).toBe([
    "You are acting as: Researcher.",
    "Role description: Compares options.",
    "",
    "TASK: Compare",
    "Compare three.",
    "",
    "You will be judged on:",
    "1. Accuracy (60%): Facts are right.",
    "2. Clarity (40%)",
    "",
    "WHEN DONE, reply with your answer only.",
  ].join("\n"));
  expect(p).not.toContain("repository");
  // an incomplete base_ref counts as none
  expect(renderPrompt({ template: GENERIC_TEMPLATE, role, task: { title: "T", prompt: "x", base_ref: { repo: "r" } } })).not.toContain("repository");
});

test("the same input always gives the same prompt", () => {
  const input = { template: GENERIC_TEMPLATE, role, task: { title: "T", prompt: "<p>x</p>", output_type: "code", base_ref: '{"repo":"github.com/a/b","commit":"abc1234"}', attachments: ["a.md", "b.png"] } };
  const a = renderPrompt(input);
  expect(renderPrompt(input)).toBe(a);
  expect(a).toContain("Work in the repository github.com/a/b, starting from commit abc1234.");
  expect(a).toContain("Attached files: a.md, b.png");
});

test("cost needs both prices and both token counts", () => {
  expect(deriveCost(1000, 2000, 3, 15)).toBeCloseTo(0.033, 10);
  expect(deriveCost(1000, 2000, 3, null)).toBeNull();
  expect(deriveCost(null, 2000, 3, 15)).toBeNull();
});

test("run status follows TECH-SPEC §8", () => {
  expect(runStatusFrom(["submitted", "waiting"])).toBe("running");
  expect(runStatusFrom(["submitted", "judged", "failed"])).toBe("judging");
  expect(runStatusFrom(["judged", "failed"])).toBe("done");
  expect(runStatusFrom(["failed"])).toBe("done");
});

test("file names: the Phase 1 list, and the stored type must fit the name", () => {
  expect(uploadTypeError("a.png", "image/png")).toBeNull();
  expect(uploadTypeError("a.zip", "application/zip")).toBeNull();
  expect(uploadTypeError("notes.md", "text/markdown")).toBeNull();
  expect(uploadTypeError("data.csv", "text/csv")).toBeNull();
  expect(uploadTypeError("build.log", "text/plain")).toBeNull();
  // files stored by the old upload route (before Vaultbase 0.48)
  expect(uploadTypeError("notes.md", "text/plain")).toBeNull();
  expect(uploadTypeError("a.zip", "application/octet-stream")).toBeNull();
  expect(uploadTypeError("tool.exe", "application/x-msdownload")).toContain("isn't a supported file");
  expect(uploadTypeError("a.png", "application/pdf")).toContain("doesn't match");
});

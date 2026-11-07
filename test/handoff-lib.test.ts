// lib/handoff.ts without a server: the prompt pieces, the renderer copy and
// the upload checks (TECH-SPEC §9, F4, F6).
import { expect, test } from "bun:test";
import {
  checkUpload, costOf, htmlToText, renderPrompt, renderTemplate, returnInstructionsFor, rubricText, runStatusOf,
  uploadTargetError, uploadTypeError,
} from "../vb_hooks/lib/handoff.ts";
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
  expect(costOf(1000, 2000, 3, 15)).toBeCloseTo(0.033, 10);
  expect(costOf(1000, 2000, 3, null)).toBeNull();
  expect(costOf(null, 2000, 3, 15)).toBeNull();
});

test("run status follows TECH-SPEC §8", () => {
  expect(runStatusOf(["submitted", "waiting"])).toBe("running");
  expect(runStatusOf(["submitted", "judged", "failed"])).toBe("judging");
  expect(runStatusOf(["judged", "failed"])).toBe("done");
  expect(runStatusOf(["failed"])).toBe("done");
});

test("upload checks: size, type by name, and content", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]);
  const pdf = new TextEncoder().encode("%PDF-1.4");
  expect(checkUpload("a.png", "image/png", png.length, png)).toBeNull();
  expect(checkUpload("a.zip", "application/zip", zip.length, zip)).toBeNull();
  expect(checkUpload("a.zip", "application/octet-stream", zip.length, zip)).toBeNull();
  expect(checkUpload("a.pdf", "application/pdf", pdf.length, pdf)).toBeNull();
  expect(checkUpload("notes.md", "text/markdown", 3, new Uint8Array(3))).toBeNull();
  expect(checkUpload("big.txt", "text/plain", 26 * 1024 * 1024, new Uint8Array(0))?.code).toBe(413);
  expect(checkUpload("tool.exe", "application/octet-stream", 3, new Uint8Array(3))?.code).toBe(415);
  expect(checkUpload("fake.png", "image/png", 3, new Uint8Array([1, 2, 3]))?.code).toBe(415);
  expect(uploadTypeError("a.png", "application/pdf")).toContain("doesn't match");
  expect(checkUpload("e.txt", "text/plain", 0, new Uint8Array(0))?.code).toBe(422);
});

test("upload targets: waiting handoff outputs and unlocked tasks only", () => {
  expect(uploadTargetError("attempts", "output_files", { mode: "handoff", status: "waiting" })).toBeNull();
  expect(uploadTargetError("attempts", "output_files", { mode: "handoff", status: "submitted" })?.code).toBe(409);
  expect(uploadTargetError("attempts", "output_files", { mode: "api", status: "waiting" })?.code).toBe(403);
  expect(uploadTargetError("tasks", "attachments", { locked: false })).toBeNull();
  expect(uploadTargetError("tasks", "attachments", { locked: true })?.code).toBe(403);
  expect(uploadTargetError("contenders", "x", {})?.code).toBe(404);
  expect(uploadTargetError("attempts", "prompt_sent", { mode: "handoff", status: "waiting" })?.code).toBe(404);
});

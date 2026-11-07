// lib/judge.ts without a server: which files the judge sees, the prompt,
// and the reply check (TECH-SPEC §10, Q5). The same-provider
// warning is lib/runs.ts sameProviderWarnings (T1), tested in test/runs.test.ts.
import { expect, test } from "bun:test";
import { chooseFiles, JUDGE_IMAGE_MAX_BYTES, JUDGE_SCHEMA, JUDGE_SYSTEM, judgePrompt, parseJudgeReply } from "../vb_hooks/lib/judge.ts";

const RUBRIC = [{ name: "Matches the brief", weight: 60, guidance: "Shows what the brief asks for." }, { name: "Visual quality", weight: 40 }];
const file = (name: string, mime: string, size = 1000) => ({ name, mime, size, stored: `${name}.stored` });

test("images, PDFs and text are shown; SVG, AVIF, oversized images and zips are named instead", () => {
  const { shown, notes } = chooseFiles([
    file("a.png", "image/png"), file("b.jpg", "image/jpeg"), file("c.webp", "image/webp"), file("d.gif", "image/gif"),
    file("logo.svg", "image/svg+xml"), file("e.avif", "image/avif"), file("huge.png", "image/png", JUDGE_IMAGE_MAX_BYTES + 1),
    file("brief.pdf", "application/pdf"), file("notes.txt", "text/plain"), file("site.zip", "application/octet-stream"),
  ]);
  expect(shown.map((f) => f.name)).toEqual(["a.png", "b.jpg", "c.webp", "d.gif", "brief.pdf", "notes.txt"]);
  expect(notes).toEqual([
    "an image `logo.svg` was supplied but could not be shown to you",
    "an image `e.avif` was supplied but could not be shown to you",
    "an image `huge.png` was supplied but could not be shown to you (too large)",
    "a file `site.zip` was supplied but could not be shown to you",
  ]);
});

test("an SVG declared as octet-stream is still treated as an image that can't be shown", () => {
  expect(chooseFiles([file("x.svg", "application/octet-stream")]).notes).toEqual(["an image `x.svg` was supplied but could not be shown to you"]);
});

test("the prompt holds the task as sent, the rubric with guidance, the output and the notes", () => {
  const p = judgePrompt({ promptSent: "TASK: Draw a bag", rubric: RUBRIC, output: "Here it is", shown: ["a.png"], notes: ["an image `x.svg` was supplied but could not be shown to you"] });
  expect(p).toContain("TASK: Draw a bag");
  expect(p).toContain("1. Matches the brief (60%): Shows what the brief asks for.");
  expect(p).toContain("2. Visual quality (40%)");
  expect(p).toContain("Here it is");
  expect(p).toContain("`a.png`");
  expect(p).toContain("- an image `x.svg` was supplied but could not be shown to you.");
  expect(JUDGE_SYSTEM).toContain("unverified claims");
  expect(JUDGE_SCHEMA.properties.criteria.items.properties.stars).toEqual({ type: "integer", minimum: 1, maximum: 5 });
});

test("a good reply parses into scores in rubric order", () => {
  const reply = JSON.stringify({ criteria: [{ name: "Visual quality", stars: 4, reason: " clean " }, { name: "Matches the brief", stars: 5, reason: "yes" }] });
  const r = parseJudgeReply(reply, RUBRIC);
  expect(r).toEqual({ scores: { "Matches the brief": { stars: 5, reason: "yes" }, "Visual quality": { stars: 4, reason: "clean" } } });
  expect(Object.keys((r as { scores: object }).scores)).toEqual(["Matches the brief", "Visual quality"]);
  expect("scores" in parseJudgeReply("```json\n" + reply + "\n```", RUBRIC)).toBe(true);
});

test("bad replies are refused with a reason", () => {
  const one = (o: object) => JSON.stringify({ criteria: [{ name: "Matches the brief", stars: 4, reason: "r" }, o] });
  expect(parseJudgeReply("not json", RUBRIC)).toEqual({ error: "the reply was not JSON" });
  expect(parseJudgeReply("{}", RUBRIC)).toEqual({ error: "the reply has no criteria list" });
  expect(parseJudgeReply(JSON.stringify({ criteria: [{ name: "Matches the brief", stars: 4, reason: "r" }] }), RUBRIC)).toEqual({ error: 'the reply missed "Visual quality"' });
  expect(parseJudgeReply(one({ name: "Matches the brief", stars: 3, reason: "r" }), RUBRIC)).toEqual({ error: 'the reply scored "Matches the brief" twice' });
  expect(parseJudgeReply(one({ name: "Style", stars: 3, reason: "r" }), RUBRIC)).toEqual({ error: 'the reply scored an unknown criterion "Style"' });
  expect("error" in parseJudgeReply(one({ name: "Visual quality", stars: 6, reason: "r" }), RUBRIC)).toBe(true);
  expect("error" in parseJudgeReply(one({ name: "Visual quality", stars: 3.5, reason: "r" }), RUBRIC)).toBe(true);
});

// lib/scoring.ts without a server: the weighted score, star checks and the
// blind order (TECH-SPEC §10). The run status rule and HTML to text are T1's
// and T2's (lib/runs.ts, lib/handoff.ts), tested there.
import { expect, test } from "bun:test";
import { blindKey, blindOrder, cleanScores, label, neutralName, scoresError, weightedScore } from "../vb_hooks/lib/scoring.ts";

const RUBRIC = [
  { name: "Accuracy", weight: 40 }, { name: "Relevance", weight: 25 },
  { name: "Recommendation", weight: 20 }, { name: "Sources", weight: 15 },
];

test("the TECH-SPEC example: 4, 3, 4, 2 stars give 3.45", () => {
  expect(weightedScore({ Accuracy: { stars: 4 }, Relevance: { stars: 3 }, Recommendation: { stars: 4 }, Sources: { stars: 2 } }, RUBRIC)).toBe(3.45);
});

test("scores round to two decimals", () => {
  const r = [{ name: "A", weight: 33 }, { name: "B", weight: 33 }, { name: "C", weight: 34 }];
  expect(weightedScore({ A: { stars: 5 }, B: { stars: 4 }, C: { stars: 4 } }, r)).toBe(4.33);
});

test("stars: every criterion, whole numbers 1 to 5, nothing extra", () => {
  const ok = { Accuracy: { stars: 4 }, Relevance: { stars: 3 }, Recommendation: { stars: 4 }, Sources: { stars: 2, reason: "thin" } };
  expect(scoresError(ok, RUBRIC)).toBeNull();
  expect(scoresError(JSON.stringify(ok), RUBRIC)).toBeNull();
  expect(scoresError({ ...ok, Sources: undefined }, RUBRIC)).toContain("Sources");
  expect(scoresError({ ...ok, Sources: { stars: 6 } }, RUBRIC)).toContain("1 to 5");
  expect(scoresError({ ...ok, Sources: { stars: 0 } }, RUBRIC)).toContain("1 to 5");
  expect(scoresError({ ...ok, Sources: { stars: 2.5 } }, RUBRIC)).toContain("whole");
  expect(scoresError({ ...ok, Style: { stars: 3 } }, RUBRIC)).toContain("Style");
  expect(scoresError([], RUBRIC)).not.toBeNull();
  expect(cleanScores({ ...ok, Sources: { stars: 2, reason: "  thin ", extra: 1 } }, RUBRIC).Sources).toEqual({ stars: 2, reason: "thin" });
});

test("labels: A to Z, then AA", () => {
  expect([0, 1, 25, 26, 27].map(label)).toEqual(["A", "B", "Z", "AA", "AB"]);
});

test("the blind order is by SHA-256 of run + task + attempt, the same on every call", () => {
  const attempts = ["a1", "a2", "a3", "a4", "a5"].map((id) => ({ id }));
  const one = blindOrder("run", "task", attempts);
  const two = blindOrder("run", "task", [...attempts].reverse());
  expect(two).toEqual(one);
  expect(one.map((o) => o.label)).toEqual(["A", "B", "C", "D", "E"]);
  const keys = one.map((o) => blindKey("run", "task", o.attempt.id));
  expect([...keys].sort()).toEqual(keys);
  // Another task shuffles differently.
  expect(blindOrder("run", "task-2", attempts).map((o) => o.attempt.id)).not.toEqual(one.map((o) => o.attempt.id));
});

test("neutral file names: prefix, number from 1, original extension in lower case", () => {
  expect(neutralName("A", 0, "chatgpt-image.PNG")).toBe("A-1.png");
  expect(neutralName("B", 2, "report.final.pdf")).toBe("B-3.pdf");
  expect(neutralName("file", 0, "no extension")).toBe("file-1");
  expect(neutralName("AA", 1, "logo.svg")).toBe("AA-2.svg");
});

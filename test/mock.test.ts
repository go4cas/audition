// The mock provider is deterministic for the same seed (TECH-SPEC §12).
import { describe, expect, test } from "bun:test";
import { generate, mockSeed, ProviderError, qualityMarker, type GenerateInput } from "../vb_hooks/lib/providers/mock.ts";

const input = (behaviour: string, seed: string, extra: Partial<GenerateInput> = {}): GenerateInput => ({
  model: `mock-${behaviour}`, config: { mock: { behaviour: behaviour as never } }, maxOutputTokens: 16000,
  prompt: "You are acting as: Researcher.\n\nTASK: Compare three options\nDo it.", attachments: [], seed, ...extra,
});
const seedA = mockSeed("task-1", "contender-1", 0);
const seedB = mockSeed("task-1", "contender-1", 1);

test("the seed is sha256(task + contender + n)", () => {
  expect(seedA).toMatch(/^[0-9a-f]{64}$/);
  expect(mockSeed("task-1", "contender-1", 0)).toBe(seedA);
  expect(seedB).not.toBe(seedA);
});

describe("same seed, same result", () => {
  for (const b of ["steady", "erratic", "image"]) {
    test(b, async () => {
      const one = await generate(input(b, seedA));
      const two = await generate(input(b, seedA));
      expect(two).toEqual(one);
    });
  }
  test("judge", async () => {
    const i = input("judge", seedA, { outputSchema: {}, criteria: ["Accuracy", "Visual quality"], prompt: "output [[mock-quality:4]]", attachments: [{ name: "a.png", mime: "image/png", bytes: new Uint8Array() }] });
    expect(await generate(i)).toEqual(await generate(i));
  });
});

test("steady: quality 4, tokens from the prompt, 300 out, a seeded time", async () => {
  const r = await generate(input("steady", seedA));
  expect(qualityMarker(r.text)).toBe(4);
  expect(r.text).toContain("Compare three options");
  expect(r.tokensIn).toBe(Math.ceil(input("steady", seedA).prompt.length / 4));
  expect(r.tokensOut).toBe(300);
  expect(r.durationMs!).toBeGreaterThanOrEqual(200);
  expect(r.durationMs!).toBeLessThanOrEqual(2000);
});

test("erratic: quality 2 to 5 and 150 to 600 tokens, varying by seed", async () => {
  const results = await Promise.all(Array.from({ length: 30 }, (_, n) => generate(input("erratic", mockSeed("t", "c", n)))));
  const q = new Set(results.map((r) => qualityMarker(r.text)));
  for (const r of results) {
    expect(qualityMarker(r.text)!).toBeGreaterThanOrEqual(2);
    expect(qualityMarker(r.text)!).toBeLessThanOrEqual(5);
    expect(r.tokensOut!).toBeGreaterThanOrEqual(150);
    expect(r.tokensOut!).toBeLessThanOrEqual(600);
  }
  expect(q.size).toBeGreaterThan(1);
});

test("fail: non-retryable error every time; flaky: retryable once, then steady", async () => {
  await expect(generate(input("fail", seedA))).rejects.toMatchObject({ retryable: false });
  const first = generate(input("flaky", seedA, { tryNumber: 1 }));
  await expect(first).rejects.toBeInstanceOf(ProviderError);
  await expect(first).rejects.toMatchObject({ retryable: true });
  const second = await generate(input("flaky", seedA, { tryNumber: 2 }));
  expect(qualityMarker(second.text)).toBe(4);
});

test("image: one or two PNGs with captions, quality 3 or 4, 50 tokens out", async () => {
  for (let n = 0; n < 10; n++) {
    const r = await generate(input("image", mockSeed("t", "c", n)));
    expect(r.files.length).toBeGreaterThanOrEqual(1);
    expect(r.files.length).toBeLessThanOrEqual(2);
    for (const f of r.files) {
      expect(f.mime).toBe("image/png");
      expect([...f.bytes.slice(0, 4)]).toEqual([137, 80, 78, 71]);
    }
    expect([3, 4]).toContain(qualityMarker(r.text)!);
    expect(r.tokensOut).toBe(50);
  }
});

test("judge: stars follow the quality marker, plus one per image for Visual quality, capped at 5", async () => {
  const img = { name: "a.png", mime: "image/png", bytes: new Uint8Array() };
  const r = await generate(input("judge", seedA, { outputSchema: {}, criteria: ["Matches the brief", "Visual quality"], prompt: "…[[mock-quality:4]]", attachments: [img, img] }));
  const parsed = JSON.parse(r.text);
  expect(parsed.criteria).toEqual([
    { name: "Matches the brief", stars: 4, reason: "mock judge" },
    { name: "Visual quality", stars: 5, reason: "mock judge" },
  ]);
  const plain = JSON.parse((await generate(input("judge", seedA, { outputSchema: {}, criteria: ["Accuracy"], prompt: "no marker" }))).text);
  expect(plain.criteria[0].stars).toBe(3);
  await expect(generate(input("judge", seedA))).rejects.toBeInstanceOf(ProviderError);
});

// Regenerate the test images in seed/fixtures and fixtures/factory-demo.
// They come from the same encoder the mock provider uses (vb_hooks/lib/png.ts).
import { join } from "node:path";
import { encodePng, testImage } from "../vb_hooks/lib/png.ts";
import { ROOT } from "./lib/vaultbase.ts";

await Bun.write(join(ROOT, "seed/fixtures/images/coffee-1.png"), testImage(0));
await Bun.write(join(ROOT, "seed/fixtures/images/coffee-2.png"), testImage(1));

// A grey wireframe of the settings screen: header, side tabs, three cards.
const W = 480, H = 360;
const mockup = encodePng(W, H, (x, y) => {
  const inside = (x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
  if (inside(0, 0, W, 40)) return [23, 23, 23];
  if (inside(16, 56, 120, 80) || inside(16, 88, 120, 112) || inside(16, 120, 120, 144)) return [212, 212, 212];
  if (inside(136, 56, 464, 160)) return [236, 236, 236];
  if (inside(136, 172, 464, 268)) return [236, 236, 236];
  if (inside(136, 280, 464, 344)) return [255, 228, 228];
  return [250, 250, 250];
});
await Bun.write(join(ROOT, "seed/fixtures/mockup.png"), mockup);
await Bun.write(join(ROOT, "fixtures/factory-demo/mockup.png"), mockup);
console.log("fixtures written");

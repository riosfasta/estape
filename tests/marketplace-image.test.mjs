import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../web/static/js/marketplace-image.js", import.meta.url), "utf8");
const { cropRectangle, imageFileError, MAX_MARKETPLACE_IMAGE_BYTES } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

test("crop stays inside the image for supported shapes, zoom and offsets", () => {
  for (const [width, height] of [[1600, 900], [900, 1600], [200, 200]]) {
    for (const aspect of [width / height, 1, 1.6, 0.75]) {
      for (const zoom of [1, 2, 3]) {
        for (const offset of [0, 50, 100]) {
          const crop = cropRectangle(width, height, aspect, zoom, offset, offset);
          assert.ok(crop.x >= 0 && crop.y >= 0);
          assert.ok(crop.x + crop.width <= width + 0.001 && crop.y + crop.height <= height + 0.001);
          assert.ok(Math.abs(crop.width / crop.height - aspect) < 0.001);
        }
      }
    }
  }
});
test("original proportions at default zoom keep every ID edge", () => {
  assert.deepEqual(cropRectangle(1500, 1000, 1.5, 1, 50, 50), { x: 0, y: 0, width: 1500, height: 1000 });
});
test("image inputs reject unsupported formats and anything above 500 KB", () => {
  for (const [name, type] of [["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.png", "image/png"], ["a.webp", "image/webp"]]) {
    assert.equal(imageFileError({ name, type, size: MAX_MARKETPLACE_IMAGE_BYTES }), "");
    assert.match(imageFileError({ name, type, size: MAX_MARKETPLACE_IMAGE_BYTES + 1 }), /500 KB/);
  }
  assert.match(imageFileError({ name: "a.svg", type: "image/svg+xml", size: 100 }), /JPG/);
});

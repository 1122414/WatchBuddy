import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  validateWatchPetBundle
} from "../../../scripts/validate-watch-pet-bundle.mjs";
import { WATCH_PET_ANIMATIONS } from "../src/index.js";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createBundle() {
  const root = mkdtempSync(join(tmpdir(), "watch-pet-bundle-"));
  const frameBytes = Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50
  ]);
  const assets = WATCH_PET_ANIMATIONS.map((animation, index) => {
    const id = `${animation.toLowerCase()}-0`;
    const path = `frames/${animation.toLowerCase()}/000.webp`;
    mkdirSync(join(root, "frames", animation.toLowerCase()), {
      recursive: true
    });
    writeFileSync(join(root, path), frameBytes);
    return {
      id,
      path,
      sha256: sha256(frameBytes),
      bytes: frameBytes.length
    };
  });
  const animations = Object.fromEntries(
    WATCH_PET_ANIMATIONS.map((animation, index) => [
      animation,
      {
        frames: [assets[index].id],
        durationsMs: [140],
        loop: animation === "idle"
      }
    ])
  );
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const manifest = {
    schemaVersion: 1,
    id: "bundle-test",
    displayName: "Bundle Test",
    description: "用于验证资源文件摘要的测试宠物。",
    renderer: "frame-sequence-v1",
    source: {
      format: "codex-pet-v2",
      spriteVersionNumber: 2,
      sourceUrl: "https://example.com/bundle-test",
      author: "WatchBuddy",
      license: {
        name: "Test Redistribution License",
        url: "https://example.com/license",
        redistributionAllowed: true
      },
      attribution: "WatchBuddy test fixture.",
      sha256: "a".repeat(64)
    },
    frame: {
      width: 128,
      height: 139,
      displayWidth: 176,
      displayHeight: 176
    },
    assets,
    animations,
    stateMap: {
      sleeping: "idle",
      idle: "idle",
      daydreaming: "waiting",
      watching: "review",
      curious: "jumping",
      concerned: "waiting",
      chatting: "waving",
      giving_space: "idle"
    },
    interactionMap: {
      tap: "jumping",
      message: "waving",
      loading: "running",
      failure: "failed"
    },
    fallbackFrame: assets[0].id,
    budget: {
      frameCount: assets.length,
      totalBytes,
      maxFrameBytes: frameBytes.length
    }
  };
  writeFileSync(
    join(root, "watch-pet.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return {
    assets,
    manifest,
    root
  };
}

test("资源包校验文件长度、摘要和魔数", (context) => {
  const bundle = createBundle();
  context.after(() => rmSync(bundle.root, { recursive: true, force: true }));

  const result = validateWatchPetBundle(bundle.root);

  assert.equal(result.assetCount, WATCH_PET_ANIMATIONS.length);
  assert.equal(result.totalBytes, bundle.manifest.budget.totalBytes);
});

test("资源被修改后拒绝加载", (context) => {
  const bundle = createBundle();
  context.after(() => rmSync(bundle.root, { recursive: true, force: true }));
  const firstPath = join(bundle.root, bundle.assets[0].path);
  const bytes = readFileSync(firstPath);
  writeFileSync(firstPath, Buffer.concat([bytes, Buffer.from([0])]));

  assert.throws(
    () => validateWatchPetBundle(bundle.root),
    /长度不匹配/
  );
});

test("扩展名与图片魔数不一致时拒绝加载", (context) => {
  const bundle = createBundle();
  context.after(() => rmSync(bundle.root, { recursive: true, force: true }));
  const first = bundle.assets[0];
  const filePath = join(bundle.root, first.path);
  const bytes = Buffer.from("not-webp");
  writeFileSync(filePath, bytes);
  first.bytes = bytes.length;
  first.sha256 = sha256(bytes);
  bundle.manifest.budget.totalBytes = bundle.manifest.assets.reduce(
    (sum, asset) => sum + asset.bytes,
    0
  );
  bundle.manifest.budget.maxFrameBytes = Math.max(
    ...bundle.manifest.assets.map((asset) => asset.bytes)
  );
  writeFileSync(
    join(bundle.root, "watch-pet.json"),
    `${JSON.stringify(bundle.manifest, null, 2)}\n`
  );

  assert.throws(
    () => validateWatchPetBundle(bundle.root),
    /魔数/
  );
});

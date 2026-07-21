import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { overlayLocalWatchPet } from "../local-watch-pet-overlay.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const TRACKED_BUNDLE = join(
  PROJECT_ROOT,
  "apps/watch-huawei/entry/src/main/js/MainAbility/common/pets/watchbuddy-sprout"
);
const TRACKED_IMAGES = join(
  PROJECT_ROOT,
  "apps/watch-huawei/entry/src/main/js/MainAbility/common/images/pets/watchbuddy-sprout"
);

function createLocalOnlyBundle(root) {
  const sourceManifest = JSON.parse(
    readFileSync(join(TRACKED_BUNDLE, "watch-pet.json"), "utf8")
  );
  const frameIds = new Set();
  for (const animation of Object.values(sourceManifest.animations)) {
    for (const frameId of animation.frames) {
      frameIds.add(frameId);
    }
  }
  const assets = sourceManifest.assets.filter((asset) => frameIds.has(asset.id));
  for (const asset of assets) {
    const destination = join(root, asset.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(
      join(TRACKED_IMAGES, asset.path.slice("frames/".length)),
      destination
    );
  }
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  sourceManifest.assets = assets;
  delete sourceManifest.lookDirections;
  sourceManifest.displayName = "Local Test Pet";
  sourceManifest.source = {
    format: "codex-pet-v1-local",
    sourceUrl: "local-only",
    license: {
      redistributionAllowed: false
    }
  };
  sourceManifest.budget = {
    frameCount: assets.length,
    maxFrameBytes: Math.max(...assets.map((asset) => asset.bytes)),
    totalBytes
  };
  writeFileSync(
    join(root, "watch-pet.json"),
    `${JSON.stringify(sourceManifest)}\n`,
    "utf8"
  );
  return sourceManifest;
}

test("本地 Codex Pet 只覆盖临时工程中的 57 个标准动画帧", () => {
  const temporary = mkdtempSync(join(tmpdir(), "watchbuddy-local-pet-"));
  try {
    const bundleRoot = join(temporary, "bundle");
    const projectRoot = join(temporary, "project");
    mkdirSync(bundleRoot, { recursive: true });
    const manifest = createLocalOnlyBundle(bundleRoot);

    const result = overlayLocalWatchPet(bundleRoot, projectRoot);

    assert.equal(result.displayName, "Local Test Pet");
    assert.equal(result.frameCount, 57);
    assert.equal(result.totalBytes, manifest.budget.totalBytes);
    assert.equal(
      readFileSync(join(result.targetRoot, "idle/000.png")).length,
      manifest.assets.find((asset) => asset.path === "frames/idle/000.png").bytes
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

test("本地覆盖拒绝允许再分发的错误来源标记", () => {
  const temporary = mkdtempSync(join(tmpdir(), "watchbuddy-local-pet-"));
  try {
    const bundleRoot = join(temporary, "bundle");
    mkdirSync(bundleRoot, { recursive: true });
    const manifest = createLocalOnlyBundle(bundleRoot);
    manifest.source.license.redistributionAllowed = true;
    writeFileSync(
      join(bundleRoot, "watch-pet.json"),
      `${JSON.stringify(manifest)}\n`,
      "utf8"
    );

    assert.throws(
      () => overlayLocalWatchPet(bundleRoot, join(temporary, "project")),
      /必须明确禁止再分发/
    );
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
});

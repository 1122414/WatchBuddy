import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertWatchPetManifest,
  validateWatchPetManifest,
  WATCH_PET_ANIMATIONS,
  WATCH_PET_LOOK_DIRECTIONS
} from "../src/index.js";

const HASH = "a".repeat(64);

test("JSON Schema 文件可解析且固定为第一版清单", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../watch-pet.schema.json", import.meta.url),
    "utf8"
  ));

  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(schema.properties.renderer.const, "frame-sequence-v1");
  assert.equal(schema.$defs.source.properties.spriteVersionNumber.const, 2);
});

function validManifest() {
  const assets = WATCH_PET_ANIMATIONS.map((animation, index) => ({
    id: `${animation.toLowerCase()}-0`,
    path: `frames/${animation.toLowerCase()}/000.webp`,
    sha256: HASH,
    bytes: 1000 + index
  }));
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

  return {
    schemaVersion: 1,
    id: "watchbuddy-sprout",
    displayName: "WatchBuddy Sprout",
    description: "WatchBuddy 的原创默认手表宠物。",
    renderer: "frame-sequence-v1",
    source: {
      format: "codex-pet-v2",
      spriteVersionNumber: 2,
      sourceUrl: "https://example.com/watchbuddy-sprout",
      author: "WatchBuddy",
      license: {
        name: "WatchBuddy Original Asset License",
        url: "https://example.com/watchbuddy-sprout/license",
        redistributionAllowed: true
      },
      attribution: "Created for WatchBuddy.",
      sha256: HASH
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
      maxFrameBytes: assets.at(-1).bytes
    }
  };
}

test("接受来源、授权、状态和预算完整的手表宠物清单", () => {
  const manifest = validManifest();

  assert.deepEqual(validateWatchPetManifest(manifest), []);
  assert.equal(assertWatchPetManifest(manifest), manifest);
});

test("拒绝旧版源格式、未知字段和远程资源路径", () => {
  const manifest = validManifest();
  manifest.source.spriteVersionNumber = 1;
  manifest.unknown = true;
  manifest.assets[0].path = "https://evil.example/pet.webp";

  const errors = validateWatchPetManifest(manifest).join(" ");

  assert.match(errors, /spriteVersionNumber/);
  assert.match(errors, /unknown/);
  assert.match(errors, /相对路径/);
});

test("拒绝路径穿越、重复资源和缺少资源引用", () => {
  const manifest = validManifest();
  manifest.assets[0].path = "frames/../secret.webp";
  manifest.assets[1].id = manifest.assets[0].id;
  manifest.animations.review.frames = ["missing-frame"];

  const errors = validateWatchPetManifest(manifest).join(" ");

  assert.match(errors, /path/);
  assert.match(errors, /id 不能重复/);
  assert.match(errors, /引用已声明资源/);
});

test("拒绝未知授权、含凭据 URL 和不允许再分发", () => {
  const manifest = validManifest();
  manifest.source.sourceUrl = "https://user:secret@example.com/pet";
  manifest.source.license.name = "unknown";
  manifest.source.license.redistributionAllowed = false;

  const errors = validateWatchPetManifest(manifest).join(" ");

  assert.match(errors, /不含凭据/);
  assert.match(errors, /未知或未授权/);
  assert.match(errors, /redistributionAllowed/);
});

test("拒绝时序错位、未知动画映射和伪造预算", () => {
  const manifest = validManifest();
  manifest.animations.idle.durationsMs = [100, 200];
  manifest.stateMap.curious = "lookAround";
  manifest.budget.totalBytes += 1;
  manifest.budget.maxFrameBytes += 1;

  const errors = validateWatchPetManifest(manifest).join(" ");

  assert.match(errors, /帧数和时序数/);
  assert.match(errors, /stateMap.curious/);
  assert.match(errors, /budget.totalBytes/);
  assert.match(errors, /budget.maxFrameBytes/);
});

test("注视方向必须一次提供完整的顺时针十六方向", () => {
  const incomplete = validManifest();
  incomplete.lookDirections = {
    "000": incomplete.assets[0].id
  };
  assert.match(
    validateWatchPetManifest(incomplete).join(" "),
    /lookDirections/
  );

  const complete = validManifest();
  complete.lookDirections = Object.fromEntries(
    WATCH_PET_LOOK_DIRECTIONS.map(
      (direction, index) => [
        direction,
        complete.assets[index % complete.assets.length].id
      ]
    )
  );
  assert.deepEqual(validateWatchPetManifest(complete), []);
});

test("assertWatchPetManifest 汇总拒绝原因", () => {
  const manifest = validManifest();
  manifest.source.sha256 = "not-a-hash";

  assert.throws(
    () => assertWatchPetManifest(manifest),
    /source\.sha256/
  );
});

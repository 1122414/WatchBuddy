import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectSdkHome } from "../check-watch-toolchain.mjs";


const COMPONENTS = ["toolchains", "ets", "js", "native", "previewer"];


test("识别 DevEco 内置 HarmonyOS hms SDK 组件目录", () => {
  const root = mkdtempSync(join(tmpdir(), "watchbuddy-sdk-"));
  try {
    const sdkHome = join(root, "default");
    for (const component of COMPONENTS) {
      mkdirSync(join(sdkHome, "hms", component), { recursive: true });
    }

    const result = inspectSdkHome([sdkHome]);

    assert.equal(result.home, sdkHome);
    assert.equal(result.componentHome, join(sdkHome, "hms"));
    assert.deepEqual(result.missingComponents, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("部分 SDK 精确报告缺失的 JavaScript 组件", () => {
  const root = mkdtempSync(join(tmpdir(), "watchbuddy-sdk-"));
  try {
    const sdkHome = join(root, "default");
    for (const component of COMPONENTS.filter((name) => name !== "js")) {
      mkdirSync(join(sdkHome, "hms", component), { recursive: true });
    }

    const result = inspectSdkHome([sdkHome]);

    assert.equal(result.home, sdkHome);
    assert.equal(result.componentHome, join(sdkHome, "hms"));
    assert.deepEqual(result.missingComponents, ["js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("HarmonyOS 工程不能把完整 OpenHarmony 目录当成 HMS SDK", () => {
  const root = mkdtempSync(join(tmpdir(), "watchbuddy-sdk-"));
  try {
    const sdkHome = join(root, "default");
    for (const component of COMPONENTS) {
      mkdirSync(
        join(sdkHome, "openharmony", component),
        { recursive: true }
      );
    }
    for (const component of COMPONENTS.filter((name) => name !== "js")) {
      mkdirSync(join(sdkHome, "hms", component), { recursive: true });
    }

    const result = inspectSdkHome([sdkHome]);

    assert.equal(result.componentHome, join(sdkHome, "hms"));
    assert.deepEqual(result.missingComponents, ["js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

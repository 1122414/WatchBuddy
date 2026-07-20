import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectSdkHome } from "../check-watch-toolchain.mjs";


const HMS_COMPONENTS = ["toolchains", "ets", "native", "previewer"];


test("识别 DevEco 预集成的智能穿戴 SDK 根目录", () => {
  const root = mkdtempSync(join(tmpdir(), "watchbuddy-sdk-"));
  try {
    for (const component of HMS_COMPONENTS) {
      mkdirSync(
        join(root, "default", "hms", component),
        { recursive: true }
      );
    }
    mkdirSync(join(root, "default", "openharmony", "js"), {
      recursive: true
    });
    mkdirSync(join(root, "default", "openharmony", "toolchains"), {
      recursive: true
    });

    const result = inspectSdkHome([root]);

    assert.equal(result.home, root);
    assert.equal(result.componentHome, join(root, "default"));
    assert.deepEqual(result.missingComponents, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("部分 SDK 精确报告缺失的 OpenHarmony JavaScript 组件", () => {
  const root = mkdtempSync(join(tmpdir(), "watchbuddy-sdk-"));
  try {
    for (const component of HMS_COMPONENTS) {
      mkdirSync(
        join(root, "default", "hms", component),
        { recursive: true }
      );
    }
    mkdirSync(join(root, "default", "openharmony", "toolchains"), {
      recursive: true
    });

    const result = inspectSdkHome([root]);

    assert.equal(result.home, root);
    assert.equal(result.componentHome, join(root, "default"));
    assert.deepEqual(result.missingComponents, ["default/openharmony/js"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test("兼容旧的 default SDK 环境变量路径并归一到 SDK 根目录", () => {
  const root = mkdtempSync(join(tmpdir(), "watchbuddy-sdk-"));
  try {
    for (const component of HMS_COMPONENTS) {
      mkdirSync(
        join(root, "default", "hms", component),
        { recursive: true }
      );
    }
    mkdirSync(join(root, "default", "openharmony", "js"), {
      recursive: true
    });
    mkdirSync(join(root, "default", "openharmony", "toolchains"), {
      recursive: true
    });

    const result = inspectSdkHome([join(root, "default")]);

    assert.equal(result.home, root);
    assert.equal(result.componentHome, join(root, "default"));
    assert.deepEqual(result.missingComponents, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

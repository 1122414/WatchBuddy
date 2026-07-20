import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonStateStore } from "../src/json-state-store.js";

function withTemporaryDirectory(run) {
  const directory = mkdtempSync(join(tmpdir(), "watchbuddy-state-"));
  try {
    return run(directory);
  } finally {
    rmSync(directory, {
      force: true,
      recursive: true
    });
  }
}

test("状态文件以 0600 权限原子保存并可重新读取", () => {
  withTemporaryDirectory((directory) => {
    const filePath = join(directory, "data", "state.json");
    const store = new JsonStateStore(filePath);
    const devices = [{
      deviceId: "gt6pro_test_01"
    }];

    store.save(devices);

    assert.deepEqual(store.load(), devices);
    assert.equal(lstatSync(filePath).mode & 0o777, 0o600);
    assert.deepEqual(
      JSON.parse(readFileSync(filePath, "utf8")),
      {
        schemaVersion: 1,
        devices
      }
    );
  });
});

test("状态存储拒绝损坏、过大和符号链接文件", () => {
  withTemporaryDirectory((directory) => {
    const invalidPath = join(directory, "invalid.json");
    writeFileSync(invalidPath, "{broken", {
      mode: 0o600
    });
    assert.throws(
      () => new JsonStateStore(invalidPath).load(),
      SyntaxError
    );

    const oversizedPath = join(directory, "oversized.json");
    writeFileSync(oversizedPath, "x".repeat(2 * 1024 * 1024 + 1), {
      mode: 0o600
    });
    assert.throws(
      () => new JsonStateStore(oversizedPath).load(),
      /大小无效/
    );

    const realPath = join(directory, "real.json");
    writeFileSync(realPath, JSON.stringify({
      schemaVersion: 1,
      devices: []
    }), {
      mode: 0o600
    });
    const linkPath = join(directory, "link.json");
    symlinkSync(realPath, linkPath);
    const linkedStore = new JsonStateStore(linkPath);
    assert.throws(() => linkedStore.load(), /普通文件/);
    assert.throws(() => linkedStore.save([]), /普通文件/);
  });
});

test("状态存储拒绝错误版本、目录和超量设备", () => {
  withTemporaryDirectory((directory) => {
    const versionPath = join(directory, "version.json");
    writeFileSync(versionPath, JSON.stringify({
      schemaVersion: 2,
      devices: []
    }), {
      mode: 0o600
    });
    assert.throws(
      () => new JsonStateStore(versionPath).load(),
      /结构无效/
    );

    const directoryPath = join(directory, "directory.json");
    mkdirSync(directoryPath);
    assert.throws(
      () => new JsonStateStore(directoryPath).load(),
      /普通文件/
    );
    assert.throws(
      () => new JsonStateStore(directoryPath).save([]),
      /普通文件/
    );

    assert.throws(
      () => new JsonStateStore(join(directory, "many.json"))
        .save(Array.from({ length: 513 }, () => ({}))),
      /设备状态集合无效/
    );
  });
});

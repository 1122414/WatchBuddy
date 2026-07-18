import {
  lstatSync,
  readFileSync,
  realpathSync
} from "node:fs";
import { createHash } from "node:crypto";
import {
  extname,
  isAbsolute,
  relative,
  resolve
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertWatchPetManifest
} from "../packages/watch-pet-format/src/index.js";

const MAX_MANIFEST_BYTES = 128 * 1024;

export function validateWatchPetBundle(bundleDirectory) {
  const root = realpathSync(bundleDirectory);
  const manifestPath = resolve(root, "watch-pet.json");
  rejectSymlink(manifestPath, "watch-pet.json");
  const manifestBytes = readFileSync(manifestPath);
  if (manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new RangeError(
      `watch-pet.json 不能超过 ${MAX_MANIFEST_BYTES} 字节`
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    throw new TypeError("watch-pet.json 不是有效 JSON");
  }
  assertWatchPetManifest(manifest);

  let totalBytes = 0;
  for (const asset of manifest.assets) {
    if (isAbsolute(asset.path)) {
      throw new TypeError(`资源路径不能是绝对路径: ${asset.path}`);
    }
    const assetPath = resolve(root, asset.path);
    const relativePath = relative(root, assetPath);
    if (!relativePath
      || relativePath.startsWith("..")
      || isAbsolute(relativePath)) {
      throw new TypeError(`资源路径越界: ${asset.path}`);
    }
    rejectSymlink(assetPath, asset.path);
    const bytes = readFileSync(assetPath);
    if (bytes.length !== asset.bytes) {
      throw new RangeError(`资源长度不匹配: ${asset.path}`);
    }
    if (sha256(bytes) !== asset.sha256) {
      throw new TypeError(`资源 SHA-256 不匹配: ${asset.path}`);
    }
    assertImageMagic(bytes, extname(asset.path).toLowerCase(), asset.path);
    totalBytes += bytes.length;
  }

  if (totalBytes !== manifest.budget.totalBytes) {
    throw new RangeError("资源总大小与 manifest 预算不一致");
  }

  return Object.freeze({
    assetCount: manifest.assets.length,
    manifest,
    manifestSha256: sha256(manifestBytes),
    totalBytes
  });
}

function rejectSymlink(filePath, label) {
  const status = lstatSync(filePath);
  if (!status.isFile()) {
    throw new TypeError(`只允许普通文件: ${label}`);
  }
  if (status.isSymbolicLink()) {
    throw new TypeError(`不允许符号链接: ${label}`);
  }
}

function assertImageMagic(bytes, extension, label) {
  const png = bytes.length >= 8
    && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  const webp = bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if ((extension === ".png" && !png)
    || (extension === ".webp" && !webp)) {
    throw new TypeError(`资源魔数与扩展名不匹配: ${label}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function main() {
  const bundleDirectory = process.argv[2];
  if (!bundleDirectory) {
    console.error(
      "用法: node scripts/validate-watch-pet-bundle.mjs <bundle-directory>"
    );
    process.exitCode = 2;
    return;
  }

  try {
    const result = validateWatchPetBundle(bundleDirectory);
    console.log(
      `✓ 手表宠物资源有效：${result.assetCount} 帧，`
      + `${result.totalBytes} 字节，manifest ${result.manifestSha256}`
    );
  } catch (error) {
    console.error(`✗ 手表宠物资源无效：${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

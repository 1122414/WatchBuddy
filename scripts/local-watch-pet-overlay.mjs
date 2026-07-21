import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";

const MANIFEST_LIMIT_BYTES = 256 * 1024;
const FRAME_LIMIT_BYTES = 7 * 1024;
const TOTAL_LIMIT_BYTES = 2 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PET_TARGET = join(
  "entry",
  "src",
  "main",
  "js",
  "MainAbility",
  "common",
  "images",
  "pets",
  "watchbuddy-sprout"
);

const STANDARD_ANIMATIONS = [
  ["idle", "idle", 6],
  ["runningRight", "running-right", 8],
  ["runningLeft", "running-left", 8],
  ["waving", "waving", 4],
  ["jumping", "jumping", 5],
  ["failed", "failed", 8],
  ["waiting", "waiting", 6],
  ["running", "running", 6],
  ["review", "review", 6]
];

function fail(message) {
  throw new Error(`本地 Codex Pet 无效：${message}`);
}

function regularFile(path, label) {
  if (!existsSync(path)) {
    fail(`${label} 不存在`);
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`${label} 必须是普通文件且不能是符号链接`);
  }
  return metadata;
}

function readManifest(bundleRoot) {
  const manifestPath = join(bundleRoot, "watch-pet.json");
  const metadata = regularFile(manifestPath, "watch-pet.json");
  if (metadata.size < 1 || metadata.size > MANIFEST_LIMIT_BYTES) {
    fail(`watch-pet.json 大小必须为 1 到 ${MANIFEST_LIMIT_BYTES} 字节`);
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail("watch-pet.json 不是有效 JSON");
  }
}

function validateLocalSource(manifest) {
  const source = manifest.source;
  if (!source || typeof source !== "object") {
    fail("缺少 source 元数据");
  }
  if (typeof source.format !== "string" || !source.format.endsWith("-local")) {
    fail("source.format 必须明确标记为 local");
  }
  if (source.sourceUrl !== "local-only") {
    fail("sourceUrl 必须为 local-only");
  }
  if (!source.license || source.license.redistributionAllowed !== false) {
    fail("本地资源必须明确禁止再分发");
  }
}

function validatePng(raw, manifest) {
  if (raw.length < 24 || !raw.subarray(0, 8).equals(PNG_MAGIC)) {
    fail("动画帧必须是 PNG");
  }
  const width = raw.readUInt32BE(16);
  const height = raw.readUInt32BE(20);
  if (width !== manifest.frame.width || height !== manifest.frame.height) {
    fail(`动画帧尺寸 ${width}x${height} 与清单不一致`);
  }
}

export function overlayLocalWatchPet(bundlePath, temporaryProjectRoot) {
  const bundleRoot = resolve(bundlePath);
  if (!existsSync(bundleRoot)) {
    fail(`目录不存在：${bundleRoot}`);
  }
  const rootMetadata = lstatSync(bundleRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail("资源根目录必须是普通目录且不能是符号链接");
  }
  const realRoot = realpathSync(bundleRoot);
  const manifest = readManifest(bundleRoot);
  validateLocalSource(manifest);

  if (!manifest.frame
    || !Number.isInteger(manifest.frame.width)
    || !Number.isInteger(manifest.frame.height)
    || manifest.frame.width < 32
    || manifest.frame.width > 192
    || manifest.frame.height < 32
    || manifest.frame.height > 208) {
    fail("frame 尺寸无效");
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 57) {
    fail("必须恰好包含 57 个标准动画帧");
  }

  const assets = new Map();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.id !== "string" || assets.has(asset.id)) {
      fail("asset id 缺失或重复");
    }
    assets.set(asset.id, asset);
  }

  const validatedFrames = [];
  let totalBytes = 0;
  for (const [animationName, directory, frameCount] of STANDARD_ANIMATIONS) {
    const animation = manifest.animations && manifest.animations[animationName];
    if (!animation
      || !Array.isArray(animation.frames)
      || animation.frames.length !== frameCount) {
      fail(`${animationName} 必须包含 ${frameCount} 帧`);
    }
    for (let index = 0; index < frameCount; index += 1) {
      const frameId = animation.frames[index];
      const asset = assets.get(frameId);
      const fileName = String(index).padStart(3, "0");
      const expectedPath = `frames/${directory}/${fileName}.png`;
      if (!asset || asset.path !== expectedPath) {
        fail(`${animationName} 第 ${index + 1} 帧路径必须为 ${expectedPath}`);
      }
      const sourcePath = join(bundleRoot, asset.path);
      const metadata = regularFile(sourcePath, asset.path);
      const realSource = realpathSync(sourcePath);
      if (!realSource.startsWith(`${realRoot}${sep}`)) {
        fail(`${asset.path} 不能离开资源根目录`);
      }
      if (metadata.size !== asset.bytes || metadata.size > FRAME_LIMIT_BYTES) {
        fail(`${asset.path} 大小与清单不符或超过 ${FRAME_LIMIT_BYTES} 字节`);
      }
      const raw = readFileSync(sourcePath);
      validatePng(raw, manifest);
      const hash = createHash("sha256").update(raw).digest("hex");
      if (hash !== asset.sha256) {
        fail(`${asset.path} SHA-256 与清单不一致`);
      }
      totalBytes += raw.length;
      validatedFrames.push({
        destination: join(directory, `${fileName}.png`),
        source: sourcePath
      });
    }
  }

  if (validatedFrames.length !== assets.size) {
    fail("清单包含未使用的额外动画帧");
  }
  if (!manifest.budget
    || totalBytes !== manifest.budget.totalBytes
    || totalBytes > TOTAL_LIMIT_BYTES) {
    fail("资源总大小与清单不符或超过 2 MiB");
  }

  const targetRoot = join(temporaryProjectRoot, PET_TARGET);
  rmSync(targetRoot, { force: true, recursive: true });
  for (const frame of validatedFrames) {
    const destination = join(targetRoot, frame.destination);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(frame.source, destination);
  }

  return {
    displayName: manifest.displayName,
    frameCount: validatedFrames.length,
    targetRoot,
    totalBytes
  };
}

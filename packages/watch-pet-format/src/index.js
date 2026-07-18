export const WATCH_PET_SCHEMA_VERSION = 1;
export const WATCH_PET_RENDERER = "frame-sequence-v1";
export const MAX_WATCH_PET_ASSETS = 88;
export const MAX_WATCH_PET_FRAME_BYTES = 64 * 1024;
export const MAX_WATCH_PET_TOTAL_BYTES = 2 * 1024 * 1024;

export const WATCH_PET_ANIMATIONS = Object.freeze([
  "idle",
  "runningRight",
  "runningLeft",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review"
]);

export const WATCH_PET_STATES = Object.freeze([
  "sleeping",
  "idle",
  "daydreaming",
  "watching",
  "curious",
  "concerned",
  "chatting",
  "giving_space"
]);

export const WATCH_PET_INTERACTIONS = Object.freeze([
  "tap",
  "message",
  "loading",
  "failure"
]);

export const WATCH_PET_LOOK_DIRECTIONS = Object.freeze([
  "000",
  "022.5",
  "045",
  "067.5",
  "090",
  "112.5",
  "135",
  "157.5",
  "180",
  "202.5",
  "225",
  "247.5",
  "270",
  "292.5",
  "315",
  "337.5"
]);

const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "id",
  "displayName",
  "description",
  "renderer",
  "source",
  "frame",
  "assets",
  "animations",
  "lookDirections",
  "stateMap",
  "interactionMap",
  "fallbackFrame",
  "budget"
]);
const SOURCE_KEYS = Object.freeze([
  "format",
  "spriteVersionNumber",
  "sourceUrl",
  "author",
  "license",
  "attribution",
  "sha256"
]);
const LICENSE_KEYS = Object.freeze([
  "name",
  "spdxId",
  "url",
  "redistributionAllowed"
]);
const FRAME_KEYS = Object.freeze([
  "width",
  "height",
  "displayWidth",
  "displayHeight"
]);
const ASSET_KEYS = Object.freeze(["id", "path", "sha256", "bytes"]);
const ANIMATION_KEYS = Object.freeze(["frames", "durationsMs", "loop"]);
const BUDGET_KEYS = Object.freeze([
  "frameCount",
  "totalBytes",
  "maxFrameBytes"
]);
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ASSET_PATH_PATTERN =
  /^(frames|assets)\/[a-z0-9][a-z0-9/_-]*\.(png|webp)$/;
const UNKNOWN_LICENSES = new Set([
  "none",
  "unknown",
  "unlicensed",
  "unspecified"
]);

export function validateWatchPetManifest(manifest) {
  const errors = [];

  if (!isPlainObject(manifest)) {
    return ["manifest 必须是普通对象"];
  }

  checkExactKeys(manifest, TOP_LEVEL_KEYS, "manifest", errors, [
    "lookDirections"
  ]);
  checkValue(
    manifest.schemaVersion === WATCH_PET_SCHEMA_VERSION,
    "schemaVersion 必须为 1",
    errors
  );
  checkValue(
    typeof manifest.id === "string" && PET_ID_PATTERN.test(manifest.id),
    "id 必须是 1 到 48 位小写字母、数字或连字符",
    errors
  );
  checkText(manifest.displayName, 1, 32, "displayName", errors);
  checkText(manifest.description, 1, 160, "description", errors);
  checkValue(
    manifest.renderer === WATCH_PET_RENDERER,
    `renderer 必须为 ${WATCH_PET_RENDERER}`,
    errors
  );

  validateSource(manifest.source, errors);
  validateFrame(manifest.frame, errors);
  const assets = validateAssets(manifest.assets, errors);
  const assetIds = new Set(assets.map((asset) => asset.id));
  validateAnimations(manifest.animations, assetIds, errors);
  validateLookDirections(manifest.lookDirections, assetIds, errors);
  validateMap(
    manifest.stateMap,
    WATCH_PET_STATES,
    "stateMap",
    errors
  );
  validateMap(
    manifest.interactionMap,
    WATCH_PET_INTERACTIONS,
    "interactionMap",
    errors
  );
  checkValue(
    typeof manifest.fallbackFrame === "string"
      && assetIds.has(manifest.fallbackFrame),
    "fallbackFrame 必须引用已声明资源",
    errors
  );
  validateBudget(manifest.budget, assets, errors);

  return errors;
}

export function assertWatchPetManifest(manifest) {
  const errors = validateWatchPetManifest(manifest);
  if (errors.length > 0) {
    throw new TypeError(errors.join("; "));
  }
  return manifest;
}

function validateSource(source, errors) {
  if (!isPlainObject(source)) {
    errors.push("source 必须是普通对象");
    return;
  }
  checkExactKeys(source, SOURCE_KEYS, "source", errors);
  checkValue(
    source.format === "codex-pet-v2",
    "source.format 必须为 codex-pet-v2",
    errors
  );
  checkValue(
    source.spriteVersionNumber === 2,
    "source.spriteVersionNumber 必须为 2",
    errors
  );
  checkHttpsUrl(source.sourceUrl, "source.sourceUrl", errors);
  checkText(source.author, 1, 80, "source.author", errors);
  checkText(source.attribution, 1, 240, "source.attribution", errors);
  checkValue(
    typeof source.sha256 === "string"
      && SHA256_PATTERN.test(source.sha256),
    "source.sha256 必须是小写 SHA-256",
    errors
  );
  validateLicense(source.license, errors);
}

function validateLicense(license, errors) {
  if (!isPlainObject(license)) {
    errors.push("source.license 必须是普通对象");
    return;
  }
  checkExactKeys(license, LICENSE_KEYS, "source.license", errors, ["spdxId"]);
  checkText(license.name, 1, 64, "source.license.name", errors);
  if (typeof license.name === "string"
    && UNKNOWN_LICENSES.has(license.name.trim().toLowerCase())) {
    errors.push("source.license.name 不能是未知或未授权");
  }
  if (license.spdxId !== undefined) {
    checkText(license.spdxId, 1, 64, "source.license.spdxId", errors);
  }
  checkHttpsUrl(license.url, "source.license.url", errors);
  checkValue(
    license.redistributionAllowed === true,
    "source.license.redistributionAllowed 必须明确为 true",
    errors
  );
}

function validateFrame(frame, errors) {
  if (!isPlainObject(frame)) {
    errors.push("frame 必须是普通对象");
    return;
  }
  checkExactKeys(frame, FRAME_KEYS, "frame", errors);
  checkIntegerRange(frame.width, 32, 192, "frame.width", errors);
  checkIntegerRange(frame.height, 32, 208, "frame.height", errors);
  checkIntegerRange(
    frame.displayWidth,
    64,
    200,
    "frame.displayWidth",
    errors
  );
  checkIntegerRange(
    frame.displayHeight,
    64,
    200,
    "frame.displayHeight",
    errors
  );
}

function validateAssets(value, errors) {
  if (!Array.isArray(value)
    || value.length < WATCH_PET_ANIMATIONS.length
    || value.length > MAX_WATCH_PET_ASSETS) {
    errors.push(
      `assets 数量必须为 ${WATCH_PET_ANIMATIONS.length} 到 `
      + `${MAX_WATCH_PET_ASSETS}`
    );
    return [];
  }

  const ids = new Set();
  const paths = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const asset = value[index];
    const label = `assets[${index}]`;
    if (!isPlainObject(asset)) {
      errors.push(`${label} 必须是普通对象`);
      continue;
    }
    checkExactKeys(asset, ASSET_KEYS, label, errors);
    checkValue(
      typeof asset.id === "string" && IDENTIFIER_PATTERN.test(asset.id),
      `${label}.id 无效`,
      errors
    );
    checkValue(
      typeof asset.path === "string"
        && asset.path.length <= 160
        && ASSET_PATH_PATTERN.test(asset.path)
        && !asset.path.includes("//"),
      `${label}.path 必须是 frames/ 或 assets/ 下的 PNG/WebP 相对路径`,
      errors
    );
    checkValue(
      typeof asset.sha256 === "string"
        && SHA256_PATTERN.test(asset.sha256),
      `${label}.sha256 必须是小写 SHA-256`,
      errors
    );
    checkIntegerRange(
      asset.bytes,
      1,
      MAX_WATCH_PET_FRAME_BYTES,
      `${label}.bytes`,
      errors
    );
    if (typeof asset.id === "string") {
      if (ids.has(asset.id)) {
        errors.push(`${label}.id 不能重复`);
      }
      ids.add(asset.id);
    }
    if (typeof asset.path === "string") {
      if (paths.has(asset.path)) {
        errors.push(`${label}.path 不能重复`);
      }
      paths.add(asset.path);
    }
  }
  return value.filter(isPlainObject);
}

function validateAnimations(animations, assetIds, errors) {
  if (!isPlainObject(animations)) {
    errors.push("animations 必须是普通对象");
    return;
  }
  checkExactKeys(animations, WATCH_PET_ANIMATIONS, "animations", errors);

  for (const name of WATCH_PET_ANIMATIONS) {
    const animation = animations[name];
    if (!isPlainObject(animation)) {
      errors.push(`animations.${name} 必须是普通对象`);
      continue;
    }
    checkExactKeys(animation, ANIMATION_KEYS, `animations.${name}`, errors);
    const frames = animation.frames;
    const durations = animation.durationsMs;
    if (!Array.isArray(frames) || frames.length < 1 || frames.length > 8) {
      errors.push(`animations.${name}.frames 数量必须为 1 到 8`);
    } else {
      for (const frameId of frames) {
        if (typeof frameId !== "string" || !assetIds.has(frameId)) {
          errors.push(`animations.${name}.frames 必须引用已声明资源`);
        }
      }
    }
    if (!Array.isArray(durations)
      || durations.length < 1
      || durations.length > 8
      || durations.some(
        (duration) => !Number.isInteger(duration)
          || duration < 40
          || duration > 2000
      )) {
      errors.push(`animations.${name}.durationsMs 必须是 40 到 2000 毫秒数组`);
    }
    if (Array.isArray(frames)
      && Array.isArray(durations)
      && frames.length !== durations.length) {
      errors.push(`animations.${name} 的帧数和时序数必须一致`);
    }
    if (typeof animation.loop !== "boolean") {
      errors.push(`animations.${name}.loop 必须是布尔值`);
    }
  }
}

function validateLookDirections(lookDirections, assetIds, errors) {
  if (lookDirections === undefined) {
    return;
  }
  if (!isPlainObject(lookDirections)) {
    errors.push("lookDirections 必须是普通对象");
    return;
  }
  checkExactKeys(
    lookDirections,
    WATCH_PET_LOOK_DIRECTIONS,
    "lookDirections",
    errors
  );
  for (const direction of WATCH_PET_LOOK_DIRECTIONS) {
    if (typeof lookDirections[direction] !== "string"
      || !assetIds.has(lookDirections[direction])) {
      errors.push(`lookDirections.${direction} 必须引用已声明资源`);
    }
  }
}

function validateMap(value, expectedKeys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} 必须是普通对象`);
    return;
  }
  checkExactKeys(value, expectedKeys, label, errors);
  for (const key of expectedKeys) {
    if (!WATCH_PET_ANIMATIONS.includes(value[key])) {
      errors.push(`${label}.${key} 必须引用标准动画`);
    }
  }
}

function validateBudget(budget, assets, errors) {
  if (!isPlainObject(budget)) {
    errors.push("budget 必须是普通对象");
    return;
  }
  checkExactKeys(budget, BUDGET_KEYS, "budget", errors);
  const totalBytes = assets.reduce(
    (sum, asset) => sum + (Number.isInteger(asset.bytes) ? asset.bytes : 0),
    0
  );
  const maxFrameBytes = assets.reduce(
    (maximum, asset) => Math.max(
      maximum,
      Number.isInteger(asset.bytes) ? asset.bytes : 0
    ),
    0
  );
  checkValue(
    budget.frameCount === assets.length,
    "budget.frameCount 必须等于 assets 数量",
    errors
  );
  checkValue(
    budget.totalBytes === totalBytes
      && totalBytes <= MAX_WATCH_PET_TOTAL_BYTES,
    `budget.totalBytes 必须等于资源总大小且不超过 `
      + `${MAX_WATCH_PET_TOTAL_BYTES}`,
    errors
  );
  checkValue(
    budget.maxFrameBytes === maxFrameBytes
      && maxFrameBytes <= MAX_WATCH_PET_FRAME_BYTES,
    `budget.maxFrameBytes 必须等于最大资源大小且不超过 `
      + `${MAX_WATCH_PET_FRAME_BYTES}`,
    errors
  );
}

function checkExactKeys(value, expected, label, errors, optional = []) {
  const expectedSet = new Set(expected);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) {
      errors.push(`${label} 不允许字段 ${key}`);
    }
  }
  for (const key of expected) {
    if (!optionalSet.has(key)
      && !Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${label} 缺少字段 ${key}`);
    }
  }
}

function checkText(value, minimum, maximum, label, errors) {
  const length = typeof value === "string" ? [...value.trim()].length : 0;
  checkValue(
    length >= minimum && length <= maximum,
    `${label} 长度必须为 ${minimum} 到 ${maximum} 个字符`,
    errors
  );
}

function checkHttpsUrl(value, label, errors) {
  let valid = false;
  if (typeof value === "string" && value.length <= 512) {
    try {
      const parsed = new URL(value);
      valid = parsed.protocol === "https:"
        && Boolean(parsed.hostname)
        && !parsed.username
        && !parsed.password;
    } catch (error) {
      valid = false;
    }
  }
  checkValue(valid, `${label} 必须是不含凭据的 HTTPS URL`, errors);
}

function checkIntegerRange(value, minimum, maximum, label, errors) {
  checkValue(
    Number.isInteger(value) && value >= minimum && value <= maximum,
    `${label} 必须是 ${minimum} 到 ${maximum} 的整数`,
    errors
  );
}

function checkValue(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

import { createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync
} from "node:fs";
import {
  extname,
  resolve
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateWatchPetBundle
} from "../../../scripts/validate-watch-pet-bundle.mjs";

const DEFAULT_BUNDLE_DIRECTORIES = Object.freeze([
  fileURLToPath(
    new URL(
      "../../../assets/pets/watchbuddy-sprout/watch-lite/",
      import.meta.url
    )
  )
]);
const MAX_CATALOG_PETS = 16;
const MAX_CATALOG_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_DISTRIBUTED_ASSET_BYTES = 7 * 1024;
const MAX_JSON_RESPONSE_BYTES = 7 * 1024;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mediaTypeForPath(path) {
  const extension = extname(path).toLowerCase();
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".png") {
    return "image/png";
  }
  throw new TypeError(`不支持的宠物资源格式: ${path}`);
}

function assetUrl(petId, assetId) {
  return `/v1/pets/${petId}/assets/${assetId}`;
}

function base64AssetUrl(petId, assetId) {
  return `${assetUrl(petId, assetId)}?encoding=base64`;
}

function metadataUrl(petId) {
  return `/v1/pets/${petId}`;
}

function assetsUrl(petId) {
  return `/v1/pets/${petId}/assets`;
}

function createVersion(manifestSha256) {
  return `sha256-${manifestSha256.slice(0, 16)}`;
}

function createBase64Payload(asset) {
  return {
    catalogSchemaVersion: 1,
    asset: {
      bytes: asset.length,
      data: asset.bytes.toString("base64"),
      encoding: "base64",
      id: asset.id,
      mediaType: asset.contentType,
      sha256: asset.sha256
    }
  };
}

function createRecord(bundleDirectory) {
  const validated = validateWatchPetBundle(bundleDirectory);
  const root = realpathSync(bundleDirectory);
  const {
    manifest,
    manifestSha256
  } = validated;
  const assetsById = new Map();

  for (const asset of manifest.assets) {
    if (asset.bytes > MAX_DISTRIBUTED_ASSET_BYTES) {
      throw new RangeError(
        `目录单资源不能超过 ${MAX_DISTRIBUTED_ASSET_BYTES} 字节: ${asset.path}`
      );
    }
    const bytes = readFileSync(resolve(root, asset.path));
    if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
      throw new TypeError(`宠物资源在加载期间发生变化: ${asset.path}`);
    }
    const loaded = Object.freeze({
      bytes,
      contentType: mediaTypeForPath(asset.path),
      id: asset.id,
      length: asset.bytes,
      sha256: asset.sha256
    });
    if (loaded.contentType !== "image/png") {
      throw new TypeError(`Lite Wearable 同步资源必须是 PNG: ${asset.path}`);
    }
    if (
      Buffer.byteLength(JSON.stringify(createBase64Payload(loaded)))
      > MAX_JSON_RESPONSE_BYTES
    ) {
      throw new RangeError(
        `Base64 宠物资源响应不能超过 ${MAX_JSON_RESPONSE_BYTES} 字节: `
        + asset.path
      );
    }
    assetsById.set(asset.id, loaded);
  }

  const fallback = assetsById.get(manifest.fallbackFrame);
  const version = createVersion(manifestSha256);
  const summary = Object.freeze({
    assetCount: manifest.assets.length,
    assetsUrl: assetsUrl(manifest.id),
    budget: manifest.budget,
    description: manifest.description,
    displayName: manifest.displayName,
    frame: manifest.frame,
    id: manifest.id,
    manifestSha256,
    metadataUrl: metadataUrl(manifest.id),
    preview: Object.freeze({
      assetId: fallback.id,
      base64Url: base64AssetUrl(manifest.id, fallback.id),
      bytes: fallback.length,
      mediaType: fallback.contentType,
      sha256: fallback.sha256,
      url: assetUrl(manifest.id, fallback.id)
    }),
    renderer: manifest.renderer,
    version
  });
  const detail = Object.freeze({
    ...summary,
    animations: manifest.animations,
    fallbackFrame: manifest.fallbackFrame,
    interactionMap: manifest.interactionMap,
    lookDirections: manifest.lookDirections ?? {},
    source: manifest.source,
    stateMap: manifest.stateMap
  });
  const assets = manifest.assets.map((asset) => {
    const loaded = assetsById.get(asset.id);
    return Object.freeze({
      base64Url: base64AssetUrl(manifest.id, asset.id),
      bytes: asset.bytes,
      id: asset.id,
      mediaType: loaded.contentType,
      sha256: asset.sha256,
      url: assetUrl(manifest.id, asset.id)
    });
  });

  return Object.freeze({
    assets: Object.freeze(assets),
    assetsById,
    detail,
    id: manifest.id,
    summary
  });
}

export class PetCatalog {
  #records = new Map();

  constructor({
    bundleDirectories = DEFAULT_BUNDLE_DIRECTORIES
  } = {}) {
    if (!Array.isArray(bundleDirectories) || bundleDirectories.length < 1) {
      throw new TypeError("至少需要一个受控宠物资源目录");
    }
    if (bundleDirectories.length > MAX_CATALOG_PETS) {
      throw new RangeError(`受控宠物目录不能超过 ${MAX_CATALOG_PETS} 个`);
    }

    let totalBytes = 0;
    for (const bundleDirectory of bundleDirectories) {
      const record = createRecord(bundleDirectory);
      if (this.#records.has(record.id)) {
        throw new TypeError(`宠物 ID 重复: ${record.id}`);
      }
      totalBytes += record.summary.budget.totalBytes;
      if (totalBytes > MAX_CATALOG_TOTAL_BYTES) {
        throw new RangeError(
          `受控宠物资源总量不能超过 ${MAX_CATALOG_TOTAL_BYTES} 字节`
        );
      }
      this.#records.set(record.id, record);
    }
  }

  getAsset(petId, assetId) {
    const asset = this.#records.get(petId)?.assetsById.get(assetId);
    if (!asset) {
      return null;
    }
    return {
      ...asset,
      bytes: Buffer.from(asset.bytes)
    };
  }

  getBase64Asset(petId, assetId) {
    const asset = this.#records.get(petId)?.assetsById.get(assetId);
    if (!asset) {
      return null;
    }
    return createBase64Payload(asset);
  }

  getPet(petId) {
    return this.#records.get(petId)?.detail ?? null;
  }

  listAssets(petId, {
    limit,
    offset
  }) {
    const record = this.#records.get(petId);
    if (!record) {
      return null;
    }
    const assets = record.assets.slice(offset, offset + limit);
    return {
      assets,
      hasMore: offset + assets.length < record.assets.length,
      nextOffset: offset + assets.length,
      petId,
      total: record.assets.length,
      version: record.summary.version
    };
  }

  listPets() {
    return [...this.#records.values()].map((record) => record.summary);
  }
}

export const defaultPetCatalog = new PetCatalog();

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  defaultPetCatalog
} from "../src/pet-catalog.js";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("默认目录只公开经过校验的 Sprout 宠物", () => {
  const pets = defaultPetCatalog.listPets();

  assert.equal(pets.length, 1);
  assert.equal(pets[0].id, "watchbuddy-sprout");
  assert.match(pets[0].version, /^sha256-[a-f0-9]{16}$/);
  assert.match(pets[0].manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(pets[0].budget.totalBytes, 237_839);
  assert.equal(pets[0].assetCount, 73);
  assert.equal(pets[0].preview.assetId, "idle-0");
});

test("目录版本固定到仓库清单 SHA-256", () => {
  const manifestBytes = readFileSync(
    new URL(
      "../../../assets/pets/watchbuddy-sprout/watch-lite/watch-pet.json",
      import.meta.url
    )
  );
  const pet = defaultPetCatalog.listPets()[0];

  assert.equal(pet.manifestSha256, sha256(manifestBytes));
  assert.equal(
    pet.version,
    `sha256-${pet.manifestSha256.slice(0, 16)}`
  );
});

test("资源摘要可分页且下载内容与摘要一致", () => {
  const first = defaultPetCatalog.listAssets("watchbuddy-sprout", {
    limit: 20,
    offset: 0
  });
  const last = defaultPetCatalog.listAssets("watchbuddy-sprout", {
    limit: 20,
    offset: 60
  });

  assert.equal(first.assets.length, 20);
  assert.equal(first.assets.every((asset) => asset.bytes < 7 * 1024), true);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 20);
  assert.equal(last.assets.length, 13);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, 73);

  const descriptor = first.assets[0];
  const asset = defaultPetCatalog.getAsset(
    "watchbuddy-sprout",
    descriptor.id
  );
  assert.equal(asset.contentType, "image/png");
  assert.equal(asset.length, descriptor.bytes);
  assert.equal(sha256(asset.bytes), descriptor.sha256);

  asset.bytes.fill(0);
  assert.equal(
    sha256(
      defaultPetCatalog.getAsset("watchbuddy-sprout", descriptor.id).bytes
    ),
    descriptor.sha256
  );

  const encoded = defaultPetCatalog.getBase64Asset(
    "watchbuddy-sprout",
    descriptor.id
  );
  assert.equal(encoded.asset.encoding, "base64");
  assert.equal(encoded.asset.mediaType, "image/png");
  assert.equal(Buffer.byteLength(JSON.stringify(encoded)) < 7 * 1024, true);
  assert.equal(
    sha256(Buffer.from(encoded.asset.data, "base64")),
    descriptor.sha256
  );
});

test("不存在的宠物和资源不会回退到任意文件路径", () => {
  assert.equal(defaultPetCatalog.getPet("missing"), null);
  assert.equal(
    defaultPetCatalog.listAssets("missing", { limit: 1, offset: 0 }),
    null
  );
  assert.equal(
    defaultPetCatalog.getAsset("watchbuddy-sprout", "../watch-pet.json"),
    null
  );
  assert.equal(
    defaultPetCatalog.getBase64Asset(
      "watchbuddy-sprout",
      "../watch-pet.json"
    ),
    null
  );
});

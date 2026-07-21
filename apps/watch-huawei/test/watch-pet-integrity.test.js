import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  decodeBase64,
  petAssetUri,
  petManifestUri,
  sha256Hex,
  verifyDownloadedPetAsset
} from '../entry/src/main/js/MainAbility/common/watch-pet-integrity.js';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const BUNDLE_ROOT = path.join(
  REPOSITORY_ROOT,
  'assets/pets/watchbuddy-sprout/watch-lite'
);

test('纯 JavaScript SHA-256 与 Base64 解码符合标准向量', () => {
  assert.equal(
    sha256Hex(new Uint8Array()),
    'e3b0c44298fc1c149afbf4c8996fb924'
      + '27ae41e4649b934ca495991b7852b855'
  );
  assert.equal(
    sha256Hex(new Uint8Array([97, 98, 99])),
    'ba7816bf8f01cfea414140de5dae2223'
      + 'b00361a396177a9cb410ff61f20015ad'
  );
  assert.deepEqual(
    [...decodeBase64('V2F0Y2hCdWRkeQ==')],
    [...new TextEncoder().encode('WatchBuddy')]
  );
  assert.throws(() => decodeBase64('A==='), /Base64/);
  assert.throws(() => decodeBase64('AA=A'), /Base64/);
  assert.throws(() => decodeBase64('AA?='), /Base64/);
});

test('真实轻量 PNG 下载后校验长度、魔数和 SHA-256', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(BUNDLE_ROOT, 'watch-pet.json'), 'utf8')
  );
  const descriptor = {
    ...manifest.assets[0],
    mediaType: 'image/png'
  };
  const bytes = await readFile(path.join(BUNDLE_ROOT, descriptor.path));
  const verified = verifyDownloadedPetAsset({
    bytes: descriptor.bytes,
    data: bytes.toString('base64'),
    encoding: 'base64',
    id: descriptor.id,
    mediaType: descriptor.mediaType,
    sha256: descriptor.sha256
  }, descriptor);

  assert.equal(verified.length, descriptor.bytes);
  assert.equal(sha256Hex(verified), descriptor.sha256);
  assert.throws(() => verifyDownloadedPetAsset({
    bytes: descriptor.bytes,
    data: Buffer.from('not a png').toString('base64'),
    encoding: 'base64',
    id: descriptor.id,
    mediaType: descriptor.mediaType,
    sha256: descriptor.sha256
  }, descriptor), /(长度|PNG|SHA-256)/);
});

test('版本化私有文件 URI 可预测且不超过 128 字符', () => {
  const version = 'sha256-0123456789abcdef';
  const assetId = `a${'b'.repeat(63)}`;
  const finalUri = petAssetUri(version, assetId);
  const tempUri = petAssetUri(version, assetId, true);

  assert.equal(finalUri.startsWith('internal://app/wbp-'), true);
  assert.equal(tempUri.startsWith('internal://app/wbt-'), true);
  assert.equal(finalUri.length <= 128, true);
  assert.equal(
    petManifestUri(version),
    'internal://app/wbm-0123456789abcdef.json'
  );
  assert.throws(
    () => petAssetUri(version, '../idle-0'),
    /ID/
  );
});

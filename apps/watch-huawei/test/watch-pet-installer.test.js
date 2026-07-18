import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  installPetBundle,
  loadInstalledPet,
  MAX_PET_DOWNLOAD_ATTEMPTS
} from '../entry/src/main/js/MainAbility/common/watch-pet-installer.js';
import {
  petUrisForCleanup
} from '../entry/src/main/js/MainAbility/common/watch-pet-install-plan.js';
import {
  defaultPetCatalog
} from '../../watchbuddy-api/src/pet-catalog.js';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const BUNDLE_ROOT = path.join(
  REPOSITORY_ROOT,
  'assets/pets/watchbuddy-sprout/watch-lite'
);

async function fixture() {
  const pet = defaultPetCatalog.getPet('watchbuddy-sprout');
  const descriptors = defaultPetCatalog.listAssets(pet.id, {
    limit: 88,
    offset: 0
  }).assets;
  const manifest = JSON.parse(
    await readFile(path.join(BUNDLE_ROOT, 'watch-pet.json'), 'utf8')
  );
  const pathById = Object.fromEntries(
    manifest.assets.map((asset) => [asset.id, asset.path])
  );
  const bytesById = Object.create(null);
  for (const descriptor of descriptors) {
    bytesById[descriptor.id] = await readFile(
      path.join(BUNDLE_ROOT, pathById[descriptor.id])
    );
  }
  return {
    bytesById,
    descriptors,
    pet
  };
}

function createTransport(data, corruptAssetId) {
  return {
    fetchAsset(pet, descriptor, onSuccess) {
      let bytes = data.bytesById[descriptor.id];
      if (descriptor.id === corruptAssetId) {
        bytes = Buffer.from(bytes);
        bytes[bytes.length - 1] ^= 0xff;
      }
      onSuccess({
        bytes: descriptor.bytes,
        data: bytes.toString('base64'),
        encoding: 'base64',
        id: descriptor.id,
        mediaType: descriptor.mediaType,
        sha256: descriptor.sha256
      });
      return { cancel() {} };
    },
    listAssets(pet, limit, offset, onSuccess) {
      const assets = data.descriptors.slice(offset, offset + limit);
      onSuccess({
        assets,
        hasMore: offset + assets.length < data.descriptors.length,
        nextOffset: offset + assets.length,
        petId: pet.id,
        total: data.descriptors.length,
        version: pet.version
      });
      return { cancel() {} };
    }
  };
}

function createFiles() {
  const values = new Map();
  return {
    values,
    move(sourceUri, destinationUri, onSuccess, onFailure) {
      if (!values.has(sourceUri)) {
        onFailure('missing', 1);
        return;
      }
      values.set(destinationUri, values.get(sourceUri));
      values.delete(sourceUri);
      onSuccess(destinationUri);
    },
    readBuffer(uri, onSuccess, onFailure) {
      const value = values.get(uri);
      if (!(value instanceof Uint8Array)) {
        onFailure('missing', 1);
        return;
      }
      onSuccess(new Uint8Array(value));
    },
    readText(uri, onSuccess, onFailure) {
      const value = values.get(uri);
      if (typeof value !== 'string') {
        onFailure('missing', 1);
        return;
      }
      onSuccess(value);
    },
    remove(uri, onComplete) {
      onComplete(values.delete(uri));
    },
    writeBuffer(uri, bytes, onSuccess) {
      values.set(uri, new Uint8Array(bytes));
      onSuccess();
    },
    writeText(uri, value, onSuccess) {
      values.set(uri, value);
      onSuccess();
    }
  };
}

function previousPet(pet) {
  return {
    ...pet,
    manifestSha256: '0'.repeat(64),
    version: 'sha256-0000000000000000'
  };
}

test('73 帧全部写入并回读校验后才原子提交选择指针', async () => {
  const data = await fixture();
  const files = createFiles();
  const progress = [];
  let selection = null;
  let installed = null;

  installPetBundle({
    commit(next, onSuccess) {
      assert.equal(progress.at(-1), 73);
      selection = next;
      onSuccess();
    },
    files,
    onFailure(reason) {
      assert.fail(reason);
    },
    onProgress(completed) {
      progress.push(completed);
    },
    onSuccess(result) {
      installed = result.pet;
    },
    pet: data.pet,
    transport: createTransport(data)
  });

  assert.deepEqual(selection, {
    petId: data.pet.id,
    version: data.pet.version
  });
  assert.equal(installed.version, data.pet.version);
  assert.equal(files.values.size, 74);
  assert.equal(
    [...files.values.keys()].some((uri) => uri.includes('/wbt')),
    false
  );

  let restored = null;
  loadInstalledPet(selection, files, {
    onFailure(reason) {
      assert.fail(reason);
    },
    onSuccess(pet) {
      restored = pet;
    }
  });
  assert.equal(restored.version, data.pet.version);
});

test('下载内容被篡改时删除新版本并保留旧版本', async () => {
  const data = await fixture();
  const files = createFiles();
  const previous = previousPet(data.pet);
  const previousUris = petUrisForCleanup(previous);
  previousUris.forEach((uri) => files.values.set(uri, 'old-version'));
  let committed = false;
  let failure = '';

  installPetBundle({
    commit() {
      committed = true;
    },
    files,
    onFailure(reason) {
      failure = reason;
    },
    pet: data.pet,
    previousPet: previous,
    transport: createTransport(data, data.descriptors[10].id)
  });

  assert.equal(failure, 'asset_integrity_failed');
  assert.equal(committed, false);
  assert.equal(
    previousUris.every((uri) => files.values.get(uri) === 'old-version'),
    true
  );
  assert.equal(
    [...files.values.keys()].some(
      (uri) => uri.includes(data.pet.version.slice(7))
    ),
    false
  );
});

test('选择指针提交失败时完整回滚，新提交成功后清理旧缓存', async () => {
  const data = await fixture();
  const previous = previousPet(data.pet);
  const previousUris = petUrisForCleanup(previous);
  const failedFiles = createFiles();
  previousUris.forEach(
    (uri) => failedFiles.values.set(uri, 'old-version')
  );
  let failure = '';

  installPetBundle({
    commit(next, onSuccess, onFailure) {
      onFailure();
    },
    files: failedFiles,
    onFailure(reason) {
      failure = reason;
    },
    pet: data.pet,
    previousPet: previous,
    transport: createTransport(data)
  });
  assert.equal(failure, 'selection_commit_failed');
  assert.equal(
    previousUris.every(
      (uri) => failedFiles.values.get(uri) === 'old-version'
    ),
    true
  );
  assert.equal(failedFiles.values.size, previousUris.length);

  const successfulFiles = createFiles();
  previousUris.forEach(
    (uri) => successfulFiles.values.set(uri, 'old-version')
  );
  let succeeded = false;
  installPetBundle({
    commit(next, onSuccess) {
      onSuccess();
    },
    files: successfulFiles,
    onFailure(reason) {
      assert.fail(reason);
    },
    onSuccess() {
      succeeded = true;
    },
    pet: data.pet,
    previousPet: previous,
    transport: createTransport(data)
  });
  assert.equal(succeeded, true);
  assert.equal(
    previousUris.some((uri) => successfulFiles.values.has(uri)),
    false
  );
  assert.equal(successfulFiles.values.size, 74);
});

test('页面隐藏时取消进行中的文件写入且不留下临时版本', async () => {
  const data = await fixture();
  const files = createFiles();
  const originalWriteBuffer = files.writeBuffer;
  let pendingWrite = null;
  files.writeBuffer = function(uri, bytes, onSuccess) {
    if (!pendingWrite) {
      pendingWrite = function() {
        files.values.set(uri, new Uint8Array(bytes));
        onSuccess();
      };
      return;
    }
    originalWriteBuffer(uri, bytes, onSuccess);
  };
  let failure = '';
  const installer = installPetBundle({
    commit(next, onSuccess) {
      onSuccess();
    },
    files,
    onFailure(reason) {
      failure = reason;
    },
    pet: data.pet,
    transport: createTransport(data)
  });

  assert.equal(typeof pendingWrite, 'function');
  installer.cancel();
  assert.equal(failure, '');
  pendingWrite();

  assert.equal(failure, 'cancelled');
  assert.equal(files.values.size, 0);
});

test('瞬时网络错误最多重试三次，完整性错误不进入重试', async () => {
  const data = await fixture();
  const files = createFiles();
  const baseTransport = createTransport(data);
  let attempts = 0;
  const transport = {
    ...baseTransport,
    fetchAsset(pet, descriptor, onSuccess, onFailure) {
      if (descriptor.id === data.descriptors[0].id) {
        attempts += 1;
        if (attempts < MAX_PET_DOWNLOAD_ATTEMPTS) {
          onFailure('network_error');
          return { cancel() {} };
        }
      }
      return baseTransport.fetchAsset(
        pet,
        descriptor,
        onSuccess,
        onFailure
      );
    }
  };
  let succeeded = false;
  installPetBundle({
    commit(next, onSuccess) {
      onSuccess();
    },
    files,
    onFailure(reason) {
      assert.fail(reason);
    },
    onSuccess() {
      succeeded = true;
    },
    pet: data.pet,
    schedule(callback) {
      callback();
      return null;
    },
    transport
  });
  assert.equal(MAX_PET_DOWNLOAD_ATTEMPTS, 3);
  assert.equal(attempts, 3);
  assert.equal(succeeded, true);

  const failedFiles = createFiles();
  let failedAttempts = 0;
  let failure = '';
  installPetBundle({
    commit() {
      assert.fail('不应提交失败下载');
    },
    files: failedFiles,
    onFailure(reason) {
      failure = reason;
    },
    pet: data.pet,
    schedule(callback) {
      callback();
      return null;
    },
    transport: {
      ...baseTransport,
      fetchAsset(pet, descriptor, onSuccess, onFailure) {
        failedAttempts += 1;
        onFailure('timeout');
        return { cancel() {} };
      }
    }
  });
  assert.equal(failedAttempts, 3);
  assert.equal(failure, 'timeout');
  assert.equal(failedFiles.values.size, 0);
});

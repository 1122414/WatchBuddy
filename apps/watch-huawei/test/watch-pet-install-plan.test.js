import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPetInstallPlan,
  MAX_ACTIVE_PET_BYTES,
  MAX_PET_ASSETS,
  MAX_TRANSIENT_PET_BYTES,
  parsePetRuntimeManifest,
  petUrisForCleanup
} from '../entry/src/main/js/MainAbility/common/watch-pet-install-plan.js';
import {
  defaultPetCatalog
} from '../../watchbuddy-api/src/pet-catalog.js';

function fixture() {
  const pet = defaultPetCatalog.getPet('watchbuddy-sprout');
  const descriptors = defaultPetCatalog.listAssets(pet.id, {
    limit: 88,
    offset: 0
  }).assets;
  return {
    descriptors,
    pet
  };
}

test('安装计划固定 2MiB 活跃缓存、4MiB 临时预算和 88 帧上限', () => {
  assert.equal(MAX_ACTIVE_PET_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_TRANSIENT_PET_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_PET_ASSETS, 88);

  const { descriptors, pet } = fixture();
  const plan = createPetInstallPlan(pet, descriptors);

  assert.equal(plan.entries.length, 73);
  assert.equal(plan.runtimeManifest.length < 7 * 1024, true);
  assert.equal(
    plan.entries.every(
      (entry) => entry.finalUri.startsWith('internal://app/wbp-')
        && entry.temporaryUri.startsWith('internal://app/wbt-')
    ),
    true
  );
});

test('安装计划拒绝摘要篡改、遗漏动画帧和同版本覆盖', () => {
  const { descriptors, pet } = fixture();
  const tampered = descriptors.map((asset) => ({ ...asset }));
  tampered[0].bytes += 1;
  assert.throws(
    () => createPetInstallPlan(pet, tampered),
    /(预算|摘要)/
  );
  assert.throws(
    () => createPetInstallPlan(pet, descriptors.slice(1)),
    /清单/
  );
  assert.throws(
    () => createPetInstallPlan(pet, descriptors, pet),
    /已安装/
  );
});

test('离线运行清单必须与紧凑选择指针一致', () => {
  const { descriptors, pet } = fixture();
  const plan = createPetInstallPlan(pet, descriptors);
  const selection = {
    petId: pet.id,
    version: pet.version
  };

  assert.deepEqual(
    parsePetRuntimeManifest(plan.runtimeManifest, selection),
    pet
  );
  assert.throws(
    () => parsePetRuntimeManifest(plan.runtimeManifest, {
      ...selection,
      version: 'sha256-0000000000000000'
    }),
    /不一致/
  );
  assert.equal(petUrisForCleanup(pet).length, 74);
  assert.equal(
    petUrisForCleanup(pet).at(-1),
    plan.manifestFinalUri
  );
});

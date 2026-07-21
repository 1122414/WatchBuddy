import {
  isValidPetDetail,
  isValidSha256,
  MAX_FETCH_PACKET_BYTES,
  utf8ByteLength
} from './watch-api-contract.js';
import {
  petAssetUri,
  petManifestUri
} from './watch-pet-integrity.js';

export const MAX_ACTIVE_PET_BYTES = 2 * 1024 * 1024;
export const MAX_PET_ASSETS = 88;
export const MAX_TRANSIENT_PET_BYTES = 4 * 1024 * 1024;

export function createPetInstallPlan(pet, descriptors, previousPet) {
  if (!isValidPetDetail(pet)
    || !Array.isArray(descriptors)
    || descriptors.length !== pet.assetCount
    || descriptors.length < 1
    || descriptors.length > MAX_PET_ASSETS
    || pet.budget.totalBytes > MAX_ACTIVE_PET_BYTES) {
    throw new TypeError('宠物安装清单无效');
  }
  if (previousPet
    && (!isValidPetDetail(previousPet)
      || previousPet.budget.totalBytes > MAX_ACTIVE_PET_BYTES
      || previousPet.budget.totalBytes + pet.budget.totalBytes
        > MAX_TRANSIENT_PET_BYTES)) {
    throw new TypeError('宠物临时缓存预算无效');
  }
  if (previousPet && previousPet.version === pet.version) {
    throw new TypeError('宠物版本已安装');
  }

  const byId = Object.create(null);
  let totalBytes = 0;
  let maxFrameBytes = 0;
  const entries = descriptors.map((descriptor) => {
    if (!isValidDescriptor(descriptor, pet)
      || byId[descriptor.id]) {
      throw new TypeError('宠物资源摘要无效');
    }
    byId[descriptor.id] = true;
    totalBytes += descriptor.bytes;
    maxFrameBytes = Math.max(maxFrameBytes, descriptor.bytes);
    return {
      descriptor,
      finalUri: petAssetUri(pet.version, descriptor.id),
      temporaryUri: petAssetUri(pet.version, descriptor.id, true)
    };
  });
  if (totalBytes !== pet.budget.totalBytes
    || maxFrameBytes !== pet.budget.maxFrameBytes) {
    throw new TypeError('宠物资源预算不一致');
  }

  const referencedIds = referencedAssetIds(pet);
  if (referencedIds.length !== descriptors.length
    || !referencedIds.every((assetId) => byId[assetId])) {
    throw new TypeError('宠物动画引用与资源摘要不一致');
  }

  const runtimeManifest = JSON.stringify({
    schemaVersion: 1,
    pet
  });
  if (utf8ByteLength(runtimeManifest) > MAX_FETCH_PACKET_BYTES) {
    throw new TypeError('宠物运行清单超过 Lite Wearable 单包限制');
  }
  return {
    entries,
    manifestFinalUri: petManifestUri(pet.version),
    manifestTemporaryUri: petManifestUri(pet.version, true),
    pet,
    previousPet: previousPet || null,
    runtimeManifest
  };
}

export function parsePetRuntimeManifest(value, selection) {
  if (typeof value !== 'string'
    || utf8ByteLength(value) > MAX_FETCH_PACKET_BYTES
    || !selection
    || typeof selection.petId !== 'string'
    || typeof selection.version !== 'string') {
    throw new TypeError('宠物运行清单存储无效');
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError('宠物运行清单不是合法 JSON');
  }
  if (!parsed
    || parsed.schemaVersion !== 1
    || !isValidPetDetail(parsed.pet)
    || parsed.pet.id !== selection.petId
    || parsed.pet.version !== selection.version) {
    throw new TypeError('宠物运行清单与选择指针不一致');
  }
  return parsed.pet;
}

export function petUrisForCleanup(pet) {
  if (!isValidPetDetail(pet)) {
    return [];
  }
  const uris = referencedAssetIds(pet).map(
    (assetId) => petAssetUri(pet.version, assetId)
  );
  uris.push(petManifestUri(pet.version));
  return uris;
}

function referencedAssetIds(pet) {
  const seen = Object.create(null);
  const assetIds = [];

  function add(assetId) {
    if (!seen[assetId]) {
      seen[assetId] = true;
      assetIds.push(assetId);
    }
  }

  const animationNames = Object.keys(pet.animations);
  for (let index = 0; index < animationNames.length; index += 1) {
    pet.animations[animationNames[index]].frames.forEach(add);
  }
  if (pet.lookDirections) {
    Object.keys(pet.lookDirections).forEach(
      (direction) => add(pet.lookDirections[direction])
    );
  }
  add(pet.fallbackFrame);
  return assetIds;
}

function isValidDescriptor(descriptor, pet) {
  return descriptor
    && typeof descriptor.id === 'string'
    && descriptor.mediaType === 'image/png'
    && Number.isInteger(descriptor.bytes)
    && descriptor.bytes > 0
    && descriptor.bytes <= MAX_FETCH_PACKET_BYTES
    && typeof descriptor.sha256 === 'string'
    && isValidSha256(descriptor.sha256)
    && descriptor.url === `/v1/pets/${pet.id}/assets/${descriptor.id}`
    && descriptor.base64Url
      === `/v1/pets/${pet.id}/assets/${descriptor.id}?encoding=base64`;
}

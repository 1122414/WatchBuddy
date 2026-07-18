import {
  fetchPetAsset,
  fetchPetAssets
} from './watch-api-client.js';

export function createWatchPetTransport(deviceToken) {
  return {
    fetchAsset(pet, descriptor, onSuccess, onFailure) {
      return fetchPetAsset(
        deviceToken,
        pet.id,
        descriptor,
        {
          onFailure,
          onSuccess(result) {
            onSuccess(result.data);
          }
        }
      );
    },

    listAssets(pet, limit, offset, onSuccess, onFailure) {
      return fetchPetAssets(
        deviceToken,
        pet.id,
        pet.version,
        limit,
        offset,
        {
          onFailure,
          onSuccess(result) {
            onSuccess(result.data);
          }
        }
      );
    }
  };
}

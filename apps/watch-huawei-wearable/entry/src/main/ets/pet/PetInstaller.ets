import { common } from '@kit.AbilityKit';

import {
  parseStoredPetDescriptors,
  parseStoredPetDetail,
  PetAnimationDefinition,
  PetAssetDescriptor,
  PetAssetDownload,
  PetAssetPage,
  PetDetail,
  PetSummary
} from '../network/ApiModels';
import { WatchBuddyApi } from '../network/WatchBuddyApi';
import {
  PetSelection,
  WatchBuddyPreferences
} from '../storage/WatchBuddyPreferences';
import {
  PetFileStore,
  PetInstallPaths
} from './PetFiles';
import {
  decodePetAsset,
  verifyPetAsset
} from './PetIntegrity';

const ASSET_PAGE_SIZE: number = 20;
const MAX_ACTIVE_PET_BYTES: number = 2 * 1024 * 1024;
const MAX_TRANSIENT_PET_BYTES: number = 4 * 1024 * 1024;
const MAX_PET_ASSETS: number = 88;
const MAX_PET_DOWNLOAD_ATTEMPTS: number = 3;
const RETRY_BASE_DELAY_MS: number = 400;

export class InstalledPetBundle {
  pet: PetDetail;
  directory: string;

  constructor(pet: PetDetail, directory: string) {
    this.pet = pet;
    this.directory = directory;
  }
}

export class PetInstaller {
  private api: WatchBuddyApi;
  private files: PetFileStore;
  private preferences: WatchBuddyPreferences;

  constructor(
    context: common.UIAbilityContext,
    api: WatchBuddyApi,
    preferences: WatchBuddyPreferences
  ) {
    this.api = api;
    this.files = new PetFileStore(context);
    this.preferences = preferences;
  }

  async loadInstalled(): Promise<InstalledPetBundle | null> {
    const selection: PetSelection =
      await this.preferences.loadPetSelection();
    if (!selection.isDownloaded()) {
      return null;
    }
    const directory: string = this.files.installedDirectory(
      selection.petId,
      selection.version
    );
    try {
      const pet: PetDetail =
        parseStoredPetDetail(this.files.readManifest(directory));
      if (pet.id !== selection.petId || pet.version !== selection.version) {
        throw new Error('pet_selection_mismatch');
      }
      const descriptors: Array<PetAssetDescriptor> =
        parseStoredPetDescriptors(
          this.files.readAssetIndex(directory),
          pet.id,
          pet.assetCount
        );
      validateInstallPlan(pet, descriptors);
      for (let index: number = 0; index < descriptors.length; index += 1) {
        const descriptor: PetAssetDescriptor = descriptors[index];
        const bytes: Uint8Array = this.files.readAsset(
          directory,
          descriptor.id,
          descriptor.bytes
        );
        verifyPetAsset(bytes, descriptor);
      }
      const fallback: Uint8Array = this.files.readAsset(
        directory,
        pet.preview.id,
        pet.preview.bytes
      );
      verifyPetAsset(fallback, pet.preview);
      return new InstalledPetBundle(pet, directory);
    } catch (error) {
      try {
        await this.preferences.clearPetSelection();
      } catch (clearError) {
      }
      return null;
    }
  }

  async install(
    deviceToken: string,
    summary: PetSummary,
    onProgress: (completed: number, total: number) => void
  ): Promise<InstalledPetBundle> {
    const previousSelection: PetSelection =
      await this.preferences.loadPetSelection();
    if (previousSelection.petId === summary.id
      && previousSelection.version === summary.version) {
      const installed: InstalledPetBundle | null = await this.loadInstalled();
      if (installed !== null) {
        return installed;
      }
    }

    const detail: PetDetail =
      await this.retryPetDetail(deviceToken, summary.id);
    requireMatchingSummary(summary, detail);
    const previousPet: InstalledPetBundle | null =
      await this.loadInstalled();
    if (detail.budget.totalBytes > MAX_ACTIVE_PET_BYTES
      || (previousPet !== null
        && previousPet.pet.budget.totalBytes + detail.budget.totalBytes
          > MAX_TRANSIENT_PET_BYTES)) {
      throw new Error('pet_storage_budget_exceeded');
    }

    const descriptors: Array<PetAssetDescriptor> =
      await this.loadDescriptors(deviceToken, detail);
    validateInstallPlan(detail, descriptors);

    const paths: PetInstallPaths =
      this.files.prepareInstall(detail.id, detail.version);
    let directoryCommitted: boolean = false;
    let selectionCommitted: boolean = false;
    try {
      onProgress(0, descriptors.length);
      for (let index: number = 0; index < descriptors.length; index += 1) {
        const descriptor: PetAssetDescriptor = descriptors[index];
        const payload: PetAssetDownload =
          await this.retryPetAsset(deviceToken, detail.id, descriptor);
        const bytes: Uint8Array = decodePetAsset(payload, descriptor);
        this.files.writeAsset(
          paths.temporaryDirectory,
          descriptor.id,
          bytes
        );
        const storedBytes: Uint8Array = this.files.readAsset(
          paths.temporaryDirectory,
          descriptor.id,
          descriptor.bytes
        );
        verifyPetAsset(storedBytes, descriptor);
        onProgress(index + 1, descriptors.length);
      }

      const manifest: string = JSON.stringify(detail);
      const assetIndex: string = JSON.stringify(descriptors);
      this.files.writeManifest(paths.temporaryDirectory, manifest);
      this.files.writeAssetIndex(paths.temporaryDirectory, assetIndex);
      if (this.files.readManifest(paths.temporaryDirectory) !== manifest) {
        throw new Error('pet_manifest_verify_failed');
      }
      if (this.files.readAssetIndex(paths.temporaryDirectory) !== assetIndex) {
        throw new Error('pet_asset_index_verify_failed');
      }
      this.files.commitInstall(paths);
      directoryCommitted = true;

      const selection: PetSelection =
        new PetSelection(detail.id, detail.version);
      await this.preferences.savePetSelection(selection);
      selectionCommitted = true;

      if (previousPet !== null
        && (previousPet.pet.id !== detail.id
          || previousPet.pet.version !== detail.version)) {
        try {
          this.files.removeVersion(
            previousPet.pet.id,
            previousPet.pet.version
          );
        } catch (cleanupError) {
        }
      }
      return new InstalledPetBundle(detail, paths.finalDirectory);
    } catch (error) {
      if (!selectionCommitted && directoryCommitted) {
        try {
          this.files.removeVersion(detail.id, detail.version);
        } catch (cleanupError) {
        }
      } else if (!directoryCommitted) {
        try {
          this.files.removeTemporary(paths);
        } catch (cleanupError) {
        }
      }
      throw new Error(
        error instanceof Error ? error.message : 'pet_install_failed'
      );
    }
  }

  imageSource(bundle: InstalledPetBundle, assetId: string): string {
    return this.files.imageSource(bundle.directory, assetId);
  }

  private async loadDescriptors(
    deviceToken: string,
    pet: PetDetail
  ): Promise<Array<PetAssetDescriptor>> {
    const descriptors: Array<PetAssetDescriptor> = [];
    let offset: number = 0;
    while (offset < pet.assetCount) {
      const page: PetAssetPage = await this.retryPetAssets(
        deviceToken,
        pet.id,
        pet.version,
        offset
      );
      if (page.total !== pet.assetCount) {
        throw new Error('pet_asset_catalog_mismatch');
      }
      for (let index: number = 0; index < page.assets.length; index += 1) {
        descriptors.push(page.assets[index]);
      }
      offset = page.nextOffset;
      if (!page.hasMore) {
        break;
      }
    }
    if (descriptors.length !== pet.assetCount) {
      throw new Error('pet_asset_catalog_incomplete');
    }
    return descriptors;
  }

  private async retryPetDetail(
    deviceToken: string,
    petId: string
  ): Promise<PetDetail> {
    let attempt: number = 1;
    while (attempt <= MAX_PET_DOWNLOAD_ATTEMPTS) {
      try {
        return await this.api.petDetail(deviceToken, petId);
      } catch (error) {
        if (!shouldRetry(error, attempt)) {
          throw new Error(errorMessage(error, 'pet_detail_failed'));
        }
        await retryDelay(attempt);
        attempt += 1;
      }
    }
    throw new Error('pet_detail_failed');
  }

  private async retryPetAssets(
    deviceToken: string,
    petId: string,
    version: string,
    offset: number
  ): Promise<PetAssetPage> {
    let attempt: number = 1;
    while (attempt <= MAX_PET_DOWNLOAD_ATTEMPTS) {
      try {
        return await this.api.petAssets(
          deviceToken,
          petId,
          version,
          ASSET_PAGE_SIZE,
          offset
        );
      } catch (error) {
        if (!shouldRetry(error, attempt)) {
          throw new Error(errorMessage(error, 'pet_assets_failed'));
        }
        await retryDelay(attempt);
        attempt += 1;
      }
    }
    throw new Error('pet_assets_failed');
  }

  private async retryPetAsset(
    deviceToken: string,
    petId: string,
    descriptor: PetAssetDescriptor
  ): Promise<PetAssetDownload> {
    let attempt: number = 1;
    while (attempt <= MAX_PET_DOWNLOAD_ATTEMPTS) {
      try {
        return await this.api.petAsset(deviceToken, petId, descriptor);
      } catch (error) {
        if (!shouldRetry(error, attempt)) {
          throw new Error(errorMessage(error, 'pet_asset_failed'));
        }
        await retryDelay(attempt);
        attempt += 1;
      }
    }
    throw new Error('pet_asset_failed');
  }
}

function requireMatchingSummary(
  summary: PetSummary,
  detail: PetDetail
): void {
  if (detail.id !== summary.id
    || detail.version !== summary.version
    || detail.manifestSha256 !== summary.manifestSha256
    || detail.assetCount !== summary.assetCount
    || detail.budget.totalBytes !== summary.budget.totalBytes
    || detail.budget.maxFrameBytes !== summary.budget.maxFrameBytes
    || detail.preview.sha256 !== summary.preview.sha256) {
    throw new Error('pet_detail_mismatch');
  }
}

function validateInstallPlan(
  pet: PetDetail,
  descriptors: Array<PetAssetDescriptor>
): void {
  if (descriptors.length < 1
    || descriptors.length > MAX_PET_ASSETS
    || descriptors.length !== pet.assetCount) {
    throw new Error('pet_install_plan_invalid');
  }
  const descriptorIds: Array<string> = [];
  let totalBytes: number = 0;
  let maxFrameBytes: number = 0;
  for (let index: number = 0; index < descriptors.length; index += 1) {
    const descriptor: PetAssetDescriptor = descriptors[index];
    if (descriptorIds.includes(descriptor.id)) {
      throw new Error('pet_asset_duplicate');
    }
    descriptorIds.push(descriptor.id);
    totalBytes += descriptor.bytes;
    maxFrameBytes = Math.max(maxFrameBytes, descriptor.bytes);
  }
  if (totalBytes !== pet.budget.totalBytes
    || maxFrameBytes !== pet.budget.maxFrameBytes) {
    throw new Error('pet_asset_budget_mismatch');
  }
  const referencedIds: Array<string> = referencedAssetIds(pet);
  for (let index: number = 0; index < referencedIds.length; index += 1) {
    if (!descriptorIds.includes(referencedIds[index])) {
      throw new Error('pet_animation_asset_missing');
    }
  }
}

function referencedAssetIds(pet: PetDetail): Array<string> {
  const values: Array<string> = [];
  const animations: Array<PetAnimationDefinition> = [
    pet.animations.idle,
    pet.animations.runningRight,
    pet.animations.runningLeft,
    pet.animations.waving,
    pet.animations.jumping,
    pet.animations.failed,
    pet.animations.waiting,
    pet.animations.running,
    pet.animations.review
  ];
  for (let animationIndex: number = 0;
    animationIndex < animations.length;
    animationIndex += 1) {
    const frames: Array<string> = animations[animationIndex].frames;
    for (let frameIndex: number = 0;
      frameIndex < frames.length;
      frameIndex += 1) {
      if (!values.includes(frames[frameIndex])) {
        values.push(frames[frameIndex]);
      }
    }
  }
  if (!values.includes(pet.fallbackFrame)) {
    values.push(pet.fallbackFrame);
  }
  return values;
}

function shouldRetry(error: Object, attempt: number): boolean {
  if (attempt >= MAX_PET_DOWNLOAD_ATTEMPTS || !(error instanceof Error)) {
    return false;
  }
  return error.message === 'network_error'
    || error.message === 'http_429'
    || error.message === 'http_500'
    || error.message === 'http_502'
    || error.message === 'http_503'
    || error.message === 'http_504';
}

function errorMessage(error: Object, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function retryDelay(attempt: number): Promise<void> {
  const delayMs: number = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, delayMs);
  });
}

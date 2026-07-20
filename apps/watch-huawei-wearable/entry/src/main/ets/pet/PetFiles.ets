import { common } from '@kit.AbilityKit';
import { buffer } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';

import {
  isValidPetAssetId,
  isValidPetId,
  isValidPetVersion
} from '../network/ApiModels';

const PET_STORAGE_DIRECTORY: string = 'watchbuddy-pets';
const PET_MANIFEST_FILE: string = 'watch-pet.json';
const PET_ASSET_INDEX_FILE: string = 'assets.json';
const MAX_MANIFEST_BYTES: number = 7 * 1024;
const MAX_ASSET_INDEX_BYTES: number = 64 * 1024;

export class PetInstallPaths {
  temporaryDirectory: string;
  finalDirectory: string;

  constructor(temporaryDirectory: string, finalDirectory: string) {
    this.temporaryDirectory = temporaryDirectory;
    this.finalDirectory = finalDirectory;
  }
}

export class PetFileStore {
  private rootDirectory: string;

  constructor(context: common.UIAbilityContext) {
    this.rootDirectory = `${context.filesDir}/${PET_STORAGE_DIRECTORY}`;
  }

  prepareInstall(petId: string, version: string): PetInstallPaths {
    requirePetPathParts(petId, version);
    this.ensureDirectory(this.rootDirectory);
    const petDirectory: string = `${this.rootDirectory}/${petId}`;
    this.ensureDirectory(petDirectory);
    const versionTag: string = version.slice('sha256-'.length);
    const temporaryDirectory: string =
      `${this.rootDirectory}/.install-${petId}-${versionTag}`;
    const finalDirectory: string = `${petDirectory}/${version}`;
    this.removeTree(temporaryDirectory);
    this.ensureDirectory(temporaryDirectory);
    return new PetInstallPaths(temporaryDirectory, finalDirectory);
  }

  commitInstall(paths: PetInstallPaths): void {
    this.removeTree(paths.finalDirectory);
    try {
      fileIo.renameSync(paths.temporaryDirectory, paths.finalDirectory);
    } catch (error) {
      throw new Error('pet_directory_commit_failed');
    }
  }

  writeAsset(
    directory: string,
    assetId: string,
    bytes: Uint8Array
  ): string {
    const path: string = this.assetPath(directory, assetId);
    const data: ArrayBuffer = new ArrayBuffer(bytes.length);
    new Uint8Array(data).set(bytes);
    this.writeFile(path, data);
    return path;
  }

  readAsset(
    directory: string,
    assetId: string,
    maximumBytes: number
  ): Uint8Array {
    const path: string = this.assetPath(directory, assetId);
    return this.readFile(path, maximumBytes);
  }

  writeManifest(directory: string, value: string): void {
    if (value.length < 1
      || buffer.from(value, 'utf8').length > MAX_MANIFEST_BYTES) {
      throw new Error('pet_manifest_too_large');
    }
    this.writeText(`${directory}/${PET_MANIFEST_FILE}`, value);
  }

  readManifest(directory: string): string {
    return this.readText(
      `${directory}/${PET_MANIFEST_FILE}`,
      MAX_MANIFEST_BYTES,
      'pet_manifest_read_failed'
    );
  }

  writeAssetIndex(directory: string, value: string): void {
    if (value.length < 1
      || buffer.from(value, 'utf8').length > MAX_ASSET_INDEX_BYTES) {
      throw new Error('pet_asset_index_too_large');
    }
    this.writeText(`${directory}/${PET_ASSET_INDEX_FILE}`, value);
  }

  readAssetIndex(directory: string): string {
    return this.readText(
      `${directory}/${PET_ASSET_INDEX_FILE}`,
      MAX_ASSET_INDEX_BYTES,
      'pet_asset_index_read_failed'
    );
  }

  private readText(
    path: string,
    maximumBytes: number,
    failure: string
  ): string {
    try {
      const stat: fileIo.Stat = fileIo.statSync(path);
      if (stat.size < 1 || stat.size > maximumBytes) {
        throw new Error(failure);
      }
      return fileIo.readTextSync(path);
    } catch (error) {
      throw new Error(failure);
    }
  }

  installedDirectory(petId: string, version: string): string {
    requirePetPathParts(petId, version);
    return `${this.rootDirectory}/${petId}/${version}`;
  }

  imageSource(
    directory: string,
    assetId: string
  ): string {
    return `file://${this.assetPath(directory, assetId)}`;
  }

  exists(path: string): boolean {
    try {
      return fileIo.accessSync(path);
    } catch (error) {
      return false;
    }
  }

  removeVersion(petId: string, version: string): void {
    this.removeTree(this.installedDirectory(petId, version));
  }

  removeTemporary(paths: PetInstallPaths): void {
    this.removeTree(paths.temporaryDirectory);
  }

  private assetPath(directory: string, assetId: string): string {
    if (!isValidPetAssetId(assetId)) {
      throw new Error('invalid_pet_asset_id');
    }
    return `${directory}/${assetId}.png`;
  }

  private ensureDirectory(path: string): void {
    if (this.exists(path)) {
      return;
    }
    try {
      fileIo.mkdirSync(path, true);
    } catch (error) {
      throw new Error('pet_directory_create_failed');
    }
  }

  private writeFile(path: string, data: ArrayBuffer): void {
    let file: fileIo.File | null = null;
    try {
      file = fileIo.openSync(
        path,
        fileIo.OpenMode.WRITE_ONLY
          | fileIo.OpenMode.CREATE
          | fileIo.OpenMode.TRUNC
      );
      const written: number = fileIo.writeSync(file.fd, data);
      if (written !== data.byteLength) {
        throw new Error('pet_asset_write_incomplete');
      }
      fileIo.fsyncSync(file.fd);
    } catch (error) {
      throw new Error('pet_asset_write_failed');
    } finally {
      if (file !== null) {
        try {
          fileIo.closeSync(file);
        } catch (error) {
        }
      }
    }
  }

  private writeText(path: string, value: string): void {
    let file: fileIo.File | null = null;
    try {
      file = fileIo.openSync(
        path,
        fileIo.OpenMode.WRITE_ONLY
          | fileIo.OpenMode.CREATE
          | fileIo.OpenMode.TRUNC
      );
      const written: number = fileIo.writeSync(file.fd, value);
      if (written < 1) {
        throw new Error('pet_manifest_write_incomplete');
      }
      fileIo.fsyncSync(file.fd);
    } catch (error) {
      throw new Error('pet_manifest_write_failed');
    } finally {
      if (file !== null) {
        try {
          fileIo.closeSync(file);
        } catch (error) {
        }
      }
    }
  }

  private readFile(path: string, maximumBytes: number): Uint8Array {
    let file: fileIo.File | null = null;
    try {
      const stat: fileIo.Stat = fileIo.statSync(path);
      if (stat.size < 1 || stat.size > maximumBytes) {
        throw new Error('pet_asset_size_invalid');
      }
      const data: ArrayBuffer = new ArrayBuffer(stat.size);
      file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
      const read: number = fileIo.readSync(file.fd, data);
      if (read !== stat.size) {
        throw new Error('pet_asset_read_incomplete');
      }
      return new Uint8Array(data);
    } catch (error) {
      throw new Error('pet_asset_read_failed');
    } finally {
      if (file !== null) {
        try {
          fileIo.closeSync(file);
        } catch (error) {
        }
      }
    }
  }

  private removeTree(path: string): void {
    if (!this.exists(path)) {
      return;
    }
    try {
      const stat: fileIo.Stat = fileIo.statSync(path);
      if (!stat.isDirectory()) {
        fileIo.unlinkSync(path);
        return;
      }
      const children: Array<string> = fileIo.listFileSync(path);
      for (let index: number = 0; index < children.length; index += 1) {
        this.removeTree(`${path}/${children[index]}`);
      }
      fileIo.rmdirSync(path);
    } catch (error) {
      throw new Error('pet_cleanup_failed');
    }
  }
}

function requirePetPathParts(petId: string, version: string): void {
  if (!isValidPetId(petId) || !isValidPetVersion(version)) {
    throw new Error('invalid_pet_path');
  }
}

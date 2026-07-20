import { buffer } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

import {
  PetAssetDescriptor,
  PetAssetDownload
} from '../network/ApiModels';

const BASE64_PATTERN: RegExp = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG_MAGIC: Array<number> = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_PET_ASSET_BYTES: number = 7 * 1024;

export function decodePetAsset(
  payload: PetAssetDownload,
  descriptor: PetAssetDescriptor
): Uint8Array {
  if (!payload
    || !descriptor
    || payload.id !== descriptor.id
    || payload.bytes !== descriptor.bytes
    || payload.mediaType !== 'image/png'
    || payload.sha256 !== descriptor.sha256) {
    throw new Error('asset_descriptor_mismatch');
  }
  const bytes: Uint8Array = decodeCanonicalBase64(payload.data);
  verifyPetAsset(bytes, descriptor);
  return bytes;
}

export function verifyPetAsset(
  bytes: Uint8Array,
  descriptor: PetAssetDescriptor
): void {
  if (!bytes
    || !descriptor
    || descriptor.mediaType !== 'image/png'
    || descriptor.bytes < 1
    || descriptor.bytes > MAX_PET_ASSET_BYTES
    || bytes.length !== descriptor.bytes) {
    throw new Error('asset_size_mismatch');
  }
  for (let index: number = 0; index < PNG_MAGIC.length; index += 1) {
    if (bytes[index] !== PNG_MAGIC[index]) {
      throw new Error('asset_not_png');
    }
  }
  if (sha256Hex(bytes) !== descriptor.sha256) {
    throw new Error('asset_hash_mismatch');
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  try {
    const md: cryptoFramework.Md = cryptoFramework.createMd('SHA256');
    md.updateSync({ data: bytes });
    const digest: cryptoFramework.DataBlob = md.digestSync();
    let result: string = '';
    for (let index: number = 0; index < digest.data.length; index += 1) {
      const value: string = digest.data[index].toString(16);
      result += value.length === 1 ? `0${value}` : value;
    }
    return result;
  } catch (error) {
    throw new Error('asset_hash_failed');
  }
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (typeof value !== 'string'
    || value.length < 4
    || value.length % 4 !== 0
    || !BASE64_PATTERN.test(value)) {
    throw new Error('asset_base64_invalid');
  }
  const firstPadding: number = value.indexOf('=');
  if (firstPadding >= 0 && firstPadding < value.length - 2) {
    throw new Error('asset_base64_invalid');
  }
  try {
    const decoded: buffer.Buffer = buffer.from(value, 'base64');
    if (decoded.length < 1
      || decoded.length > MAX_PET_ASSET_BYTES
      || decoded.toString('base64') !== value) {
      throw new Error('asset_base64_invalid');
    }
    const bytes: Uint8Array = new Uint8Array(decoded.length);
    for (let index: number = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded[index];
    }
    return bytes;
  } catch (error) {
    throw new Error('asset_base64_invalid');
  }
}

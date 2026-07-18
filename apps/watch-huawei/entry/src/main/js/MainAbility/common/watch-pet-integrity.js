const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^sha256-[a-f0-9]{16}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_PET_ASSET_BYTES = 7 * 1024;
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

export function decodeBase64(value) {
  if (typeof value !== 'string'
    || value.length < 4
    || value.length % 4 !== 0
    || !BASE64_PATTERN.test(value)) {
    throw new TypeError('宠物资源 Base64 无效');
  }
  const firstPadding = value.indexOf('=');
  if (firstPadding >= 0 && firstPadding < value.length - 2) {
    throw new TypeError('宠物资源 Base64 填充无效');
  }
  const padding = value.endsWith('==') ? 2 : (value.endsWith('=') ? 1 : 0);
  const output = new Uint8Array(value.length / 4 * 3 - padding);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let outputIndex = 0;

  for (let index = 0; index < value.length; index += 4) {
    const a = alphabet.indexOf(value[index]);
    const b = alphabet.indexOf(value[index + 1]);
    const c = value[index + 2] === '='
      ? 0
      : alphabet.indexOf(value[index + 2]);
    const d = value[index + 3] === '='
      ? 0
      : alphabet.indexOf(value[index + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      throw new TypeError('宠物资源 Base64 字符无效');
    }
    const block = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < output.length) {
      output[outputIndex] = (block >>> 16) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < output.length) {
      output[outputIndex] = (block >>> 8) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < output.length) {
      output[outputIndex] = block & 0xff;
      outputIndex += 1;
    }
  }
  return output;
}

export function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('SHA-256 输入必须是 Uint8Array');
  }
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000);
  const bitLengthLow = (bytes.length << 3) >>> 0;
  writeUint32(padded, paddedLength - 8, bitLengthHigh);
  writeUint32(padded, paddedLength - 4, bitLengthLow);

  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (
        (padded[wordOffset] << 24)
        | (padded[wordOffset + 1] << 16)
        | (padded[wordOffset + 2] << 8)
        | padded[wordOffset + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15];
      const before2 = words[index - 2];
      const sigma0 = (
        rotateRight(before15, 7)
        ^ rotateRight(before15, 18)
        ^ (before15 >>> 3)
      ) >>> 0;
      const sigma1 = (
        rotateRight(before2, 17)
        ^ rotateRight(before2, 19)
        ^ (before2 >>> 10)
      ) >>> 0;
      words[index] = (
        words[index - 16]
        + sigma0
        + words[index - 7]
        + sigma1
      ) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = (
        rotateRight(e, 6)
        ^ rotateRight(e, 11)
        ^ rotateRight(e, 25)
      ) >>> 0;
      const choice = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (
        h
        + sum1
        + choice
        + SHA256_CONSTANTS[index]
        + words[index]
      ) >>> 0;
      const sum0 = (
        rotateRight(a, 2)
        ^ rotateRight(a, 13)
        ^ rotateRight(a, 22)
      ) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  let result = '';
  for (let index = 0; index < hash.length; index += 1) {
    let word = hash[index].toString(16);
    while (word.length < 8) {
      word = `0${word}`;
    }
    result += word;
  }
  return result;
}

export function verifyDownloadedPetAsset(payload, descriptor) {
  if (!payload
    || !descriptor
    || payload.id !== descriptor.id
    || payload.mediaType !== 'image/png'
    || descriptor.mediaType !== 'image/png'
    || payload.encoding !== 'base64'
    || payload.bytes !== descriptor.bytes
    || payload.sha256 !== descriptor.sha256
    || !ASSET_ID_PATTERN.test(payload.id || '')
    || !Number.isInteger(payload.bytes)
    || payload.bytes < 1
    || payload.bytes > MAX_PET_ASSET_BYTES
    || !HASH_PATTERN.test(payload.sha256 || '')) {
    throw new TypeError('宠物资源描述不一致');
  }
  const bytes = decodeBase64(payload.data);
  verifyStoredPetAsset(bytes, descriptor);
  return bytes;
}

export function verifyStoredPetAsset(bytes, descriptor) {
  const assetId = descriptor && (descriptor.id || descriptor.assetId);
  if (!(bytes instanceof Uint8Array)
    || !descriptor
    || !ASSET_ID_PATTERN.test(assetId || '')
    || descriptor.mediaType !== 'image/png'
    || !Number.isInteger(descriptor.bytes)
    || descriptor.bytes < 1
    || descriptor.bytes > MAX_PET_ASSET_BYTES
    || !HASH_PATTERN.test(descriptor.sha256 || '')
    || bytes.length !== descriptor.bytes) {
    throw new TypeError('宠物资源长度校验失败');
  }
  for (let index = 0; index < PNG_MAGIC.length; index += 1) {
    if (bytes[index] !== PNG_MAGIC[index]) {
      throw new TypeError('宠物资源不是有效 PNG');
    }
  }
  if (sha256Hex(bytes) !== descriptor.sha256) {
    throw new TypeError('宠物资源 SHA-256 校验失败');
  }
  return true;
}

export function petAssetUri(version, assetId, temporary = false) {
  const tag = versionTag(version);
  if (!ASSET_ID_PATTERN.test(assetId || '')) {
    throw new TypeError('宠物资源 ID 无效');
  }
  return checkedUri(
    `internal://app/${temporary ? 'wbt' : 'wbp'}-${tag}-${assetId}.png`
  );
}

export function petManifestUri(version, temporary = false) {
  const tag = versionTag(version);
  return checkedUri(
    `internal://app/${temporary ? 'wbtm' : 'wbm'}-${tag}.json`
  );
}

function versionTag(version) {
  if (!VERSION_PATTERN.test(version || '')) {
    throw new TypeError('宠物版本无效');
  }
  return version.slice('sha256-'.length);
}

function checkedUri(uri) {
  if (uri.length > 128) {
    throw new TypeError('宠物文件 URI 超过 Lite Wearable 上限');
  }
  return uri;
}

function rotateRight(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

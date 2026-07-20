import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

const STATE_SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_DEVICES = 512;

export class JsonStateStore {
  #filePath;

  constructor(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new TypeError("状态文件路径不能为空");
    }
    this.#filePath = isAbsolute(filePath)
      ? filePath
      : resolve(filePath);
  }

  load() {
    if (!existsSync(this.#filePath)) {
      return [];
    }
    const stat = lstatSync(this.#filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TypeError("状态文件必须是普通文件");
    }
    if (stat.size < 1 || stat.size > MAX_STATE_BYTES) {
      throw new RangeError("状态文件大小无效");
    }
    const parsed = JSON.parse(readFileSync(this.#filePath, "utf8"));
    if (!parsed
      || parsed.schemaVersion !== STATE_SCHEMA_VERSION
      || !Array.isArray(parsed.devices)
      || parsed.devices.length > MAX_DEVICES) {
      throw new TypeError("状态文件结构无效");
    }
    return parsed.devices;
  }

  save(devices) {
    if (!Array.isArray(devices) || devices.length > MAX_DEVICES) {
      throw new TypeError("设备状态集合无效");
    }
    const payload = JSON.stringify({
      schemaVersion: STATE_SCHEMA_VERSION,
      devices
    });
    if (Buffer.byteLength(payload) > MAX_STATE_BYTES) {
      throw new RangeError("状态文件超过大小上限");
    }

    const parent = dirname(this.#filePath);
    mkdirSync(parent, {
      mode: 0o700,
      recursive: true
    });
    if (existsSync(this.#filePath)) {
      const stat = lstatSync(this.#filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new TypeError("状态文件必须是普通文件");
      }
    }
    const temporaryPath =
      `${this.#filePath}.${randomUUID()}.tmp`;
    let descriptor = null;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, payload, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      renameSync(temporaryPath, this.#filePath);
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
    }
  }
}

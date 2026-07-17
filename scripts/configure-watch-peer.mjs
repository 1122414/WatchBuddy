import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const fingerprint = (process.argv[2] ?? "")
  .replaceAll(":", "")
  .trim()
  .toUpperCase();

if (!/^[0-9A-F]{64}$/.test(fingerprint)) {
  throw new TypeError("请提供 Android 签名证书的 64 位 SHA-256 指纹");
}

const configPath = resolve(
  "apps/watch-huawei/entry/src/main/js/MainAbility/common/peer-config.js"
);
const source = await readFile(configPath, "utf8");
const updated = source.replace(
  /export const PHONE_CERT_FINGERPRINT = '[^']+';/,
  `export const PHONE_CERT_FINGERPRINT = '${fingerprint}';`
);

if (updated === source) {
  throw new Error("未找到表端 PHONE_CERT_FINGERPRINT 配置");
}

await writeFile(configPath, updated);
console.info("已写入 Android 公钥指纹；构建完成后请恢复占位值");

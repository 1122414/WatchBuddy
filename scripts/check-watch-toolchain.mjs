import {
  accessSync,
  constants,
  existsSync,
  readFileSync
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const projectRoot = new URL("../", import.meta.url);
const devEcoCandidates = [
  "/Applications/DevEco-Studio.app",
  "/Applications/DevEco Studio.app",
  join(homedir(), "Applications", "DevEco-Studio.app"),
  join(homedir(), "Applications", "DevEco Studio.app")
];
const androidStudioJava = "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java";

function findExecutable(command) {
  try {
    return execFileSync("/usr/bin/which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch (error) {
    return "";
  }
}

function isExecutable(filePath) {
  if (!filePath) {
    return false;
  }
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function canRunJava(filePath) {
  if (!isExecutable(filePath)) {
    return false;
  }

  try {
    execFileSync(filePath, ["-version"], {
      stdio: "ignore"
    });
    return true;
  } catch (error) {
    return false;
  }
}

function readProjectConfig() {
  const configPath = new URL(
    "apps/watch-huawei/entry/src/main/config.json",
    projectRoot
  );
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  return {
    bundleName: config.app.bundleName,
    deviceType: config.module.deviceType,
    hasInternetPermission: config.module.reqPermissions?.some(
      (permission) => permission.name === "ohos.permission.INTERNET"
    ) ?? false
  };
}

const devEcoPath = devEcoCandidates.find(existsSync) ?? "";
const sdkManagerPath = findExecutable("sdkmgr");
const ohpmPath = findExecutable("ohpm");
const hvigorPath = findExecutable("hvigorw") || findExecutable("hvigor");
const pathJava = findExecutable("java");
const javaPath = canRunJava(pathJava)
  ? pathJava
  : (canRunJava(androidStudioJava) ? androidStudioJava : "");
const projectConfig = readProjectConfig();

const checks = [
  {
    name: "DevEco Studio",
    ok: Boolean(devEcoPath),
    detail: devEcoPath || "未安装"
  },
  {
    name: "HarmonyOS SDK 管理器",
    ok: Boolean(sdkManagerPath),
    detail: sdkManagerPath || "PATH 中未找到 sdkmgr"
  },
  {
    name: "OHPM",
    ok: Boolean(ohpmPath),
    detail: ohpmPath || "PATH 中未找到 ohpm"
  },
  {
    name: "Hvigor",
    ok: Boolean(hvigorPath),
    detail: hvigorPath || "PATH 中未找到 hvigorw/hvigor"
  },
  {
    name: "Java",
    ok: Boolean(javaPath),
    detail: javaPath || "未找到可用 Java"
  },
  {
    name: "表端包名",
    ok: projectConfig.bundleName === "com.watchbuddy.watch",
    detail: projectConfig.bundleName
  },
  {
    name: "Lite Wearable",
    ok: projectConfig.deviceType.includes("liteWearable"),
    detail: projectConfig.deviceType.join(", ")
  },
  {
    name: "网络权限",
    ok: projectConfig.hasInternetPermission,
    detail: projectConfig.hasInternetPermission
      ? "ohos.permission.INTERNET"
      : "未声明"
  }
];

for (const check of checks) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
}

const canBuild = Boolean(javaPath)
  && (Boolean(devEcoPath) || Boolean(sdkManagerPath))
  && Boolean(ohpmPath)
  && Boolean(hvigorPath);

if (!canBuild) {
  console.error("\n尚不能构建 HAP：请安装 DevEco Studio 或完整 HarmonyOS Command Line Tools。");
  process.exitCode = 1;
} else {
  console.log("\n工具链已具备最小 HAP 构建条件。");
}

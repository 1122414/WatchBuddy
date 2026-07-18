import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
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
const requiredSdkComponents = [
  "toolchains",
  "ets",
  "js",
  "native",
  "previewer"
];

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

function findBundledExecutable(devEcoPath, relativePath) {
  if (!devEcoPath) {
    return "";
  }

  const executablePath = join(devEcoPath, relativePath);
  return isExecutable(executablePath) ? executablePath : "";
}

function inspectSdkHome() {
  const candidates = [
    process.env.DEVECO_SDK_HOME,
    join(homedir(), "Library", "Huawei", "Sdk"),
    join(homedir(), "Library", "OpenHarmony", "Sdk")
  ].filter(Boolean);
  let firstPartialSdk = null;

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const possibleHomes = [
      candidate,
      ...readdirSync(candidate, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(candidate, entry.name))
    ];

    for (const possibleHome of possibleHomes) {
      const missingComponents = requiredSdkComponents.filter(
        (component) => !existsSync(join(possibleHome, component))
      );
      if (missingComponents.length === 0) {
        return {
          home: possibleHome,
          missingComponents: []
        };
      }

      firstPartialSdk ??= {
        home: possibleHome,
        missingComponents
      };
    }
  }

  return firstPartialSdk ?? {
    home: "",
    missingComponents: requiredSdkComponents
  };
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
const ohpmPath = findExecutable("ohpm")
  || findBundledExecutable(devEcoPath, "Contents/tools/ohpm/bin/ohpm");
const hvigorPath = findExecutable("hvigorw")
  || findExecutable("hvigor")
  || findBundledExecutable(devEcoPath, "Contents/tools/hvigor/bin/hvigorw");
const pathJava = findExecutable("java");
const devEcoJava = findBundledExecutable(
  devEcoPath,
  "Contents/jbr/Contents/Home/bin/java"
);
const javaPath = canRunJava(devEcoJava)
  ? devEcoJava
  : (canRunJava(pathJava)
    ? pathJava
    : (canRunJava(androidStudioJava) ? androidStudioJava : ""));
const sdk = inspectSdkHome();
const projectConfig = readProjectConfig();

const checks = [
  {
    name: "DevEco Studio",
    ok: Boolean(devEcoPath),
    detail: devEcoPath || "未安装"
  },
  {
    name: "HarmonyOS SDK",
    ok: Boolean(sdk.home) && sdk.missingComponents.length === 0,
    detail: sdk.home
      ? `${sdk.home}${sdk.missingComponents.length > 0
        ? `（缺少 ${sdk.missingComponents.join(", ")}）`
        : ""}`
      : "未安装"
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
  && Boolean(devEcoPath)
  && Boolean(sdk.home)
  && sdk.missingComponents.length === 0
  && Boolean(ohpmPath)
  && Boolean(hvigorPath);

if (!canBuild) {
  console.error("\n尚不能构建 HAP：请安装完整 HarmonyOS SDK 后重试。");
  process.exitCode = 1;
} else {
  console.log("\n工具链已具备最小 HAP 构建条件。");
}

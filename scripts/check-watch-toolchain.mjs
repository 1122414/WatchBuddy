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
import { pathToFileURL } from "node:url";

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
  const buildProfilePath = new URL(
    "apps/watch-huawei/build-profile.json5",
    projectRoot
  );
  const entryBuildProfilePath = new URL(
    "apps/watch-huawei/entry/build-profile.json5",
    projectRoot
  );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const buildProfile = JSON.parse(readFileSync(buildProfilePath, "utf8"));
  const entryBuildProfile = JSON.parse(
    readFileSync(entryBuildProfilePath, "utf8")
  );
  const product = buildProfile.app.products.find(
    (candidate) => candidate.name === "default"
  );
  const requiredPageFiles = [
    "index.js",
    "index.hml",
    "index.css"
  ].map((fileName) => new URL(
    `apps/watch-huawei/entry/src/main/js/MainAbility/pages/index/${fileName}`,
    projectRoot
  ));
  const prohibitedRuntimeFiles = [
    "peer-config.js",
    "wear-engine-manager.js",
    "sdk/litewearable/wearengine.js"
  ].map((relativePath) => new URL(
    `apps/watch-huawei/entry/src/main/js/MainAbility/common/${relativePath}`,
    projectRoot
  ));

  return {
    bundleName: config.app.bundleName,
    compatibleSdkVersion: product?.compatibleSdkVersion,
    deviceType: config.module.deviceType,
    hasCircleScreen: config.module.distroFilter?.screenShape?.value?.includes(
      "circle"
    ) ?? false,
    hasInternetPermission: config.module.reqPermissions?.some(
      (permission) => permission.name === "ohos.permission.INTERNET"
    ) ?? false,
    hasRequiredPageFiles: requiredPageFiles.every(existsSync),
    hasWearEngineRuntimeFiles: prohibitedRuntimeFiles.some(existsSync),
    hasWatchResolution: config.module.distroFilter?.screenWindow?.value?.includes(
      "466*466"
    ) ?? false,
    isFaMode: entryBuildProfile.apiType === "faMode",
    runtimeOS: product?.runtimeOS,
    targetSdkVersion: product?.targetSdkVersion
  };
}

export function inspectWatchToolchain() {
  const devEcoPath = devEcoCandidates.find(existsSync) ?? "";
  const ohpmPath = findExecutable("ohpm")
    || findBundledExecutable(devEcoPath, "Contents/tools/ohpm/bin/ohpm");
  const hvigorPath = findExecutable("hvigorw")
    || findExecutable("hvigor")
    || findBundledExecutable(devEcoPath, "Contents/tools/hvigor/bin/hvigorw");
  const nodePath = findBundledExecutable(
    devEcoPath,
    "Contents/tools/node/bin/node"
  ) || findExecutable("node");
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
      detail: ohpmPath || "未找到 ohpm"
    },
    {
      name: "Hvigor",
      ok: Boolean(hvigorPath),
      detail: hvigorPath || "未找到 hvigorw/hvigor"
    },
    {
      name: "Java",
      ok: Boolean(javaPath),
      detail: javaPath || "未找到可用 Java"
    },
    {
      name: "Node.js",
      ok: Boolean(nodePath),
      detail: nodePath || "未找到可用 Node.js"
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
      name: "HarmonyOS 目标版本",
      ok: projectConfig.targetSdkVersion === "5.0.5(17)"
        && projectConfig.compatibleSdkVersion === "5.0.5(17)"
        && projectConfig.runtimeOS === "HarmonyOS",
      detail: `${projectConfig.targetSdkVersion} / ${projectConfig.runtimeOS}`
    },
    {
      name: "Lite Wearable FA 模型",
      ok: projectConfig.isFaMode,
      detail: projectConfig.isFaMode ? "faMode" : "配置错误"
    },
    {
      name: "GT 6 Pro 圆屏",
      ok: projectConfig.hasCircleScreen && projectConfig.hasWatchResolution,
      detail: projectConfig.hasCircleScreen && projectConfig.hasWatchResolution
        ? "circle / 466*466"
        : "配置错误"
    },
    {
      name: "表端页面文件",
      ok: projectConfig.hasRequiredPageFiles,
      detail: projectConfig.hasRequiredPageFiles ? "JS/HML/CSS 完整" : "文件缺失"
    },
    {
      name: "独立运行源码",
      ok: !projectConfig.hasWearEngineRuntimeFiles,
      detail: projectConfig.hasWearEngineRuntimeFiles
        ? "仍包含 Wear Engine/手机 peer"
        : "无 Wear Engine/手机 peer"
    },
    {
      name: "网络权限",
      ok: projectConfig.hasInternetPermission,
      detail: projectConfig.hasInternetPermission
        ? "ohos.permission.INTERNET"
        : "未声明"
    }
  ];

  return {
    canBuild: checks.every((check) => check.ok),
    checks,
    paths: {
      devEcoPath,
      hvigorPath,
      javaPath,
      nodePath,
      ohpmPath,
      sdkHome: sdk.home
    }
  };
}

export function printWatchToolchainReport(report) {
  for (const check of report.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  }

  if (!report.canBuild) {
    console.error("\n尚不能构建 HAP：请安装完整 HarmonyOS SDK 后重试。");
    return;
  }

  console.log("\n工具链已具备最小 HAP 构建条件。");
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = inspectWatchToolchain();
  printWatchToolchainReport(report);
  if (!report.canBuild) {
    process.exitCode = 1;
  }
}

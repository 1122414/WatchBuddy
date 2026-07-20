import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
const requiredSdkEntries = [
  ["default", "hms", "toolchains"],
  ["default", "hms", "ets"],
  ["default", "hms", "native"],
  ["default", "hms", "previewer"],
  ["default", "openharmony", "js"],
  ["default", "openharmony", "toolchains"]
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

function sdkCandidates(additionalCandidates = []) {
  return [
    process.env.DEVECO_SDK_HOME,
    join(homedir(), "Library", "Huawei", "Sdk"),
    join(homedir(), "Library", "OpenHarmony", "Sdk"),
    ...additionalCandidates
  ].filter((candidate, index, values) => (
    Boolean(candidate) && values.indexOf(candidate) === index
  ));
}

export function inspectSdkHome(candidates = sdkCandidates()) {
  let bestPartialSdk = null;

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const possibleHomes = [
      candidate,
      candidate.endsWith("/default") ? dirname(candidate) : "",
      ...readdirSync(candidate, { withFileTypes: true })
        .filter((entry) => (
          entry.isDirectory()
          && entry.name !== "default"
        ))
        .map((entry) => join(candidate, entry.name))
    ].filter(Boolean);

    for (const possibleHome of possibleHomes) {
      const missingComponents = requiredSdkEntries
        .filter((segments) => !existsSync(join(possibleHome, ...segments)))
        .map((segments) => segments.join("/"));
      if (missingComponents.length === 0) {
        return {
          componentHome: join(possibleHome, "default"),
          home: possibleHome,
          missingComponents: []
        };
      }

      if (
        !bestPartialSdk
        || missingComponents.length < bestPartialSdk.missingComponents.length
      ) {
        bestPartialSdk = {
          componentHome: join(possibleHome, "default"),
          home: possibleHome,
          missingComponents
        };
      }
    }
  }

  return bestPartialSdk ?? {
    componentHome: "",
    home: "",
    missingComponents: requiredSdkEntries.map(
      (segments) => segments.join("/")
    )
  };
}

function readProjectConfig() {
  const appConfigPath = new URL(
    "apps/watch-huawei-wearable/AppScope/app.json5",
    projectRoot
  );
  const moduleConfigPath = new URL(
    "apps/watch-huawei-wearable/entry/src/main/module.json5",
    projectRoot
  );
  const buildProfilePath = new URL(
    "apps/watch-huawei-wearable/build-profile.json5",
    projectRoot
  );
  const entryBuildProfilePath = new URL(
    "apps/watch-huawei-wearable/entry/build-profile.json5",
    projectRoot
  );
  const appConfig = JSON.parse(readFileSync(appConfigPath, "utf8"));
  const moduleConfig = JSON.parse(readFileSync(moduleConfigPath, "utf8"));
  const buildProfile = JSON.parse(readFileSync(buildProfilePath, "utf8"));
  const entryBuildProfile = JSON.parse(
    readFileSync(entryBuildProfilePath, "utf8")
  );
  const product = buildProfile.app.products.find(
    (candidate) => candidate.name === "default"
  );
  const requiredSourceFiles = [
    "entryability/EntryAbility.ets",
    "pages/Index.ets"
  ].map((relativePath) => new URL(
    `apps/watch-huawei-wearable/entry/src/main/ets/${relativePath}`,
    projectRoot
  ));
  const prohibitedRuntimeFiles = [
    "peer-config.ets",
    "wear-engine-manager.ets",
    "WearEngine.ets"
  ].map((fileName) => new URL(
    `apps/watch-huawei-wearable/entry/src/main/ets/${fileName}`,
    projectRoot
  ));

  return {
    bundleName: appConfig.app.bundleName,
    compatibleSdkVersion: product?.compatibleSdkVersion,
    deviceTypes: moduleConfig.module.deviceTypes,
    hasInternetPermission: moduleConfig.module.requestPermissions?.some(
      (permission) => permission.name === "ohos.permission.INTERNET"
    ) ?? false,
    hasRequiredSourceFiles: requiredSourceFiles.every(existsSync),
    hasWearEngineRuntimeFiles: prohibitedRuntimeFiles.some(existsSync),
    isStageMode: entryBuildProfile.apiType === "stageMode",
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
  const bundledSdk = devEcoPath
    ? join(devEcoPath, "Contents", "sdk")
    : "";
  const sdk = inspectSdkHome(sdkCandidates([bundledSdk]));
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
        ? `${sdk.home}${sdk.componentHome !== sdk.home
          ? `（组件目录 ${sdk.componentHome}）`
          : ""}${sdk.missingComponents.length > 0
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
      name: "智能穿戴设备类型",
      ok: projectConfig.deviceTypes.includes("wearable"),
      detail: projectConfig.deviceTypes.join(", ")
    },
    {
      name: "HarmonyOS 目标版本",
      ok: projectConfig.targetSdkVersion === "6.0.2(22)"
        && projectConfig.compatibleSdkVersion === "5.0.2(14)"
        && projectConfig.runtimeOS === "HarmonyOS",
      detail: `${projectConfig.targetSdkVersion}（兼容 ${projectConfig.compatibleSdkVersion}）`
    },
    {
      name: "ArkTS Stage 模型",
      ok: projectConfig.isStageMode,
      detail: projectConfig.isStageMode ? "stageMode" : "配置错误"
    },
    {
      name: "ArkTS 表端入口",
      ok: projectConfig.hasRequiredSourceFiles,
      detail: projectConfig.hasRequiredSourceFiles
        ? "EntryAbility/Index 完整"
        : "文件缺失"
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
    console.error(
      "\n尚不能构建 HAP：请检查 DevEco Studio、智能穿戴工程和 "
      + "HarmonyOS/OpenHarmony 预集成 SDK 目录。"
    );
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

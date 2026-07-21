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
import { fileURLToPath, pathToFileURL } from "node:url";

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

function countPngFiles(directory) {
  if (!existsSync(directory)) {
    return 0;
  }
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return total + countPngFiles(entryPath);
      }
      return total + Number(entry.isFile() && entry.name.endsWith(".png"));
    },
    0
  );
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
  const requiredIconFiles = [
    "icon.png",
    "icon_small.png"
  ].map((fileName) => new URL(
    `apps/watch-huawei/entry/src/main/resources/base/media/${fileName}`,
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
  const petRuntimePath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/"
      + "watch-pet-runtime.js",
    projectRoot
  ));
  const petResourceRoot = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/images/"
      + "pets/watchbuddy-sprout",
    projectRoot
  ));
  const networkClientPath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/"
      + "watch-api-client.js",
    projectRoot
  ));
  const apiContractPath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/"
      + "watch-api-contract.js",
    projectRoot
  ));
  const petInstallerPath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/"
      + "watch-pet-installer.js",
    projectRoot
  ));
  const petFilesPath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/"
      + "watch-pet-files.js",
    projectRoot
  ));
  const petIntegrityPath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/common/"
      + "watch-pet-integrity.js",
    projectRoot
  ));
  const pagePath = fileURLToPath(new URL(
    "apps/watch-huawei/entry/src/main/js/MainAbility/pages/index/index.js",
    projectRoot
  ));
  const networkClientSource = existsSync(networkClientPath)
    ? readFileSync(networkClientPath, "utf8")
    : "";
  const apiContractSource = existsSync(apiContractPath)
    ? readFileSync(apiContractPath, "utf8")
    : "";
  const petInstallerSource = existsSync(petInstallerPath)
    ? readFileSync(petInstallerPath, "utf8")
    : "";
  const petFilesSource = existsSync(petFilesPath)
    ? readFileSync(petFilesPath, "utf8")
    : "";
  const petIntegritySource = existsSync(petIntegrityPath)
    ? readFileSync(petIntegrityPath, "utf8")
    : "";
  const pageSource = existsSync(pagePath)
    ? readFileSync(pagePath, "utf8")
    : "";

  return {
    bundleName: config.app.bundleName,
    compatibleSdkVersion: product?.compatibleSdkVersion,
    deviceTypes: config.module.deviceType,
    hasCircleScreen: config.module.distroFilter?.screenShape?.value?.includes(
      "circle"
    ) ?? false,
    hasInternetPermission: config.module.reqPermissions?.some(
      (permission) => permission.name === "ohos.permission.INTERNET"
    ) ?? false,
    hasWatchResolution: config.module.distroFilter?.screenWindow?.value?.includes(
      "466*466"
    ) ?? false,
    hasPetRuntime: existsSync(petRuntimePath),
    hasControlledPetInstaller:
      petInstallerSource.includes("MAX_PET_DOWNLOAD_ATTEMPTS")
      && petInstallerSource.includes("commitSelection")
      && petInstallerSource.includes("finishFailure")
      && petFilesSource.includes("move(")
      && petFilesSource.includes("remove(")
      && petIntegritySource.includes("sha256Hex")
      && petIntegritySource.includes("PNG_MAGIC"),
    hasPetControls:
      pageSource.includes("playWave")
      && pageSource.includes("playJump")
      && pageSource.includes("restPet")
      && pageSource.includes("runLocalAction")
      && pageSource.includes("registerWatchBuddy")
      && pageSource.includes("replyToCompanion"),
    hasDirectNetworkRuntime: networkClientSource.includes("@system.fetch")
      && networkClientSource.includes("fetch.fetch(")
      && apiContractSource.includes("startsWith('https://')"),
    hasPetTouchRuntime: pageSource.includes("@system.vibrator")
      && pageSource.includes("vibrator.vibrate"),
    hasLiteWearableIcons:
      config.module.abilities?.some(
        (ability) => ability.icon === "$media:icon"
      ) === true
      && requiredIconFiles.every(existsSync),
    hasRequiredSourceFiles: requiredPageFiles.every(existsSync),
    hasWearEngineRuntimeFiles: prohibitedRuntimeFiles.some(existsSync),
    isFaMode: entryBuildProfile.apiType === "faMode",
    petFrameCount: countPngFiles(petResourceRoot),
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
      name: "Lite Wearable 设备类型",
      ok: projectConfig.deviceTypes.includes("liteWearable"),
      detail: projectConfig.deviceTypes.join(", ")
    },
    {
      name: "已验证安装基线",
      ok: projectConfig.targetSdkVersion === "5.0.5(17)"
        && projectConfig.compatibleSdkVersion === "5.0.5(17)"
        && projectConfig.runtimeOS === "HarmonyOS",
      detail: `${projectConfig.targetSdkVersion}（兼容 ${projectConfig.compatibleSdkVersion}）`
    },
    {
      name: "Lite Wearable FA 模型",
      ok: projectConfig.isFaMode,
      detail: projectConfig.isFaMode ? "faMode" : "配置错误"
    },
    {
      name: "GT 6 安装兼容过滤器",
      ok: !projectConfig.hasCircleScreen && !projectConfig.hasWatchResolution,
      detail: !projectConfig.hasCircleScreen && !projectConfig.hasWatchResolution
        ? "未声明（避免调测助手错误 40）"
        : "诊断基线不应声明 distroFilter"
    },
    {
      name: "Lite Wearable 表端入口",
      ok: projectConfig.hasRequiredSourceFiles,
      detail: projectConfig.hasRequiredSourceFiles
        ? "JS/HML/CSS 完整"
        : "文件缺失"
    },
    {
      name: "Lite Wearable 应用图标",
      ok: projectConfig.hasLiteWearableIcons,
      detail: projectConfig.hasLiteWearableIcons
        ? "icon.png / icon_small.png"
        : "图标资源或入口引用缺失"
    },
    {
      name: "独立运行源码",
      ok: !projectConfig.hasWearEngineRuntimeFiles,
      detail: projectConfig.hasWearEngineRuntimeFiles
        ? "仍包含 Wear Engine/手机 peer"
        : "无 Wear Engine/手机 peer"
    },
    {
      name: "GT 6 权限安装基线",
      ok: !projectConfig.hasInternetPermission,
      detail: projectConfig.hasInternetPermission
        ? "不应声明 ohos.permission.INTERNET（调测助手错误 46）"
        : "未显式声明（保留 @system.fetch 真机探测）"
    },
    {
      name: "手表直连网络",
      ok: projectConfig.hasDirectNetworkRuntime,
      detail: projectConfig.hasDirectNetworkRuntime
        ? "@system.fetch HTTPS"
        : "Lite Wearable HTTPS 客户端缺失"
    },
    {
      name: "内置宠物运行时",
      ok: projectConfig.hasPetRuntime
        && projectConfig.petFrameCount === 73,
      detail: projectConfig.hasPetRuntime
        ? `JavaScript + ${projectConfig.petFrameCount} 帧`
        : "运行时缺失"
    },
    {
      name: "受控宠物原子安装",
      ok: projectConfig.hasControlledPetInstaller,
      detail: projectConfig.hasControlledPetInstaller
        ? "分页下载 + SHA-256 + 原子切换 + 回滚"
        : "Lite Wearable 安装链路缺失"
    },
    {
      name: "宠物 AI 交互控制",
      ok: projectConfig.hasPetControls,
      detail: projectConfig.hasPetControls
        ? "Codex Pet 动画 + 后台注册 + DeepSeek 回复"
        : "Lite Wearable AI 交互控制缺失"
    },
    {
      name: "宠物触感运行时",
      ok: projectConfig.hasPetTouchRuntime,
      detail: projectConfig.hasPetTouchRuntime
        ? "@system.vibrator"
        : "触感调用缺失"
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
      "\n尚不能构建 HAP：请检查 DevEco Studio、Lite Wearable 工程和 "
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

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectWatchToolchain,
  printWatchToolchainReport
} from "./check-watch-toolchain.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const watchProjectRoot = join(repositoryRoot, "apps", "watch-huawei");
const signingRoot = join(
  homedir(),
  "Library",
  "Application Support",
  "WatchBuddy",
  "signing"
);
const signingMaterial = {
  certpath: join(signingRoot, "watchbuddy-debug.cer"),
  keyAlias: "watchbuddy",
  profile: join(signingRoot, "watchbuddy-debug.p7b"),
  signAlg: "SHA256withECDSA",
  storeFile: join(signingRoot, "watchbuddy-debug.p12")
};
const keychainService = "WatchBuddy HarmonyOS Signing";
const keychainAccount = "watchbuddy";
const expectedBundleName = "com.watchbuddy.watch";
const appVersion = JSON.parse(readFileSync(
  join(watchProjectRoot, "entry", "src", "main", "config.json"),
  "utf8"
)).app.version.name;
const outputPath = process.env.WATCHBUDDY_SIGNED_OUTPUT
  || join(homedir(), "Downloads", `WatchBuddy-${appVersion}-debug-signed.hap`);

function findFiles(directory, predicate) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findFiles(entryPath, predicate);
    }
    return entry.isFile() && predicate(entry.name) ? [entryPath] : [];
  });
}

function readSigningPassword() {
  return execFileSync(
    "/usr/bin/security",
    [
      "find-generic-password",
      "-s",
      keychainService,
      "-a",
      keychainAccount,
      "-w"
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }
  ).trim();
}

function copyProject(source, destination) {
  cpSync(source, destination, {
    filter: (sourcePath) => {
      const name = basename(sourcePath);
      return name !== ".hvigor" && name !== "build";
    },
    recursive: true
  });
}

function runSigningTool(javaPath, args, label) {
  try {
    execFileSync(javaPath, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? `（退出码 ${error.status}）` : "";
    const secrets = ["-keystorePwd", "-keyPwd"]
      .map((flag) => args.indexOf(flag))
      .filter((index) => index >= 0)
      .map((index) => args[index + 1]);
    const detail = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((output) => output.toString())
      .join("\n")
      .trim();
    const sanitizedDetail = secrets.reduce(
      (current, secret) => current.replaceAll(secret, "<已隐藏>"),
      detail
    );
    const suffix = sanitizedDetail ? `\n${sanitizedDetail}` : "";
    throw new Error(`${label}失败${status}。${suffix}`);
  }
}

function normalizePem(value) {
  return value.replace(/\s/g, "");
}

function verifyProfile(profileJsonPath) {
  const result = JSON.parse(readFileSync(profileJsonPath, "utf8"));
  const content = result.content || {};
  const bundleInfo = content["bundle-info"] || {};
  const deviceIds = content["debug-info"]?.["device-ids"];

  if (!result.verifiedPassed) {
    throw new Error("Profile 的数字签名校验未通过。");
  }
  if (content.type !== "debug") {
    throw new Error(`Profile 类型应为 debug，实际为 ${content.type || "未知"}。`);
  }
  if (bundleInfo["bundle-name"] !== expectedBundleName) {
    throw new Error(
      `Profile 包名应为 ${expectedBundleName}，实际为 ${
        bundleInfo["bundle-name"] || "未知"
      }。`
    );
  }
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    throw new Error("Profile 中没有已注册的调试设备。");
  }

  const profileCertificate = bundleInfo["development-certificate"] || "";
  const localCertificate = readFileSync(signingMaterial.certpath, "utf8");
  const localCertificateChain = localCertificate.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
  ) || [];
  const hasProfileCertificate = localCertificateChain.some(
    (certificate) => normalizePem(certificate) === normalizePem(profileCertificate)
  );
  if (!hasProfileCertificate) {
    throw new Error("Profile 绑定的开发证书与本机签名证书不一致。");
  }
}

function verifySignedBin(unsignedBinPath, signedBinPath) {
  const unsignedBin = readFileSync(unsignedBinPath);
  const signedBin = readFileSync(signedBinPath);
  const signHeadLength = 32;

  if (signedBin.length <= unsignedBin.length + signHeadLength) {
    throw new Error("签名 BIN 没有包含有效的签名数据。");
  }
  if (!signedBin.subarray(0, unsignedBin.length).equals(unsignedBin)) {
    throw new Error("签名 BIN 的原始应用数据发生了变化。");
  }

  const signHead = signedBin.subarray(-signHeadLength);
  const magic = signHead.subarray(0, 16).toString("ascii");
  const version = signHead.subarray(16, 20).toString("ascii");
  const signedDataLength = signHead.readUInt32BE(20);
  const blockCount = signHead.readUInt32BE(24);

  if (magic !== "hw signed app   " || version !== "1000") {
    throw new Error("签名 BIN 缺少华为 Lite Wearable 签名头。");
  }
  if (signedDataLength !== signedBin.length - unsignedBin.length) {
    throw new Error("签名 BIN 记录的签名区长度不正确。");
  }
  if (blockCount !== 2) {
    throw new Error(`签名 BIN 应包含 2 个签名块，实际为 ${blockCount}。`);
  }
}

function verifyPackagedHap(signedHapPath, signedBinPath) {
  const entries = execFileSync("/usr/bin/unzip", ["-Z1", signedHapPath], {
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const packagedBinEntries = entries.filter((entry) => entry.endsWith(".bin"));
  if (packagedBinEntries.length !== 1) {
    throw new Error(
      `签名 HAP 中应包含 1 个 BIN，实际找到 ${packagedBinEntries.length} 个。`
    );
  }

  const packagedBin = execFileSync(
    "/usr/bin/unzip",
    ["-p", signedHapPath, packagedBinEntries[0]],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }
  );
  const signedBin = readFileSync(signedBinPath);
  if (!packagedBin.equals(signedBin)) {
    throw new Error("签名 HAP 中的 BIN 与已签名 BIN 不一致。");
  }
}

const report = inspectWatchToolchain();
printWatchToolchainReport(report);

if (!report.canBuild) {
  process.exitCode = 1;
} else {
  const missingMaterial = Object.values(signingMaterial)
    .filter((value) => typeof value === "string" && value.startsWith(signingRoot))
    .filter((materialPath) => !existsSync(materialPath));

  if (missingMaterial.length > 0) {
    console.error("\n缺少本机签名材料：");
    missingMaterial.forEach((materialPath) => console.error(materialPath));
    process.exitCode = 1;
  } else {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "watchbuddy-signed-"));
    const temporaryProjectRoot = join(temporaryRoot, "watch-huawei");

    try {
      const password = readSigningPassword();
      copyProject(watchProjectRoot, temporaryProjectRoot);

      const nodeHome = dirname(dirname(report.paths.nodePath));
      const javaHome = dirname(dirname(report.paths.javaPath));
      execFileSync(
        report.paths.hvigorPath,
        [
          "assembleHap",
          "--mode",
          "module",
          "-p",
          "product=default",
          "-p",
          "module=entry@default",
          "-p",
          "buildMode=debug",
          "--no-daemon"
        ],
        {
          cwd: temporaryProjectRoot,
          env: {
            ...process.env,
            DEVECO_SDK_HOME: report.paths.sdkHome,
            JAVA_HOME: javaHome,
            NODE_HOME: nodeHome
          },
          stdio: "inherit"
        }
      );

      const unsignedBinFiles = findFiles(
        join(temporaryProjectRoot, "entry", "build"),
        (fileName) => (
          fileName.endsWith(".bin") && fileName.includes("unsigned")
        )
      )
        .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

      if (unsignedBinFiles.length === 0) {
        throw new Error("构建命令已完成，但没有找到 unsigned BIN。");
      }

      const sdkToolRoot = join(
        report.paths.sdkHome,
        "default",
        "openharmony",
        "toolchains",
        "lib"
      );
      const signToolPath = join(sdkToolRoot, "hap-sign-tool.jar");
      const packingToolPath = join(sdkToolRoot, "app_packing_tool.jar");
      const signedBinPath = join(temporaryRoot, "entry-default-signed.bin");
      const signedHapPath = join(temporaryRoot, "entry-default-signed.hap");
      const verifiedProfilePath = join(temporaryRoot, "verified-profile.json");

      runSigningTool(report.paths.javaPath, [
        "-jar",
        signToolPath,
        "sign-app",
        "-mode",
        "localSign",
        "-profileFile",
        signingMaterial.profile,
        "-profileSigned",
        "1",
        "-inForm",
        "bin",
        "-signAlg",
        signingMaterial.signAlg,
        "-keyAlias",
        signingMaterial.keyAlias,
        "-keystoreFile",
        signingMaterial.storeFile,
        "-keystorePwd",
        password,
        "-keyPwd",
        password,
        "-appCertFile",
        signingMaterial.certpath,
        "-inFile",
        unsignedBinFiles[0],
        "-outFile",
        signedBinPath
      ], "BIN 签名");

      verifySignedBin(unsignedBinFiles[0], signedBinPath);

      runSigningTool(report.paths.javaPath, [
        "-jar",
        signToolPath,
        "verify-profile",
        "-inFile",
        signingMaterial.profile,
        "-outFile",
        verifiedProfilePath
      ], "Profile 校验");
      verifyProfile(verifiedProfilePath);

      execFileSync(
        report.paths.javaPath,
        [
          "-Dfile.encoding=utf-8",
          "-jar",
          packingToolPath,
          "--mode",
          "hap",
          "--bin-path",
          signedBinPath,
          "--out-path",
          signedHapPath,
          "--force",
          "true"
        ],
        { stdio: "ignore" }
      );

      verifyPackagedHap(signedHapPath, signedBinPath);

      mkdirSync(dirname(outputPath), { recursive: true });
      copyFileSync(signedHapPath, outputPath);
      const hapBytes = readFileSync(outputPath);
      const sha256 = createHash("sha256").update(hapBytes).digest("hex");

      console.log(`\n签名 HAP 已生成：${outputPath}`);
      console.log(`文件大小：${hapBytes.length} 字节`);
      console.log(`SHA-256：${sha256}`);
    } catch (error) {
      console.error(`\n签名构建失败：${error.message}`);
      process.exitCode = Number.isInteger(error.status) ? error.status : 1;
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }
}

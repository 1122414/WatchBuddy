import {
  existsSync,
  readdirSync,
  statSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectWatchToolchain,
  printWatchToolchainReport
} from "./check-watch-toolchain.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const watchProjectRoot = join(
  repositoryRoot,
  "apps",
  "watch-huawei-wearable"
);
const buildOutputRoot = join(watchProjectRoot, "entry", "build");

function findHapFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findHapFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".hap") ? [entryPath] : [];
  });
}

const report = inspectWatchToolchain();
printWatchToolchainReport(report);

if (!report.canBuild) {
  process.exitCode = 1;
} else {
  const nodeHome = dirname(dirname(report.paths.nodePath));
  const javaHome = dirname(dirname(report.paths.javaPath));

  try {
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
        cwd: watchProjectRoot,
        env: {
          ...process.env,
          DEVECO_SDK_HOME: report.paths.sdkHome,
          JAVA_HOME: javaHome,
          NODE_HOME: nodeHome
        },
        stdio: "inherit"
      }
    );
  } catch (error) {
    process.exitCode = Number.isInteger(error.status) ? error.status : 1;
  }

  if (!process.exitCode) {
    const hapFiles = findHapFiles(buildOutputRoot)
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

    if (hapFiles.length === 0) {
      console.error("\n构建命令已完成，但没有找到 HAP 产物。");
      process.exitCode = 1;
    } else {
      console.log(`\nHAP 已生成：${hapFiles[0]}`);
    }
  }
}

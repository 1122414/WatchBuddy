import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync
} from "node:fs";
import { join } from "node:path";
import test from "node:test";


const repositoryRoot = new URL("../../", import.meta.url);
const wearableRoot = new URL(
  "apps/watch-huawei-wearable/",
  repositoryRoot
);
const petRoot = new URL(
  "entry/src/main/resources/rawfile/pets/watchbuddy-sprout/",
  wearableRoot
);
const legacyPetRoot = new URL(
  "apps/watch-huawei/entry/src/main/js/MainAbility/common/images/"
    + "pets/watchbuddy-sprout/",
  repositoryRoot
);
const runtimePath = new URL(
  "entry/src/main/ets/pet/PetRuntime.ets",
  wearableRoot
);
const pagePath = new URL(
  "entry/src/main/ets/pages/Index.ets",
  wearableRoot
);
const modulePath = new URL(
  "entry/src/main/module.json5",
  wearableRoot
);
const networkClientPath = new URL(
  "entry/src/main/ets/network/WatchBuddyApi.ets",
  wearableRoot
);
const secureTokenStorePath = new URL(
  "entry/src/main/ets/storage/SecureTokenStore.ets",
  wearableRoot
);
const preferencesPath = new URL(
  "entry/src/main/ets/storage/WatchBuddyPreferences.ets",
  wearableRoot
);
const sessionPath = new URL(
  "entry/src/main/ets/runtime/WatchBuddySession.ets",
  wearableRoot
);
const apiModelsPath = new URL(
  "entry/src/main/ets/network/ApiModels.ets",
  wearableRoot
);
const petFilesPath = new URL(
  "entry/src/main/ets/pet/PetFiles.ets",
  wearableRoot
);
const petInstallerPath = new URL(
  "entry/src/main/ets/pet/PetInstaller.ets",
  wearableRoot
);
const petIntegrityPath = new URL(
  "entry/src/main/ets/pet/PetIntegrity.ets",
  wearableRoot
);

const EXPECTED_FRAMES = {
  failed: 8,
  idle: 6,
  jumping: 5,
  look: 16,
  review: 6,
  running: 6,
  "running-left": 8,
  "running-right": 8,
  waiting: 6,
  waving: 4
};


function pngDimensions(filePath) {
  const contents = readFileSync(filePath);
  const signature = contents.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a");
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    bitDepth: contents[24],
    colorType: contents[25]
  };
}


test("智能穿戴内置宠物包含全部 73 张透明标准帧", () => {
  let total = 0;
  for (const [state, expectedCount] of Object.entries(EXPECTED_FRAMES)) {
    const files = readdirSync(new URL(`${state}/`, petRoot))
      .filter((fileName) => fileName.endsWith(".png"))
      .sort();
    assert.equal(files.length, expectedCount, state);
    assert.deepEqual(
      files,
      Array.from(
        { length: expectedCount },
        (_, index) => `${String(index).padStart(3, "0")}.png`
      ),
      state
    );
    for (const fileName of files) {
      const wearableFramePath = join(
        new URL(`${state}/`, petRoot).pathname,
        fileName
      );
      const dimensions = pngDimensions(wearableFramePath);
      assert.deepEqual(dimensions, {
        width: 128,
        height: 139,
        bitDepth: 8,
        colorType: 6
      });
      assert.deepEqual(
        readFileSync(wearableFramePath),
        readFileSync(join(
          new URL(`${state}/`, legacyPetRoot).pathname,
          fileName
        )),
        `${state}/${fileName}`
      );
      total += 1;
    }
  }
  assert.equal(total, 73);
});


test("ArkTS 宠物运行时保留状态映射、互动映射和点击防抖", () => {
  const runtime = readFileSync(runtimePath, "utf8");
  assert.match(runtime, /export const TAP_DEBOUNCE_MS: number = 800/);
  assert.match(runtime, /case 'daydreaming':[\s\S]*return 'waiting'/);
  assert.match(runtime, /case 'watching':[\s\S]*return 'review'/);
  assert.match(runtime, /case 'curious':[\s\S]*return 'jumping'/);
  assert.match(runtime, /case 'chatting':[\s\S]*return 'waving'/);
  assert.match(runtime, /case 'offline':[\s\S]*return 'waiting'/);
  assert.match(runtime, /case 'giving_space':[\s\S]*return 'idle'/);
  assert.match(runtime, /case 'tap':[\s\S]*return 'jumping'/);
  assert.match(runtime, /case 'failure':[\s\S]*return 'failed'/);
});


test("466 圆屏主页渲染动态宠物且不包含 Wear Engine", () => {
  const page = readFileSync(pagePath, "utf8");
  const moduleConfig = JSON.parse(readFileSync(modulePath, "utf8"));
  assert.match(page, /Image\(\$rawfile\(this\.petFramePath\)\)/);
  assert.match(page, /\.onClick\(\(\) => \{\s*this\.triggerTap\(\)/);
  assert.match(page, /vibrator\.startVibration/);
  assert.deepEqual(moduleConfig.module.deviceTypes, ["wearable"]);
  assert.equal(
    moduleConfig.module.requestPermissions.some(
      (permission) => permission.name === "ohos.permission.VIBRATE"
    ),
    true
  );
  assert.doesNotMatch(page, /WearEngine|wear-engine|peer-config/);
});


test("ArkTS 使用 Network Kit 直连且限制响应、超时和 HTTPS", () => {
  const networkClient = readFileSync(networkClientPath, "utf8");
  const session = readFileSync(sessionPath, "utf8");
  assert.match(networkClient, /from '@kit\.NetworkKit'/);
  assert.match(networkClient, /http\.createHttp\(\)/);
  assert.match(networkClient, /MAX_RESPONSE_BYTES: number = 7 \* 1024/);
  assert.match(networkClient, /REQUEST_TIMEOUT_MS: number = 8000/);
  assert.match(networkClient, /baseUrl\.startsWith\('https:\/\/'\)/);
  assert.doesNotMatch(networkClient, /@system\.fetch|WearEngine/);
  assert.match(session, /new WatchBuddyApi\(WATCHBUDDY_API_BASE_URL\)/);
  assert.doesNotMatch(session, /console\.(log|error).*deviceToken/);
});


test("设备令牌只进入 Asset Store Kit，Preferences 不保存令牌", () => {
  const secretStore = readFileSync(secureTokenStorePath, "utf8");
  const localPreferences = readFileSync(preferencesPath, "utf8");
  assert.match(secretStore, /from '@kit\.AssetStoreKit'/);
  assert.match(secretStore, /asset\.Tag\.SECRET/);
  assert.match(
    secretStore,
    /asset\.Accessibility\.DEVICE_FIRST_UNLOCKED/
  );
  assert.match(secretStore, /asset\.SyncType\.NEVER/);
  assert.doesNotMatch(secretStore, /@kit\.ArkData|preferences/);
  assert.doesNotMatch(localPreferences, /deviceToken|device_token|TOKEN/);
});


test("ArkTS 宠物目录只读取受控 API 且执行严格响应校验", () => {
  const networkClient = readFileSync(networkClientPath, "utf8");
  const apiModels = readFileSync(apiModelsPath, "utf8");
  assert.match(networkClient, /'\/v1\/pets'/);
  assert.match(networkClient, /`\/v1\/pets\/\$\{petId\}`/);
  assert.match(
    networkClient,
    /assets\?limit=\$\{limit\}&offset=\$\{offset\}/
  );
  assert.match(networkClient, /\?encoding=base64/);
  assert.match(apiModels, /payload\.renderer !== 'frame-sequence-v1'/);
  assert.match(apiModels, /MAX_PET_ASSET_BYTES: number = 7 \* 1024/);
  assert.match(apiModels, /payload\.source\.format|payload\.format === 'codex-pet-v2'/);
  assert.match(apiModels, /redistributionAllowed === true/);
  assert.match(apiModels, /parseStoredPetDescriptors/);
});


test("ArkTS 动态宠物逐帧做 Base64、PNG 和 SHA-256 校验", () => {
  const integrity = readFileSync(petIntegrityPath, "utf8");
  assert.match(integrity, /from '@kit\.CryptoArchitectureKit'/);
  assert.match(integrity, /cryptoFramework\.createMd\('SHA256'\)/);
  assert.match(integrity, /decoded\.toString\('base64'\) !== value/);
  assert.match(integrity, /PNG_MAGIC/);
  assert.match(integrity, /sha256Hex\(bytes\) !== descriptor\.sha256/);
});


test("ArkTS 宠物安装有界重试、缓存预算、原子切换和失败回滚", () => {
  const installer = readFileSync(petInstallerPath, "utf8");
  const files = readFileSync(petFilesPath, "utf8");
  assert.match(installer, /MAX_ACTIVE_PET_BYTES: number = 2 \* 1024 \* 1024/);
  assert.match(installer, /MAX_TRANSIENT_PET_BYTES: number = 4 \* 1024 \* 1024/);
  assert.match(installer, /MAX_PET_DOWNLOAD_ATTEMPTS: number = 3/);
  assert.match(installer, /RETRY_BASE_DELAY_MS: number = 400/);
  assert.match(installer, /http_429/);
  assert.match(installer, /http_504/);
  assert.match(installer, /this\.files\.removeTemporary\(paths\)/);
  assert.ok(
    installer.indexOf("this.files.commitInstall(paths)")
      < installer.indexOf("this.preferences.savePetSelection(selection)")
  );
  assert.ok(
    installer.indexOf("this.preferences.savePetSelection(selection)")
      < installer.indexOf("this.files.removeVersion(")
  );
  assert.match(files, /from '@kit\.CoreFileKit'/);
  assert.match(files, /fileIo\.renameSync/);
  assert.match(files, /fileIo\.fsyncSync/);
  assert.match(files, /\.install-\$\{petId\}-\$\{versionTag\}/);
});


test("圆屏宠物库恢复已安装宠物并保留内置宠物降级", () => {
  const page = readFileSync(pagePath, "utf8");
  const runtime = readFileSync(runtimePath, "utf8");
  assert.match(page, /await this\.session\.loadInstalledPet\(\)/);
  assert.match(page, /await this\.session\.loadPetCatalog\(\)/);
  assert.match(page, /await this\.session\.installPet\(/);
  assert.match(page, /Image\(this\.petFramePath\)/);
  assert.match(page, /Image\(\$rawfile\(this\.petFramePath\)\)/);
  assert.match(page, /已保留当前宠物/);
  assert.match(runtime, /file:\/\/\$\{this\.directory\}/);
  assert.match(runtime, /createDownloadedPetRuntime/);
});


test("ArkTS 陪伴状态严格校验消息、动作、安静模式和过期时间", () => {
  const apiModels = readFileSync(apiModelsPath, "utf8");
  assert.match(apiModels, /payload\.type !== 'COMPANION_NUDGE'/);
  assert.match(apiModels, /payload\.expiresAt <= serverTime/);
  assert.match(apiModels, /payload\.actions\.length < 2/);
  assert.match(apiModels, /actionIds\.includes\(action\.id\)/);
  assert.match(apiModels, /typeof payload\.settings\.quietMode !== 'boolean'/);
  assert.match(apiModels, /parseMemoryPagePayload/);
});


test("ArkTS 快捷回复先持久化幂等请求并执行最多三次有界重试", () => {
  const networkClient = readFileSync(networkClientPath, "utf8");
  const session = readFileSync(sessionPath, "utf8");
  const localPreferences = readFileSync(preferencesPath, "utf8");
  assert.match(networkClient, /'\/v1\/companion\/reply'/);
  assert.match(networkClient, /'Idempotency-Key'/);
  assert.match(session, /MAX_REPLY_ATTEMPTS: number = 3/);
  assert.match(session, /REPLY_RETRY_BASE_MS: number = 400/);
  assert.ok(
    session.indexOf("savePendingQuickReply(pending)")
      < session.indexOf("deliverPendingQuickReply(pending, true)")
  );
  assert.match(session, /loadPendingQuickReply\(\)/);
  assert.match(session, /Math\.pow\(2, pending\.attempts - 1\)/);
  assert.match(localPreferences, /PENDING_REPLY_KEY/);
  assert.doesNotMatch(localPreferences, /deviceToken|device_token|TOKEN/);
});


test("ArkTS 圆屏支持直接快捷回复、安静模式和记忆删除确认", () => {
  const page = readFileSync(pagePath, "utf8");
  const networkClient = readFileSync(networkClientPath, "utf8");
  assert.match(page, /await this\.session\.replyToNudge\(/);
  assert.match(page, /回复会直接从手表发送/);
  assert.match(page, /await this\.session\.setQuietMode/);
  assert.match(page, /await this\.session\.memories\(3, 0\)/);
  assert.match(page, /await this\.session\.deleteMemory\(memoryId\)/);
  assert.match(page, /再次点按以清空全部记忆/);
  assert.match(page, /await this\.session\.clearMemories\(\)/);
  assert.match(networkClient, /'\/v1\/settings'/);
  assert.match(networkClient, /`\/v1\/memories\/\$\{memoryId\}`/);
  assert.match(networkClient, /http\.RequestMethod\.DELETE/);
});

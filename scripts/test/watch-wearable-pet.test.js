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

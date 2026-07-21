import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  advancePetPlayback,
  canTriggerPetTap,
  createDownloadedPetRuntime,
  createPetPlayback,
  DEFAULT_PET_FRAME,
  DEFAULT_PET_ID,
  getPetAnimation,
  petAnimationForState,
  petInteractionAnimation,
  petSteadyAnimationForState
} from '../entry/src/main/js/MainAbility/common/watch-pet-runtime.js';
import {
  defaultPetCatalog
} from '../../watchbuddy-api/src/pet-catalog.js';

const REPOSITORY_ROOT = path.resolve(
  import.meta.dirname,
  '../../..'
);
const APP_RESOURCE_ROOT = path.join(
  REPOSITORY_ROOT,
  'apps/watch-huawei/entry/src/main/js/MainAbility'
);
const APP_PET_MANIFEST = path.join(
  APP_RESOURCE_ROOT,
  'common/pets/watchbuddy-sprout/watch-pet.json'
);

test('状态与交互映射到默认宠物动画', () => {
  assert.equal(DEFAULT_PET_ID, 'watchbuddy-sprout');
  assert.equal(DEFAULT_PET_FRAME.endsWith('/idle/000.png'), true);
  assert.equal(petAnimationForState('watching'), 'review');
  assert.equal(petAnimationForState('curious'), 'jumping');
  assert.equal(petSteadyAnimationForState('curious'), 'idle');
  assert.equal(petInteractionAnimation('loading'), 'running');
  assert.equal(petInteractionAnimation('failure'), 'failed');
  assert.equal(petAnimationForState('unknown'), 'idle');
});

test('循环动画回到首帧，一次性动画完成后停止', () => {
  let idle = createPetPlayback('idle');
  for (let index = 0; index < getPetAnimation('idle').frames.length; index += 1) {
    idle = advancePetPlayback(idle);
  }
  assert.equal(idle.done, false);
  assert.equal(idle.frameIndex, 0);

  let jumping = createPetPlayback('jumping');
  for (let index = 0; index < getPetAnimation('jumping').frames.length; index += 1) {
    jumping = advancePetPlayback(jumping);
  }
  assert.equal(jumping.done, true);
  assert.equal(jumping.frameIndex, 4);
});

test('宠物点击使用单调的 800ms 防连点窗口', () => {
  assert.equal(canTriggerPetTap(1_000, 1_799), false);
  assert.equal(canTriggerPetTap(1_000, 1_800), true);
  assert.equal(canTriggerPetTap(2_000, 1_999), false);
});

test('下载宠物使用版本化私有 PNG 路径并保留动作映射', () => {
  const pet = defaultPetCatalog.getPet('watchbuddy-sprout');
  const runtime = createDownloadedPetRuntime(pet);
  const playback = createPetPlayback('jumping', runtime);

  assert.equal(runtime.id, pet.id);
  assert.equal(runtime.version, pet.version);
  assert.equal(
    playback.framePath,
    `internal://app/wbp-${pet.version.slice(7)}-jumping-0.png`
  );
  assert.equal(petAnimationForState('watching', runtime), 'review');
  assert.equal(petInteractionAnimation('failure', runtime), 'failed');
  assert.equal(getPetAnimation('idle', runtime).frames.length, 6);
});

test('HAP 内置 73 帧且与受控手表包逐文件一致', async () => {
  const manifest = JSON.parse(
    await readFile(APP_PET_MANIFEST, 'utf8')
  );
  assert.equal(manifest.assets.length, 73);
  assert.equal(manifest.budget.totalBytes, 237_839);

  for (const asset of manifest.assets) {
    const relativeFrame = asset.path.replace(/^frames\//, '');
    const appPath = path.join(
      APP_RESOURCE_ROOT,
      'common/images/pets/watchbuddy-sprout',
      relativeFrame
    );
    const file = await readFile(appPath);
    const metadata = await stat(appPath);
    assert.equal(metadata.size, asset.bytes, asset.path);
    assert.equal(
      createHash('sha256').update(file).digest('hex'),
      asset.sha256,
      asset.path
    );
  }
});

test('页面保留真实宠物并通过后台身份接入 DeepSeek', async () => {
  const pageRoot = path.join(APP_RESOURCE_ROOT, 'pages/index');
  const [hml, source, apiConfig, appConfigText] = await Promise.all([
    readFile(path.join(pageRoot, 'index.hml'), 'utf8'),
    readFile(path.join(pageRoot, 'index.js'), 'utf8'),
    readFile(path.join(APP_RESOURCE_ROOT, 'common/api-config.js'), 'utf8'),
    readFile(path.join(
      REPOSITORY_ROOT,
      'apps/watch-huawei/entry/src/main/config.json'
    ), 'utf8')
  ]);
  const appConfig = JSON.parse(appConfigText);

  assert.match(
    hml,
    /<image class="pet-frame" src="\{\{petFramePath\}\}"><\/image>/
  );
  assert.doesNotMatch(hml, /class="face"/);
  assert.match(
    source,
    /onHide\(\) \{\s*this\.visible = false;\s*this\.cancelActiveWork\(\);/
  );
  assert.match(
    source,
    /onDestroy\(\) \{\s*this\.visible = false;\s*this\.cancelActiveWork\(\);/
  );
  assert.match(
    source,
    /cancelActiveWork\(\) \{[\s\S]*?this\.cancelRequest\(\);[\s\S]*?this\.stopPetAnimation\(\);/
  );
  assert.match(hml, /value="聊聊" onclick="playWave"/);
  assert.match(hml, /value="鼓励" onclick="playJump"/);
  assert.match(hml, /value="晚安" onclick="restPet"/);
  assert.match(hml, /AI 回复由 DeepSeek 生成/);
  assert.doesNotMatch(hml, /离线陪伴 · 无需注册/);
  assert.match(source, /registerWatchBuddy\(\{/);
  assert.match(source, /replyToCompanion\(/);
  assert.match(source, /result\.data\.companionReply/);
  assert.match(source, /serializeIdentity\(\{/);
  assert.match(source, /reason === 'http_409' && !this\.registrationRecoveryAttempted/);
  assert.match(source, /timeoutMs: 12000/);
  assert.match(source, /vibrator\.vibrate\(\{/);
  assert.doesNotMatch(source, /DEEPSEEK_API_KEY|sk-[A-Za-z0-9]/);
  assert.match(
    apiConfig,
    /https:\/\/watchbuddy\.47-239-238-27\.sslip\.io/
  );
  assert.doesNotMatch(apiConfig, /DEEPSEEK_API_KEY|sk-[A-Za-z0-9]/);
  assert.equal(appConfig.module.reqPermissions, undefined);
});

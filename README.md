# WatchBuddy

WatchBuddy 是以 HUAWEI WATCH GT 6 Pro 为唯一用户侧运行设备的 AI 伙伴。MVP
必须在不安装、不启动、不依赖任何 WatchBuddy 手机应用的情况下，由手表端独立完成角色展示、
联网对话、快捷回复、主动陪伴与可控记忆。

## 产品边界

- 唯一用户侧应用：GT 6 Pro 上的 `com.watchbuddy.watch`；
- 表端形态：HarmonyOS Lite Wearable JavaScript 应用，目标屏幕 466 × 466；
- 运行链路：手表端通过 HTTPS 直接访问 WatchBuddy 服务端；
- 不使用 HUAWEI Wear Engine，不要求 Android 手机应用保持前台或后台；
- 不允许以手机通知、手机语音、手机传感器或手机网络代理作为 MVP 降级方案；
- 云端服务负责 AI 推理、主动策略和持久记忆，手表保存最小离线缓存与设备令牌。

“独立运行”的最终验收要求手机关机、断开蓝牙或离开手表通信范围后，WatchBuddy
仍能使用手表自身可用的网络路径完成核心交互。若 GT 6 Pro 真机不提供第三方
Lite Wearable 应用可用的独立网络能力，应记录为设备能力不满足，而不是回退到手机端。

## 架构

```text
HUAWEI WATCH GT 6 Pro
└── WatchBuddy HAP
    ├── 角色与 466 × 466 交互界面
    ├── HTTPS 客户端
    ├── 设备身份与最小离线缓存
    └── 本地可撤回设置
            │
            │ HTTPS
            ▼
WatchBuddy 服务端
├── 设备注册与鉴权
├── AI 对话
├── 主动陪伴策略
└── 记忆保存、查看与删除
```

## 仓库结构

```text
apps/
├── watch-huawei/        # GT 6 Pro 独立表端；MVP 唯一用户侧应用
└── mobile-android/      # 旧 Wear Engine 验证工程；不属于新 MVP 运行链路
packages/
├── companion-core/      # 可迁移到服务端的协议、角色、主动策略与记忆核心
└── watch-pet-format/    # 手表宠物清单、语义校验与资源包验证
tools/
└── watch-pet/           # Codex Pet v2 的构建期转换器与图片测试
docs/
├── device-validation/   # GT 6 Pro 独立运行能力矩阵与真机证据
└── 2026-07-17_mvp-execution.md
```

在手表独立链路完成真机验收前，旧 Android 工程只保留为历史证据，不继续扩展，也不删除。

## 当前执行顺序

1. 建立可构建 Lite Wearable HAP 的 DevEco Studio 与 SDK 工具链；
2. 构建手表直连 HTTPS 的最小 Spike；
3. 在手机关机或断开连接时验证 GT 6 Pro 独立联网；
4. 建立 WatchBuddy 服务端并复用 `packages/companion-core`；
5. 将表端 Wear Engine 传输替换为 HTTPS API；
6. 验证后台提醒、语音与传感器能力，不提供手机端降级；
7. 签名、安装 HAP，并在 GT 6 Pro 完成全部硬验收。

完整门槛与验收证据见
[`docs/2026-07-17_mvp-execution.md`](docs/2026-07-17_mvp-execution.md)。

## 本地验证

当前可离线运行核心与表端协议测试：

```bash
npm test
```

手表宠物转换器使用 Pillow 12.2 构建期依赖（MIT-CMU，不进入 HAP 或 API 运行时）：

```bash
python3 -m pip install -r tools/watch-pet/requirements.txt
npm run test:pet-tools
```

把通过授权审查的 Codex Pet v2 转成手表资源：

```bash
npm run convert:pet -- \
  --source-dir /path/to/codex-pet-v2 \
  --output-dir /path/to/watch-pet-output \
  --source-url https://example.com/pets/my-pet \
  --author "Pet Author" \
  --license-name "Redistribution License" \
  --license-url https://example.com/pets/my-pet/license \
  --attribution "Created by Pet Author."

npm run validate:pet -- /path/to/watch-pet-output
```

转换器拒绝旧版/伪装 v2、无透明通道、错误网格、空必需格、非透明未使用格、未知授权和已有输出
目录。成功结果包含 `watch-pet.json`、本地 PNG/WebP 小帧、`conversion-report.json` 与
`preview-466.png`，原始 Codex 图集不会交给手表运行时解析。

检查 HAP 构建所需的本机工具链：

```bash
npm run doctor:watch
```

自检会识别 DevEco Studio 内置的 OHPM、Hvigor 和 Java，并确认
HarmonyOS SDK 的 `toolchains`、`ets`、`js`、`native`、`previewer`
组件是否完整；同时校验 Lite Wearable FA 模型、目标 SDK、466 × 466
圆屏、页面文件、网络权限及独立运行源码约束。

安装完整 SDK 后，构建 Lite Wearable debug HAP：

```bash
npm run build:watch
```

构建脚本固定使用 `apps/watch-huawei`、`default` 产品和 `entry@default`
模块，并在成功后打印实际 HAP 路径。

启动最小 WatchBuddy API：

```bash
npm run start:api
```

当前开发版提供以下接口：

- `GET /health`；
- `POST /v1/device/register` 与 `DELETE /v1/device`；
- `GET /v1/companion/state` 与 `POST /v1/companion/reply`；
- `GET /v1/memories?limit=10&offset=0`；
- `DELETE /v1/memories/:id` 与 `DELETE /v1/memories`。

注册和回复写操作要求 `Idempotency-Key`，设备接口使用 Bearer 令牌。请求和响应均限制在
Lite Wearable 单包 7 KB 以内，记忆列表每页最多 20 条。当前存储仅供本地闭环验证，
进程重启后会清空；持久化存储和 AI 适配器仍属于后续阶段。

本地进程默认监听 `127.0.0.1:8787`；真机验证前仍需部署到受信任的公网 HTTPS 地址，
不能把本地 HTTP 结果当作 GT 6 Pro 独立联网证据。

表端工程使用 DevEco Studio 打开 `apps/watch-huawei`。构建和安装前需要配置
HarmonyOS 手表应用、签名证书与真机调试权限；任何账号凭据、服务端密钥、签名文件与设备令牌
均不得提交到 Git。

真机联网前，将公网 HTTPS 地址写入
`apps/watch-huawei/entry/src/main/js/MainAbility/common/api-config.js`。仓库默认留空，表端会显示
“待配置服务”，避免误把本地 HTTP 或占位地址当成独立联网结果。

表端启动后会在自身沙箱内生成设备身份并直接向服务端注册，然后获取角色状态和消息。快捷回复使用
幂等键提交；网络失败时最多自动重试三次，超过上限后保留待发送记录并要求用户手动重试。
最近角色、消息摘要和待发送回复会在应用重启后恢复。由于 Lite Wearable 的轻量存储单值很小，
设备身份、消息和发件箱均使用拆分后的紧凑记录；设备令牌不会写入日志。

服务端通过手表上报的时区计算本地时段：23:00–07:00 不生成主动消息，用户选择“晚点”或
“我在忙”后进入六小时抑制期，每台设备每天最多主动发起两次互动。返回的 `nextCheckAt`
会跳过睡眠、冷却和预算阻断区间，避免表端无意义地高频轮询。

主页“记忆”入口会读取最近三条记忆，支持按条删除和经二次确认后全部清空。上述逻辑已通过
Node.js 契约测试，但必须等待 HarmonyOS SDK 安装后再由 DevEco 编译器和 GT 6 Pro 真机验证。

## 隐私边界

- AI 服务密钥只保存在服务端，不写入 HAP；
- 服务端只接收实现对话和记忆所必需的数据；
- 不持续监听麦克风；
- 原始健康数据默认不上传；
- 用户拒绝、忙碌或开启安静模式后立即停止主动互动；
- 记忆必须可在手表端查看、按条删除和全部清空；
- 不进行医疗诊断或具体心理状态断言。

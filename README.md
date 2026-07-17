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
└── companion-core/      # 可迁移到服务端的协议、角色、主动策略与记忆核心
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

启动最小 WatchBuddy API：

```bash
npm run start:api
```

当前提供 `GET /health`。本地进程默认监听 `127.0.0.1:8787`；真机验证前仍需部署到受信任的
公网 HTTPS 地址，不能把本地 HTTP 结果当作 GT 6 Pro 独立联网证据。

表端工程使用 DevEco Studio 打开 `apps/watch-huawei`。构建和安装前需要配置
HarmonyOS 手表应用、签名证书与真机调试权限；任何账号凭据、服务端密钥、签名文件与设备令牌
均不得提交到 Git。

## 隐私边界

- AI 服务密钥只保存在服务端，不写入 HAP；
- 服务端只接收实现对话和记忆所必需的数据；
- 不持续监听麦克风；
- 原始健康数据默认不上传；
- 用户拒绝、忙碌或开启安静模式后立即停止主动互动；
- 记忆必须可在手表端查看、按条删除和全部清空；
- 不进行医疗诊断或具体心理状态断言。

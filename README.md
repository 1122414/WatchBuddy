# WatchBuddy

WatchBuddy 是运行在 HUAWEI WATCH GT 6 Pro 与 Android 手机上的 AI 伙伴。MVP 目标是让角色在手表上持续存在，并通过克制的主动消息、事件跟进、快捷回复、短语音与可控记忆形成连续陪伴体验。

## 当前目标

- 目标手表：HUAWEI WATCH GT 6 Pro（466 × 466）
- 配对手机：Android 9 及以上
- 表端：HarmonyOS Lite Wearable JavaScript 应用
- 手机端：Android 应用，集成 HUAWEI Wear Engine
- 首选路线：B 级（表端文字交互 + 手机语音），设备验证通过后可升级为 A 级

## 仓库结构

```text
apps/
├── mobile-android/       # Android 手机端、Wear Engine 与本地陪伴闭环
└── watch-huawei/        # GT 6 Pro Lite Wearable 表端
docs/
├── device-validation/   # 真机能力矩阵与测试证据
└── 2026-07-17_mvp-execution.md
packages/
└── companion-core/      # 可测试的协议、角色、主动策略与记忆核心
```

## 本地验证

核心与表端协议测试不依赖第三方包：

```bash
npm test
```

Android 工程使用 Android Studio 打开 `apps/mobile-android`。构建前需要用户本人接受
Android SDK Platform 36 / Build-Tools 36 License，并在本地配置华为 App ID 与表端签名指纹。

表端工程使用 DevEco Studio 打开 `apps/watch-huawei`。运行
`scripts/configure-watch-peer.mjs` 可在构建前把 Android 签名 SHA-256 写入表端本地配置。
华为开发者账号、签名文件、App ID 与服务申请材料不得提交到 Git。

当前实现包括：

- 手机与手表双向 JSON、ACK、幂等、过期和有界重试；
- 表端常驻角色、状态、消息卡与 2–4 个快捷回复；
- 日常问候、随机关心、关系跟进、每日预算、冷却与安静模式；
- 本地记忆查看、按条删除、全部清空和显式语音文本保存；
- 用户点击后才开始的系统 ASR、固定模板降级回复与手机 TTS；
- 基于手机加速度计的 10 秒真实活动采样和猜对/猜错降权。

## 隐私边界

- 不持续监听麦克风；
- 原始健康数据默认不发送给语言模型；
- 用户拒绝、忙碌或开启安静模式后立即停止主动互动；
- 记忆可查看、删除和清空；
- 不进行医疗诊断或具体心理状态断言。

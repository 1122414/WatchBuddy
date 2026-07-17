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
├── mobile-android/       # Android 手机端（下一阶段）
└── watch-huawei/        # GT 6 Pro Lite Wearable 表端
docs/
├── device-validation/   # 真机能力矩阵与测试证据
└── 2026-07-17_mvp-execution.md
packages/
└── companion-core/      # 可测试的协议、角色、主动策略与记忆核心
```

## 本地验证

核心模块不依赖第三方包：

```bash
npm test
```

表端工程使用 DevEco Studio 打开 `apps/watch-huawei`。手机端构建和真机安装说明将在 Android 工程落地后补充。

## 隐私边界

- 不持续监听麦克风；
- 原始健康数据默认不发送给语言模型；
- 用户拒绝、忙碌或开启安静模式后立即停止主动互动；
- 记忆可查看、删除和清空；
- 不进行医疗诊断或具体心理状态断言。

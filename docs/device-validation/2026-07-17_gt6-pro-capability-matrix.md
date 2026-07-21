# HUAWEI WATCH GT 6 Pro 手表独立能力矩阵

> 初始日期：2026-07-17
>
> 最近校准：2026-07-21
>
> 判定原则：区分“WatchBuddy 没有手机配套 App”和“手表不依赖任何手机联网”两项能力，不把前者冒充后者。

## 设备分类与交付路线

| 项目 | 当前证据 | 结论 |
|---|---|---|
| 目标设备 | 用户持有 HUAWEI WATCH GT 6 Pro | 继续作为真机目标 |
| 官方开发分类 | 华为指南列出 WATCH GT 6、466 × 466、支持 API 20；应用调测助手对 API 20 完整包返回错误 40，而 API 17 最小探针安装成功 | GT 6 Pro 使用 Lite Wearable 路线；当前安装诊断基线为 API 17 |
| 主工程 | `apps/watch-huawei` | Lite Wearable JavaScript FA 主路径 |
| 实验工程 | `apps/watch-huawei-wearable` | 保留 ArkTS 迁移原型，不作为 GT 6 Pro 安装包，不删除 |
| 包名 | `com.watchbuddy.watch` | 保持不变 |
| 设备类型 | `deviceType: ["liteWearable"]` | 与官方设备分类一致 |
| 屏幕 | 页面按 466 × 466 圆屏设计；0.1.1 不声明 `distroFilter` | 保留圆屏 UI，避免调测助手错误 40 |
| 网络 API | 0.4.0 显式声明 `ohos.permission.INTERNET` 后安装报错误 46；0.4.1 保留 `@system.fetch` 但不显式声明权限 | 先恢复可安装基线，再以真机请求结果判断系统是否允许 HTTPS |
| 手机业务依赖 | 主工程无 Wear Engine、手机 peer 或 WatchBuddy 手机 App | 符合“没有 WatchBuddy 手机配套 App”边界 |
| 本机构建 | `npm run build:watch:signed` 生成 3438361 字节的 0.4.1 签名 HAP，SHA-256 `b7dd5d94…51fcfab` | 已确认包内无显式联网权限且保留 `@system.fetch`，待真机安装与 HTTPS 探测 |

## 最近验证的连接与安装通道

| 检查项 | 2026-07-20 结果 | 判定 |
|---|---|---|
| USB 物理连接 | macOS USB 树识别到“一加 13T” | 电脑已连手机，不代表已连手表 |
| HDC 目标 | `hdc list targets -v` 无输出 | DevEco 当前没有可直接调试的手机或手表目标 |
| 手机—手表 | 用户确认一加 13T 通过蓝牙连接 GT 6 Pro | 对日常配对有用，但不能把手表转发成 HDC 目标 |
| Lite Wearable 调测 | Lite Wearable 不能直接连接 DevEco Studio；需手工签名，并由已配对手机上的华为运动健康和应用调测助手安装 HAP | 无线调试或 USB/HDC 不是 GT 6 Pro 的安装路线 |
| 旧手机兼容性 | 一加 13T 的应用调测助手识别 GT 6 Pro，并成功安装 API 17 最小探针 | 非华为手机可承担该安装桥接 |
| 当前手机状态 | 用户正在更换手机，并明确要求暂不向手机安装或复制任何内容 | 等用户明确允许后再检查新手机 |

应用调测助手和运动健康只是华为规定的开发安装工具，不是 WatchBuddy 手机端。不过，如果运行期
HTTPS 也必须依靠已配对手机提供系统网络，这仍然不满足“手机关机后在线”的严格独立联网定义。

## 网络独立性硬门槛

GT 6 Pro 官方规格的“数据连接”只列出 NFC、Bluetooth 2.4 GHz 和 GNSS，没有列出 Wi‑Fi、蜂窝或
eSIM。基于该规格，手机断开后的任意 HTTPS 目前没有可识别的独立网络承载，因此严格的“手机关机后
仍在线”目标大概率不受硬件支持。该结论是基于规格做出的工程判断，最终仍以真机断开蓝牙测试为准。

| 能力 | 验证方法 | 当前状态 | 失败处理 |
|---|---|---|---|
| 离线宠物与 UI | 安装后断开蓝牙，从手表启动、点击宠物、切页并重启 | 源码/测试完成，待真机 | 这是 GT 6 Pro 可继续交付的核心 |
| 配对状态下 HTTPS | 保持手机配对，手表调用公网 `GET /health` | 待安装和公网端点 | 记录网络是否经系统配对链路 |
| 手机断开后 HTTPS | 关闭手机蓝牙或手机关机后再次调用 `GET /health` | 高风险，官方规格无独立网络承载 | 失败即明确标记 GT 6 Pro 不满足严格在线独立性，不引入手机 App |
| 无 WatchBuddy 手机 App | 不安装或启动 Android/iOS WatchBuddy | 主工程已满足，待真机流程确认 | 不回退到 Wear Engine |
| 调试签名 | AGC debug Profile 绑定 `com.watchbuddy.watch`、开发证书和目标 GT 6 Pro；0.1.1 签名 HAP 已生成 | 已完成，敏感材料均在仓库外 | 不提交证书、私钥、Profile 或口令 |
| 最小探针安装 | 应用调测助手安装 112 KiB、API 17、无权限和过滤器的探针 | 安装成功 | 证明签名、Profile、设备注册和安装桥接有效 |
| 完整 HAP 安装 | 应用调测助手选择 `WatchBuddy-0.4.1-debug-signed.hap` | 已构建，尚未复制到手机 | 用户明确允许后再复制并安装，先确认不再出现错误 46 |

## MVP 功能验收

| 能力 | 当前实现 | 真机证据要求 |
|---|---|---|
| 角色主页 | Lite Wearable JS/HML/CSS，466 × 466 圆屏 | 无裁切、状态可辨识 |
| 内置宠物 | 芽芽 73 帧、状态映射、800 ms 防连点、振动 | 离线可见，切页/销毁停止动画 |
| 服务端注册与状态 | `@system.fetch` HTTPS、8 秒超时、7 KiB 响应限制 | 配对和断开场景分别记录 |
| 对话与快捷回复 | 幂等发件箱、最多三次有界重试 | 手表显示服务端回应且不重复提交 |
| 安静模式与记忆 | 开关、最近三条、单删、二次确认清空 | 设置和删除端到端生效 |
| 受控宠物目录 | 鉴权目录、分页 Base64、PNG/长度/SHA‑256 校验 | 全量完成才切换，失败回滚内置宠物 |
| 缓存与损坏恢复 | 2 MiB 活跃/4 MiB 临时预算、版本化文件与选择指针 | 空间不足、损坏和重启样本通过 |
| 系统表盘 | Theme Studio Pro 独立主题路线 | 不把 WatchBuddy 应用页面冒充系统表盘 |

## 宠物来源边界

- 原创 Sprout（芽芽）已完成 Codex Pet v2 图集、73 帧手表转换、来源和哈希记录；
- `codex-pets.net` 通用条款不足以授权 WatchBuddy 再分发，必须取得单独开放许可或权利人书面授权；
- 手表不直接下载、解释或执行第三方原始宠物包；所有资源先在构建期或服务端受控转换；
- 动态安装虽已在 Lite Wearable 源码和 Node.js 测试中实现，但尚未在 GT 6 Pro 上证明文件 API、
  运行时图片路径、存储预算和网络传输均可用。

## 最终判定

只有下列证据同时存在，才能声称 WatchBuddy 已安装并在 GT 6 Pro 上按定义运行：

1. 可重复构建的手工签名 Lite Wearable HAP、版本、大小和 SHA‑256；
2. 应用调测助手安装记录及 GT 6 Pro 独立启动记录；
3. 离线宠物互动、状态恢复、损坏降级和重启记录；
4. 配对状态和手机断开状态各自的 HTTPS 结果，不能混写；
5. 表端不存在 Wear Engine、手机 peer 或 WatchBuddy 手机 App 依赖；
6. 对话、回复、记忆和宠物目录只在相应网络能力真实可用时标记通过。

## 官方依据

- [华为：轻量级智能穿戴应用开发](https://developer.huawei.com/consumer/cn/doc/best-practices/bpta-lite-wearable-guide)
- [华为：HUAWEI WATCH GT 6 Pro 规格参数](https://consumer.huawei.com/cn/wearables/watch-gt6-pro/specs/)
- [华为：AGC 添加调试设备](https://developer.huawei.com/consumer/cn/doc/app/agc-help-add-device-0000001946142249)
- [华为：穿戴设备应用开发概览](https://developer.huawei.com/consumer/cn/multidevice/wearables/)
- [华为：Theme Studio Pro 工具](https://developer.huawei.com/consumer/cn/doc/content/themes-tools-0000001104440212)

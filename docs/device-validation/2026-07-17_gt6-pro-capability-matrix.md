# HUAWEI WATCH GT 6 Pro 手表独立能力矩阵

> 初始日期：2026-07-17
> 最近校准：2026-07-20
> 判定原则：WatchBuddy 只有手表端应用，不依赖 WatchBuddy 手机应用或 Wear Engine。

## 目标设备与当前工程

| 项目 | 当前证据 | 结论 |
|---|---|---|
| 目标设备 | 用户持有 HUAWEI WATCH GT 6 Pro；官方产品页标明 HarmonyOS 6 | 使用智能穿戴路线 |
| 官方开发分类 | 华为将 HarmonyOS 5.1 及以上穿戴设备归为“智能穿戴”，使用 ArkTS 与 ArkUI | 不再把 GT 6 Pro 当作 Lite Wearable |
| 主工程 | `apps/watch-huawei-wearable` | 新的智能穿戴主路径 |
| 历史工程 | `apps/watch-huawei` | 暂存旧 Lite Wearable JS 实现，迁移完成前不删除 |
| 包名 | `com.watchbuddy.watch` | 保持不变 |
| 设备类型 | `deviceTypes: ["wearable"]` | 正确 |
| 应用模型 | ArkTS Stage 模型 | 正确 |
| SDK | target `6.0.2(22)`，compatible `5.0.2(14)` | 使用 API 22 编译并保持基础兼容 |
| 网络权限 | `ohos.permission.INTERNET` | 已声明，待真机 HTTPS |
| 最小 HAP | `npm run build:watch` 成功生成 unsigned HAP | 本机构建通过 |
| 手机依赖 | 新工程没有 Wear Engine 或手机 peer | 符合手表端独立应用定义 |

“独立应用”表示 WatchBuddy 的 UI、业务逻辑、存储和网络请求都在手表应用或服务端完成。手表最终
使用 Wi‑Fi、蜂窝网络或系统提供的联网路径，需由 GT 6 Pro 真机判定；即使设备联网路径经过已配对
手机，也不得要求安装、启动或保活 WatchBuddy 手机应用。

## 独立运行硬门槛

| 能力 | 验证方法 | 当前状态 | 失败处理 |
|---|---|---|---|
| 最小 HAP 构建 | `npm run build:watch` | 已通过（unsigned） | 保持可重复构建 |
| 调试/发布签名 | DevEco/AGC 配置 `com.watchbuddy.watch` 签名 | 待验证 | 不提交密钥 |
| 表端应用安装 | GT 6 Pro 应用列表出现 WatchBuddy | 待验证 | 核对产品、签名与安装通道 |
| 表端独立启动 | 仅从手表打开 WatchBuddy | 待验证 | 修复 HAP 或兼容级别 |
| HTTPS GET | 手表调用 `GET /health` | 待迁移/真机 | 使用 Network Kit，不引入手机 App |
| HTTPS POST | 手表提交注册或回复 JSON | 待迁移/真机 | 校验超时、鉴权与幂等 |
| 设备令牌存储 | 重启应用后令牌仍可用 | 待迁移/真机 | 使用 Preferences/安全存储 |
| 离线提示 | 断网时有限时失败且界面显示离线 | 待迁移/真机 | 不允许假在线 |
| 无配套 App | 不安装或启动 WatchBuddy Android/iOS App | 待真机验收 | 不回退到 Wear Engine |
| 手机断开测试 | 关闭蓝牙后再次访问服务端 | 能力 Spike | 若设备无独立网络，只记录设备边界 |
| 息屏/后台提醒 | 应用关闭或息屏后收到测试提醒 | 能力 Spike | 不支持则下次打开呈现 |

阶段 0 的硬要求是“不需要 WatchBuddy 手机应用或 Wear Engine”。“手机断开后仍联网”属于设备
网络能力验证，不再作为手表端独立应用定义的前提。

## MVP 功能验收

| 能力 | 真机证据要求 | 当前状态 |
|---|---|---|
| 角色主页 | 466 × 466 圆屏无裁切，状态可辨识 | ArkTS 已构建，待真机视觉验收 |
| 内置宠物 | 离线可见、可点击、切页停止动画 | ArkTS 73 帧已进 HAP，待真机验收 |
| 服务端注册 | 手表获得可撤销设备令牌 | 服务端通过，ArkTS 待迁移 |
| 对话与快捷回复 | 手表直连服务端并显示回应 | 服务端通过，ArkTS 待迁移 |
| 安静模式 | 手表设置后服务端立即抑制 | 服务端通过，ArkTS 待迁移 |
| 记忆控制 | 查看、按条删除和全部清空 | 服务端通过，ArkTS 待迁移 |
| 离线恢复 | 未提交回复有界重试且不重复 | 旧 JS 通过，ArkTS 待迁移 |
| 服务端失败降级 | 固定模板，不暴露密钥或内部错误 | 待完成 |

## 宠物系统能力矩阵

| 能力 | 当前证据 | 当前状态 | 硬验收 |
|---|---|---|---|
| Codex v2 输入 | hatch-pet 契约为 8 × 11、1536 × 2288、`spriteVersionNumber: 2` | 工具测试通过 | schema、像素、透明度、帧和摘要通过 |
| 默认宠物 | Sprout（芽芽）已有 73 个手表 PNG 帧 | ArkTS HAP 已内置 | 离线可见与来源可追溯，待真机确认 |
| 状态动画 | idle、waiting、review、jumping、waving、running、failed 等映射已定义 | ArkTS 编译通过 | 动画生命周期已实现，真机帧率待验收 |
| 受控目录 | 服务端提供鉴权列表、清单、分页摘要和按 ID 下载 | 服务端完成 | 手表只读取 WatchBuddy 审核目录 |
| codex-pets.net 导入 | 构建期导入器限制 HTTPS 来源、预算、ZIP 路径、v2 清单与许可证 | 工具完成 | 不让手表直接执行或信任第三方包 |
| 动态安装 | 旧 JS 已实现临时写入、SHA‑256、全部成功后切换和失败回滚 | ArkTS 待迁移 | 真机验证文件、摘要、缓存与原子切换 |
| 芽芽公开授权 | 当前自定义许可证不是 CC-BY-4.0 | 阻塞公开发布 | 必须取得用户明确授权后才可改许可/上传 |
| 系统表盘 | Theme Studio Pro 是独立主题路线 | 不属于当前 HAP | 不把应用页面冒充成系统表盘 |

宠物 MVP 的第一交付边界是 WatchBuddy 应用主页内的内置宠物。动态换宠物只有在 ArkTS 实现、
完整性回滚和真机文件能力通过后才开放。

## 扩展能力 Spike

| 能力 | 验证目标 | 当前状态 | 不支持时的产品边界 |
|---|---|---|---|
| 本地通知/Push | 应用关闭时手表主动展示 | 待验证 | 下次打开应用呈现 |
| 表端录音 | 用户明确触发后生成短音频 | 待验证 | MVP 保留文字 |
| 表端播放 | 可播放短 TTS 且可中断 | 待验证 | MVP 保留文字 |
| 手表活动信号 | 至少一种低风险活动/传感器信号 | 待验证 | 不做状态猜测 |

任何扩展能力失败都不得回退到手机麦克风、手机扬声器、手机传感器或手机通知。

## 旧路线证据与决策

| 历史事实 | 证据 | 新结论 |
|---|---|---|
| Android APK 构建、安装、启动成功 | 历史提交 `eef4bef` | 仅保留为历史证据 |
| Wear Engine 双向协议已实现 | 历史提交 `c9f8765` | 退出表端运行路径 |
| Android APPID | `118346425` | 不用于手表独立架构 |
| Wear Engine 申请 | 华为审核指出手机 App 需活跃，并建议手表联网直达服务端 | 不再重新申请 |
| Lite Wearable JS 工程 | `apps/watch-huawei` | 只作为迁移来源，不用于 GT 6 Pro 交付 |

## 最终判定

只有下列证据同时存在，才能声称 WatchBuddy 可直接安装并独立运行在 GT 6 Pro：

1. 可重复构建的签名 HAP、版本号、大小和 SHA-256；
2. GT 6 Pro 上的安装和独立启动记录；
3. 不启动 WatchBuddy 手机应用时的 HTTPS 成功记录；
4. 手表完成注册、对话、回复、宠物互动、记忆和删除的端到端记录；
5. 表端运行代码中不存在 Wear Engine 或手机 peer 依赖；
6. 离线、重启、令牌失效和服务端错误均有真机结果。

## 官方依据

- [华为：HUAWEI WATCH GT 6 Pro](https://consumer.huawei.com/cn/wearables/watch-gt6-pro/)
- [华为：穿戴设备应用开发概览](https://developer.huawei.com/consumer/cn/multidevice/wearables/)
- [华为：穿戴应用开发入门](https://developer.huawei.com/consumer/cn/multidevice/wearables/get-started/)
- [华为：智能穿戴应用开发](https://developer.huawei.com/consumer/cn/multidevice/wearables/smart/)
- [华为：Theme Studio Pro 工具](https://developer.huawei.com/consumer/cn/doc/content/themes-tools-0000001104440212)

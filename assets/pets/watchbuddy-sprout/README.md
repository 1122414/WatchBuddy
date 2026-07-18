# Sprout（芽芽）

Sprout 是 WatchBuddy 的原创默认宠物。源资源遵循 Codex Pet v2 的 8 × 11、
1536 × 2288 图集契约；`watch/` 是通过仓库转换器生成的手表专用帧包。

## 目录

- `source/`：可追溯的 Codex Pet v2 源清单与图集；
- `watch/`：缩放、压缩并逐文件校验后的 Watch Pet 包；
- `qa/`：确定性校验、动画预览、方向盲测和视觉审查证据。

`watch/` 中的资源可以打入 HAP 并离线使用。不要让手表直接加载 `source/`
中的原始图集，也不要在设备上运行转换流程。

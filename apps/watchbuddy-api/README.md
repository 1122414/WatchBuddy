# WatchBuddy API

WatchBuddy API 面向手表独立应用。除健康检查与设备注册外，接口都要求设备注册后获得的
Bearer 令牌。

## 受控宠物目录

| 接口 | 用途 |
|---|---|
| `GET /v1/pets` | 列出经过审核的宠物及版本、清单摘要和预览帧 |
| `GET /v1/pets/:petId` | 获取不含资源摘要数组的紧凑渲染清单 |
| `GET /v1/pets/:petId/assets?limit=16&offset=0` | 分页获取资源长度、SHA-256 与下载地址 |
| `GET /v1/pets/:petId/assets/:assetId` | 下载白名单内的单个 PNG 资源 |
| `GET /v1/pets/:petId/assets/:assetId?encoding=base64` | 获取 Lite Wearable 可读取的 Base64 JSON |

宠物列表、渲染清单、单页资源摘要、Base64 JSON 和每个二进制帧均受 7KB 响应上限约束。资源接口返回
`Content-Length`、`ETag` 和 `X-Content-SHA256`，内容版本不变时支持
`If-None-Match`。手表端应使用资源摘要里的 `base64Url`，解码后再次核对长度和
SHA-256，再写入应用私有目录。

服务启动时会完整校验每个受控包的清单、授权声明、路径、文件类型、魔数、长度、总预算和
SHA-256，并把允许下载的资源 ID 固定到内存目录。接口不接受任意 URL、文件路径、上传内容或
未经转换的 Codex Pet 源包。

当前目录只包含仓库内的 Sprout（芽芽）256 色透明 PNG 轻量包。表端动态写入、原子切换、
单活跃版本缓存与失败回滚已经通过模拟文件适配器测试，但尚未完成 Lite Wearable 真机验证；
因此这些接口目前只构成受控同步边界，不代表在线换宠物已经开放。

单设备默认限流为每分钟 120 次。一次 73 帧同步按 20 条分页、逐帧串行下载，连同目录和清单
请求低于该上限；表端同一时间只允许一个手动触发的宠物安装任务。

## 本地运行

```sh
npm run start:api
```

默认监听 `127.0.0.1:8787`。

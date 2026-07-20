# WatchBuddy API

WatchBuddy API 面向手表独立应用。除健康检查与设备注册外，接口都要求设备注册后获得的
Bearer 令牌。

## 陪伴设置

| 接口 | 用途 |
|---|---|
| `GET /v1/settings` | 读取设备当前安静模式 |
| `PUT /v1/settings` | 用严格布尔字段 `quietMode` 开启或关闭安静模式 |

开启安静模式会立即撤下当前未回复的主动消息，并在后续状态请求中以 `quiet_mode`
硬阻止新的主动互动。设置保存在服务端设备记录中，手表每次同步状态时以服务端结果为准。

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

本地开发默认使用内存状态。要验证服务重启恢复，显式配置状态文件：

```sh
WATCHBUDDY_STATE_FILE=.local/watchbuddy-state.json npm run start:api
```

状态文件使用临时文件写入、`fsync` 和原子改名，文件权限为 `0600`。内容包括设备令牌的
SHA-256 摘要、陪伴状态、安静模式和用户记忆，不包含明文设备令牌；它仍属于敏感数据，
不得提交 Git 或放入公开下载目录。

## 容器部署

从仓库根目录构建：

```sh
docker build -f apps/watchbuddy-api/Dockerfile -t watchbuddy-api .
docker run --rm \
  -p 8787:8787 \
  -v watchbuddy-data:/data \
  watchbuddy-api
```

生产环境必须把持久卷挂载到 `/data`，并由可信网关或托管平台在容器前终止 HTTPS。
手表只能配置受信任的公网 `https://` 地址，不能直连容器的明文 HTTP 端口。

当前 JSON 状态存储只支持单实例进程；不能让多个副本同时写同一文件。需要水平扩容前，
应换成具备事务和并发控制的服务端数据库。容器文件已就绪，但仓库没有绑定或购买任何
云平台，也没有替用户创建公网服务。

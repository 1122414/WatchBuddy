# WatchBuddy API

WatchBuddy API 面向手表独立应用。除健康检查与设备注册外，接口都要求设备注册后获得的
Bearer 令牌。

## AI 陪伴回复

`POST /v1/companion/reply` 的文字回复会附带 `companionReply`：

```json
{
  "text": "我在这里，继续说给我听吧。",
  "fallback": false
}
```

服务端支持 OpenAI Responses API 和 DeepSeek Chat Completions API。默认保持 OpenAI
`gpt-5.6-terra` 与 `low` 推理强度；设置 `WATCHBUDDY_AI_PROVIDER=deepseek` 后改用
`deepseek-v4-flash` 非思考模式，适合手表短回复的延迟边界。两种提供商都只接收不超过 64 个字符
的用户文字，输出必须是经过服务端校验、不超过 38 个字符的单句纯文本。

OpenAI 请求设置 `store: false`，设备 ID 仅以 SHA-256 后的 `safety_identifier` 发送；DeepSeek
同样只接收 SHA-256 后的 `user_id`。密钥、请求正文、模型输出和上游错误均不写入结构化日志。
只有所选提供商配置了对应密钥才会请求模型；未配置密钥、8 秒超时、上游错误、非 JSON、未完成、
内容过滤、截断或超长输出都会返回同一个固定模板，API 不向手表暴露内部错误。

| 环境变量 | 默认值 | 用途 |
|---|---:|---|
| `WATCHBUDDY_AI_PROVIDER` | `openai` | 选择 `openai` 或 `deepseek` |
| `OPENAI_API_KEY` | 空 | 服务端 OpenAI API 密钥，不得写入 HAP 或 Git |
| `DEEPSEEK_API_KEY` | 空 | 服务端 DeepSeek API 密钥，不得写入 HAP 或 Git |
| `WATCHBUDDY_OPENAI_MODEL` | `gpt-5.6-terra` | 覆盖 OpenAI 模型 |
| `WATCHBUDDY_DEEPSEEK_MODEL` | `deepseek-v4-flash` | 覆盖 DeepSeek 模型 |
| `WATCHBUDDY_OPENAI_TIMEOUT_MS` | `8000` | OpenAI 超时，允许 1–60000 毫秒 |
| `WATCHBUDDY_DEEPSEEK_TIMEOUT_MS` | `8000` | DeepSeek 超时，允许 1–60000 毫秒 |

启用 DeepSeek 时，把新密钥注入服务器的秘密环境变量，并设置：

```sh
WATCHBUDDY_AI_PROVIDER=deepseek npm run start:api
```

不要把密钥直接写在命令、源码、`.env`、HAP 或 Git 中；生产环境应使用部署平台的秘密管理功能。

自动化测试使用本地模拟响应，不消费 OpenAI 或 DeepSeek 的真实 API 配额。当前离线诊断 HAP
尚未调用这条文字对话链路；
必须先完成阶段 0 的 GT 6 Pro 独立 HTTPS 真机门槛，才可称为手表端 AI 已连通。

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

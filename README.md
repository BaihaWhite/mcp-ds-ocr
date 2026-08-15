# DSH OCR 视觉识别插件（动态 Cordis）

视觉模型 OCR 插件（OpenAI / Anthropic 双协议）：配置 `API 格式 / API URL / API Key / Model Name`（设置 → 插件 → 插件配置 的可折叠卡片），支持**获取模型列表**与**测试连接**按钮；传入图片自动识别；结果做**百分比坐标化**并以**对角线两点方框**描述；低置信度文字自动**同图区域重读**再识别并合并。

## 文件

| 文件 | 说明 |
| --- | --- |
| `plugin/host.js` | Host 半：配置状态、RPC（get/set-config、list-models、test-config）、`ocr_recognize` 工具（curl 双协议适配、坐标归一化、区域重读合并） |
| `plugin/client.js` | Client 半：设置 → 插件 的「OCR 视觉识别」可折叠配置卡片 |
| `tools/mock-ocr-server.py` | OpenAI + Anthropic 兼容 mock（端口 18923：`/models`、`/chat/completions`、`/v1/models`、`/v1/messages`） |
| `test-400x300.png` | 400×300 测试图片 |
| `.dsh-ocr/config.json` | 配置持久化文件（工作区根目录，git 已忽略，含 API Key 不入库） |

## 配置项

| 字段 | 说明 |
| --- | --- |
| `apiFormat` | `openai`（POST `{apiurl}/chat/completions`，Bearer 认证）或 `anthropic`（POST `{apiurl}/v1/messages`，x-api-key + anthropic-version 头） |
| `apiurl` | 服务商 base URL（OpenAI 兼容如 `https://api.example.com/v1`；Anthropic 如 `https://api.anthropic.com`，自动补 `/v1`） |
| `apikey` | 认证密钥（仅写入 `.dsh-ocr/config.json`，UI 只回显脱敏） |
| `model` | 视觉模型名；可由「获取模型列表」按钮拉取后从旁侧下拉选择 |
| `threshold` | 置信度阈值（默认 0.7），低于阈值触发区域重读 |
| `coordMode` | `both` / `percent` / `pixel` |
| `retryEnabled` | 是否自动区域重读 |
| `maxRounds` | 重读最大轮数（1-3，默认 2） |

## 配置卡片功能

- 顶部 **API 格式**下拉：OpenAI 兼容 / Anthropic（切换后 API URL 占位符、模型占位符联动）。
- **获取模型列表**：GET `{base}/models`（按格式自动选端点与认证头），结果填充 Model Name 旁的下拉（可再键入过滤，datalist 联动），60s 缓存、配置变更自动失效。
- **测试连接**：强制刷新模型列表，报告耗时、模型数、已配置模型是否在列表中。
- **保存 / 重置**：保存 = 更新内存 + 写工作区配置文件（未发现工作区时先存内存、首次工具调用补写）。

## 工具

`ocr_recognize(image_path, coord_mode?, retry_if_uncertain?, max_rounds?, focus_regions?, prompt_hint?)`

- `image_path`：绝对路径或工作区相对路径（PNG/JPEG/GIF/WebP，≤10MB）。
- 结果每项：`text`、`box_px`（像素框）、`box_pct`（百分比框）、`description`（`左上(x%, y%) → 右下(x%, y%)`）、`confidence`、`retried`。
- 低置信度（< threshold）→ 同一图片按不确定区域像素框重读精读 → IoU 匹配按高置信合并，`attempts` 记录调用次数。
- `focus_regions`：手动指定 `[x1,y1,x2,y2]` 区域精读一次。
- 图片宽高由插件本地解析图片头（无需图像库）。

## 架构要点（已核实的运行时契约）

- 工具注册：`harness.defineTool({name, description, parameters, output:{schema, render}, execute})` + `harness.registerTool(ctx, tool)`；`render` 返回 content blocks 数组（`[{type:'text', text}]`）。
- HTTP：Host 沙箱无 `fetch`，通过 `shell` 服务执行 curl；请求体走 `stdin`，apikey 经 `env` 注入（`$DSH_OCR_API_KEY`），避免出现在命令行。
- 双协议：Anthropic 请求体为 `{model, max_tokens, system?, messages:[{role:'user', content:[{type:'text'},{type:'image', source:{type:'base64', media_type, data}}]}]}`；响应取 `content[]` 中 text 块拼接。
- 配置持久化：`fs` 服务读写 `<workspace>/.dsh-ocr/config.json`；工作区通过工具执行上下文的 `exec.agent.session.header.cwd` 发现（回退 `sandboxPolicy.workspaceRoot`，排除 `/`，再回退 fs 默认 cwd）；UI 保存 = 更新内存 + 写文件，未发现工作区时先存内存、首次工具调用时补写。
- 客户端：`slots.inject('settings.plugin.item', …)` 注册卡片（list 协议，`id:'dsh-ocr'`，order 95）；主题样式用 `--dsw-alias-*` CSS 变量。
- 参考案例：DSH 官方 `dsh-client-ui-settings-models`（ModelListEditor 的「获取模型列表」模式）与 [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list)、[Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)。

## 限制

- 动态插件配置随会话进程生命周期；工作区配置文件使其跨插件重启/更新生效，但换工作区需重新配置。
- 重读策略为同图区域重读（用户选定），不依赖系统截图工具。
- 若响应非 2xx / 非 JSON / 协议字段缺失，返回可读错误；apikey 全程脱敏、不落日志。
- 移植为 dsh-web-ui 正式插件（侧边栏入口 + 全局持久化）时：把 `plugin/host.js` 的识别逻辑迁到 Host 包、`plugin/client.js` 的卡片迁到设置项即可。

## 端到端测试（本地 mock）

```bash
python3 tools/mock-ocr-server.py &          # 127.0.0.1:18923
# .dsh-ocr/config.json 指向 http://127.0.0.1:18923
# 调用 ocr_recognize(image_path='test-400x300.png')
# 期望：首轮 "HELL0 4?"(conf 0.42) → 重读 → "HELLO 42"(conf 0.97, retried)
# box [40,30,200,150] @400x300 → box_pct [10,10,50,50]，description "左上(10%, 10%) → 右下(50%, 50%)"
```

✅ 实测通过（ocr-1/pkg-3，2026-08）：

- OpenAI 格式：`mock-ocr-v1`，2 次调用，`HELLO 42`(97%，重读后确认) + `精确文本`(95%)，坐标 `[10,10,50,50]`。
- Anthropic 格式：`claude-mock-1`（apiFormat 切 anthropic 后走 `/v1/messages`，x-api-key/anthropic-version 头正常），同样 2 次调用、重读合并正常。
- `GET /models` 与 `GET /v1/models` 返回模型列表（mock 各 3/2 个），供卡片「获取模型列表 / 测试连接」使用。
- 错误路径返回可读中文报错。

# dsh-ocr · DSH OCR 视觉识别插件

视觉模型 OCR 插件（OpenAI / Anthropic 双协议）：配置 `API 格式 / API URL / API Key / Model Name`（设置 → 插件 → 插件配置 的可折叠卡片），支持**获取模型列表**与**测试连接**按钮；`ocr_recognize` 工具对传入图片自动识别；结果**百分比坐标化**并以**对角线两点方框**描述；低置信度文字自动**同图区域重读**再识别并合并。

## 安装

### 方式一：插件商店（推荐，已收录）

仓库已打 `topic:dsh-plugin` 并被商店收录，`package.json` 已声明 `dsh.bundle.patch`：

1. 打开 **设置 → 插件 → 插件商店**，搜索 `dsh-ocr`（或 `BaihaWhite`）；
2. 卡片点「安装」：自动 `pnpm add github:BaihaWhite/mcp-ds-ocr` + 写入 profile bundles；
3. 重启 DSH 生效；之后可「更新 / 卸载 / 一键更新」。

### 方式二：手工挂载（本地开发）

```bash
ln -s /root/projects/mcp-ds-ocr ~/.dsh/profiles/web/dsh-ocr
ln -s ../dsh-ocr ~/.dsh/profiles/web/node_modules/dsh-ocr
# ~/.dsh/profiles/web/cordis.patch.yml 增加：
# - insert:
#     - id: dsh-ocr
#       name: 'dsh-ocr'
#       config: {}
# 重启 dsh web（watchdog 会自动拉起）
```

## 文件

| 文件 | 说明 |
| --- | --- |
| `lib/index.js` | 宿主半（ESM 无构建）：`ocr_recognize` 工具、`/api/dsh-ocr/models|test` 路由（loopback+同源校验）、配置经 dsh-settings 持久化 |
| `lib/client.js` | 浏览器半（ModuleLoader lazy-factory）：设置 → 插件 的可折叠配置卡片 |
| `package.json` | 包清单：`exports`（`.` 宿主 / `./client` 浏览器）、`dsh.bundle.patch`（商店安装）、`dsh.client`（浏览器自动发现） |
| `cordis.patch.yml` | bundle patch：声明 `dsh-ocr` 插件行 |
| `plugin/` | 早期动态 Cordis 版本源码存档（已由正式包取代） |
| `test-400x300.png` | 400×300 测试图片 |

## 配置项（dsh-settings 持久化，全局生效）

| 字段 | 说明 |
| --- | --- |
| `apiFormat` | `openai`（POST `{apiurl}/chat/completions`，Bearer）或 `anthropic`（POST `{apiurl}/v1/messages`，x-api-key + anthropic-version，自动补 `/v1`） |
| `apiurl` | 服务商 base URL |
| `apikey` | 认证密钥（明文存于本机设置文件，请勿外传） |
| `model` | 视觉模型名；「获取模型列表」拉取后可从旁侧下拉选择 |
| `threshold` | 置信度阈值（默认 0.7），低于阈值触发区域重读 |
| `coordMode` | `both` / `percent` / `pixel` |
| `retryEnabled` | 是否自动区域重读（默认开） |
| `maxRounds` | 重读最大轮数（1-3，默认 2） |

## 工具

`ocr_recognize(image_path, coord_mode?, retry_if_uncertain?, max_rounds?, focus_regions?, prompt_hint?)`

- `image_path`：绝对路径或工作区相对路径（PNG/JPEG/GIF/WebP，≤10MB；相对路径按 sandboxPolicy 工作区根 → 进程 cwd 解析）。
- 结果每项：`text`、`box_px`（像素框）、`box_pct`（百分比框）、`description`（`左上(x%, y%) → 右下(x%, y%)`）、`confidence`、`retried`。
- 低置信度（< threshold）→ 同一图片按不确定区域像素框重读精读 → IoU 匹配按高置信合并，`attempts` 记录调用次数。
- `focus_regions`：手动指定 `[x1,y1,x2,y2]` 区域精读一次。
- 图片宽高由插件本地解析图片头（PNG/JPEG/GIF/WebP，无需图像库）。

## 架构要点

- 宿主半：`defineTool`（`@deepseek-ai/dsh-tools`）+ `ctx.tools.register`；配置 `installSettingsSection`（`@deepseek-ai/dsh-settings`，schemastery schema）；按钮路由 `ctx.webServer.register`（`/api/dsh-ocr/*`，loopback-only + sec-fetch-site/Origin 同源校验，仿 dsh-ssh）。
- 浏览器半：`window.__ModuleLoader__.load({ id, factory })`，`inject: ['slots', 'settingsScope']`；卡片注册于 `settings.plugin.item`（id `dsh-ocr`，order 95）；配置读写经 settingsScope（快照 + `storeValue`/`clear`），按钮 `fetch('/api/dsh-ocr/*')`。
- HTTP 调用：`child_process.spawn('curl', …)`（请求体走 stdin，apikey 进 Authorization 头 argv，本地进程可接受）。
- 依赖解析：`@deepseek-ai/*` 包从 profiles 全局 node_modules 解析（与 web-search-scrape 相同）；项目根 `node_modules` 符号链接指向 `~/.dsh/profiles/node_modules`（仅本地解析用，已 gitignore）。

## 测试记录（2026-08）

- 动态版阶段用本地 mock（OpenAI + Anthropic 兼容，已删除）完成端到端验证：双协议识别、百分比坐标 `[10,10,50,50]`、对角线两点描述、低置信重读合并 `attempts=2`。
- 正式包安装后验证：工具注册、卡片注册（occupant `dsh-ocr` active）、路由 200 / 跨源 403、未配置时返回可读指引。

## 回滚

- 商店安装：商店卡片「卸载」（改 package.json + 删 bundle + 删目录）。
- 手工挂载：删除两个符号链接 + `cordis.patch.yml` 中的 insert 段，重启 dsh web。

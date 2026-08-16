// dsh-ocr — 宿主半（正式插件，ESM，无构建步骤）
// 配置走 dsh-settings 持久化（全局，Settings → 插件 卡片编辑）；
// 工具 ocr_recognize（OpenAI / Anthropic 双协议视觉 OCR）；
// 路由 /api/dsh-ocr/models、/api/dsh-ocr/test 供卡片按钮调用。
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-ocr'
export const inject = ['tools', 'webServer']

export const Config = z.object({
  apiurl: z.string().default(''),
  apikey: z.string().default(''),
  model: z.string().default(''),
  apiFormat: z.union([z.const('openai'), z.const('anthropic')]).default('openai'),
  threshold: z.number().default(0.7),
  coordMode: z.union([z.const('percent'), z.const('pixel'), z.const('both')]).default('both'),
  retryEnabled: z.boolean().default(true),
  maxRounds: z.number().default(2),
})

export const OCR_SETTINGS_NAMESPACE = settingsNamespace('dsh-ocr')

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// ---------- 基础工具函数 ----------
function msg(e) {
  return String((e && e.message) || e)
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
function r2(v) {
  return Math.round(v * 100) / 100
}
function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + '…' : s
}
function readU16(b, i) {
  return (b[i] << 8) | b[i + 1]
}
function readU32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
}
// 解析常见图片头，返回 {width, height, mime}
function imageInfo(bytes) {
  if (!bytes || bytes.length < 16) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes.length >= 24) {
    return { width: readU32(bytes, 16), height: readU32(bytes, 20), mime: 'image/png' }
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8), mime: 'image/gif' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: readU16(bytes, i + 7), height: readU16(bytes, i + 5), mime: 'image/jpeg' }
      }
      const len = readU16(bytes, i + 2)
      if (len < 2) break
      i += 2 + len
    }
    return null
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const four = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (four === 'VP8X' && bytes.length >= 30) {
      return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)), mime: 'image/webp' }
    }
    if (four === 'VP8 ' && bytes.length >= 30) {
      return { width: bytes[26] | ((bytes[27] & 0x3f) << 8), height: bytes[28] | ((bytes[29] & 0x3f) << 8), mime: 'image/webp' }
    }
    if (four === 'VP8L' && bytes.length >= 25) {
      return {
        width: 1 + (((bytes[21] & 0x3f) << 8) | bytes[22]),
        height: 1 + (((bytes[23] & 0x0f) << 10) | (bytes[24] << 2) | ((bytes[25] & 0xc0) >> 6)),
        mime: 'image/webp',
      }
    }
    return null
  }
  return null
}

// ---------- curl HTTP（spawn，不走 shell；apikey 以 argv 传递，本地进程） ----------
function curlRequest({ method, url, body, headers, timeoutMs, stdoutMaxBytes }) {
  return new Promise((resolve, reject) => {
    const secs = Math.max(10, Math.round((timeoutMs || 60000) / 1000))
    const args = ['-sS', '-m', String(secs), '-o', '-', '-w', '\n__HTTP__%{http_code}', '-X', method]
    for (const h of headers) args.push('-H', h)
    if (body !== undefined) args.push('--data-binary', '@-')
    args.push(url)
    const child = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errChunks = []
    let size = 0
    child.stdout.on('data', (d) => {
      size += d.length
      if (size > (stdoutMaxBytes || 4 * 1024 * 1024)) {
        child.kill('SIGKILL')
        reject(new Error('API 响应超过捕获上限'))
        return
      }
      chunks.push(d)
    })
    child.stderr.on('data', (d) => errChunks.push(d))
    child.on('error', (e) => reject(new Error(`curl 启动失败：${msg(e)}`)))
    child.on('close', (code) => {
      const out = Buffer.concat(chunks).toString('utf8')
      const stderr = Buffer.concat(errChunks).toString('utf8')
      if (code !== 0) {
        reject(new Error(`curl 执行失败 (exit ${code})：${truncate((stderr || out).trim(), 400) || '无输出'}`))
        return
      }
      const marker = out.lastIndexOf('__HTTP__')
      let httpCode = 0
      let payload = out
      if (marker >= 0) {
        payload = out.slice(0, marker)
        httpCode = parseInt(out.slice(marker + 8).trim(), 10) || 0
      }
      if (httpCode && (httpCode < 200 || httpCode >= 300)) {
        reject(new Error(`API 返回 HTTP ${httpCode}：${truncate(payload.trim(), 300)}`))
        return
      }
      let json = null
      try { json = JSON.parse(payload) } catch (e) { json = null }
      if (!json || typeof json !== 'object') {
        reject(new Error(`API 响应不是有效 JSON：${truncate(payload.trim(), 200)}`))
        return
      }
      resolve(json)
    })
    if (body !== undefined) child.stdin.end(body)
    else child.stdin.end()
  })
}

// ---------- 模型输出解析与合并 ----------
function parseItems(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return []
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const first = text.indexOf('[')
  const last = text.lastIndexOf(']')
  if (first >= 0 && last > first) {
    try {
      const arr = JSON.parse(text.slice(first, last + 1))
      if (Array.isArray(arr)) return arr
    } catch (e) { /* fallthrough */ }
  }
  const out = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object') out.push(obj)
    } catch (e) { /* skip */ }
  }
  if (out.length) return out
  return [{ text, box: null, confidence: 0.3 }]
}
function normalizeItem(it, width, height, warnings) {
  const text = truncate(String(it.text === undefined || it.text === null ? '' : it.text).replace(/\n/g, '\\n'), 500)
  const conf = typeof it.confidence === 'number' ? clamp(it.confidence, 0, 1) : 0.8
  const box = Array.isArray(it.box) && it.box.length >= 4 ? it.box.map(Number) : null
  if (!box || !box.every(Number.isFinite)) {
    return { text, box_px: null, box_pct: null, description: '', confidence: conf, retried: false }
  }
  let [x1, y1, x2, y2] = box
  const looksPct = width && height && box.every(v => v >= 0 && v <= 100) && box.some(v => !Number.isInteger(v))
  if (looksPct) {
    x1 = x1 / 100 * width; y1 = y1 / 100 * height; x2 = x2 / 100 * width; y2 = y2 / 100 * height
    if (warnings) warnings.push('模型返回的 box 疑似百分比坐标，已按百分比换算为像素')
  }
  const px = [clamp(Math.round(x1), 0, width || 100000), clamp(Math.round(y1), 0, height || 100000),
              clamp(Math.round(x2), 0, width || 100000), clamp(Math.round(y2), 0, height || 100000)]
  let pct = null
  if (width && height) {
    pct = [r2(px[0] / width * 100), r2(px[1] / height * 100), r2(px[2] / width * 100), r2(px[3] / height * 100)]
  }
  const description = pct ? `左上(${pct[0]}%, ${pct[1]}%) → 右下(${pct[2]}%, ${pct[3]}%)` : ''
  return { text, box_px: px, box_pct: pct, description, confidence: conf, retried: false }
}
function boxIoU(a, b) {
  if (!a || !b || a.length < 4 || b.length < 4) return 0
  const ax1 = Math.min(a[0], a[2]), ay1 = Math.min(a[1], a[3]), ax2 = Math.max(a[0], a[2]), ay2 = Math.max(a[1], a[3])
  const bx1 = Math.min(b[0], b[2]), by1 = Math.min(b[1], b[3]), bx2 = Math.max(b[0], b[2]), by2 = Math.max(b[1], b[3])
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1))
  const inter = ix * iy
  const ua = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
  return ua <= 0 ? 0 : inter / ua
}
function mergeItems(items, refined, regions) {
  const next = items.map(it => ({ ...it }))
  const assigned = new Set()
  for (const r of refined) {
    if (!r.box_px) continue
    let bestIdx = -1
    let bestIoU = 0.2
    for (let i = 0; i < regions.length; i++) {
      if (assigned.has(i)) continue
      const iou = boxIoU(regions[i], r.box_px)
      if (iou > bestIoU) { bestIoU = iou; bestIdx = i }
    }
    if (bestIdx < 0) continue
    assigned.add(bestIdx)
    const region = regions[bestIdx]
    let target = next.find(it => it.box_px && boxIoU(it.box_px, region) > 0.8)
    if (!target && bestIdx < next.length && next[bestIdx].box_px) target = next[bestIdx]
    if (target) {
      if (r.confidence >= target.confidence) {
        target.text = r.text
        target.confidence = r.confidence
      }
      target.retried = true
    }
  }
  return next
}
function buildRegionMessages(baseMessages, regions) {
  const list = regions.map(r => `[${r.join(', ')}]`).join('\n')
  const text = '以下是重读请求：上一轮识别中置信度不足的文字区域（像素坐标，对角线两点 [x1,y1,x2,y2]）：\n' + list +
    '\n请仅对这些方框内的文字重新仔细辨认：放大想象框内内容、结合整图上下文推断模糊字符。' +
    '输出与之前相同格式的 JSON 数组，每项 box 必须与给定方框一致，顺序与上表一致。仍无法确定的 confidence 给 0.5 以下。'
  const img = (baseMessages[1].content || []).find(c => c.type === 'image_url')
  return [
    { role: 'system', content: baseMessages[0].content },
    { role: 'user', content: [{ type: 'text', text }, img] },
  ]
}

// ---------- 视觉模型调用（双协议） ----------
function authHeaders(cfg) {
  if (cfg.apiFormat === 'anthropic') {
    return ['Content-Type: application/json', `x-api-key: ${cfg.apikey}`, 'anthropic-version: 2023-06-01']
  }
  return ['Content-Type: application/json', `Authorization: Bearer ${cfg.apikey}`]
}
function basePath(cfg, suffix) {
  const base = cfg.apiurl.replace(/\/+$/, '')
  if (cfg.apiFormat === 'anthropic') {
    const hasV1 = /\/v1\/?$/.test(base)
    return hasV1 ? base + suffix : `${base}/v1${suffix}`
  }
  return base + suffix
}
async function callVision(cfg, messages) {
  const format = cfg.apiFormat || 'openai'
  const url = basePath(cfg, format === 'anthropic' ? '/messages' : '/chat/completions')
  let body
  if (format === 'anthropic') {
    const sys = messages[0] && messages[0].content
    const user = (messages[1] && messages[1].content) || []
    const textBlock = user.find(c => c.type === 'text')
    const imgBlock = user.find(c => c.type === 'image_url')
    const dataUrl = (imgBlock && imgBlock.image_url && imgBlock.image_url.url) || ''
    const comma = dataUrl.indexOf(';base64,')
    const mime = comma > 0 ? dataUrl.slice(5, comma) : 'image/png'
    const b64 = comma > 0 ? dataUrl.slice(comma + 8) : ''
    const content = []
    if (textBlock) content.push({ type: 'text', text: textBlock.text })
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } })
    body = JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      ...(sys ? { system: sys } : {}),
      messages: [{ role: 'user', content }],
    })
  } else {
    body = JSON.stringify({ model: cfg.model, temperature: 0.1, messages })
  }
  const json = await curlRequest({ method: 'POST', url, body, headers: authHeaders(cfg), timeoutMs: 120000 })
  if (format === 'anthropic') {
    const blocks = json.content || []
    if (!Array.isArray(blocks)) throw new Error('Anthropic 响应缺少 content 数组')
    const text = blocks.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
    if (!text) throw new Error('Anthropic 响应 content 中没有文本块')
    return text
  }
  if (!json.choices || !json.choices.length || !json.choices[0].message) {
    throw new Error(`OCR API 响应格式异常（缺少 choices/message）：${truncate(JSON.stringify(json), 200)}`)
  }
  const content = json.choices[0].message.content
  return typeof content === 'string' ? content : JSON.stringify(content)
}
async function fetchModelList(cfg) {
  const url = basePath(cfg, '/models')
  const json = await curlRequest({ method: 'GET', url, headers: authHeaders(cfg), timeoutMs: 30000, stdoutMaxBytes: 2 * 1024 * 1024 })
  const rows = Array.isArray(json.data) ? json.data : []
  return rows
    .map(m => ({ id: String(m && m.id || '').trim(), displayName: String(m && (m.display_name || m.name || '')).trim() }))
    .filter(m => m.id)
}

// ---------- 工具结果渲染 ----------
function renderSummary(v) {
  if (!v.ok) return `OCR 识别失败：${v.error || '未知错误'}`
  const lines = []
  lines.push(`OCR 识别完成：共 ${v.items.length} 条文字（模型 ${v.model}，图片 ${v.image.width}×${v.image.height}，API 调用 ${v.attempts} 次，耗时 ${v.elapsed_ms}ms）`)
  for (let i = 0; i < v.items.length; i++) {
    const it = v.items[i]
    const conf = it.confidence != null ? `${Math.round(it.confidence * 100)}%` : '?'
    const pos = it.description ? `，位置 ${it.description}` : (it.box_px ? `，像素框 [${it.box_px.join(', ')}]` : '')
    const retry = it.retried ? '（重读后确认）' : ''
    lines.push(`${i + 1}. "${truncate(it.text, 120)}" — 置信度 ${conf}${pos}${retry}`)
  }
  if (v.uncertain_remaining > 0) {
    const boxes = v.items.filter(it => it.confidence < (v.threshold || 0.7) && it.box_px).map(it => `[${it.box_px.join(', ')}]`).join(' ')
    lines.push(`⚠ 仍有 ${v.uncertain_remaining} 条文字置信度低于阈值${boxes ? '：' + boxes : ''}，可用 focus_regions 指定区域再识别`)
  }
  if (v.warnings && v.warnings.length) lines.push(`警告：${v.warnings.join('；')}`)
  return lines.join('\n')
}

// ---------- 图片路径解析（绝对路径；相对路径按 sandboxPolicy.workspaceRoot → process.cwd()） ----------
function resolveImagePath(ctx, imagePath) {
  if (path.isAbsolute(imagePath)) return imagePath
  const roots = []
  try {
    const policy = ctx.get('sandboxPolicy')
    if (policy && policy.workspaceRoot && policy.workspaceRoot !== '/') roots.push(policy.workspaceRoot)
  } catch (e) { /* ignore */ }
  roots.push(process.cwd())
  return path.join(roots[0], imagePath)
}

// ---------- apply ----------
export function apply(ctx, config) {
  // settings section 是配置的活数据源：卡片编辑它，工具/路由每次快照读取
  let section = config
  installSettingsSection(ctx, OCR_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { section = source },
  })
  const resolve = () => ({
    apiurl: String(section?.apiurl || ''),
    apikey: String(section?.apikey || ''),
    model: String(section?.model || ''),
    apiFormat: section?.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
    threshold: typeof section?.threshold === 'number' ? clamp(section.threshold, 0, 1) : 0.7,
    coordMode: ['percent', 'pixel', 'both'].includes(section?.coordMode) ? section.coordMode : 'both',
    retryEnabled: section?.retryEnabled !== false,
    maxRounds: Math.max(1, Math.min(3, Number(section?.maxRounds) || 2)),
  })

  // ---------- ocr_recognize 工具 ----------
  const tool = defineTool({
    name: 'ocr_recognize',
    description: '识别图片中的文字（OCR）。自动完成：读取图片 → 调用视觉模型 API（OpenAI 或 Anthropic 协议）→ 输出每条文字的百分比坐标与对角线两点方框描述；对低置信度文字自动同图区域重读再识别并合并结果。图片路径支持绝对路径或工作区相对路径（PNG/JPEG/GIF/WebP）。',
    parameters: {
      image_path: { type: 'string', required: true, description: '图片文件路径（绝对路径或工作区相对路径），支持 PNG/JPEG/GIF/WebP' },
      coord_mode: { type: 'string', enum: ['percent', 'pixel', 'both'], description: '输出坐标形式：percent=仅百分比坐标；pixel=仅像素坐标；both=两者都给出（默认）' },
      retry_if_uncertain: { type: 'boolean', description: '低置信度文字是否自动触发同图区域重读再识别（默认 true）' },
      max_rounds: { type: 'integer', description: '区域重读最大轮数（默认取插件配置，1-3）' },
      focus_regions: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '可选：手动指定精读区域，每项为像素坐标 [x1,y1,x2,y2]（对角线两点）；提供后对这些区域执行一次精读再识别' },
      prompt_hint: { type: 'string', description: '可选：附加给模型的识别提示（如语言、领域词汇）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          model: { type: 'string' },
          threshold: { type: 'number' },
          elapsed_ms: { type: 'number' },
          image: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string' },
                box_px: { type: 'array', items: { type: 'number' } },
                box_pct: { type: 'array', items: { type: 'number' } },
                description: { type: 'string' },
                confidence: { type: 'number' },
                retried: { type: 'boolean' },
              },
            },
          },
          attempts: { type: 'number' },
          uncertain_remaining: { type: 'number' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSummary(value) }],
    },
    async execute(args) {
      const warnings = []
      const started = Date.now()
      try {
        const cfg = resolve()
        if (!cfg.apiurl || !cfg.apikey || !cfg.model) {
          return { ok: false, error: 'OCR 未配置：请到「设置 → 插件 → OCR 视觉识别」填写 API URL、API Key 与 Model Name' }
        }
        const imagePath = String(args.image_path)
        let bytes
        try {
          bytes = await readFile(resolveImagePath(ctx, imagePath))
        } catch (e) {
          return { ok: false, error: `读取图片失败（文件不存在或不可读）：${msg(e)}` }
        }
        if (bytes.length > MAX_IMAGE_BYTES) {
          return { ok: false, error: `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限` }
        }
        const info = imageInfo(bytes)
        if (!info) return { ok: false, error: '无法识别的图片格式（支持 PNG/JPEG/GIF/WebP）或文件为空' }
        const dataUrl = `data:${info.mime};base64,${bytes.toString('base64')}`
        const width = info.width
        const height = info.height

        const sys = '你是专业的 OCR 识别引擎。用户提供一张图片，请识别其中所有可见文字并按阅读顺序输出。' +
          '只输出一个 JSON 数组，不要输出任何其他内容（不要用 markdown 代码块）。数组每项格式：' +
          '{"text":"识别出的文字原文（保留标点与换行，换行用\\n）","box":[x1,y1,x2,y2],"confidence":0~1}。' +
          'box 为该条文字的矩形外接框，以图片左上角为原点、单位像素；x1,y1 是框的左上角点，x2,y2 是框的右下角点（对角线两点）。' +
          'confidence 表示对文字内容的把握：完全确定给 0.95 以上；部分模糊给 0.6~0.85；基本看不清给 0.5 以下（并把能辨认的部分写进 text）。'
        let userText = '请识别图片中的全部文字。'
        if (args.prompt_hint) userText += `\n补充提示：${String(args.prompt_hint)}`
        const baseMessages = [
          { role: 'system', content: sys },
          { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: dataUrl } }] },
        ]

        let items = parseItems(await callVision(cfg, baseMessages)).map(it => normalizeItem(it, width, height, warnings))
        let attempts = 1

        if (Array.isArray(args.focus_regions) && args.focus_regions.length) {
          const regions = args.focus_regions.map(r => r.map(Number)).filter(r => r.length >= 4 && r.every(Number.isFinite))
          if (regions.length) {
            const refined = parseItems(await callVision(cfg, buildRegionMessages(baseMessages, regions))).map(it => normalizeItem(it, width, height, warnings))
            attempts++
            items = mergeItems(items, refined, regions)
          }
        }

        if (args.retry_if_uncertain !== false && cfg.retryEnabled) {
          const maxRounds = Math.max(1, Math.min(3, typeof args.max_rounds === 'number' ? Math.floor(args.max_rounds) : cfg.maxRounds))
          for (let round = 0; round < maxRounds; round++) {
            const uncertain = items.filter(it => it.confidence < cfg.threshold)
            if (!uncertain.length) break
            const regions = uncertain.map(it => it.box_px).filter(Boolean)
            if (!regions.length) break
            const refined = parseItems(await callVision(cfg, buildRegionMessages(baseMessages, regions))).map(it => normalizeItem(it, width, height, warnings))
            attempts++
            items = mergeItems(items, refined, regions)
          }
        }

        const mode = args.coord_mode || cfg.coordMode || 'both'
        items = items.map(it => {
          const out = { ...it }
          if (mode === 'percent') delete out.box_px
          if (mode === 'pixel') delete out.box_pct
          return out
        })

        const uncertain = items.filter(it => it.confidence < cfg.threshold).length
        return {
          ok: true,
          model: cfg.model,
          threshold: cfg.threshold,
          elapsed_ms: Date.now() - started,
          image: { path: imagePath, width, height },
          items,
          attempts,
          uncertain_remaining: uncertain,
          warnings,
        }
      } catch (e) {
        return { ok: false, error: msg(e) }
      }
    },
  })
  ctx.tools.register(tool)

  // ---------- 卡片按钮路由（loopback-only） ----------
  const isLoopbackRequest = (req) => {
    const address = req.socket.remoteAddress
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
    const host = req.headers.host
    if (typeof host !== 'string') return false
    let hostUrl
    try { hostUrl = new URL(`http://${host}`) } catch { return false }
    return hostUrl.hostname === '127.0.0.1' || hostUrl.hostname === 'localhost' || hostUrl.hostname === '[::1]'
  }
  const writeJson = (res, code, obj) => {
    const data = JSON.stringify(obj)
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(data)
  }

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ocr/models',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      try {
        const cfg = resolve()
        if (!cfg.apiurl || !cfg.apikey) return writeJson(res, 200, { ok: false, error: '请先填写 API URL 与 API Key' })
        const models = await fetchModelList(cfg)
        writeJson(res, 200, { ok: true, count: models.length, models })
      } catch (e) {
        writeJson(res, 200, { ok: false, error: msg(e) })
      }
    },
  })
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ocr/test',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
      const started = Date.now()
      try {
        const cfg = resolve()
        if (!cfg.apiurl || !cfg.apikey) return writeJson(res, 200, { ok: false, error: '请先填写 API URL 与 API Key' })
        const models = await fetchModelList(cfg)
        const latency = Date.now() - started
        const modelKnown = cfg.model ? models.some(m => m.id === cfg.model) : null
        writeJson(res, 200, { ok: true, latencyMs: latency, count: models.length, model: cfg.model, modelKnown, models })
      } catch (e) {
        writeJson(res, 200, { ok: false, error: msg(e), latencyMs: Date.now() - started })
      }
    },
  })
}

export default { name, inject, Config, apply }

// dsh-ocr — 客户端半（ModuleLoader lazy-factory，无构建）
// 设置 → 插件 的「OCR 视觉识别」可折叠配置卡片：
// API 格式下拉、API URL / API Key / Model Name（旁侧模型下拉）、
// 获取模型列表 / 测试连接按钮、高级选项。
// 配置读写走 /api/dsh-ocr/config（宿主文件持久化 ~/.dsh/dsh-ocr.json）。
window.__ModuleLoader__.load({
  id: 'dsh-ocr',
  factory: (require) => {
    const React = require('react')

    const CARD_CSS = `
.dsh-ocr-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; margin: 8px 0; overflow: hidden; }
.dsh-ocr-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; user-select: none; }
.dsh-ocr-title { font-weight: 600; }
.dsh-ocr-badge { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
.dsh-ocr-badge.on { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); color: var(--dsw-alias-state-success-primary); }
.dsh-ocr-badge.off { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent); color: var(--dsw-alias-state-warn-primary); }
.dsh-ocr-chev { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-ocr-body { padding: 4px 12px 12px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-ocr-row { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; margin: 8px 0; }
.dsh-ocr-row label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-ocr-row input, .dsh-ocr-row select { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-ocr-row input:focus, .dsh-ocr-row select:focus { outline: 1px solid var(--dsw-alias-brand-primary); }
.dsh-ocr-modelwrap { display: flex; gap: 6px; align-items: center; }
.dsh-ocr-modelwrap input { flex: 1; min-width: 0; }
.dsh-ocr-modelwrap select { flex: 0 0 auto; width: auto; max-width: 45%; }
.dsh-ocr-adv-head { cursor: pointer; color: var(--dsw-alias-label-secondary); margin: 10px 0 2px; font-size: 12px; user-select: none; }
.dsh-ocr-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.dsh-ocr-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 13px; }
.dsh-ocr-btn:hover { filter: brightness(1.08); }
.dsh-ocr-btn.primary { background: var(--dsw-alias-brand-primary); color: #fff; border-color: transparent; }
.dsh-ocr-btn:disabled { opacity: 0.55; cursor: default; }
.dsh-ocr-status { margin-top: 8px; font-size: 12px; min-height: 16px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.dsh-ocr-note { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
`

    const FIELDS = [
      { field: 'apiurl', kind: 'string', label: 'API URL', placeholder: (f) => (f === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.example.com/v1') },
      { field: 'apikey', kind: 'password', label: 'API Key', placeholder: () => 'sk-…' },
      { field: 'model', kind: 'string', label: 'Model Name', placeholder: (f) => (f === 'anthropic' ? 'claude-sonnet-4-20250514…' : 'qwen-vl-plus / glm-4v / gpt-4o…') },
      { field: 'apiFormat', kind: 'select', label: 'API 格式', options: [['openai', 'OpenAI 兼容（/chat/completions）'], ['anthropic', 'Anthropic（/v1/messages）']] },
      { field: 'threshold', kind: 'number', label: '置信度阈值' },
      { field: 'coordMode', kind: 'select', label: '坐标模式', options: [['both', '百分比 + 像素'], ['percent', '仅百分比'], ['pixel', '仅像素']] },
      { field: 'retryEnabled', kind: 'boolean', label: '自动区域重读' },
      { field: 'maxRounds', kind: 'number', label: '最大重读轮数' },
    ]

    // 同源 fetch 辅助
    const apiFetch = (path, body) => fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { 'X-Requested-With': 'dsh-ocr' } : { 'Content-Type': 'application/json', 'X-Requested-With': 'dsh-ocr' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => r.json())

    function OcrCard() {
      const [expanded, setExpanded] = React.useState(true)
      const [advExpanded, setAdvExpanded] = React.useState(false)
      const [draft, setDraft] = React.useState({})
      const [config, setConfig] = React.useState(null) // 已保存配置（masked 视图）
      const [models, setModels] = React.useState(null) // null=未获取, [] = 空
      const [status, setStatus] = React.useState('加载中…')
      const [busy, setBusy] = React.useState('')

      // 挂载时读取已保存配置
      React.useEffect(() => {
        let alive = true
        apiFetch('/api/dsh-ocr/config').then((res) => {
          if (!alive) return
          if (res && res.ok && res.config) {
            setConfig(res.config)
            if (res.config.apiurl && res.config.model && res.config.hasKey) setStatus(`已配置（${res.config.model}）`)
            else setStatus('未配置')
          } else {
            setStatus('配置读取失败')
          }
        }).catch((e) => { if (alive) setStatus('配置读取失败：' + String((e && e.message) || e)) })
        return () => { alive = false }
      }, [])

      const value = config || {}
      const saved = (field) => field in value
      const fieldValue = (field) => (draft[field] !== undefined ? draft[field] : value[field])
      const display = (field) => {
        const v = fieldValue(field)
        if (v === undefined || v === null) return ''
        if (field === 'threshold' || field === 'maxRounds') return String(v)
        return v
      }
      const format = fieldValue('apiFormat') || 'openai'
      const ready = !!(value.apiurl && value.model && value.hasKey)

      const edit = (field) => (ev) => setDraft((d) => ({ ...d, [field]: ev.target.value }))
      const editChecked = (field) => (ev) => setDraft((d) => ({ ...d, [field]: ev.target.checked ? 'true' : 'false' }))

      // 保存：POST /api/dsh-ocr/config（apikey 留空 = 不修改）
      const saveAll = async () => {
        setBusy('save')
        setStatus('保存中…')
        try {
          const payload = {}
          let changed = false
          for (const f of FIELDS) {
            const key = f.field
            if (!(key in draft)) continue
            const raw = String(draft[key]).trim()
            if (raw === '') { if (key !== 'apikey') changed = true; continue } // apikey 留空 = 不修改
            let parsed
            if (f.kind === 'boolean') parsed = raw === 'true'
            else if (f.kind === 'number') parsed = Number(raw)
            else parsed = raw
            payload[key] = parsed
            if (String(parsed) !== String(value[key] ?? '')) changed = true
          }
          if (!changed) { setStatus('没有改动'); return }
          const res = await apiFetch('/api/dsh-ocr/config', payload)
          if (!res || !res.ok) {
            setStatus('保存失败：' + ((res && res.error) || '未知错误'))
            return
          }
          setConfig(res.config)
          setDraft({})
          setStatus('已保存（' + (res.config.configPath || '~/.dsh/dsh-ocr.json') + '，重启后仍生效）')
        } catch (e) {
          setStatus('保存失败：' + String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }

      // 表单草稿配置（POST 给路由做临时测试；apikey 未填时回落已保存值）
      const draftConfig = () => ({
        apiurl: draft.apiurl !== undefined ? draft.apiurl : undefined,
        apikey: draft.apikey !== undefined && draft.apikey !== '' ? draft.apikey : undefined,
        apiFormat: draft.apiFormat !== undefined ? draft.apiFormat : undefined,
      })

      const fetchModels = async () => {
        setBusy('list')
        setStatus('正在获取模型列表…')
        try {
          const res = await apiFetch('/api/dsh-ocr/models', draftConfig())
          if (!res.ok) { setStatus('获取失败：' + (res.error || '未知错误')); return }
          setModels(res.models || [])
          const names = (res.models || []).slice(0, 8).map((m) => m.id).join('、')
          setStatus(`模型列表：${res.count} 个${names ? '（' + names + (res.count > 8 ? '…' : '') + '）' : ''}`)
        } catch (e) {
          setStatus('获取失败：' + String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }

      const testConfig = async () => {
        setBusy('test')
        setStatus('正在测试连接…')
        try {
          const res = await apiFetch('/api/dsh-ocr/test', draftConfig())
          if (!res.ok) { setStatus('测试失败：' + (res.error || '未知错误')); return }
          setModels(res.models || [])
          let extra = ''
          if (res.modelKnown === true) extra = '，已配置模型在列表中'
          else if (res.modelKnown === false) extra = `，注意：模型「${res.model}」不在列表中`
          setStatus(`连接正常：${res.latencyMs}ms，${res.count} 个模型${extra}`)
        } catch (e) {
          setStatus('测试失败：' + String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }

      const reset = () => {
        setDraft({})
        setModels(null)
        setStatus('已重置为草稿（点击「保存」生效）')
      }

      const pickModel = (ev) => {
        if (ev.target.value) setDraft((d) => ({ ...d, model: ev.target.value }))
      }
      const dirty = Object.keys(draft).length > 0
      const modelList = models === null ? [] : models
      const modelOptions = modelList.map((m) => React.createElement('option', { key: m.id, value: m.id }, m.displayName ? `${m.id}（${m.displayName}）` : m.id))

      return React.createElement('div', { className: 'dsh-ocr-card' },
        React.createElement('div', {
          className: 'dsh-ocr-head',
          role: 'button',
          title: expanded ? '折叠配置' : '展开配置',
          onClick: () => setExpanded(!expanded),
        }, [
          React.createElement('span', { className: 'dsh-ocr-title', key: 't' }, 'OCR 视觉识别'),
          React.createElement('span', { className: 'dsh-ocr-badge ' + (ready ? 'on' : 'off'), key: 'b' }, status),
          React.createElement('span', { className: 'dsh-ocr-chev', key: 'c' }, expanded ? '▾' : '▸'),
        ]),
        expanded ? React.createElement('div', { className: 'dsh-ocr-body', key: 'body' }, [
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r0' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-format' }, 'API 格式'),
            React.createElement('select', { key: 'i', id: 'ocr-format', value: display('apiFormat') || 'openai', onChange: edit('apiFormat') }, [
              React.createElement('option', { key: 'openai', value: 'openai' }, 'OpenAI 兼容（/chat/completions）'),
              React.createElement('option', { key: 'anthropic', value: 'anthropic' }, 'Anthropic（/v1/messages）'),
            ]),
          ]),
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r1' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-apiurl' }, 'API URL'),
            React.createElement('input', { key: 'i', id: 'ocr-apiurl', type: 'text', placeholder: FIELDS[0].placeholder(format), value: display('apiurl'), onChange: edit('apiurl'), spellCheck: false }),
          ]),
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r2' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-apikey' }, 'API Key'),
            React.createElement('input', { key: 'i', id: 'ocr-apikey', type: 'password', placeholder: saved('apikey') ? '已设置，留空则不修改' : 'sk-…', value: draft.apikey !== undefined ? draft.apikey : '', onChange: edit('apikey'), spellCheck: false, autoComplete: 'off' }),
          ]),
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r3' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-model' }, 'Model Name'),
            React.createElement('div', { className: 'dsh-ocr-modelwrap', key: 'i' }, [
              React.createElement('input', { id: 'ocr-model', type: 'text', placeholder: FIELDS[2].placeholder(format), value: display('model'), onChange: edit('model'), spellCheck: false, list: 'dsh-ocr-model-datalist' }),
              React.createElement('select', {
                'aria-label': '从模型列表选择',
                value: '',
                onChange: pickModel,
                disabled: modelList.length === 0,
                title: modelList.length ? '从获取的模型列表中选择' : '先点击「获取模型列表」',
              }, [
                React.createElement('option', { key: '__ph', value: '' }, models === null ? '（先获取模型列表）' : modelList.length ? '选择…' : '（列表为空）'),
                ...modelOptions,
              ]),
              React.createElement('datalist', { id: 'dsh-ocr-model-datalist' },
                modelList.map((m) => React.createElement('option', { key: m.id, value: m.id })),
              ),
            ]),
          ]),
          React.createElement('div', { className: 'dsh-ocr-actions', key: 'ac1' }, [
            React.createElement('button', { key: 'l', className: 'dsh-ocr-btn', disabled: !!busy, onClick: fetchModels }, busy === 'list' ? '获取中…' : '获取模型列表'),
            React.createElement('button', { key: 't', className: 'dsh-ocr-btn', disabled: !!busy, onClick: testConfig }, busy === 'test' ? '测试中…' : '测试连接'),
          ]),
          React.createElement('div', {
            className: 'dsh-ocr-adv-head',
            key: 'ah',
            role: 'button',
            title: advExpanded ? '折叠高级选项' : '展开高级选项',
            onClick: () => setAdvExpanded(!advExpanded),
          }, '高级选项 ' + (advExpanded ? '▾' : '▸')),
          advExpanded ? [
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a1' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-threshold' }, '置信度阈值'),
              React.createElement('input', { key: 'i', id: 'ocr-threshold', type: 'number', min: 0, max: 1, step: 0.05, value: display('threshold'), onChange: edit('threshold') }),
            ]),
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a2' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-coord' }, '坐标模式'),
              React.createElement('select', { key: 'i', id: 'ocr-coord', value: display('coordMode') || 'both', onChange: edit('coordMode') }, [
                React.createElement('option', { key: 'both', value: 'both' }, '百分比 + 像素'),
                React.createElement('option', { key: 'percent', value: 'percent' }, '仅百分比'),
                React.createElement('option', { key: 'pixel', value: 'pixel' }, '仅像素'),
              ]),
            ]),
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a3' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-retry' }, '自动区域重读'),
              React.createElement('input', { key: 'i', id: 'ocr-retry', type: 'checkbox', checked: String(fieldValue('retryEnabled') ?? true) === 'true', onChange: editChecked('retryEnabled') }),
            ]),
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a4' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-rounds' }, '最大重读轮数'),
              React.createElement('input', { key: 'i', id: 'ocr-rounds', type: 'number', min: 1, max: 3, step: 1, value: display('maxRounds'), onChange: edit('maxRounds') }),
            ]),
          ] : null,
          React.createElement('div', { className: 'dsh-ocr-actions', key: 'ac2' }, [
            React.createElement('button', { key: 's', className: 'dsh-ocr-btn primary', disabled: !!busy || !dirty, onClick: saveAll }, '保存'),
            React.createElement('button', { key: 'r', className: 'dsh-ocr-btn', disabled: !!busy, onClick: reset }, '重置'),
          ]),
          React.createElement('div', { className: 'dsh-ocr-status', key: 'st' }, status),
          React.createElement('div', { className: 'dsh-ocr-note', key: 'nt' }, '配置保存于 ~/.dsh/dsh-ocr.json（重启后仍生效）；API Key 明文存于本机，请勿外传。'),
        ]) : null,
      )
    }

    // ---- 插件 ----
    const inject = ['slots']

    function apply(ctx) {
      const css = document.createElement('style')
      css.textContent = CARD_CSS
      document.head.appendChild(css)

      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({
          name: 'settings.plugin.item',
          id: 'dsh-ocr',
          order: 95,
          label: () => 'OCR 视觉识别',
        }, () => React.createElement(OcrCard))
      })
    }

    return { apply, inject }
  },
})

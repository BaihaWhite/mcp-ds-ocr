// dsh-ocr — 客户端半（ModuleLoader lazy-factory，无构建）
// 设置 → 插件 的「OCR 视觉识别」可折叠配置卡片：
// API 格式下拉、API URL / API Key / Model Name（旁侧模型下拉）、
// 获取模型列表 / 测试连接按钮（fetch /api/dsh-ocr/*）、高级选项。
// 配置读写走 settingsScope（dsh-settings 持久化，全局生效）。
window.__ModuleLoader__.load({
  id: 'dsh-ocr',
  factory: (require) => {
    const React = require('react')
    const { createSnapshotStore } = require('@deepseek-ai/dsh-client-runtime/client')

    const NAMESPACE = 'dsh-ocr'

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

    function OcrCard(props) {
      const scope = props.scope
      const [expanded, setExpanded] = React.useState(true)
      const [advExpanded, setAdvExpanded] = React.useState(false)
      const [draft, setDraft] = React.useState({})
      const [models, setModels] = React.useState(null) // null=未获取, [] = 空
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [, force] = React.useState(0)

      React.useEffect(() => {
        const dispose = scope.subscribe(() => force((n) => n + 1))
        return dispose
      }, [])

      const snap = scope.getSnapshot()
      const value = snap.value || {}
      const saved = (field) => Object.prototype.hasOwnProperty.call(value, field)
      const fieldValue = (field) => (draft[field] !== undefined ? draft[field] : value[field])
      const display = (field) => {
        const v = fieldValue(field)
        if (v === undefined || v === null) return ''
        if (field === 'threshold' || field === 'maxRounds') return String(v)
        return v
      }
      const format = fieldValue('apiFormat') || 'openai'
      const ready = !!(value.apiurl && value.model && value.apikey)

      const edit = (field) => (ev) => {
        const raw = ev.target.value
        setDraft((d) => ({ ...d, [field]: raw }))
      }
      const editChecked = (field) => (ev) => {
        setDraft((d) => ({ ...d, [field]: ev.target.checked ? 'true' : 'false' }))
      }

      const saveAll = async () => {
        setBusy('save')
        setStatus('保存中…')
        try {
          const writes = []
          for (const f of FIELDS) {
            const key = f.field
            if (!(key in draft)) continue
            const raw = String(draft[key]).trim()
            if (raw === '') {
              if (key === 'apikey') continue // apikey 留空 = 不修改（不回显已保存值）
              if (saved(key)) writes.push(scope.unset(key))
              continue
            }
            let parsed
            if (f.kind === 'boolean') parsed = raw === 'true'
            else if (f.kind === 'number') parsed = Number(raw)
            else parsed = raw
            if (String(parsed) === String(value[key] ?? '')) continue
            writes.push(scope.set(key, parsed))
          }
          if (writes.length === 0) { setStatus('没有改动'); return }
          const results = await Promise.allSettled(writes)
          if (results.some((r) => r.status === 'rejected')) {
            setStatus('保存失败：' + (results.find((r) => r.status === 'rejected').reason?.message ?? '未知错误'))
            return
          }
          // 保存后核对（settings 写入失败会被吞掉，这里主动验证）
          await new Promise((resolve) => setTimeout(resolve, 0))
          const snapAfter = scope.getSnapshot()
          const vAfter = snapAfter.value || {}
          const failed = []
          for (const f of FIELDS) {
            const key = f.field
            if (!(key in draft)) continue
            if (key === 'apikey') {
              if (!(key in vAfter)) failed.push(key)
            } else if (String(vAfter[key] ?? '') !== String(draft[key] ?? '')) {
              failed.push(key)
            }
          }
          if (failed.length > 0) {
            setStatus(`保存未生效（${failed.join('、')}）：设置服务拒绝了写入，请检查该插件的 settings 命名空间是否被允许`)
            return
          }
          setDraft({})
          setStatus('已保存（设置全局持久化，重启后仍生效）')
        } catch (e) {
          setStatus('保存失败：' + String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }

      // 表单草稿配置（POST 给路由做临时测试；apikey 未填时传给 undefined，路由回落到已保存值）
      const draftConfig = () => ({
        apiurl: draft.apiurl !== undefined ? draft.apiurl : undefined,
        apikey: draft.apikey !== undefined && draft.apikey !== '' ? draft.apikey : undefined,
        apiFormat: draft.apiFormat !== undefined ? draft.apiFormat : undefined,
      })

      const fetchModels = async () => {
        setBusy('list')
        setStatus('正在获取模型列表…')
        try {
          const res = await fetch('/api/dsh-ocr/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dsh-ocr' },
            body: JSON.stringify(draftConfig()),
          })
          const body = await res.json()
          if (!body.ok) { setStatus('获取失败：' + (body.error || '未知错误')); return }
          setModels(body.models || [])
          const names = (body.models || []).slice(0, 8).map((m) => m.id).join('、')
          setStatus(`模型列表：${body.count} 个${names ? '（' + names + (body.count > 8 ? '…' : '') + '）' : ''}`)
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
          const res = await fetch('/api/dsh-ocr/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dsh-ocr' },
            body: JSON.stringify(draftConfig()),
          })
          const body = await res.json()
          if (!body.ok) { setStatus('测试失败：' + (body.error || '未知错误')); return }
          setModels(body.models || [])
          let extra = ''
          if (body.modelKnown === true) extra = '，已配置模型在列表中'
          else if (body.modelKnown === false) extra = `，注意：模型「${body.model}」不在列表中`
          setStatus(`连接正常：${body.latencyMs}ms，${body.count} 个模型${extra}`)
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
          React.createElement('span', { className: 'dsh-ocr-badge ' + (ready ? 'on' : 'off'), key: 'b' }, ready ? `已配置（${value.model}）` : '未配置'),
          React.createElement('span', { className: 'dsh-ocr-chev', key: 'c' }, expanded ? '▾' : '▸'),
        ]),
        expanded ? React.createElement('div', { className: 'dsh-ocr-body', key: 'body' }, [
          // API 格式
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r0' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-format' }, 'API 格式'),
            React.createElement('select', { key: 'i', id: 'ocr-format', value: display('apiFormat') || 'openai', onChange: edit('apiFormat') }, [
              React.createElement('option', { key: 'openai', value: 'openai' }, 'OpenAI 兼容（/chat/completions）'),
              React.createElement('option', { key: 'anthropic', value: 'anthropic' }, 'Anthropic（/v1/messages）'),
            ]),
          ]),
          // API URL
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r1' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-apiurl' }, 'API URL'),
            React.createElement('input', { key: 'i', id: 'ocr-apiurl', type: 'text', placeholder: FIELDS[0].placeholder(format), value: display('apiurl'), onChange: edit('apiurl'), spellCheck: false }),
          ]),
          // API Key
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r2' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-apikey' }, 'API Key'),
            React.createElement('input', { key: 'i', id: 'ocr-apikey', type: 'password', placeholder: saved('apikey') ? '已设置，留空则不修改' : 'sk-…', value: draft.apikey !== undefined ? draft.apikey : '', onChange: edit('apikey'), spellCheck: false, autoComplete: 'off' }),
          ]),
          // Model Name + 旁侧下拉
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
          // 按钮
          React.createElement('div', { className: 'dsh-ocr-actions', key: 'ac1' }, [
            React.createElement('button', { key: 'l', className: 'dsh-ocr-btn', disabled: !!busy, onClick: fetchModels }, busy === 'list' ? '获取中…' : '获取模型列表'),
            React.createElement('button', { key: 't', className: 'dsh-ocr-btn', disabled: !!busy, onClick: testConfig }, busy === 'test' ? '测试中…' : '测试连接'),
          ]),
          // 高级选项
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
          // 保存/重置
          React.createElement('div', { className: 'dsh-ocr-actions', key: 'ac2' }, [
            React.createElement('button', { key: 's', className: 'dsh-ocr-btn primary', disabled: !!busy || !dirty, onClick: saveAll }, '保存'),
            React.createElement('button', { key: 'r', className: 'dsh-ocr-btn', disabled: !!busy, onClick: reset }, '重置'),
          ]),
          React.createElement('div', { className: 'dsh-ocr-status', key: 'st' }, status || (dirty ? '有未保存的改动' : '')),
          React.createElement('div', { className: 'dsh-ocr-note', key: 'nt' }, '配置经 dsh 设置持久化（全局生效，重启不丢）；API Key 明文存于本机设置文件，请勿外传。'),
        ]) : null,
      )
    }

    // ---- 插件 ----
    const inject = ['slots', 'settingsScope']

    function apply(ctx) {
      const css = document.createElement('style')
      css.textContent = CARD_CSS
      document.head.appendChild(css)

      const scope = ctx.settingsScope.bind({ namespace: NAMESPACE })
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register({
          name: 'settings.plugin.item',
          id: 'dsh-ocr',
          order: 95,
          label: () => 'OCR 视觉识别',
        }, (props) => React.createElement(OcrCard, { ...props, scope }))
      })
    }

    return { apply, inject }
  },
})

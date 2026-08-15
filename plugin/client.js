// DSH OCR 插件 — Client 半 v3
// 设置 → 插件 → 插件配置 中的可折叠「OCR 视觉识别」配置卡片
// 含：API 格式下拉（OpenAI/Anthropic）、获取模型列表、测试连接、模型输入+下拉
return {
  apply(ctx) {
    styles.insert(`
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
`)

    const slots = ctx.get('slots')
    if (slots === undefined) return

    function OcrCard() {
      const [expanded, setExpanded] = React.useState(true)
      const [advExpanded, setAdvExpanded] = React.useState(false)
      const [form, setForm] = React.useState({ apiurl: '', apikey: '', model: '', apiFormat: 'openai', threshold: 0.7, coordMode: 'both', retryEnabled: true, maxRounds: 2 })
      const [view, setView] = React.useState(null)
      const [models, setModels] = React.useState([])
      const [status, setStatus] = React.useState('加载中…')
      const [busy, setBusy] = React.useState('') // '' | 'save' | 'list' | 'test'

      React.useEffect(() => {
        let alive = true
        host.call('ocr.get-config').then((v) => {
          if (!alive) return
          setView(v)
          setForm(f => ({
            ...f,
            apiurl: v.apiurl || '',
            model: v.model || '',
            apiFormat: v.apiFormat || 'openai',
            threshold: v.threshold,
            coordMode: v.coordMode,
            retryEnabled: v.retryEnabled,
            maxRounds: v.maxRounds,
          }))
          if (v.apiurl && v.model && v.hasKey) {
            setStatus(`已配置（${v.model}）${v.source === 'file' ? '· 已持久化' : '· 仅运行期'}`)
          } else {
            setStatus('未配置')
          }
        }).catch((e) => {
          if (alive) setStatus('加载失败：' + String((e && e.message) || e))
        })
        return () => { alive = false }
      }, [])

      const setStr = (k) => (ev) => setForm(f => ({ ...f, [k]: ev.target.value }))
      const setNum = (k) => (ev) => setForm(f => ({ ...f, [k]: Number(ev.target.value) }))
      const setBool = (k) => (ev) => setForm(f => ({ ...f, [k]: ev.target.checked }))

      const save = async () => {
        setBusy('save')
        setStatus('保存中…')
        try {
          const res = await host.call('ocr.set-config', {
            apiurl: form.apiurl.trim(),
            apikey: form.apikey ? form.apikey.trim() : undefined,
            model: form.model.trim(),
            apiFormat: form.apiFormat,
            threshold: form.threshold,
            coordMode: form.coordMode,
            retryEnabled: form.retryEnabled,
            maxRounds: form.maxRounds,
          })
          if (!res || res.ok === false) {
            setStatus('保存失败：' + ((res && res.error) || '未知错误'))
            return
          }
          setView(res.view)
          setForm(f => ({ ...f, apikey: '' }))
          setModels([])
          setStatus('已保存' + (res.savedToFile ? '（已写入工作区 .dsh-ocr/config.json）' : '（仅运行期内存，首次调用 OCR 工具时补写文件）'))
        } catch (e) {
          setStatus('保存失败：' + String((e && e.message) || e))
        } finally {
          setBusy('')
        }
      }

      const fetchModels = async () => {
        setBusy('list')
        setStatus('正在获取模型列表…')
        try {
          const res = await host.call('ocr.list-models', { force: true })
          if (!res || res.ok === false) {
            setStatus('获取失败：' + ((res && res.error) || '未知错误'))
            return
          }
          setModels(res.models || [])
          const names = (res.models || []).slice(0, 8).map(m => m.id).join('、')
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
          const res = await host.call('ocr.test-config')
          if (!res || res.ok === false) {
            setStatus('测试失败：' + ((res && res.error) || '未知错误'))
            return
          }
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
        setForm(f => ({
          ...f,
          apiurl: '',
          apikey: '',
          model: '',
          apiFormat: 'openai',
          threshold: 0.7,
          coordMode: 'both',
          retryEnabled: true,
          maxRounds: 2,
        }))
        setModels([])
        setStatus('已重置为默认值（点击「保存」生效）')
      }

      const pickModel = (ev) => {
        setForm(f => ({ ...f, model: ev.target.value }))
      }
      const ready = !!(view && view.apiurl && view.model && view.hasKey)
      const formatLabel = form.apiFormat === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'

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
            React.createElement('select', { key: 'i', id: 'ocr-format', value: form.apiFormat, onChange: setStr('apiFormat') }, [
              React.createElement('option', { key: 'openai', value: 'openai' }, 'OpenAI 兼容（/chat/completions）'),
              React.createElement('option', { key: 'anthropic', value: 'anthropic' }, 'Anthropic（/v1/messages）'),
            ]),
          ]),
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r1' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-apiurl' }, 'API URL'),
            React.createElement('input', { key: 'i', id: 'ocr-apiurl', type: 'text', placeholder: form.apiFormat === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.example.com/v1', value: form.apiurl, onChange: setStr('apiurl'), spellCheck: false }),
          ]),
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r2' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-apikey' }, 'API Key'),
            React.createElement('div', { key: 'i' }, [
              React.createElement('input', { id: 'ocr-apikey', type: 'password', placeholder: view && view.hasKey ? `已设置（${view.keyHint}），留空则不修改` : 'sk-…', value: form.apikey, onChange: setStr('apikey'), spellCheck: false, autoComplete: 'off' }),
            ]),
          ]),
          React.createElement('div', { className: 'dsh-ocr-row', key: 'r3' }, [
            React.createElement('label', { key: 'l', htmlFor: 'ocr-model' }, 'Model Name'),
            React.createElement('div', { className: 'dsh-ocr-modelwrap', key: 'i' }, [
              React.createElement('input', { id: 'ocr-model', type: 'text', placeholder: form.apiFormat === 'anthropic' ? 'claude-sonnet-4-20250514…' : 'qwen-vl-plus / glm-4v / gpt-4o…', value: form.model, onChange: setStr('model'), spellCheck: false, list: 'dsh-ocr-model-datalist' }),
              React.createElement('select', {
                'aria-label': '从模型列表选择',
                value: '',
                onChange: pickModel,
                disabled: !models.length,
                title: models.length ? '从获取的模型列表中选择' : '先点击「获取模型列表」',
              }, [
                React.createElement('option', { key: '__ph', value: '' }, models.length ? '选择…' : '（先获取模型列表）'),
                ...models.map(m => React.createElement('option', { key: m.id, value: m.id }, m.displayName ? `${m.id}（${m.displayName}）` : m.id)),
              ]),
              React.createElement('datalist', { id: 'dsh-ocr-model-datalist' },
                models.map(m => React.createElement('option', { key: m.id, value: m.id })),
              ),
            ]),
          ]),
          React.createElement('div', { className: 'dsh-ocr-actions', key: 'ac1' }, [
            React.createElement('button', { key: 'l', className: 'dsh-ocr-btn', disabled: !!busy || !form.apiurl || !form.apikey, onClick: fetchModels }, busy === 'list' ? '获取中…' : '获取模型列表'),
            React.createElement('button', { key: 't', className: 'dsh-ocr-btn', disabled: !!busy || !form.apiurl || !form.apikey, onClick: testConfig }, busy === 'test' ? '测试中…' : '测试连接'),
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
              React.createElement('input', { key: 'i', id: 'ocr-threshold', type: 'number', min: 0, max: 1, step: 0.05, value: form.threshold, onChange: setNum('threshold') }),
            ]),
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a2' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-coord' }, '坐标模式'),
              React.createElement('select', { key: 'i', id: 'ocr-coord', value: form.coordMode, onChange: setStr('coordMode') }, [
                React.createElement('option', { key: 'both', value: 'both' }, '百分比 + 像素'),
                React.createElement('option', { key: 'percent', value: 'percent' }, '仅百分比'),
                React.createElement('option', { key: 'pixel', value: 'pixel' }, '仅像素'),
              ]),
            ]),
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a3' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-retry' }, '自动区域重读'),
              React.createElement('input', { key: 'i', id: 'ocr-retry', type: 'checkbox', checked: form.retryEnabled, onChange: setBool('retryEnabled') }),
            ]),
            React.createElement('div', { className: 'dsh-ocr-row', key: 'a4' }, [
              React.createElement('label', { key: 'l', htmlFor: 'ocr-rounds' }, '最大重读轮数'),
              React.createElement('input', { key: 'i', id: 'ocr-rounds', type: 'number', min: 1, max: 3, step: 1, value: form.maxRounds, onChange: setNum('maxRounds') }),
            ]),
          ] : null,
          React.createElement('div', { className: 'dsh-ocr-actions', key: 'ac2' }, [
            React.createElement('button', { key: 's', className: 'dsh-ocr-btn primary', disabled: !!busy, onClick: save }, '保存'),
            React.createElement('button', { key: 'r', className: 'dsh-ocr-btn', disabled: !!busy, onClick: reset }, '重置'),
          ]),
          React.createElement('div', { className: 'dsh-ocr-status', key: 'st' }, status),
          React.createElement('div', { className: 'dsh-ocr-note', key: 'nt' }, `当前格式：${formatLabel}；配置保存于工作区 .dsh-ocr/config.json（插件重启后仍生效）；API Key 只写文件不回显明文。`),
        ]) : null,
      )
    }

    slots.inject('settings.plugin.item', () => slots.register(
      { name: 'settings.plugin.item', id: 'dsh-ocr', order: 95, label: 'OCR 视觉识别' },
      () => React.createElement(OcrCard),
    ))
  },
}

import { useEffect, useRef, useState } from 'react'
import './App.css'
import { EventsOn, EventsEmit } from '../wailsjs/runtime/runtime'

// 安全包装：在浏览器直开或未通过 Wails 运行时，window.runtime 可能不存在
const RT = typeof window !== 'undefined' && window.runtime
const EOn = RT ? EventsOn : (event, cb) => { console.warn('[Mock] EventsOn', event); return () => {} }
const EEmit = RT ? EventsEmit : (...args) => { console.warn('[Mock] EventsEmit', args) }

function ChatHeader({ onToggleSettings, subtitle }) {
  return (
    <div className="chat-header">
      <div className="title">小智</div>
      <div className={`subtitle ${subtitle.includes('离线') ? 'offline' : 'online'}`}>{subtitle}</div>
      <div className="spacer" />
      <button className="icon-btn" title="连接设置" onClick={onToggleSettings}>⚙️</button>
    </div>
  )
}

function Message({ role, text, time }) {
  return (
    <div className={`msg-row ${role === 'user' ? 'right' : 'left'}`}>
      {role !== 'user' && <div className="avatar">🤖</div>}
      <div className={`bubble ${role}`}>
        <div className="text" dangerouslySetInnerHTML={{ __html: text }}></div>
        <div className="meta">{time}</div>
      </div>
      {role === 'user' && <div className="avatar user">🧑</div>}
    </div>
  )
}

function InputBar({ onSend, onPTTStart, onPTTStop, recording, pttTime }) {
  const [val, setVal] = useState('')
  const send = () => {
    const v = val.trim()
    if (!v) return
    onSend(v)
    setVal('')
  }
  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  return (
    <div className="input-bar">
      <button
        className={`mic ${recording ? 'recording' : ''}`}
        title="按住说话"
        onMouseDown={onPTTStart}
        onMouseUp={onPTTStop}
        onMouseLeave={() => recording && onPTTStop()}
        onTouchStart={(e)=>{ e.preventDefault(); onPTTStart() }}
        onTouchEnd={(e)=>{ e.preventDefault(); onPTTStop() }}
      >
        {recording ? '●' : '🎤'}
      </button>
      {recording && <div className="ptt-timer">{pttTime.toFixed(1)}s</div>}
      <textarea
        className="text-input"
        rows={1}
        placeholder="输入消息…"
        value={val}
        onChange={(e)=>setVal(e.target.value)}
        onKeyDown={handleKey}
      />
      <button className="send" onClick={send} title="发送">➤</button>
    </div>
  )
}

function SettingsPanel({ open, form, setForm, onConnect, onDisconnect, connecting }) {
  if (!open) return null
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }))
  return (
    <div className="settings">
      <div className="row">
        <label>协议</label>
        <select value={form.protocol} onChange={e=>set('protocol', e.target.value)}>
          <option value="mqtt">MQTT + UDP</option>
          <option value="ws">WebSocket</option>
        </select>
        <div className="spacer" />
        <button onClick={()=>onConnect(form)} className="primary" disabled={connecting}>{connecting ? '连接中…' : '连接'}</button>
        <button onClick={onDisconnect} className="danger" style={{marginLeft:8}} disabled={connecting}>断开</button>
      </div>
      {form.protocol === 'ws' ? (
        <>
          <div className="row">
            <label>使用OTA</label>
            <input type="checkbox" checked={!!form.use_ota} onChange={(e)=>set('use_ota', e.target.checked)} />
          </div>
          <div className="row">
            <label>启用Token</label>
            <input type="checkbox" checked={!!form.enable_token} onChange={(e)=>set('enable_token', e.target.checked)} />
          </div>
          {/* 使用 OTA 时显示 OTA 参数 */}
          {toBool(form.use_ota) && (
            <>
              <div className="row">
                <label>OTA URL</label>
                <input value={form.ota_url} onChange={e=>set('ota_url', e.target.value)} placeholder="https://api.tenclass.net/xiaozhi/ota/" style={{flex:1}} />
              </div>
              <div className="row">
                <label>Device-Id</label>
                <input value={form.ota_device_id} onChange={e=>set('ota_device_id', e.target.value)} placeholder="58:8c:81:66:01:CC" style={{flex:1}} />
              </div>
              <div className="row" style={{alignItems:'stretch'}}>
                <label style={{alignSelf:'flex-start', marginTop:4}}>OTA POST内容</label>
                <textarea
                  value={form.ota_body}
                  onChange={e=>set('ota_body', e.target.value)}
                  rows={12}
                  style={{flex:1, fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'}}
                  placeholder="粘贴/编辑将作为 POST Body 发送的 JSON"
                />
              </div>
            </>
          )}
          {/* 不使用 OTA 时显示手动 WS URL */}
          {!toBool(form.use_ota) && (
            <div className="row"><label>WS URL</label><input value={form.ws} onChange={e=>set('ws', e.target.value)} placeholder="wss://host/ws" /></div>
          )}
        </>
      ) : (
        <>
          <div className="row"><label>Broker</label><input value={form.broker} onChange={e=>set('broker', e.target.value)} placeholder="tcp://127.0.0.1:1883" /></div>
          <div className="row"><label>Pub</label><input value={form.pub} onChange={e=>set('pub', e.target.value)} placeholder="devices/+/tx" /></div>
          <div className="row"><label>Sub</label><input value={form.sub} onChange={e=>set('sub', e.target.value)} placeholder="devices/+/rx" /></div>
          <div className="row">
            <label>User</label><input value={form.username} onChange={e=>set('username', e.target.value)} />
            <label style={{marginLeft:8}}>Pass</label><input value={form.password} onChange={e=>set('password', e.target.value)} />
          </div>
        </>
      )}
      <div className="row">
        <label>ClientID</label><input value={form.client_id} onChange={e=>set('client_id', e.target.value)} />
        <label style={{marginLeft:8}}>DeviceID</label><input value={form.device_id} onChange={e=>set('device_id', e.target.value)} />
      </div>
      <div className="row"><label>Token</label><input value={form.token} onChange={e=>set('token', e.target.value)} disabled={!toBool(form.enable_token)} /></div>
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState([])
  const [recording, setRecording] = useState(false)
  const [showSettings, setShowSettings] = useState(true)
  const [form, setForm] = useState(() => ({
    protocol: 'ws',
    ws: 'ws://127.0.0.1:8000',
    use_ota: true,
    enable_token: true,
    ota_url: 'https://api.tenclass.net/xiaozhi/ota/',
    ota_device_id: '58:8c:81:66:01:CC',
    ota_body: JSON.stringify({
      version: 2,
      flash_size: 16777216,
      minimum_free_heap_size: 66204,
      mac_address: 'dc:da:0c:8f:d6:fc',
      uuid: '22655a88-1649-4526-9fb7-9698ccf14e04',
      chip_model_name: 'esp32c3',
      chip_info: { model: 5, cores: 1, revision: 4, features: 18 },
      application: {
        name: 'xiaozhi',
        version: '1.1.9',
        compile_time: 'Feb 17 2025T20:41:30Z',
        idf_version: 'v5.4-dev-4076-gce6085349f',
        elf_sha256: '27878af4f1e8f87dcca22b97a13a4da9ae9fcc43596fa3e6905b90957a1a42b9'
      },
      partition_table: [
        { label: 'nvs', type: 1, subtype: 2, address: 36864, size: 16384 },
        { label: 'otadata', type: 1, subtype: 0, address: 53248, size: 8192 },
        { label: 'phy_init', type: 1, subtype: 1, address: 61440, size: 4096 },
        { label: 'model', type: 1, subtype: 130, address: 65536, size: 983040 },
        { label: 'ota_0', type: 0, subtype: 16, address: 1048576, size: 6291456 },
        { label: 'ota_1', type: 0, subtype: 17, address: 7340032, size: 6291456 }
      ],
      ota: { label: 'ota_0' },
      board: {
        type: 'xmini-c3',
        ssid: 'Redmi_Kalicyh_2.5G',
        rssi: -54,
        channel: 9,
        ip: '192.168.31.234',
        mac: 'dc:da:0c:8f:d6:fc'
      }
    }, null, 2),
    broker: '', pub: 'devices/+/tx', sub: 'devices/+/rx', username: '', password: '', client_id: '', device_id: '', token: ''
  }))
  const [pttTime, setPttTime] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const [subtitle, setSubtitle] = useState('离线')
  const listRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    // 消息 & 连接状态监听（使用安全包装）
    const offText = EOn('text', (payload) => {
      let display = ''
      try {
        const obj = typeof payload === 'string' ? JSON.parse(payload) : payload
        display = obj.text || obj.content || obj.message || payload
      } catch {
        display = String(payload)
      }
      appendMsg('bot', escapeHtml(display))
    })
    const offConnected = EOn('connected', (info) => {
      setConnecting(false)
      const proto = (info && info.protocol) || form.protocol
      setSubtitle(`在线 · ${proto === 'ws' ? 'WebSocket' : 'MQTT'}`)
      appendMsg('bot', `已连接（${proto}）`)
      // ...不在此处保存配置，改为在发起连接时保存（包含解析后的地址）
    })
    const offDisconnected = EOn('disconnected', () => {
      setSubtitle('离线')
      appendMsg('bot', '已断开连接')
    })
    const offError = EOn('error', (err) => {
      setConnecting(false)
      setShowSettings(true)
      appendMsg('bot', `连接错误：${escapeHtml(String(err))}`)
    })
    const offConfig = EOn('config', (m) => {
      // 从持久化恢复
      try {
        const obj = typeof m === 'string' ? JSON.parse(m) : m
        setForm(f => ({
          ...f,
          ...obj,
          use_ota: toBool(obj?.use_ota ?? f.use_ota),
          enable_token: toBool(obj?.enable_token ?? f.enable_token),
        }))
      } catch {
        // ignore
      }
    })
    // 请求加载配置
    EEmit('load_config')
    return () => {
      offText && offText(); offConnected && offConnected(); offDisconnected && offDisconnected(); offError && offError(); offConfig && offConfig()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) { el.scrollTop = el.scrollHeight }
  }, [messages])

  const formatTime = () => {
    const d = new Date()
    const h = String(d.getHours()).padStart(2,'0')
    const m = String(d.getMinutes()).padStart(2,'0')
    return `${h}:${m}`
  }

  const appendMsg = (role, text) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text, time: formatTime() }])
  }

  const onSend = (text) => {
    appendMsg('user', escapeHtml(text))
    EEmit('send_text', text)
  }

  const startPTT = () => {
    setRecording(true)
    setPttTime(0)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(()=> setPttTime(t=>t+0.1), 100)
    EEmit('start_listen')
  }

  const stopPTT = () => {
    setRecording(false)
    clearInterval(timerRef.current)
    EEmit('stop_listen')
  }

  const handleConnect = async (f) => {
    setConnecting(true)
    if (f.protocol === 'ws') {
      let resolved = { ...f }
      if (toBool(f.use_ota)) {
        try {
          let bodyObj = {}
          if (f.ota_body && String(f.ota_body).trim()) {
            try { bodyObj = JSON.parse(f.ota_body) } catch (e) {
              throw new Error('OTA POST内容不是有效的 JSON')
            }
          }
          const headers = { 'Content-Type': 'application/json', 'Accept': '*/*' }
          if (f.ota_device_id) headers['Device-Id'] = f.ota_device_id
          const res = await fetch(f.ota_url, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyObj),
            cache: 'no-store'
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          const wsUrl = data?.websocket?.url
          if (!wsUrl) throw new Error('OTA 响应缺少 websocket.url')
          resolved.ws = wsUrl
          // 若 OTA 同时提供 token，则一并使用
          const wsToken = data?.websocket?.token
          if (wsToken) resolved.token = wsToken
        } catch (e) {
          setConnecting(false)
          setShowSettings(true)
          appendMsg('bot', `OTA 获取失败：${escapeHtml(String(e))}`)
          return
        }
      }
      EventsEmit('connect_ws', { url: resolved.ws, client_id: resolved.client_id, device_id: resolved.device_id, token: resolved.token, enable_token: toBool(resolved.enable_token) })
      EventsEmit('save_config', resolved)
    } else {
      EventsEmit('connect_mqtt', { broker: f.broker, username: f.username, password: f.password, pub: f.pub, sub: f.sub, client_id: f.client_id, device_id: f.device_id, token: f.token })
      EventsEmit('save_config', f)
    }
    setShowSettings(false)
  }

  const handleDisconnect = () => { EEmit('disconnect') }

  return (
    <div className="chat">
      {!RT && (
        <div style={{background:'#b23', color:'#fff', padding:8, textAlign:'center'}}>
          未检测到 Wails 运行环境。请使用 "wails dev" 或 "wails build" 运行应用。
        </div>
      )}
      <ChatHeader onToggleSettings={()=> setShowSettings(s=>!s)} subtitle={subtitle} />
      <SettingsPanel open={showSettings} form={form} setForm={setForm} onConnect={handleConnect} onDisconnect={handleDisconnect} connecting={connecting} />
      <div className="msg-list" ref={listRef}>
        {messages.map(m => (<Message key={m.id} role={m.role} text={m.text} time={m.time} />))}
      </div>
      <InputBar onSend={onSend} onPTTStart={startPTT} onPTTStop={stopPTT} recording={recording} pttTime={pttTime} />
    </div>
  )
}

export default App

function escapeHtml(str){
  return str
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;')
}

function toBool(v){
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true' || v === '1' || v.toLowerCase() === 'yes'
  return !!v
}

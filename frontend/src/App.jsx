import { useEffect, useRef, useState } from 'react'
import './App.css'
import { EventsOn, EventsEmit } from '../wailsjs/runtime/runtime'
import { GetSystemVolume, SetSystemVolume, IsSystemVolumeSupported } from '../wailsjs/go/main/App'
import AudioPlayer from './audio/AudioPlayer.js'

// 安全包装：在浏览器直开或未通过 Wails 运行时，window.runtime 可能不存在
const RT = typeof window !== 'undefined' && window.runtime
const EOn = RT ? EventsOn : (event, cb) => { console.warn('[Mock] EventsOn', event); return () => {} }
const EEmit = RT ? EventsEmit : (...args) => { console.warn('[Mock] EventsEmit', args) }

function ChatHeader({ onToggleSettings, subtitle, isPlayingAudio, audioStats }) {
  return (
    <div className="chat-header">
      <div className="title">小智</div>
      <div className={`subtitle ${subtitle.includes('离线') ? 'offline' : 'online'}`}>
        {subtitle}
        {isPlayingAudio && audioStats && (
          <span className="audio-indicator">
            🔊 {audioStats.packetsReceived} 包 
            {audioStats.smoothRate && ` | 平滑: ${audioStats.smoothRate}`}
            {audioStats.quality && ` | 音质: ${audioStats.quality}`}
          </span>
        )}
      </div>
      <div className="spacer" />
      <button className="icon-btn" title="连接设置" onClick={onToggleSettings}>⚙️</button>
    </div>
  )
}

function Message({ role, text, time }) {
  if (role === 'system') {
    return (
      <div className="msg-row left" style={{justifyContent: 'center'}}>
        <div className="bubble system">
          <div className="text" dangerouslySetInnerHTML={{ __html: text }}></div>
        </div>
      </div>
    )
  }
  
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

function SettingsPanel({ open, form, setForm, onConnect, onDisconnect, connecting, audioPlayer, isPlayingAudio }) {
  const [volume, setVolume] = useState(100) // 添加音量状态
  const [systemVolumeSupported, setSystemVolumeSupported] = useState(false)
  const [useSystemVolume, setUseSystemVolume] = useState(true) // 是否使用系统音量
  const volumeTimeoutRef = useRef(null) // 音量设置防抖
  
  // 检查系统音量支持
  useEffect(() => {
    const checkSystemVolumeSupport = async () => {
      try {
        const supported = await IsSystemVolumeSupported()
        setSystemVolumeSupported(supported)
        console.log('系统音量控制支持:', supported)
      } catch (error) {
        console.warn('检查系统音量支持失败:', error)
        setSystemVolumeSupported(false)
      }
    }
    checkSystemVolumeSupport()
  }, [])
  
  // 初始化音量
  useEffect(() => {
    const initVolume = async () => {
      if (useSystemVolume && systemVolumeSupported) {
        try {
          const systemVol = await GetSystemVolume()
          setVolume(Math.round(systemVol * 100))
          console.log('当前系统音量:', Math.round(systemVol * 100) + '%')
        } catch (error) {
          console.warn('获取系统音量失败:', error)
          setVolume(50)
        }
      } else if (audioPlayer) {
        const currentVolume = audioPlayer.getVolume()
        if (typeof currentVolume === 'number') {
          setVolume(Math.round(currentVolume * 100))
        }
      }
    }
    initVolume()
    
    // 清理函数：清除定时器
    return () => {
      if (volumeTimeoutRef.current) {
        clearTimeout(volumeTimeoutRef.current)
      }
    }
  }, [audioPlayer, useSystemVolume, systemVolumeSupported])
  
  if (!open) return null
  const set = (k, v) => setForm(s => ({ ...s, [k]: v }))
  
  const handleVolumeChange = async (newVolume) => {
    const volumeValue = parseInt(newVolume)
    setVolume(volumeValue) // 立即更新UI
    
    // 清除之前的定时器（如果有）
    if (volumeTimeoutRef.current) {
      clearTimeout(volumeTimeoutRef.current)
    }
    
    // 立即设置音量，实现实时跟随
    if (useSystemVolume && systemVolumeSupported) {
      try {
        await SetSystemVolume(volumeValue / 100)
        console.log('系统音量实时设置为:', volumeValue + '%')
      } catch (error) {
        console.error('设置系统音量失败:', error)
      }
    }
    
    if (audioPlayer) {
      audioPlayer.setVolume(volumeValue / 100)
    }
  }
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
      {toBool(form.enable_token) && (
        <div className="row">
          <label>Token方式</label>
          <select value={form.token_method || 'header'} onChange={e=>set('token_method', e.target.value)}>
            <option value="header">Header Authorization</option>
            <option value="query_access_token">Query参数 access_token</option>
            <option value="query_token">Query参数 token</option>
          </select>
        </div>
      )}
      

      
      {audioPlayer && (
        <>
          {systemVolumeSupported && (
            <div className="row">
              <label>音量控制</label>
              <select 
                value={useSystemVolume ? 'system' : 'app'} 
                onChange={(e) => setUseSystemVolume(e.target.value === 'system')}
                style={{flex: 1}}
              >
                <option value="system">系统音量</option>
                <option value="app">应用音量</option>
              </select>
            </div>
          )}
          <div className="row">
            <label>{systemVolumeSupported && useSystemVolume ? '系统音量' : '应用音量'}</label>
            <input 
              type="range" 
              min="0" 
              max="100" 
              value={volume}
              onChange={(e) => handleVolumeChange(e.target.value)}
              style={{
                flex: 1, 
                marginRight: '8px',
                WebkitAppearance: 'none',
                appearance: 'none',
                height: '6px',
                borderRadius: '3px',
                background: `linear-gradient(to right, #007acc 0%, #007acc ${volume}%, #ddd ${volume}%, #ddd 100%)`,
                outline: 'none'
              }}
            />
            <span style={{
              fontSize: '12px', 
              color: volume > 80 ? '#ff6b6b' : volume > 50 ? '#ffa726' : '#4caf50', 
              fontWeight: 'bold',
              minWidth: '35px',
              textAlign: 'right'
            }}>
              {volume}%
            </span>
          </div>
        </>
      )}
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
    broker: '', pub: 'devices/+/tx', sub: 'devices/+/rx', username: '', password: '', client_id: '', device_id: '', token: '', token_method: 'header'
  }))
  const [pttTime, setPttTime] = useState(0)
  const [connecting, setConnecting] = useState(false)
  const [subtitle, setSubtitle] = useState('离线')
  const [isPlayingAudio, setIsPlayingAudio] = useState(false) // 音频播放状态
  const [audioStats, setAudioStats] = useState({ 
    packetsReceived: 0, 
    lastPacketTime: 0,
    smoothRate: null,
    quality: 'good'
  })
  const listRef = useRef(null)
  const timerRef = useRef(null)
  const audioPlayerRef = useRef(null) // 音频播放器引用

  // 初始化音频播放器
  useEffect(() => {
    audioPlayerRef.current = new AudioPlayer()
    
    // 暴露到全局以便调试
    window.audioPlayerRef = audioPlayerRef
    
    // 设置音频播放器回调
    audioPlayerRef.current.onStartPlay = () => {
      setIsPlayingAudio(true)
      console.log('开始播放音频')
      
      // 只在开始新的播放会话时显示消息
      const now = Date.now()
      if (!window.lastPlayStartMessage || now - window.lastPlayStartMessage > 2000) {
        appendMsg('system', '🔊 开始播放语音流')
        window.lastPlayStartMessage = now
      }
    }
    
    audioPlayerRef.current.onStopPlay = () => {
      setIsPlayingAudio(false)
      console.log('停止播放音频')
      
      // 延迟显示停止消息，避免短暂停顿时的重复消息
      clearTimeout(window.stopPlayTimeout)
      window.stopPlayTimeout = setTimeout(() => {
        if (!audioPlayerRef.current?.isPlaying) {
          appendMsg('system', '🔇 语音播放完成')
          // 重置音频统计
          setAudioStats({ packetsReceived: 0, lastPacketTime: 0 })
        }
      }, 1000) // 1秒后确认真的停止了才显示消息
    }
    
    audioPlayerRef.current.onError = (error) => {
      console.error('音频播放错误:', error)
      setIsPlayingAudio(false)
      
      // 限制错误消息频率
      const now = Date.now()
      if (!window.lastPlayErrorMessage || now - window.lastPlayErrorMessage > 5000) {
        appendMsg('system', `❌ 音频播放失败: ${error.message}`)
        window.lastPlayErrorMessage = now
      }
    }

    // 清理函数
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.destroy()
      }
    }
  }, [])

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
    
    // 音频数据监听
    const offAudio = EOn('audio', async (audioData) => {
      if (audioPlayerRef.current && audioData) {
        try {
          // 检查音频数据类型和格式
          let audioBytes
          
          if (audioData instanceof ArrayBuffer) {
            audioBytes = new Uint8Array(audioData)
          } else if (audioData instanceof Uint8Array) {
            audioBytes = audioData
          } else if (Array.isArray(audioData)) {
            audioBytes = new Uint8Array(audioData)
          } else if (typeof audioData === 'string') {
            try {
              const binaryString = atob(audioData)
              audioBytes = new Uint8Array(binaryString.length)
              for (let i = 0; i < binaryString.length; i++) {
                audioBytes[i] = binaryString.charCodeAt(i)
              }
              console.log('Base64 音频数据解码成功')
            } catch (base64Error) {
              console.error('Base64 解码失败:', base64Error)
              appendMsg('system', '❌ 音频数据格式错误 (Base64)')
              return
            }
          } else {
            console.warn('未知的音频数据格式:', typeof audioData, audioData)
            appendMsg('system', '⚠️ 收到未知格式的音频数据')
            return
          }
          
          // 静默处理小音频包，只在控制台记录
          console.log(`处理音频数据: ${audioBytes.length} bytes`)
          
          // 更新音频统计
          setAudioStats(prev => ({
            packetsReceived: prev.packetsReceived + 1,
            lastPacketTime: Date.now()
          }))
          
          // 检查数据是否看起来像有效帧
          if (audioBytes.length < 10) {
            console.warn('音频数据太小，跳过处理')
            return
          }
          
          // 播放音频（静默处理，不显示每个包的消息）
          console.log(`处理音频包: ${audioBytes.length} bytes`)
          
          const success = await audioPlayerRef.current.playAudio(audioBytes, 'opus')
          if (!success) {
            // 只在连续失败时显示错误消息
            const now = Date.now()
            if (!window.lastAudioError || now - window.lastAudioError > 5000) {
              appendMsg('system', '❌ 音频播放遇到问题')
              window.lastAudioError = now
            }
          }
        } catch (error) {
          console.error('处理音频数据失败:', error)
          
          // 限制错误消息频率
          const now = Date.now()
          if (!window.lastAudioProcessError || now - window.lastAudioProcessError > 3000) {
            appendMsg('system', `❌ 音频处理错误: ${error.message}`)
            window.lastAudioProcessError = now
          }
        }
      }
    })
    
    // Go 端解码的 PCM 音频数据监听
    const offAudioPCM = EOn('audio_pcm', async (pcmData) => {
      if (audioPlayerRef.current && pcmData) {
        try {
          console.log(`收到 Go 端 PCM 数据: ${pcmData.length} samples`)
          
          // 使用新的 Go PCM 播放方法
          const success = await audioPlayerRef.current.playGoPCMAudio(pcmData)
          
          // 获取处理器统计信息并更新音频统计
          const processorStats = audioPlayerRef.current.goPCMProcessor.getStats()
          setAudioStats(prev => ({
            packetsReceived: prev.packetsReceived + 1,
            lastPacketTime: Date.now(),
            smoothRate: processorStats.smoothRate,
            quality: success ? 'good' : 'poor'
          }))
          
          if (!success) {
            // 只在连续失败时显示错误消息
            const now = Date.now()
            if (!window.lastPCMError || now - window.lastPCMError > 5000) {
              appendMsg('system', '❌ Go PCM 音频播放遇到问题')
              window.lastPCMError = now
            }
          }
        } catch (error) {
          console.error('处理 Go PCM 数据失败:', error)
          
          // 限制错误消息频率
          const now = Date.now()
          if (!window.lastPCMProcessError || now - window.lastPCMProcessError > 3000) {
            appendMsg('system', `❌ Go PCM 处理错误: ${error.message}`)
            window.lastPCMProcessError = now
          }
        }
      }
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
      // 断开连接时停止音频播放
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop()
      }
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
      offText && offText(); offAudio && offAudio(); offAudioPCM && offAudioPCM(); offConnected && offConnected(); offDisconnected && offDisconnected(); offError && offError(); offConfig && offConfig()
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
      <ChatHeader 
        onToggleSettings={()=> setShowSettings(s=>!s)} 
        subtitle={subtitle} 
        isPlayingAudio={isPlayingAudio} 
        audioStats={audioStats}
      />
      <SettingsPanel 
        open={showSettings} 
        form={form} 
        setForm={setForm} 
        onConnect={handleConnect} 
        onDisconnect={handleDisconnect} 
        connecting={connecting}
        audioPlayer={audioPlayerRef.current}
        isPlayingAudio={isPlayingAudio}
      />
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





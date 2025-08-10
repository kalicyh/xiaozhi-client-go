import { useEffect, useRef, useState } from 'react'
import './App.css'
import { EventsOn, EventsEmit } from '../wailsjs/runtime/runtime'
import { GetSystemVolume, SetSystemVolume, IsSystemVolumeSupported } from '../wailsjs/go/main/App'
import AudioPlayer from './audio/AudioPlayer.js'
import SettingsPage from './components/SettingsPage.jsx'
import CustomTitleBar from './components/CustomTitleBar.jsx'
import './components/SettingsPage.css'
// 新增：并发测试页面
import LoadTest from './components/LoadTest.jsx'
// 新增：麦克风录音器
import MicRecorder from './audio/MicRecorder.js'

// 布尔值容错转换（支持 true/false、'true'/'false'、1/0、'1'/'0'、'yes'/'no'、'on'/'off'）
function toBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'on'
  }
  return !!v
}

// 基础 HTML 转义（并将换行替换为 <br/> 以保留多行显示）
function escapeHtml(input) {
  const s = String(input ?? '')
  const escaped = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
  return escaped.replace(/\n/g, '<br/>')
}

// 安全包装：在浏览器直开或未通过 Wails 运行时，window.runtime 可能不存在
const RT = typeof window !== 'undefined' && window.runtime
const EOn = RT ? EventsOn : (event, cb) => { console.warn('[Mock] EventsOn', event); return () => {} }
const EEmit = RT ? EventsEmit : (...args) => { console.warn('[Mock] EventsEmit', args) }

// 一次性事件等待工具：等待指定事件一次并返回其数据，带超时
function onceEvent(eventName, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let off = null
    let timer = null
    const cleanup = () => { if (off) { off(); off = null } ; if (timer) { clearTimeout(timer); timer = null } }
    try {
      off = EOn(eventName, (payload) => { cleanup(); resolve(payload) })
      if (timeoutMs > 0) {
        timer = setTimeout(() => { cleanup(); reject(new Error(`${eventName} 等待超时`)) }, timeoutMs)
      }
    } catch (e) {
      cleanup(); reject(e)
    }
  })
}

function Message({ role, text, time, detail, onShowDetail, avatar }) {
  if (role === 'system') {
    const clickable = !!detail
    return (
      <div className="msg-row left" style={{justifyContent: 'center'}}>
        <div
          className="bubble system"
          style={clickable ? { cursor: 'pointer' } : undefined}
          onClick={clickable ? () => onShowDetail && onShowDetail('详细信息', detail) : undefined}
        >
          <div className="text" dangerouslySetInnerHTML={{ __html: text }}></div>
        </div>
      </div>
    )
  }
  
  return (
    <div className={`msg-row ${role === 'user' ? 'right' : 'left'}`}>
      {role !== 'user' && <div className="avatar">{avatar || '🤖'}</div>}
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
  const taRef = useRef(null)
  const composingRef = useRef(false)

  const autosize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px' // 限制最大高度，避免撑太高
  }

  const send = () => {
    const v = val.trim()
    if (!v) return
    onSend(v)
    setVal('')
    // 发送后保持焦点并复位高度
    if (taRef.current) {
      taRef.current.focus()
      taRef.current.style.height = 'auto'
      taRef.current.style.height = ''
    }
  }

  const handleKey = (e) => {
    // 避免中文输入法组合状态下回车误发送
    if (e.isComposing || composingRef.current) return
    if (e.key === 'Enter' && !e.shiftKey) { 
      e.preventDefault(); 
      send() 
    }
  }

  useEffect(() => { autosize() }, [val])

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
        ref={taRef}
        className="text-input"
        rows={1}
        placeholder="输入消息…"
        value={val}
        onChange={(e)=> setVal(e.target.value)}
        onKeyDown={handleKey}
        onCompositionStart={()=> (composingRef.current = true)}
        onCompositionEnd={()=> (composingRef.current = false)}
      />
      <button className="send" onClick={send} title="发送">➤</button>
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState([])
  const [recording, setRecording] = useState(false)
  const [currentPage, setCurrentPage] = useState('chat') // 'chat' | 'settings' | 'db' | 'loadtest'
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  // 新增：麦克风录音器引用
  const micRef = useRef(null)
  const [form, setForm] = useState(() => ({
    protocol: 'ws',
    ws: 'ws://127.0.0.1:8000',
    use_ota: true,
    enable_token: true,
    // 新增：控制系统提示气泡显隐
    show_system_bubbles: true,
    // 统一设备ID：默认使用系统 MAC
    use_system_mac: true,
    system_mac: '',
    ota_url: 'https://api.tenclass.net/xiaozhi/ota/',
    ota_body: JSON.stringify({
      version: 2,
      mac_address: '',
      uuid: '',
      application: {
        name: 'xiaozhi',
        version: '0.0.1'
      },
      board: {
        type: 'xiaozhi-client-go'
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
  const [connected, setConnected] = useState(false) // 新增：连接状态布尔
  const listRef = useRef(null)
  const timerRef = useRef(null)
  const audioPlayerRef = useRef(null) // 音频播放器引用
  const hasPlayedAudioRef = useRef(false) // 标记是否有过音频播放
  const pendingMessagesRef = useRef([]) // 新增：待发送消息队列
  const disconnectNoticeRef = useRef(0) // 新增：断开提示去重时间戳
  const [detailModal, setDetailModal] = useState({ open: false, title: '', content: '' }) // 新增：详情弹窗
  
  // 新增：按 session 追踪 TTS 消息（用于 sentence_end 校对替换）
  const ttsMsgRef = useRef(new Map())
  // 新增：头像与拦截
  const pendingAvatarRef = useRef(null)
  const lastUserMsgRef = useRef("")
  const interceptQuotaRef = useRef(0)
  // 新增：拦截窗口（仅在用户发送后的前两条服务器消息内生效）
  const interceptWindowRef = useRef(0)
  // 新增：PTT 首条消息作为用户气泡的标记
  const pttExpectUserFirstRef = useRef(false)
  const pttFirstTimeoutRef = useRef(null)
  // 新增：自动连接标志（用于抑制“已连接”重复提示）
  const autoConnectingRef = useRef(false)
  // 新增：系统气泡显隐的 ref，避免事件回调闭包拿到旧状态
  const showSystemBubblesRef = useRef(true)

  // 同步系统气泡显隐到 ref，并在关闭时清理已存在的系统消息
  useEffect(() => {
    const v = toBool(form.show_system_bubbles)
    showSystemBubblesRef.current = v
    if (!v) {
      setMessages(prev => prev.filter(m => m.role !== 'system'))
    }
  }, [form.show_system_bubbles])

  // 新增：更新已有消息文本
  const updateMsgText = (id, newHtmlText) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, text: newHtmlText } : m)))
  }

  // 初始化音频播放器
  useEffect(() => {
    audioPlayerRef.current = new AudioPlayer()
    
    // 暴露到全局以便调试
    window.audioPlayerRef = audioPlayerRef
    
    // 设置音频播放器回调
    audioPlayerRef.current.onStartPlay = () => {
      setIsPlayingAudio(true)
      hasPlayedAudioRef.current = true // 标记已有音频播放
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
        // 只有在真正播放过音频且确认停止时才显示消息
        if (!audioPlayerRef.current?.isPlaying && hasPlayedAudioRef.current) {
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
      // 清理定时器
      if (window.stopPlayTimeout) {
        clearTimeout(window.stopPlayTimeout)
      }
      // 重置音频播放标志
      hasPlayedAudioRef.current = false
      
      if (audioPlayerRef.current) {
        audioPlayerRef.current.destroy()
      }
    }
  }, [])

  // 窗口大小变化监听
  useEffect(() => {
    const handleResize = () => {
      const newSize = { width: window.innerWidth, height: window.innerHeight }
      setWindowSize(newSize)
      
      // 根据窗口大小动态调整聊天窗口类名
      const chatElement = document.querySelector('.chat')
      if (chatElement) {
        // 移除所有尺寸相关的类
        chatElement.classList.remove('fullscreen', 'maximized', 'large', 'small', 'compact')
        
        // 根据窗口大小添加适当的类
        if (newSize.width >= 1600 && newSize.height >= 900) {
          chatElement.classList.add('large')
        } else if (newSize.width <= 768 || newSize.height <= 600) {
          chatElement.classList.add('compact')
        } else if (newSize.width >= 1200 && newSize.height >= 800) {
          chatElement.classList.add('medium-large')
        }
        
        // 全屏检测
        if (newSize.width === screen.width && newSize.height === screen.height) {
          chatElement.classList.add('fullscreen')
        }
      }
      
      console.log('窗口大小变化:', newSize)
    }
    
    // 初始设置
    handleResize()
    
    // 监听窗口大小变化
    window.addEventListener('resize', handleResize)
    
    // 监听全屏状态变化
    document.addEventListener('fullscreenchange', handleResize)
    document.addEventListener('webkitfullscreenchange', handleResize)
    document.addEventListener('mozfullscreenchange', handleResize)
    document.addEventListener('MSFullscreenChange', handleResize)
    
    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('fullscreenchange', handleResize)
      document.removeEventListener('webkitfullscreenchange', handleResize)
      document.removeEventListener('mozfullscreenchange', handleResize)
      document.removeEventListener('MSFullscreenChange', handleResize)
    }
  }, [])

  useEffect(() => {
    // 消息 & 连接状态监听（使用安全包装）
    const offText = EOn('text', (payload) => {
      // 统一拿到原始字符串
      const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)

      // 尝试解析为三类结构，并生成中文概括
      try {
        const obj = typeof payload === 'string' ? JSON.parse(payload) : payload
        let summarized = ''

        // hello
        if (obj && obj.type === 'hello') {
          const ap = obj.audio_params || {}
          const fmt = (ap.format || '').toUpperCase()
          const sr = ap.sample_rate || ap.sampleRate
          const ch = ap.channels
          const fd = ap.frame_duration || ap.frameDuration
          const tp = obj.transport === 'websocket' ? 'WebSocket' : (obj.transport || '未知')

          // 同步前端音频采样率
          if (audioPlayerRef.current && sr) {
            try { audioPlayerRef.current.setSampleRate(Number(sr)) } catch {}
          }

          summarized = `会话握手成功 · 传输: ${escapeHtml(String(tp))} · 音频: ${escapeHtml(String(fmt || ''))} ${escapeHtml(String(sr || '?'))}Hz ${escapeHtml(String(ch || '?'))}声道 · 帧 ${escapeHtml(String(fd || '?'))}ms`
          return appendMsg('system', summarized, JSON.stringify(obj, null, 2))
        }

        // mcp initialize
        if (obj && (obj.type === 'mcp' || (obj.payload && obj.payload.jsonrpc === '2.0'))) {
          const method = obj.payload?.method || ''
          if (method === 'initialize') {
            const pv = obj.payload?.params?.protocolVersion || '-'
            const cn = obj.payload?.params?.clientInfo?.name || '-'
            const cv = obj.payload?.params?.clientInfo?.version || ''
            const vision = obj.payload?.params?.capabilities?.vision ? ' · 启用视觉' : ''
            summarized = `MCP 初始化 · 协议 ${escapeHtml(String(pv))} · 客户端 ${escapeHtml(String(cn))} ${escapeHtml(String(cv))}${vision}`
            return appendMsg('system', summarized, JSON.stringify(obj, null, 2))
          }
        }

        // tts（按句处理：start 先显示，end 如不同则替换）
        if (obj && obj.type === 'tts') {
          const state = obj.state || obj.status
          const sessionId = obj.session_id || obj.sessionId || 'default'
          const content = obj.text ?? obj.content ?? ''

          // 同步采样率（如果提供）
          const ttsSr = obj.sample_rate || obj.sampleRate
          if (audioPlayerRef.current && ttsSr) {
            try { audioPlayerRef.current.setSampleRate(Number(ttsSr)) } catch {}
          }

          if (state === 'sentence_start') {
            const id = crypto.randomUUID()
            const html = escapeHtml(String(content))
            // 消费一次待用头像
            let avatarEmoji
            if (pendingAvatarRef.current) { avatarEmoji = pendingAvatarRef.current; pendingAvatarRef.current = null }
            setMessages(prev => [...prev, { id, role: 'bot', text: html, time: formatTime(), avatar: avatarEmoji }])
            ttsMsgRef.current.set(sessionId, { id, text: html })
            return
          }
          if (state === 'sentence_end') {
            const html = escapeHtml(String(content))
            const rec = ttsMsgRef.current.get(sessionId)
            if (rec) {
              if (rec.text !== html) {
                updateMsgText(rec.id, html)
              }
              ttsMsgRef.current.delete(sessionId)
              return
            } else {
              // 若未找到对应 start，直接追加（同样消耗头像）
              let avatarEmoji
              if (pendingAvatarRef.current) { avatarEmoji = pendingAvatarRef.current; pendingAvatarRef.current = null }
              appendMsg('bot', html, undefined, avatarEmoji)
              return
            }
          }

          // 其它 TTS 状态保持原有概括
          const sr = obj.sample_rate || obj.sampleRate
          const stTxt = state === 'start' ? '开始' : (state === 'stop' ? '结束' : String(state))
          summarized = `TTS ${escapeHtml(stTxt)}`
          return appendMsg('system', summarized, JSON.stringify(obj, null, 2))
        }
      } catch (_) {
        // 非 JSON 或解析失败，走默认逻辑
      }

      // 默认：按原逻辑显示（可能是普通文本或 JSON 文本）
      let display = ''
      try {
        const obj = typeof payload === 'string' ? JSON.parse(payload) : payload
        display = obj.text || obj.content || obj.message || raw
      } catch {
        display = String(payload)
      }

      // 新：每次用户发送后仅拦截两条；第二条若为纯表情则作为下次回复头像
      const plain = String(display || '').trim()
      const windowActive = interceptWindowRef.current > 0

      // 若为按住说话模式下的第一条普通文本，则作为“用户”消息展示，并设置拦截状态
      if (pttExpectUserFirstRef.current && plain) {
        pttExpectUserFirstRef.current = false
        if (pttFirstTimeoutRef.current) { clearTimeout(pttFirstTimeoutRef.current); pttFirstTimeoutRef.current = null }
        appendMsg('user', escapeHtml(display))
        // 同步后续拦截逻辑，仿照键入发送
        lastUserMsgRef.current = plain
        interceptQuotaRef.current = 2
        interceptWindowRef.current = 2
        pendingAvatarRef.current = null
        return
      }

      if (windowActive && interceptQuotaRef.current > 0) {
        // 优先：若是纯表情，则作为下一条回复头像捕获
        if (isEmojiOnly(plain)) {
          pendingAvatarRef.current = plain
          interceptQuotaRef.current -= 1
          interceptWindowRef.current -= 1
          return
        }
        // 回显拦截：与最近用户消息完全一致视为回显
        if (plain === lastUserMsgRef.current) {
          interceptQuotaRef.current -= 1
          interceptWindowRef.current -= 1
          return
        }
        // 未匹配到但窗口前进，避免无限期等待
        interceptWindowRef.current -= 1
      }

      // 消费一次待用头像
      let avatarEmoji
      if (pendingAvatarRef.current) { avatarEmoji = pendingAvatarRef.current; pendingAvatarRef.current = null }
      appendMsg('bot', escapeHtml(display), undefined, avatarEmoji)
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
      // 若是自动连接触发，则不再追加“已连接（…）”提示，避免两条系统消息
      if (!autoConnectingRef.current) {
        appendMsg('system', `已连接（${proto}）`)
      }
      // 连接已建立，重置自动连接标志
      autoConnectingRef.current = false
      setConnected(true)
      // 发送排队消息
      const queued = pendingMessagesRef.current || []
      if (queued.length) {
        pendingMessagesRef.current = []
        appendMsg('system', `已发送待发消息 ${queued.length} 条`)
        queued.forEach(m => EEmit('send_text', m))
      }
      // ...不在此处保存配置，改为在发起连接时保存（包含解析后的地址）
    })
    const offDisconnected = EOn('disconnected', () => {
      setSubtitle('离线')
      notifyDisconnectedOnce()
      setConnected(false)
      // 断开连接重置自动连接标志
      autoConnectingRef.current = false
      // 断开连接时停止音频播放并重置播放标志
      if (audioPlayerRef.current) {
        audioPlayerRef.current.stop()
      }
      hasPlayedAudioRef.current = false // 重置音频播放标志
    })
    const offError = EOn('error', (err) => {
      setConnecting(false)
      setConnected(false)
      // 不再自动跳转到设置页；仅提示错误并保持当前页面

      const raw = String(err || '')
      const lower = raw.toLowerCase()
      const isTimeout = lower.includes('timeout') || lower.includes('timed out') || lower.includes('i/o timeout') || lower.includes('deadline')
      const isClosed = lower.includes('eof') || lower.includes('closed') || lower.includes('reset by peer')

      // 精简错误提示 + 可点击查看详情
      if (isTimeout) {
        appendMsg('system', '❌ 连接超时', raw)
      } else if (isClosed) {
        appendMsg('system', '❌ 连接已关闭', raw)
      } else {
        appendMsg('system', '❌ 连接错误', raw)
      }

      // 根据错误内容提示断开（去重）
      if (isTimeout || isClosed) {
        setSubtitle('离线')
        notifyDisconnectedOnce()
      }
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
          // 新增：恢复系统气泡显隐
          show_system_bubbles: toBool(obj?.show_system_bubbles ?? f.show_system_bubbles),
          // 新增：恢复是否使用系统 MAC
          use_system_mac: toBool(obj?.use_system_mac ?? f.use_system_mac),
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

  const appendMsg = (role, text, detail, avatar) => {
    // 使用 ref 中的最新值，避免闭包导致的旧状态
    if (role === 'system' && !showSystemBubblesRef.current) {
      return
    }
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text, time: formatTime(), detail, avatar }])
  }

  // 新增：断开提示（去重，2 秒内只提示一次）
  const notifyDisconnectedOnce = () => {
    const now = Date.now()
    if (now - disconnectNoticeRef.current < 2000) return
    disconnectNoticeRef.current = now
    appendMsg('system', '已断开连接')
  }

  const onSend = (text) => {
    appendMsg('user', escapeHtml(text))
    // 记录最近用户文本并设置拦截配额；清空待用头像
    lastUserMsgRef.current = String(text).trim()
    interceptQuotaRef.current = 2
    interceptWindowRef.current = 2
    pendingAvatarRef.current = null

    if (connected) {
      EEmit('send_text', text)
      return
    }
    // 未连接：排队并自动连接
    pendingMessagesRef.current.push(text)
    if (!connecting) {
      autoConnectingRef.current = true
      const proto = form.protocol || 'ws'
      appendMsg('system', `自动连接（${proto}）`)
      handleConnect(form)
    } else {
      // 已在连接中，避免重复系统提示
    }
  }

  const startPTT = async () => {
    setRecording(true)
    setPttTime(0)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(()=>setPttTime(t=>t+0.1), 100)

    // 未连接则自动连接
    if (!connected) {
      if (!connecting) {
        autoConnectingRef.current = true
        const proto = form.protocol || 'ws'
        appendMsg('system', `自动连接（${proto}）`)
        handleConnect(form)
      }
    }

    EEmit('start_listen')
    // 开始一次 PTT 会话：下一条普通文本优先作为“用户”气泡显示（带超时）
    pttExpectUserFirstRef.current = true
    if (pttFirstTimeoutRef.current) { clearTimeout(pttFirstTimeoutRef.current) }
    pttFirstTimeoutRef.current = setTimeout(() => {
      pttExpectUserFirstRef.current = false
      pttFirstTimeoutRef.current = null
    }, 10000)

    // 启动麦克风采集并将帧发送给后端
    try {
      if (!micRef.current) {
        micRef.current = new MicRecorder({
          targetSampleRate: 16000,
          onFrame: (arr) => {
            // 将Float32数组转普通数组以便 Wails 传输
            try { EEmit('mic_frame', arr) } catch (e) { console.warn('mic_frame emit failed', e) }
          }
        })
      }
      await micRef.current.start()
    } catch (e) {
      console.error('启动麦克风失败:', e)
      appendMsg('system', `🎙️ 启动麦克风失败: ${escapeHtml(e?.message || String(e))}`)
    }
  }

  const stopPTT = () => {
    setRecording(false)
    clearInterval(timerRef.current)
    EEmit('stop_listen')
    // 停止麦克风
    try { micRef.current && micRef.current.stop() } catch {}
  }

  const handleConnect = async (f) => {
    setConnecting(true)
    // 统一设备ID：优先使用系统 MAC
    const effectiveDeviceId = toBool(f.use_system_mac) ? (f.system_mac || '') : (f.device_id || '')

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
          // 覆盖 uuid 为当前设备ID（系统MAC或输入的MAC）
          if (effectiveDeviceId) { bodyObj.uuid = effectiveDeviceId }
          // 通过后端代理 OTA 请求，规避浏览器跨域限制
          EEmit('ota_request', { url: f.ota_url, device_id: effectiveDeviceId, client_id: f.client_id || '', body: bodyObj })
          const ota = await onceEvent('ota_response', 30000)
          const raw = ota?.raw_response || ''
          let data = null
          try { data = raw ? JSON.parse(raw) : null } catch {}
          const wsUrl = ota?.websocket_url || data?.websocket?.url
          if (!wsUrl) throw new Error('OTA 响应缺少 websocket.url')
          resolved.ws = wsUrl
          const wsToken = ota?.token || data?.websocket?.token
          if (wsToken) resolved.token = wsToken
        } catch (e) {
          setConnecting(false)
          setCurrentPage('settings')
          const msg = `OTA 获取失败：${escapeHtml(e?.message || String(e))}`
          const detail = e?._detail || e?.stack || String(e)
          appendMsg('system', msg, detail)
          return
        }
      }
      // 确保保存与连接时携带统一设备ID
      resolved.device_id = effectiveDeviceId
      EventsEmit('connect_ws', { url: resolved.ws, client_id: resolved.client_id, device_id: resolved.device_id, token: resolved.token, enable_token: toBool(resolved.enable_token) })
      EventsEmit('save_config', resolved)
    } else {
      // MQTT 分支：也支持 OTA 下发
      let resolved = { ...f }
      if (toBool(f.use_ota)) {
        try {
          let bodyObj = {}
          if (f.ota_body && String(f.ota_body).trim()) {
            try { bodyObj = JSON.parse(f.ota_body) } catch (e) {
              throw new Error('OTA POST内容不是有效的 JSON')
            }
          }
          if (effectiveDeviceId) { bodyObj.uuid = effectiveDeviceId }
          // 通过后端代理 OTA 请求，规避浏览器跨域限制
          EEmit('ota_request', { url: f.ota_url, device_id: effectiveDeviceId, client_id: f.client_id || '', body: bodyObj })
          const ota = await onceEvent('ota_response', 30000)
          const raw = ota?.raw_response || ''
          let data = null
          try { data = raw ? JSON.parse(raw) : null } catch {}
          const mq = data?.mqtt || data?.MQTT
          if (!mq) throw new Error('OTA 响应缺少 mqtt 字段')

          // 映射字段（兼容 py-xiaozhi）
          const endpointRaw = mq.endpoint || mq.broker || mq.url || ''
          const port = mq.port ?? mq.mqtt_port
          const endpoint = normalizeMQTTBroker(endpointRaw, true, port) // 默认优先 TLS 8883，并覆盖端口
          const pub = mq.publish_topic || mq.pub || ''
          let sub = mq.subscribe_topic || mq.sub || ''
          const qos = mq.qos ?? resolved.qos
          const keep_alive = mq.keep_alive ?? mq.keepalive ?? resolved.keep_alive
          if (String(sub).toLowerCase() === 'null') sub = ''

          resolved = {
            ...resolved,
            broker: endpoint || resolved.broker,
            username: mq.username ?? resolved.username,
            password: mq.password ?? resolved.password,
            pub: pub || resolved.pub,
            sub: sub || resolved.sub,
            client_id: mq.client_id || resolved.client_id,
            token: mq.token || resolved.token,
            port: port ?? resolved.port,
            qos,
            keep_alive,
          }
        } catch (e) {
          setConnecting(false)
          setCurrentPage('settings')
          const msg = `OTA 获取失败：${escapeHtml(e?.message || String(e))}`
          const detail = e?._detail || e?.stack || String(e)
          appendMsg('system', msg, detail)
          return
        }
      }

      // 在连接前提示将要连接的 MQTT 参数，便于排查
      try {
        appendMsg(
          'system',
          `即将连接 MQTT · ${escapeHtml(String(resolved.broker || ''))} · pub: ${escapeHtml(String(resolved.pub || ''))} · sub: ${escapeHtml(String(resolved.sub || ''))}`,
          JSON.stringify({ broker: resolved.broker, pub: resolved.pub, sub: resolved.sub, client_id: resolved.client_id, username: resolved.username, qos: resolved.qos, keep_alive: resolved.keep_alive }, null, 2)
        )
      } catch {}

      // 确保保存与连接时携带统一设备ID
      resolved.device_id = effectiveDeviceId
      EventsEmit('connect_mqtt', {
        broker: resolved.broker,
        username: resolved.username,
        password: resolved.password,
        pub: resolved.pub,
        sub: resolved.sub,
        client_id: resolved.client_id,
        device_id: resolved.device_id,
        token: resolved.token,
      })
      EventsEmit('save_config', resolved)
    }
    setCurrentPage('chat')
  }

  const handleDisconnect = () => { EEmit('disconnect') }

  // 自动同步 OTA 请求体中的 uuid 与 mac_address 到当前设备ID
  useEffect(() => {
    const effectiveDeviceId = toBool(form.use_system_mac) ? (form.system_mac || '') : (form.device_id || '')
    if (!effectiveDeviceId) return
    try {
      const obj = JSON.parse(form.ota_body || '{}')
      let changed = false
      if (obj.uuid !== effectiveDeviceId) { obj.uuid = effectiveDeviceId; changed = true }
      if (typeof obj.mac_address !== 'undefined' && obj.mac_address !== effectiveDeviceId) {
        obj.mac_address = effectiveDeviceId
        changed = true
      }
      if (changed) {
        setForm(prev => ({ ...prev, ota_body: JSON.stringify(obj, null, 2) }))
      }
    } catch {}
  }, [form.system_mac, form.device_id, form.use_system_mac])

  return (
    <div className="app-container">
      <CustomTitleBar 
        title="小智客户端" 
        subtitle={subtitle}
        isPlayingAudio={isPlayingAudio}
        audioStats={audioStats}
        onToggleSettings={() => setCurrentPage(currentPage === 'settings' ? 'chat' : 'settings')}
        onOpenDB={() => setCurrentPage(currentPage === 'db' ? 'chat' : 'db')}
        onOpenLoadTest={() => setCurrentPage(currentPage === 'loadtest' ? 'chat' : 'loadtest')}
      />
      <div className="chat">
        {!RT && (
          <div style={{background:'#b23', color:'#fff', padding:8, textAlign:'center'}}>
            未检测到 Wails 运行环境。请使用 "wails dev" 或 "wails build" 运行应用。
          </div>
        )}
      
      {/* 根据当前页面显示不同内容 */}
      {currentPage === 'settings' ? (
        <SettingsPage 
          form={form} 
          setForm={setForm} 
          onConnect={handleConnect} 
          onDisconnect={handleDisconnect} 
          connecting={connecting}
          audioPlayer={audioPlayerRef.current}
          connectionStatus={subtitle}
          onBack={() => setCurrentPage('chat')}
          windowSize={windowSize}
        />
      ) : currentPage === 'db' ? (
        <DBManager onBack={() => setCurrentPage('chat')} />
      ) : currentPage === 'loadtest' ? (
        <LoadTest 
          onBack={() => setCurrentPage('chat')} 
          defaults={{
            protocol: form.protocol,
            ws: form.ws,
            broker: form.broker,
            username: form.username,
            password: form.password,
            pub: form.pub,
            sub: form.sub,
            keepalive: form.keep_alive || 240,
            token: form.token,
            token_method: form.token_method,
            client_id: form.client_id,
            device_id: toBool(form.use_system_mac) ? (form.system_mac || '') : (form.device_id || ''),
          }}
        />
      ) : (
        <>
          {/* 头部已融合到 CustomTitleBar */}
          <div className="msg-list" ref={listRef}>
            {(toBool(form.show_system_bubbles) ? messages : messages.filter(m => m.role !== 'system')).map(m => (
              <Message
                key={m.id}
                role={m.role}
                text={m.text}
                time={m.time}
                detail={m.detail}
                avatar={m.avatar}
                onShowDetail={(title, content) => setDetailModal({ open: true, title, content })}
              />
            ))}
          </div>
          <InputBar onSend={onSend} onPTTStart={startPTT} onPTTStop={stopPTT} recording={recording} pttTime={pttTime} />
        </>
      )}
      </div>

      {/* 详情弹窗 */}
      {detailModal.open && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>{detailModal.title}</h3>
              <button className="close" onClick={() => setDetailModal({ open: false, title: '', content: '' })}>✖</button>
            </div>
            <div className="modal-content">
              <pre>{detailModal.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 简易数据库管理页面：读取/展示/编辑 config 表 + 最近消息
function DBManager({ onBack }) {
  const [tab, setTab] = useState('config') // 'config' | 'messages'
  const [rows, setRows] = useState([])
  const [msgs, setMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kv, setKv] = useState({ key: '', value: '' })
  const [edit, setEdit] = useState(null) // {key,value}

  const loadConfig = async () => {
    setLoading(true)
    setError('')
    try {
      const off = EventsOn('config', (m) => {
        try {
          const obj = typeof m === 'string' ? JSON.parse(m) : m
          const entries = Object.entries(obj || {}).map(([k,v]) => ({ key:k, value:String(v) }))
          setRows(entries)
        } catch (e) {
          setError(String(e?.message || e))
        } finally {
          setLoading(false)
        }
      })
      EventsEmit('load_config')
      setTimeout(() => off && off(), 1000)
    } catch (e) {
      setError(String(e?.message || e))
      setLoading(false)
    }
  }

  const loadMessages = async (limit = 200) => {
    setLoading(true)
    setError('')
    try {
      const off = EventsOn('db_recent_messages_result', (s) => {
        try {
          const arr = typeof s === 'string' ? JSON.parse(s) : s
          setMsgs(Array.isArray(arr) ? arr : [])
        } catch (e) {
          setError(String(e?.message || e))
        } finally {
          setLoading(false)
        }
      })
      EventsEmit('db_recent_messages', limit)
      setTimeout(() => off && off(), 1000)
    } catch (e) {
      setError(String(e?.message || e))
      setLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 'config') loadConfig(); else loadMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const save = async () => {
    if (!kv.key) return
    try {
      await EventsEmit('save_config', { [kv.key]: kv.value })
      setKv({ key:'', value:'' })
      loadConfig()
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  const del = async (key) => {
    try {
      await EventsEmit('db_delete_config', key)
      loadConfig()
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  const clearConfig = async () => {
    try {
      await EventsEmit('db_clear_config')
      loadConfig()
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  const clearMessages = async () => {
    try {
      const off = EventsOn('db_messages_cleared', () => { setMsgs([]); setLoading(false); off && off() })
      setLoading(true)
      await EventsEmit('db_clear_messages')
    } catch (e) {
      setError(String(e?.message || e))
      setLoading(false)
    }
  }

  const fmtTime = (ts) => {
    const n = Number(ts) * 1000
    if (!n) return ''
    const d = new Date(n)
    const p = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  const openEdit = (row) => setEdit({ key: row.key, value: row.value })
  const closeEdit = () => setEdit(null)
  const saveEdit = async () => {
    if (!edit?.key) return
    try {
      await EventsEmit('save_config', { [edit.key]: edit.value })
      setEdit(null)
      loadConfig()
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  return (
    <div className="db-page">
      <div className="db-toolbar">
        <button onClick={onBack}>返回</button>
        <h3 style={{margin:0}}>数据库管理</h3>
        <div className="db-tabs" style={{marginLeft:16, display:'flex', gap:8}}>
          <button className={tab==='config'? 'active' : ''} onClick={()=>setTab('config')}>配置</button>
          <button className={tab==='messages'? 'active' : ''} onClick={()=>setTab('messages')}>消息记录</button>
        </div>
        <div className="db-actions">
          {tab==='config' ? (
            <>
              <button onClick={loadConfig}>刷新配置</button>
              <button onClick={clearConfig}>清空配置</button>
            </>
          ) : (
            <>
              <button onClick={()=>loadMessages(200)}>刷新消息</button>
              <button onClick={clearMessages}>清空消息</button>
            </>
          )}
        </div>
      </div>

      <div className="db-body">
        {loading ? (
          <div>加载中…</div>
        ) : error ? (
          <div style={{color:'tomato'}}>错误：{error}</div>
        ) : tab==='config' ? (
          <div>
            <div className="db-grid" style={{marginBottom:8}}>
              <div className="head">Key</div>
              <div className="head">Value</div>
              <div />
              {rows.map((r, idx) => (
                <div key={r.key + '_' + idx} className="db-row" style={{contents:'display'}}>
                  <div className="db-cell">{r.key}</div>
                  <div className="db-cell">{r.value}</div>
                  <div>
                    <button onClick={() => openEdit(r)}>编辑</button>
                    <button style={{marginLeft:8}} onClick={() => del(r.key)}>删除</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{marginTop:16, borderTop:'1px solid rgba(255,255,255,0.1)', paddingTop:12}}>
              <h4>新增</h4>
              <div style={{display:'flex', gap:8}}>
                <input placeholder="key" value={kv.key} onChange={e=>setKv(s=>({...s, key:e.target.value}))} style={{flex:1}} />
                <input placeholder="value" value={kv.value} onChange={e=>setKv(s=>({...s, value:e.target.value}))} style={{flex:2}} />
                <button onClick={async()=>{ await EventsEmit('save_config', { [kv.key]: kv.value }); setKv({key:'', value:''}); loadConfig() }}>保存</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="db-msg-grid">
            <div className="head">Session</div>
            <div className="head">方向</div>
            <div className="head">时间</div>
            <div className="head">内容</div>
            {msgs.map((m, idx) => (
              <div key={idx + '_' + (m.id || '')} className="db-msg-row" style={{contents:'display'}}>
                <div className="db-cell">{m.session_id || m.SessionID}</div>
                <div className="db-cell">{m.direction || m.Direction}</div>
                <div className="db-cell">{fmtTime(m.created_at || m.CreatedAt)}</div>
                <div className="db-msg-payload">{m.payload || m.Payload}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {edit && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h3>编辑配置项</h3>
              <button className="close" onClick={closeEdit}>✖</button>
            </div>
            <div className="modal-content">
              <div style={{display:'flex', flexDirection:'column', gap:10}}>
                <div>
                  <label style={{display:'block', opacity:.8, fontSize:12, marginBottom:4}}>Key</label>
                  <input value={edit.key} onChange={e=>setEdit(s=>({...s, key:e.target.value}))} />
                </div>
                <div>
                  <label style={{display:'block', opacity:.8, fontSize:12, marginBottom:4}}>Value</label>
                  <textarea rows={8} style={{width:'100%'}} value={edit.value} onChange={e=>setEdit(s=>({...s, value:e.target.value}))} />
                </div>
                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                  <button onClick={closeEdit}>取消</button>
                  <button onClick={saveEdit}>保存</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 简易“纯表情”识别：若整条文本仅包含 1 个表情图形（含变体），则视为表情
function isEmojiOnly(s) {
  if (!s) return false
  try {
    if (/^\p{Extended_Pictographic}(\uFE0F|\uFE0E)?$/u.test(s)) return true
  } catch (_) { /* 属性不支持时走回退 */ }
  return /^[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}]\uFE0F?$/u.test(s)
}

// 规范化 MQTT Broker 地址：补齐协议与端口（支持端口覆盖与 IPv6）
function normalizeMQTTBroker(endpoint, preferTLS = true, portOverride) {
  if (!endpoint) return ''
  const e = String(endpoint).trim()
  // 已包含协议的，直接返回；如提供端口覆盖且 URL 未含端口，尝试补充
  if (/^(tcp|ssl|ws|wss|mqtt|mqtts):\/\//i.test(e)) {
    if (portOverride) {
      try {
        const u = new URL(e)
        if (!u.port) { u.port = String(portOverride) }
        return u.toString()
      } catch { return e }
    }
    return e
  }
  const defaultPort = preferTLS ? '8883' : '1883'
  let hostPart = e
  let portPart = ''

  // IPv6 带方括号
  if (e.startsWith('[')) {
    const idx = e.indexOf(']')
    if (idx !== -1) {
      const rest = e.slice(idx + 1)
      hostPart = e.slice(0, idx + 1) // 保留方括号
      if (rest.startsWith(':')) portPart = rest.slice(1)
    }
  } else if (e.includes(':')) {
    const colonCount = (e.match(/:/g) || []).length
    if (colonCount === 1) {
      const [h, p] = e.split(':')
      hostPart = h.trim()
      portPart = (p || '').trim()
    } else {
      // 视为不带方括号的 IPv6 主机
      hostPart = `[${e}]`
    }
  }

  const finalPort = String(portOverride || portPart || defaultPort)
  const scheme = preferTLS ? 'ssl' : 'tcp'
  return `${scheme}://${hostPart}${finalPort ? ':' + finalPort : ''}`
}

export default App





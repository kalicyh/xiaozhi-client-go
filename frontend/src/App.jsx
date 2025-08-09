import { useEffect, useRef, useState } from 'react'
import './App.css'
import { EventsOn, EventsEmit } from '../wailsjs/runtime/runtime'
import { GetSystemVolume, SetSystemVolume, IsSystemVolumeSupported } from '../wailsjs/go/main/App'
import AudioPlayer from './audio/AudioPlayer.js'
import SettingsPage from './components/SettingsPage.jsx'
import CustomTitleBar from './components/CustomTitleBar.jsx'
import './components/SettingsPage.css'

// 安全包装：在浏览器直开或未通过 Wails 运行时，window.runtime 可能不存在
const RT = typeof window !== 'undefined' && window.runtime
const EOn = RT ? EventsOn : (event, cb) => { console.warn('[Mock] EventsOn', event); return () => {} }
const EEmit = RT ? EventsEmit : (...args) => { console.warn('[Mock] EventsEmit', args) }

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
  const [currentPage, setCurrentPage] = useState('chat') // 'chat' 或 'settings'
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [form, setForm] = useState(() => ({
    protocol: 'ws',
    ws: 'ws://127.0.0.1:8000',
    use_ota: true,
    enable_token: true,
    // 新增：控制系统提示气泡显隐
    show_system_bubbles: true,
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
          summarized = `TTS ${escapeHtml(stTxt)} · 采样率 ${escapeHtml(String(sr || '?'))}Hz`
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
      if (interceptQuotaRef.current > 0) {
        // 第一条优先拦截：与最近用户消息完全一致视为回显
        if (interceptQuotaRef.current === 2 && plain === lastUserMsgRef.current) {
          interceptQuotaRef.current -= 1
          return
        }
        // 第二条：若是纯表情则缓存为下一次回复头像
        if (interceptQuotaRef.current === 1 && isEmojiOnly(plain)) {
          pendingAvatarRef.current = plain
          interceptQuotaRef.current -= 1
          return
        }
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
          setCurrentPage('settings')
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
    setCurrentPage('chat')
  }

  const handleDisconnect = () => { EEmit('disconnect') }

  return (
    <div className="app-container">
      <CustomTitleBar 
        title="小智客户端" 
        subtitle={subtitle}
        isPlayingAudio={isPlayingAudio}
        audioStats={audioStats}
        onToggleSettings={() => setCurrentPage(currentPage === 'chat' ? 'settings' : 'chat')}
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

// 简易“纯表情”识别：若整条文本仅包含 1 个表情图形（含变体），则视为表情
function isEmojiOnly(s) {
  if (!s) return false
  try {
    if (/^\p{Extended_Pictographic}(\uFE0F|\uFE0E)?$/u.test(s)) return true
  } catch (_) { /* 属性不支持时走回退 */ }
  return /^[\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}]\uFE0F?$/u.test(s)
}





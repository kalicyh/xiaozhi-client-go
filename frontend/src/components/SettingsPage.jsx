import { useEffect, useRef, useState } from 'react'
import { GetSystemVolume, SetSystemVolume, IsSystemVolumeSupported } from '../../wailsjs/go/main/App'
import './SettingsPage.css'

function SettingsPage({ form, setForm, onConnect, onDisconnect, connecting, audioPlayer, onBack, connectionStatus, windowSize: propWindowSize }) {
  const [volume, setVolume] = useState(100) // 添加音量状态
  const [systemVolumeSupported, setSystemVolumeSupported] = useState(false)
  const [useSystemVolume, setUseSystemVolume] = useState(true) // 是否使用系统音量
  const [windowSize, setWindowSize] = useState(propWindowSize || { width: window.innerWidth, height: window.innerHeight })
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

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (event) => {
      // ESC键返回
      if (event.key === 'Escape') {
        onBack()
      }
      // Ctrl+Enter 连接
      if (event.ctrlKey && event.key === 'Enter' && !connecting) {
        onConnect(form)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onBack, onConnect, form, connecting])

  // 窗口大小变化监听 - 与主应用同步
  useEffect(() => {
    // 如果父组件传入了windowSize，使用父组件的数据
    if (propWindowSize) {
      setWindowSize(propWindowSize)
      return
    }
    
    const handleResize = () => {
      const newSize = { width: window.innerWidth, height: window.innerHeight }
      setWindowSize(newSize)
      
      console.log('设置页面窗口大小变化:', newSize)
    }
    
    // 初始设置
    handleResize()
    
    // 监听窗口大小变化
    window.addEventListener('resize', handleResize)
    
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [propWindowSize])
  
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

  const toBool = (v) => {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string') return v === 'true' || v === '1' || v.toLowerCase() === 'yes'
    return !!v
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="back-btn" onClick={onBack} title="返回聊天界面">
          返回
        </button>
        <h2>连接设置</h2>
        {connectionStatus && (
          <div className={`connection-status ${connectionStatus.includes('在线') ? 'online' : 'offline'}`}>
            {connectionStatus}
          </div>
        )}
      </div>
      
      <div className="settings-content">
        <div className="settings-section">
          <h3>连接配置</h3>
          
          <div className="row">
            <label>协议</label>
            <select value={form.protocol} onChange={e=>set('protocol', e.target.value)}>
              <option value="mqtt">MQTT + UDP</option>
              <option value="ws">WebSocket</option>
            </select>
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
                      style={{
                        flex:1, 
                        fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                        resize: 'vertical',
                        minHeight: '200px'
                      }}
                      placeholder="粘贴/编辑将作为 POST Body 发送的 JSON"
                    />
                  </div>
                </>
              )}
              
              {/* 不使用 OTA 时显示手动 WS URL */}
              {!toBool(form.use_ota) && (
                <div className="row">
                  <label>WS URL</label>
                  <input value={form.ws} onChange={e=>set('ws', e.target.value)} placeholder="wss://host/ws" style={{flex:1}} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="row">
                <label>Broker</label>
                <input value={form.broker} onChange={e=>set('broker', e.target.value)} placeholder="tcp://127.0.0.1:1883" style={{flex:1}} />
              </div>
              <div className="row">
                <label>Pub</label>
                <input value={form.pub} onChange={e=>set('pub', e.target.value)} placeholder="devices/+/tx" style={{flex:1}} />
              </div>
              <div className="row">
                <label>Sub</label>
                <input value={form.sub} onChange={e=>set('sub', e.target.value)} placeholder="devices/+/rx" style={{flex:1}} />
              </div>
              <div className="row">
                <label>User</label>
                <input value={form.username} onChange={e=>set('username', e.target.value)} style={{flex:1}} />
                <label style={{marginLeft:8}}>Pass</label>
                <input value={form.password} onChange={e=>set('password', e.target.value)} style={{flex:1}} />
              </div>
            </>
          )}

          <div className="row">
            <label>ClientID</label>
            <input value={form.client_id} onChange={e=>set('client_id', e.target.value)} style={{flex:1}} />
            <label style={{marginLeft:8}}>DeviceID</label>
            <input value={form.device_id} onChange={e=>set('device_id', e.target.value)} style={{flex:1}} />
          </div>

          <div className="row">
            <label>Token</label>
            <input value={form.token} onChange={e=>set('token', e.target.value)} disabled={!toBool(form.enable_token)} style={{flex:1}} />
          </div>

          {toBool(form.enable_token) && (
            <div className="row">
              <label>Token方式</label>
              <select value={form.token_method || 'header'} onChange={e=>set('token_method', e.target.value)} style={{flex:1}}>
                <option value="header">Header Authorization</option>
                <option value="query_access_token">Query参数 access_token</option>
                <option value="query_token">Query参数 token</option>
              </select>
            </div>
          )}
        </div>

        {/* 音频设置 */}
        {audioPlayer && (
          <div className="settings-section">
            <h3>音频设置</h3>
            
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
              <div className="volume-control">
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={volume}
                  onChange={(e) => handleVolumeChange(e.target.value)}
                  className="volume-slider"
                  style={{
                    background: `linear-gradient(to right, 
                      #2b5278 0%, 
                      #2b5278 ${volume}%, 
                      rgba(255,255,255,0.1) ${volume}%, 
                      rgba(255,255,255,0.1) 100%)`
                  }}
                />
                <span className={`volume-display ${volume > 80 ? 'high' : volume > 50 ? 'medium' : 'low'}`}>
                  {volume}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 连接操作 */}
        <div className="settings-section">
          <h3>连接操作</h3>
          <div className="connect-actions">
            <button 
              onClick={()=>onConnect(form)} 
              className="primary" 
              disabled={connecting}
              title={connecting ? "连接中..." : "连接到服务器 (Ctrl+Enter)"}
            >
              {connecting ? '连接中…' : '连接'}
            </button>
            <button 
              onClick={onDisconnect} 
              className="danger" 
              disabled={connecting}
              title="断开当前连接"
            >
              断开连接
            </button>
          </div>
          <div className="keyboard-hints">
            <small>💡 快捷键：ESC 返回 | Ctrl+Enter 连接</small>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage

import { useState, useEffect } from 'react'
import './CustomTitleBar.css'

// Wails窗口控制函数
const WindowMinimise = window.runtime?.WindowMinimise || (() => console.log('WindowMinimise'))
const WindowToggleMaximise = window.runtime?.WindowToggleMaximise || (() => console.log('WindowToggleMaximise'))
const Quit = window.runtime?.Quit || (() => console.log('Quit'))
const WindowIsMaximised = window.runtime?.WindowIsMaximised || (() => Promise.resolve(false))

function CustomTitleBar({ 
  title = "小智客户端",
  subtitle = '',
  isPlayingAudio = false,
  audioStats = null,
  onToggleSettings = null,
  onOpenDB = null,
}) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // 检查窗口状态
    if (WindowIsMaximised) {
      WindowIsMaximised().then(setIsMaximized)
    }
  }, [])

  const handleMinimize = () => {
    WindowMinimise()
  }

  const handleMaximize = () => {
    WindowToggleMaximise()
    setIsMaximized(!isMaximized)
  }

  const handleClose = () => {
    Quit()
  }

  const isOffline = typeof subtitle === 'string' && subtitle.includes('离线')

  return (
    <div className="custom-titlebar" data-drag>
      <div className="titlebar-content">
        <div className="app-icon">
          <span>🤖</span>
        </div>

        {/* 左右布局：左侧标题，右侧副标题/指示 */}
        <div className="chat-info">
          <div className="title">小智</div>
          {subtitle && (
            <div className={`subtitle ${isOffline ? 'offline' : 'online'}`}>
              {subtitle}
              {isPlayingAudio && audioStats && (
                <span className="audio-indicator">
                  🔊 {audioStats.packetsReceived} 包
                  {audioStats.smoothRate && ` | 平滑: ${audioStats.smoothRate}`}
                  {audioStats.quality && ` | 音质: ${audioStats.quality}`}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="titlebar-spacer" />

        {/* 工具按钮区域（数据库 + 设置），需不可拖拽 */}
        {(onOpenDB || onToggleSettings) && (
          <div className="toolbar-actions" data-no-drag>
            {onOpenDB && (
              <button
                className="icon-btn"
                title="数据库管理"
                onClick={onOpenDB}
              >
                🗄️
              </button>
            )}
            {onToggleSettings && (
              <button 
                className="icon-btn" 
                title="连接设置" 
                onClick={onToggleSettings}
              >
                ⚙️
              </button>
            )}
          </div>
        )}

        {/* 窗口控制按钮 */}
        <div className="window-controls">
          <button 
            className="control-btn minimize-btn" 
            onClick={handleMinimize}
            title="最小化"
          >
          </button>
          <button 
            className={`control-btn maximize-btn ${isMaximized ? 'maximized' : ''}`}
            onClick={handleMaximize}
            title={isMaximized ? "还原" : "最大化"}
          >
          </button>
          <button 
            className="control-btn close-btn" 
            onClick={handleClose}
            title="关闭"
          >
          </button>
        </div>
      </div>
    </div>
  )
}

export default CustomTitleBar

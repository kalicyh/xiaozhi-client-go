/**
 * 音频播放器 - 专用于 Go 端 Opus 解码和 PCM 播放
 */

import GoPCMAudioProcessor from './GoPCMAudioProcessor.js'

class AudioPlayer {
  constructor() {
    this.audioContext = null
    this.audioQueue = []
    this.isPlaying = false
    this.gainNode = null
    this.volume = 1.0
    this.isInitialized = false
    this.stopTimeout = null
    this.currentSource = null
    this.lastPlaybackTime = null // 记录上次播放结束时间，用于无缝连接
    
    // Go PCM 处理器
    this.goPCMProcessor = new GoPCMAudioProcessor()
    
    // 缓冲区管理 - 配合 Go 端 Opus 解码器
    this.sampleRate = 48000 // 默认使用 48kHz，更高保真
    
    // 回调函数
    this.onStartPlay = null
    this.onStopPlay = null
    this.onError = null
  }

  /**
   * 设置播放采样率（同步到处理器）
   */
  setSampleRate(sampleRate) {
    const sr = Number(sampleRate)
    if (!Number.isFinite(sr) || sr <= 0) return
    if (this.sampleRate === sr) return
    this.sampleRate = sr
    if (this.goPCMProcessor && typeof this.goPCMProcessor.setSampleRate === 'function') {
      this.goPCMProcessor.setSampleRate(sr)
    }
    console.log(`AudioPlayer 采样率设为 ${sr}Hz`)
  }

  /**
   * 初始化音频上下文
   */
  async initialize() {
    if (this.isInitialized) return true

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      if (!AudioContext) {
        throw new Error('浏览器不支持 Web Audio API')
      }

      this.audioContext = new AudioContext()
      
      // 创建增益节点（音量控制）
      this.gainNode = this.audioContext.createGain()
      this.gainNode.gain.value = this.volume
      this.gainNode.connect(this.audioContext.destination)

      // 如果音频上下文被暂停，尝试恢复
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      // 初始化 Go PCM 处理器
      await this.goPCMProcessor.initialize()
      this.goPCMProcessor.onError = (error) => {
        console.error('Go PCM 处理器错误:', error)
        if (this.onError) this.onError(error)
      }

      this.isInitialized = true
      console.log('音频播放器初始化成功 - Go 端 Opus 解码模式')
      return true
    } catch (error) {
      console.error('音频播放器初始化失败:', error)
      if (this.onError) this.onError(error)
      return false
    }
  }

  /**
   * 播放来自 Go 端解码的 PCM 音频数据
   * @param {Float32Array|Array} pcmData - Go 端解码的 PCM 数据
   */
  async playGoPCMAudio(pcmData) {
    if (!this.isInitialized) {
      const initialized = await this.initialize()
      if (!initialized) return false
    }

    try {
      console.log(`收到 Go 端 PCM 数据: ${pcmData.length} samples`)
      
      // 使用 Go PCM 处理器处理数据
      const processedPCM = await this.goPCMProcessor.processPCMFrame(pcmData)
      if (!processedPCM || processedPCM.length === 0) {
        console.warn('Go PCM 处理失败或返回空数据')
        return false
      }

      // 创建 AudioBuffer，使用当前采样率
      const audioBuffer = this.audioContext.createBuffer(
        1, // 单声道
        processedPCM.length,
        this.sampleRate
      )

      // 复制PCM数据到AudioBuffer
      const channelData = audioBuffer.getChannelData(0)
      channelData.set(processedPCM)

      console.log(`Go PCM 音频创建成功: ${processedPCM.length} samples @ ${this.sampleRate}Hz`)

      // 添加到播放队列
      this.audioQueue.push(audioBuffer)
      
      // 如果当前没有在播放，开始播放
      if (!this.isPlaying) {
        this.startPlayback()
      }

      return true
    } catch (error) {
      console.error('播放 Go PCM 音频失败:', error)
      if (this.onError) this.onError(error)
      return false
    }
  }

  /**
   * 开始播放队列中的音频
   */
  startPlayback() {
    if (this.isPlaying || this.audioQueue.length === 0) return

    this.isPlaying = true
    if (this.onStartPlay) this.onStartPlay()

    this.playNextBuffer()
  }

  /**
   * 播放下一个音频缓冲区
   */
  playNextBuffer() {
    if (this.audioQueue.length === 0) {
      // 缩短延迟停止时间，提高响应性
      if (this.stopTimeout) {
        clearTimeout(this.stopTimeout)
      }
      
      this.stopTimeout = setTimeout(() => {
        if (this.audioQueue.length === 0 && this.isPlaying) {
          this.isPlaying = false
          console.log('音频播放队列为空，停止播放')
          if (this.onStopPlay) this.onStopPlay()
        }
      }, 200) // 从500ms减少到200ms，减少停顿感
      return
    }

    // 清除停止超时
    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout)
      this.stopTimeout = null
    }

    const audioBuffer = this.audioQueue.shift()
    const source = this.audioContext.createBufferSource()
    
    source.buffer = audioBuffer
    source.connect(this.gainNode)
    
    // 播放结束后立即播放下一个，无延迟
    source.onended = () => {
      console.log(`音频片段播放完成，队列剩余: ${this.audioQueue.length}`)
      // 立即播放下一个，确保连续性
      setTimeout(() => this.playNextBuffer(), 0)
    }

    // 计算精确的播放时间，确保无缝连接
    let startTime = this.audioContext.currentTime
    
    // 如果有前一个音频源，尝试无缝连接
    if (this.currentSource && this.currentSource.buffer) {
      // 计算前一个音频的结束时间
      const prevDuration = this.currentSource.buffer.duration
      startTime = Math.max(startTime, this.lastPlaybackTime || startTime)
    }
    
    source.start(startTime)
    
    // 记录播放时间用于下次计算
    this.lastPlaybackTime = startTime + audioBuffer.duration
    
    console.log(`开始播放音频片段: ${audioBuffer.duration.toFixed(3)}s @ ${startTime.toFixed(3)}s，队列: ${this.audioQueue.length}`)
    
    this.currentSource = source
  }

  /**
   * 停止播放
   */
  stop() {
    this.audioQueue = []
    this.isPlaying = false
    
    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout)
      this.stopTimeout = null
    }
    
    if (this.onStopPlay) this.onStopPlay()
  }

  /**
   * 设置音量
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume
    }
    console.log(`音量设置为: ${Math.round(this.volume * 100)}%`)
  }

  /**
   * 获取当前音量
   */
  getVolume() {
    return this.volume
  }

  /**
   * 销毁音频播放器
   */
  destroy() {
    this.stop()
    
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
    
    this.gainNode = null
    this.isInitialized = false
  }

  /**
   * 获取播放状态
   */
  getPlaybackState() {
    return {
      isPlaying: this.isPlaying,
      queueLength: this.audioQueue.length,
      volume: this.volume,
      isInitialized: this.isInitialized,
      sampleRate: this.sampleRate,
      goPCMStats: this.goPCMProcessor.getStats()
    }
  }
}

export default AudioPlayer

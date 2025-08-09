/**
 * Go PCM 音频处理器 - 处理来自 Go 端解码的 PCM 数据
 * 优化音频连续性和音质
 */

class GoPCMAudioProcessor {
  constructor() {
    this.sampleRate = 48000  // 与 Go 端保持一致（默认 48kHz）
    this.channels = 1        // 单声道
    this.isInitialized = false
    
    // 音频连续性管理
    this.lastSample = 0
    this.previousFrame = null
    this.frameBuffer = []
    this.maxBufferFrames = 3  // 最多缓存3帧用于平滑处理
    
    // 处理统计
    this.processedFrames = 0
    this.failedFrames = 0
    this.smoothedFrames = 0
    
    // 回调函数
    this.onError = null
  }

  /** 同步设置采样率 */
  setSampleRate(sr) {
    const v = Number(sr)
    if (!Number.isFinite(v) || v <= 0) return
    if (this.sampleRate === v) return
    this.sampleRate = v
    console.log(`[GoPCMAudioProcessor] 采样率设为 ${v}Hz`)
  }

  /**
   * 初始化处理器
   */
  async initialize() {
    if (this.isInitialized) return true

    try {
      if (!window.AudioContext && !window.webkitAudioContext) {
        throw new Error('浏览器不支持 Web Audio API')
      }

      this.isInitialized = true
      console.log(`Go PCM 音频处理器初始化成功 - ${this.sampleRate}Hz，启用音频平滑处理`)
      return true
    } catch (error) {
      console.error('Go PCM 音频处理器初始化失败:', error)
      if (this.onError) this.onError(error)
      return false
    }
  }

  /**
   * 处理来自 Go 端的 PCM 数据
   * @param {Float32Array|Array} pcmData - Go 端解码的 PCM 数据
   */
  async processPCMFrame(pcmData) {
    if (!this.isInitialized) {
      const initialized = await this.initialize()
      if (!initialized) return null
    }

    try {
      this.processedFrames++
      
      // 确保数据是 Float32Array 格式
      let audioData
      if (pcmData instanceof Float32Array) {
        audioData = new Float32Array(pcmData)
      } else if (Array.isArray(pcmData)) {
        audioData = new Float32Array(pcmData)
      } else {
        throw new Error('不支持的 PCM 数据格式')
      }

      if (audioData.length === 0) {
        console.warn(`帧 ${this.processedFrames} 为空`)
        return null
      }

      // 应用音频平滑处理
      const smoothedData = this.applySmoothProcessing(audioData)

      console.log(`Go PCM 处理成功: 帧 ${this.processedFrames}, ${smoothedData.length} samples`)
      return smoothedData
      
    } catch (error) {
      this.failedFrames++
      console.error(`Go PCM 处理失败 (帧 ${this.processedFrames}):`, error)
      if (this.onError) this.onError(error)
      return null
    }
  }

  /**
   * 应用音频平滑处理，减少卡顿
   */
  applySmoothProcessing(audioData) {
    const processedData = new Float32Array(audioData.length)
    processedData.set(audioData)

    // 1. 帧间连续性处理
    if (this.previousFrame && this.previousFrame.length > 0) {
      const prevLastSample = this.previousFrame[this.previousFrame.length - 1]
      const currFirstSample = processedData[0]
      const diff = currFirstSample - prevLastSample

      // 如果差异较大，应用渐变过渡（前5个样本）
      if (Math.abs(diff) > 0.1) {
        const fadeLength = Math.min(5, processedData.length)
        for (let i = 0; i < fadeLength; i++) {
          const factor = i / fadeLength
          processedData[i] = prevLastSample + diff * factor
        }
        this.smoothedFrames++
      }
    }

    // 2. 应用轻微的反锯齿滤波
    this.applyAntiAliasing(processedData)

    // 3. 应用软限幅，防止削波失真
    this.applySoftLimiting(processedData)

    // 4. 应用淡入淡出包络，减少点击音
    this.applyEnvelope(processedData)

    // 保存当前帧用于下次连续性处理
    this.previousFrame = new Float32Array(processedData)
    this.lastSample = processedData[processedData.length - 1]

    return processedData
  }

  /**
   * 应用简单的反锯齿滤波（移动平均）
   */
  applyAntiAliasing(audioData) {
    if (audioData.length < 3) return

    const filtered = new Float32Array(audioData.length)
    filtered[0] = audioData[0]
    
    for (let i = 1; i < audioData.length - 1; i++) {
      // 3点移动平均，权重: [0.25, 0.5, 0.25]
      filtered[i] = 0.25 * audioData[i - 1] + 0.5 * audioData[i] + 0.25 * audioData[i + 1]
    }
    
    filtered[audioData.length - 1] = audioData[audioData.length - 1]
    
    // 复制回原数组
    audioData.set(filtered)
  }

  /**
   * 应用软限幅，防止削波失真
   */
  applySoftLimiting(audioData) {
    const threshold = 0.95
    
    for (let i = 0; i < audioData.length; i++) {
      const sample = audioData[i]
      const absSample = Math.abs(sample)
      
      if (absSample > threshold) {
        // 软限幅：使用 tanh 函数平滑限制
        const sign = sample >= 0 ? 1 : -1
        audioData[i] = sign * Math.tanh(absSample) * 0.9
      }
    }
  }

  /**
   * 应用淡入淡出包络，减少点击音
   */
  applyEnvelope(audioData) {
    const fadeLength = Math.min(8, Math.floor(audioData.length / 8)) // 动态调整淡化长度
    
    if (fadeLength === 0) return

    // 淡入（开头）
    for (let i = 0; i < fadeLength; i++) {
      const factor = Math.sin(Math.PI * 0.5 * (i / fadeLength)) // 使用正弦曲线，更平滑
      audioData[i] *= factor
    }
    
    // 淡出（结尾）
    for (let i = audioData.length - fadeLength; i < audioData.length; i++) {
      const factor = Math.sin(Math.PI * 0.5 * ((audioData.length - i) / fadeLength))
      audioData[i] *= factor
    }
  }

  /**
   * 获取处理统计信息
   */
  getStats() {
    return {
      processedFrames: this.processedFrames,
      failedFrames: this.failedFrames,
      smoothedFrames: this.smoothedFrames,
      successRate: this.processedFrames > 0 ? 
        ((this.processedFrames - this.failedFrames) / this.processedFrames * 100).toFixed(1) + '%' : 
        '0%',
      smoothRate: this.processedFrames > 0 ?
        (this.smoothedFrames / this.processedFrames * 100).toFixed(1) + '%' : 
        '0%',
      sampleRate: this.sampleRate + 'Hz',
      mode: 'Go端Opus解码 + 音频平滑处理'
    }
  }

  /**
   * 重置处理器状态
   */
  reset() {
    this.lastSample = 0
    this.previousFrame = null
    this.frameBuffer = []
    this.processedFrames = 0
    this.failedFrames = 0
    this.smoothedFrames = 0
    console.log('Go PCM 音频处理器状态已重置')
  }

  /** 获取采样率 */
  getSampleRate() { return this.sampleRate }

  /** 获取声道数 */
  getChannels() { return this.channels }
}

export default GoPCMAudioProcessor

// 简易麦克风录音器：捕获麦克风，重采样到16kHz单声道，并以Float32数组回调

import { EventsEmit as _EventsEmit } from '../../wailsjs/runtime/runtime'

class MicRecorder {
  constructor({ targetSampleRate = 16000, onFrame } = {}) {
    this.audioContext = null
    this.mediaStream = null
    this.sourceNode = null
    this.processor = null
    this.onFrame = onFrame || null
    this.targetSampleRate = targetSampleRate
    this.running = false
    this._residual = new Float32Array(0)
  }

  async start() {
    if (this.running) return true
    // 独立的采集 AudioContext，避免影响播放
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) throw new Error('不支持 Web Audio API')

    // 申请麦克风
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true
    } })

    this.audioContext = new AudioContext()
    const inRate = this.audioContext.sampleRate || 48000

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)

    // 使用 ScriptProcessor 采集（在 WebView2 环境中兼容性更好）
    const bufferSize = 2048 // 在48k约42.7ms；可接受
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

    this.processor.onaudioprocess = (e) => {
      if (!this.running) return
      const input = e.inputBuffer.getChannelData(0)
      const resampled = this._resampleToTarget(input, inRate, this.targetSampleRate)
      this._emitFrames(resampled)
    }

    this.sourceNode.connect(this.processor)
    this.processor.connect(this.audioContext.destination) // 为了触发处理链，可将增益设为0避免回放

    // 将处理节点静音（部分实现可能会漏音）
    const gain = this.audioContext.createGain()
    gain.gain.value = 0
    this.processor.disconnect()
    this.processor.connect(gain)
    gain.connect(this.audioContext.destination)

    this.running = true
    return true
  }

  stop() {
    this.running = false
    try { this.processor && this.processor.disconnect() } catch {}
    try { this.sourceNode && this.sourceNode.disconnect() } catch {}
    try { this.mediaStream && this.mediaStream.getTracks().forEach(t => t.stop()) } catch {}
    try { this.audioContext && this.audioContext.close() } catch {}
    this.processor = null
    this.sourceNode = null
    this.mediaStream = null
    this.audioContext = null
    this._residual = new Float32Array(0)
  }

  setOnFrame(cb) { this.onFrame = cb }

  // 线性重采样到目标采样率
  _resampleToTarget(input, inRate, outRate) {
    if (inRate === outRate) return new Float32Array(input)
    const ratio = outRate / inRate
    const outLen = Math.floor(input.length * ratio)
    const out = new Float32Array(outLen)
    let idx = 0
    for (let i = 0; i < outLen; i++) {
      const x = i / ratio
      const i0 = Math.floor(x)
      const i1 = Math.min(i0 + 1, input.length - 1)
      const frac = x - i0
      out[i] = input[i0] * (1 - frac) + input[i1] * frac
      idx++
    }
    return out
  }

  // 将重采样后的数据按块回调（交给后端再聚合为960样本）
  _emitFrames(resampled) {
    if (!resampled || resampled.length === 0) return
    // 将上次残留与本次拼接，按较大的块发送，减少跨进程调用次数
    const merged = new Float32Array(this._residual.length + resampled.length)
    merged.set(this._residual, 0)
    merged.set(resampled, this._residual.length)

    // 这里不强制960对齐，直接整块发送，由后端缓冲聚合
    if (this.onFrame) {
      // Wails 更易处理普通数组
      const arr = Array.from(merged)
      try { this.onFrame(arr) } catch {}
    } else {
      // 备用：直接发事件
      try { _EventsEmit('mic_frame', Array.from(merged)) } catch {}
    }

    this._residual = new Float32Array(0)
  }
}

export default MicRecorder

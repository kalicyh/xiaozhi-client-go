package audio

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/hraban/opus"
)

// OpusDecoder Opus 音频解码器
type OpusDecoder struct {
	decoder    *opus.Decoder
	sampleRate int
	channels   int
	frameSize  int // 每帧的样本数
}

// NewOpusDecoder 创建新的 Opus 解码器
func NewOpusDecoder(sampleRate, channels int) (*OpusDecoder, error) {
	// 创建 Opus 解码器
	decoder, err := opus.NewDecoder(sampleRate, channels)
	if err != nil {
		return nil, fmt.Errorf("创建 Opus 解码器失败: %v", err)
	}

	// 计算帧大小（20ms @ 24kHz = 480 samples）
	frameSize := sampleRate * 20 / 1000

	return &OpusDecoder{
		decoder:    decoder,
		sampleRate: sampleRate,
		channels:   channels,
		frameSize:  frameSize,
	}, nil
}

// DecodeFrame 解码 Opus 音频帧，返回 PCM 数据
func (d *OpusDecoder) DecodeFrame(opusData []byte) ([]byte, error) {
	if len(opusData) == 0 {
		return nil, fmt.Errorf("空的 Opus 数据")
	}

	// 增大缓冲区以处理各种帧大小，最大支持120ms@48kHz
	maxSamples := 5760 * d.channels // 120ms @ 48kHz = 5760 samples
	pcm := make([]int16, maxSamples)
	
	n, err := d.decoder.Decode(opusData, pcm)
	if err != nil {
		return nil, fmt.Errorf("Opus 解码失败: %v", err)
	}

	if n <= 0 {
		return nil, fmt.Errorf("解码返回空数据")
	}

	// 截取实际解码的样本数
	pcm = pcm[:n*d.channels]

	// 转换为字节数组（小端序）
	pcmBytes := make([]byte, len(pcm)*2)
	for i, sample := range pcm {
		binary.LittleEndian.PutUint16(pcmBytes[i*2:], uint16(sample))
	}

	return pcmBytes, nil
}

// DecodeFrameToFloat32 解码 Opus 音频帧，返回 Float32 PCM 数据（用于前端）
func (d *OpusDecoder) DecodeFrameToFloat32(opusData []byte) ([]float32, error) {
	if len(opusData) == 0 {
		return nil, fmt.Errorf("空的 Opus 数据")
	}

	// 增大缓冲区以处理各种帧大小，最大支持120ms@48kHz
	maxSamples := 5760 * d.channels // 120ms @ 48kHz = 5760 samples
	pcm := make([]int16, maxSamples)
	
	n, err := d.decoder.Decode(opusData, pcm)
	if err != nil {
		return nil, fmt.Errorf("opus 解码失败: %v", err)
	}

	if n <= 0 {
		return nil, fmt.Errorf("解码返回空数据")
	}

	// 截取实际解码的样本数
	pcm = pcm[:n*d.channels]

	// 转换为 float32 数组（-1.0 到 1.0），应用高质量转换
	pcmFloat := make([]float32, len(pcm))
	for i, sample := range pcm {
		// 使用更精确的归一化，避免精度损失
		pcmFloat[i] = float32(sample) / 32768.0
		
		// 软限幅，防止数字削波
		if pcmFloat[i] > 0.99 {
			pcmFloat[i] = 0.99
		} else if pcmFloat[i] < -0.99 {
			pcmFloat[i] = -0.99
		}
	}

	return pcmFloat, nil
}

// DecodeFrameToBytes 解码并转换为字节数组（用于直接传输）
func (d *OpusDecoder) DecodeFrameToBytes(opusData []byte) ([]byte, error) {
	floatData, err := d.DecodeFrameToFloat32(opusData)
	if err != nil {
		return nil, err
	}

	// 将 float32 数据序列化为字节数组
	result := make([]byte, len(floatData)*4)
	for i, f := range floatData {
		bits := math.Float32bits(f)
		binary.LittleEndian.PutUint32(result[i*4:], bits)
	}

	return result, nil
}

// GetFrameSize 获取每帧的样本数
func (d *OpusDecoder) GetFrameSize() int {
	return d.frameSize
}

// GetSampleRate 获取采样率
func (d *OpusDecoder) GetSampleRate() int {
	return d.sampleRate
}

// GetChannels 获取声道数
func (d *OpusDecoder) GetChannels() int {
	return d.channels
}

// Close 关闭解码器（清理资源）
func (d *OpusDecoder) Close() {
	// opus.Decoder 不需要显式关闭，Go GC 会处理
	d.decoder = nil
}

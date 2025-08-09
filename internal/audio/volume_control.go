package audio

import (
	"fmt"
	
	"github.com/itchyny/volume-go"
)

// VolumeController 系统音量控制器
type VolumeController struct {
	lastVolume  float64 // 记录上次设置的音量，避免频繁调用
}

// NewVolumeController 创建新的音量控制器
func NewVolumeController() *VolumeController {
	vc := &VolumeController{}
	fmt.Println("使用 volume-go 库进行系统音量控制")
	return vc
}

// GetSystemVolume 获取系统音量 (0.0 - 1.0)
func (vc *VolumeController) GetSystemVolume() (float64, error) {
	vol, err := volume.GetVolume()
	if err != nil {
		return 0.5, err
	}
	
	// volume-go 返回 0-100 的整数，转换为 0.0-1.0 的浮点数
	return float64(vol) / 100.0, nil
}

// SetSystemVolume 设置系统音量 (0.0 - 1.0)
func (vc *VolumeController) SetSystemVolume(vol float64) error {
	// 确保音量在有效范围内
	if vol < 0.0 {
		vol = 0.0
	}
	if vol > 1.0 {
		vol = 1.0
	}
	
	// 转换为 0-100 的整数
	volumePercent := int(vol * 100)
	
	err := volume.SetVolume(volumePercent)
	if err != nil {
		return fmt.Errorf("设置系统音量失败: %v", err)
	}
	
	vc.lastVolume = vol
	fmt.Printf("系统音量已设置为: %d%%\n", volumePercent)
	return nil
}

// GetVolumeRange 获取音量范围信息
func (vc *VolumeController) GetVolumeRange() (min, max, step float64) {
	return 0.0, 1.0, 0.005 // 支持0-100%，步长0.5%
}

// IsVolumeSupported 检查是否支持音量控制
func (vc *VolumeController) IsVolumeSupported() bool {
	// 尝试获取当前音量来测试是否支持
	_, err := volume.GetVolume()
	return err == nil
}

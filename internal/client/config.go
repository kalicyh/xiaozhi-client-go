package client

import (
	"net"
	"strings"
	"time"
)

type AudioParams struct {
	Format        string `json:"format"`
	SampleRate    int    `json:"sample_rate"`
	Channels      int    `json:"channels"`
	FrameDuration int    `json:"frame_duration"`
}

type HelloMessage struct {
	Type        string                 `json:"type"`
	Version     int                    `json:"version"`
	Transport   string                 `json:"transport,omitempty"`
	Features    map[string]any         `json:"features,omitempty"`
	AudioParams AudioParams            `json:"audio_params"`
}

type MqttHelloResponse struct {
	Type        string       `json:"type"`
	Transport   string       `json:"transport"`
	SessionID   string       `json:"session_id"`
	AudioParams AudioParams  `json:"audio_params"`
	UDP         *UDPInfo     `json:"udp"`
}

type UDPInfo struct {
	Server  string `json:"server"`
	Port    int    `json:"port"`
	KeyHex  string `json:"key"`
	NonceHex string `json:"nonce"`
}

type Config struct {
	ClientID        string
	DeviceID        string
	AuthToken       string
	EnableToken     bool
	TokenMethod     string // "header", "query_access_token", "query_token"
	ProtocolVersion int
	Audio           AudioParams
	HelloTimeout    time.Duration

	WebsocketURL         string
	WebsocketSubprotocol string

	MQTTBroker         string
	MQTTUsername       string
	MQTTPassword       string
	MQTTPublishTopic   string
	MQTTSubscribeTopic string
	MQTTKeepAliveSec   int
}

// isVirtualName 粗略判断虚拟/非物理网卡名称（跨平台常见关键字）
func isVirtualName(name string) bool {
	n := strings.ToLower(name)
	for _, kw := range []string{
		"virtual", "vmware", "hyper-v", "vethernet", "vbox", "docker", "br-", "loopback", "npcap", "tailscale", "utun", "tap", "tun",
	} {
		if strings.Contains(n, kw) {
			return true
		}
	}
	return false
}

// getDefaultMAC 尝试获取默认出站网卡的 MAC，失败则回退到首个可用物理网卡
func getDefaultMAC() string {
	// 1) 通过到公网 UDP 拨号推断默认出站 IP
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		if ua, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			localIP := ua.IP
			_ = conn.Close()
			ifs, _ := net.Interfaces()
			for _, inf := range ifs {
				if inf.Flags&net.FlagUp == 0 || inf.Flags&net.FlagLoopback != 0 { continue }
				if isVirtualName(inf.Name) || len(inf.HardwareAddr) == 0 { continue }
				addrs, _ := inf.Addrs()
				for _, a := range addrs {
					if ipNet, ok := a.(*net.IPNet); ok && ipNet.IP != nil {
						if ipNet.IP.Equal(localIP) {
							return strings.ToLower(inf.HardwareAddr.String())
						}
					}
				}
			}
		} else {
			_ = conn.Close()
		}
	}
	// 2) 回退：挑选首个 Up 且非回环、非虚拟、带 MAC 的网卡
	ifs, _ := net.Interfaces()
	for _, inf := range ifs {
		if inf.Flags&net.FlagUp == 0 || inf.Flags&net.FlagLoopback != 0 { continue }
		if isVirtualName(inf.Name) || len(inf.HardwareAddr) == 0 { continue }
		return strings.ToLower(inf.HardwareAddr.String())
	}
	return ""
}

func DefaultConfig() Config {
	return Config{
		ProtocolVersion: 3,                                  // 文档: version = 3
		TokenMethod:     "header",
		Audio:           AudioParams{Format: "opus", SampleRate: 16000, Channels: 1, FrameDuration: 60}, // 文档: 16k/60ms
		HelloTimeout:    10 * time.Second,
		MQTTPublishTopic:   "device-server",
		MQTTSubscribeTopic: "null", // 可由 OTA/设置覆盖；为 "null" 时不订阅
		MQTTKeepAliveSec:   240,
		// 默认设备ID：采用系统首选物理网卡 MAC
		DeviceID:        getDefaultMAC(),
	}
}

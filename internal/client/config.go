package client

import "time"

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

func DefaultConfig() Config {
	return Config{
		ProtocolVersion: 1,
		TokenMethod:     "header", // 默认使用 Authorization 头
		Audio: AudioParams{Format: "opus", SampleRate: 48000, Channels: 1, FrameDuration: 20},
		HelloTimeout:    10 * time.Second,
		MQTTPublishTopic:   "devices/+/tx",
		MQTTSubscribeTopic: "devices/+/rx",
		MQTTKeepAliveSec:   240,
	}
}

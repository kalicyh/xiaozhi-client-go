package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"myproject/internal/audio"
	"myproject/internal/client"
	"myproject/internal/store"
	"myproject/internal/logging"
)

// App struct
type App struct {
	client          *client.Client
	store           *store.DB
	ctx             context.Context
	opusDecoder     *audio.OpusDecoder
	volumeController *audio.VolumeController
}

// NewApp creates a new App application struct
func NewApp() *App { return &App{} }

func getStr(m map[string]any, k string) string {
	if v, ok := m[k]; ok {
		switch t := v.(type) {
		case string:
			return t
		case fmt.Stringer:
			return t.String()
		default:
			return fmt.Sprint(v)
		}
	}
	return ""
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 初始化全局日志
	logging.Init("")
	log := logging.L().With("module", "app")

	a.store, _ = store.Open("xiaozhi.db")
	_ = a.store.InitConfig()

	// 初始化 Opus 解码器（默认使用更高质量：48kHz 单声道）
	var err error
	a.opusDecoder, err = audio.NewOpusDecoder(48000, 1)
	if err != nil {
		log.Warn("Opus 解码器初始化失败", "err", err)
	} else {
		log.Info("Opus 解码器初始化成功")
	}

	// 初始化音量控制器
	a.volumeController = audio.NewVolumeController()
	if a.volumeController.IsVolumeSupported() {
		log.Info("系统音量控制初始化成功")
	} else {
		log.Warn("系统音量控制不可用")
	}

	// helper: 根据 hello 的音频参数重建解码器
	rebuildDecoder := func(ap map[string]any) {
		if ap == nil { return }
		getInt := func(k string, def int) int {
			if v, ok := ap[k]; ok {
				switch t := v.(type) {
				case float64:
					return int(t)
				case int:
					return t
				case json.Number:
					if iv, err := t.Int64(); err == nil { return int(iv) }
				}
			}
			return def
		}
		sr := getInt("sample_rate", 48000)
		ch := getInt("channels", 1)
		if sr <= 0 { sr = 48000 }
		if ch <= 0 { ch = 1 }
		// 若与当前不一致则重建
		if a.opusDecoder == nil || a.opusDecoder.GetSampleRate() != sr || a.opusDecoder.GetChannels() != ch {
			if dec, err := audio.NewOpusDecoder(sr, ch); err == nil {
				a.opusDecoder = dec
				logging.L().With("module", "audio").Info("重建 Opus 解码器", "sample_rate", sr, "channels", ch)
			} else {
				logging.L().With("module", "audio").Warn("重建 Opus 解码器失败", "err", err)
			}
		}
	}

	// events
	runtime.EventsOn(ctx, "save_config", func(args ...interface{}) {
		if len(args) == 1 {
			switch kv := args[0].(type) {
			case map[string]string:
				_ = a.store.SetConfig(context.Background(), kv)
			case map[string]any:
				m := make(map[string]string, len(kv))
				for k, v := range kv {
					m[k] = fmt.Sprint(v)
				}
				_ = a.store.SetConfig(context.Background(), m)
			default:
				runtime.EventsEmit(a.ctx, "error", "invalid save_config payload")
			}
		}
	})
	runtime.EventsOn(ctx, "load_config", func(_ ...interface{}) {
		if m, err := a.store.GetConfig(context.Background()); err == nil {
			runtime.EventsEmit(ctx, "config", m)
		}
	})
	// MQTT connect
	runtime.EventsOn(ctx, "connect_mqtt", func(args ...interface{}) {
		if len(args) == 1 {
			var kv map[string]any
			if m, ok := args[0].(map[string]any); ok {
				kv = m
			} else if m2, ok2 := args[0].(map[string]string); ok2 {
				kv = make(map[string]any, len(m2))
				for k, v := range m2 {
					kv[k] = v
				}
			} else {
				runtime.EventsEmit(a.ctx, "error", "invalid connect_mqtt payload")
				return
			}
			cfg := client.DefaultConfig()
			cfg.MQTTBroker = getStr(kv, "broker")
			cfg.MQTTUsername = getStr(kv, "username")
			cfg.MQTTPassword = getStr(kv, "password")
			cfg.MQTTPublishTopic = getStr(kv, "pub")
			cfg.MQTTSubscribeTopic = getStr(kv, "sub")
			cfg.ClientID = getStr(kv, "client_id")
			// 仅在传入非空时覆盖默认 DeviceID
			if v := getStr(kv, "device_id"); v != "" { cfg.DeviceID = v }
			cfg.AuthToken = getStr(kv, "token")
			cfg.MQTTKeepAliveSec = 240
			c := client.New(cfg)
			c.OnJSON = func(ctx context.Context, msg map[string]any) {
				// 根据 hello 动态调整解码器
				if t, _ := msg["type"].(string); t == "hello" {
					if ap, _ := msg["audio_params"].(map[string]any); ap != nil { rebuildDecoder(ap) }
				}
				b, _ := json.Marshal(msg)
				_ = a.store.SaveMessage(context.Background(), c.SessionID, "in", "json", string(b), time.Now().Unix())
				runtime.EventsEmit(a.ctx, "text", string(b))
			}
			c.OnBinary = func(ctx context.Context, data []byte) {
				// 在 Go 端解码 Opus 数据（MQTT 通道）
				a.handleOpusAudio(data)
			}
			c.OnError = func(ctx context.Context, err error) { runtime.EventsEmit(a.ctx, "error", err.Error()) }
			c.OnClosed = func() { runtime.EventsEmit(a.ctx, "disconnected") }
			if err := c.OpenMQTT(context.Background()); err == nil {
				a.client = c
				runtime.EventsEmit(a.ctx, "connected", map[string]string{"protocol": "mqtt"})
			} else {
				runtime.EventsEmit(a.ctx, "error", err.Error())
			}
		}
	})
	// Websocket connect
	runtime.EventsOn(ctx, "connect_ws", func(args ...interface{}) {
		if len(args) == 1 {
			var kv map[string]any
			if m, ok := args[0].(map[string]any); ok {
				kv = m
			} else if m2, ok2 := args[0].(map[string]string); ok2 {
				kv = make(map[string]any, len(m2))
				for k, v := range m2 { kv[k] = v }
			} else {
				runtime.EventsEmit(a.ctx, "error", "invalid connect_ws payload")
				return
			}
			cfg := client.DefaultConfig()
			// 兼容 OTA 响应：优先从 websocket.url 读取；若没有，再读取扁平的 url
			wsURL := getStr(kv, "url")
			if wsURL == "" {
				if wsv, ok := kv["websocket"]; ok {
					switch t := wsv.(type) {
					case map[string]any:
						if u := getStr(t, "url"); u != "" { wsURL = u }
						if tok := getStr(t, "token"); tok != "" { cfg.AuthToken = tok }
					case string:
						if t != "" { wsURL = t }
					}
				}
			}
			cfg.WebsocketURL = wsURL
			cfg.ClientID = getStr(kv, "client_id")
			// 仅在传入非空时覆盖默认 DeviceID
			if v := getStr(kv, "device_id"); v != "" { cfg.DeviceID = v }
			// Token 与开关
			if tok := getStr(kv, "token"); tok != "" { cfg.AuthToken = tok }
			if en, ok := kv["enable_token"]; ok {
				switch t := en.(type) {
				case bool:
					cfg.EnableToken = t
				case string:
					cfg.EnableToken = (t == "true" || t == "1" || t == "yes")
				}
			} else {
				// 默认开启（与参考项目一致）
				cfg.EnableToken = true
			}
			c := client.New(cfg)
			c.OnJSON = func(ctx context.Context, msg map[string]any) {
				// 根据 hello 动态调整解码器
				if t, _ := msg["type"].(string); t == "hello" {
					if ap, _ := msg["audio_params"].(map[string]any); ap != nil { rebuildDecoder(ap) }
				}
				b, _ := json.Marshal(msg)
				_ = a.store.SaveMessage(context.Background(), c.SessionID, "in", "json", string(b), time.Now().Unix())
				runtime.EventsEmit(a.ctx, "text", string(b))
			}
			c.OnBinary = func(ctx context.Context, data []byte) {
				// 在 Go 端解码 Opus 数据（WebSocket 通道）
				a.handleOpusAudio(data)
			}
			c.OnError = func(ctx context.Context, err error) { runtime.EventsEmit(a.ctx, "error", err.Error()) }
			c.OnClosed = func() { runtime.EventsEmit(a.ctx, "disconnected") }
			if err := c.OpenWebsocket(context.Background()); err == nil {
				a.client = c
				runtime.EventsEmit(a.ctx, "connected", map[string]string{"protocol": "ws"})
			} else {
				runtime.EventsEmit(a.ctx, "error", err.Error())
			}
		}
	})
	// Switch protocol: { protocol: "ws"|"mqtt", ...cfg }
	runtime.EventsOn(ctx, "switch_protocol", func(args ...interface{}) {
		if len(args) == 1 {
			var kv map[string]any
			if m, ok := args[0].(map[string]any); ok {
				kv = m
			} else if m2, ok2 := args[0].(map[string]string); ok2 {
				kv = make(map[string]any, len(m2))
				for k, v := range m2 {
					kv[k] = v
				}
			} else {
				runtime.EventsEmit(a.ctx, "error", "invalid switch_protocol payload")
				return
			}
			protocol := getStr(kv, "protocol")
			if a.client == nil {
				cfg := client.DefaultConfig()
				// 兼容 OTA：初始化时同样尝试从 websocket.url 获取
				wsURL := getStr(kv, "url")
				if wsURL == "" {
					if wsv, ok := kv["websocket"]; ok {
						switch t := wsv.(type) {
						case map[string]any:
							if u := getStr(t, "url"); u != "" { wsURL = u }
							if tok := getStr(t, "token"); tok != "" { cfg.AuthToken = tok }
						case string:
							if t != "" { wsURL = t }
						}
					}
				}
				cfg.WebsocketURL = wsURL
				cfg.MQTTBroker = getStr(kv, "broker")
				cfg.MQTTUsername = getStr(kv, "username")
				cfg.MQTTPassword = getStr(kv, "password")
				cfg.MQTTPublishTopic = getStr(kv, "pub")
				cfg.MQTTSubscribeTopic = getStr(kv, "sub")
				cfg.ClientID = getStr(kv, "client_id")
				// 仅在传入非空时覆盖默认 DeviceID
				if v := getStr(kv, "device_id"); v != "" { cfg.DeviceID = v }
				if tok := getStr(kv, "token"); tok != "" { cfg.AuthToken = tok }
				a.client = client.New(cfg)
				a.client.OnJSON = func(ctx context.Context, msg map[string]any) {
					// 根据 hello 动态调整解码器
					if t, _ := msg["type"].(string); t == "hello" {
						if ap, _ := msg["audio_params"].(map[string]any); ap != nil { rebuildDecoder(ap) }
					}
					b, _ := json.Marshal(msg)
					_ = a.store.SaveMessage(context.Background(), a.client.SessionID, "in", "json", string(b), time.Now().Unix())
					runtime.EventsEmit(a.ctx, "text", string(b))
				}
				a.client.OnBinary = func(ctx context.Context, data []byte) {
					// 在 Go 端解码 Opus 数据（协议切换）
				 a.handleOpusAudio(data)
				}
				a.client.OnError = func(ctx context.Context, err error) { runtime.EventsEmit(a.ctx, "error", err.Error()) }
				a.client.OnClosed = func() { runtime.EventsEmit(a.ctx, "disconnected") }
			}
			if err := a.client.SwitchProtocol(context.Background(), protocol); err != nil {
				runtime.EventsEmit(a.ctx, "error", err.Error())
			} else {
				runtime.EventsEmit(a.ctx, "connected", map[string]string{"protocol": protocol})
			}
		}
	})
	// send text
	runtime.EventsOn(ctx, "send_text", func(args ...interface{}) {
		if len(args) == 1 {
			if s, ok := args[0].(string); ok {
				_ = a.SendTextMessage(s)
			}
		}
	})
	// start/stop listen
	runtime.EventsOn(ctx, "start_listen", func(args ...interface{}) { if a.client != nil { _ = a.client.SendListenStart(context.Background(), "manual") } })
	runtime.EventsOn(ctx, "stop_listen", func(args ...interface{}) { if a.client != nil { _ = a.client.SendListenStop(context.Background(), "manual") } })
	runtime.EventsOn(ctx, "abort", func(args ...interface{}) { if a.client != nil { _ = a.client.SendAbort(context.Background(), "user") } })
	// disconnect
	runtime.EventsOn(ctx, "disconnect", func(args ...interface{}) { if a.client != nil { a.client.Close(); runtime.EventsEmit(a.ctx, "disconnected") } })
	// OTA request
	runtime.EventsOn(ctx, "ota_request", func(args ...interface{}) {
		if len(args) == 1 {
			var kv map[string]any
			if m, ok := args[0].(map[string]any); ok {
				kv = m
			} else {
				runtime.EventsEmit(a.ctx, "error", "invalid ota_request payload")
				return
			}

			otaURL := getStr(kv, "url")
			deviceID := getStr(kv, "device_id")

			// 处理POST body
			var postBody map[string]interface{}
			if bodyData, ok := kv["body"]; ok {
				switch t := bodyData.(type) {
				case map[string]interface{}:
					postBody = t
				case string:
					if err := json.Unmarshal([]byte(t), &postBody); err != nil {
						runtime.EventsEmit(a.ctx, "error", fmt.Sprintf("OTA POST body JSON解析失败: %v", err))
						return
					}
				default:
					runtime.EventsEmit(a.ctx, "error", "OTA POST body格式错误")
					return
				}
			}

			if err := a.DoOTARequest(otaURL, deviceID, postBody); err != nil {
				runtime.EventsEmit(a.ctx, "error", fmt.Sprintf("OTA请求失败: %v", err))
			}
		}
	})

	// 监听窗口状态变化
	runtime.EventsOn(ctx, "window_state_change", func(args ...interface{}) {
		if len(args) == 1 {
			if state, ok := args[0].(string); ok {
				// 发送窗口状态变化事件给前端
				runtime.EventsEmit(a.ctx, "window_state_changed", state)
			}
		}
	})
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

func (a *App) SendTextMessage(text string) error {
	if a.client == nil {
		return nil
	}
	if err := a.client.SendDetectText(context.Background(), text); err != nil {
		return err
	}
	_ = a.store.SaveMessage(context.Background(), a.client.SessionID, "out", "detect", text, time.Now().Unix())
	return nil
}

// GetWindowState 获取当前窗口状态
func (a *App) GetWindowState() string {
	if a.ctx == nil {
		return "normal"
	}

	// 检查窗口是否为全屏状态
	isFullscreen := runtime.WindowIsFullscreen(a.ctx)
	if isFullscreen {
		return "fullscreen"
	}

	// 检查窗口是否最大化
	isMaximized := runtime.WindowIsMaximised(a.ctx)
	if isMaximized {
		return "maximized"
	}

	// 检查窗口是否最小化
	isMinimized := runtime.WindowIsMinimised(a.ctx)
	if isMinimized {
		return "minimized"
	}

	return "normal"
}

// ToggleFullscreen 切换全屏状态
func (a *App) ToggleFullscreen() {
	if a.ctx == nil {
		return
	}

	isFullscreen := runtime.WindowIsFullscreen(a.ctx)
	if isFullscreen {
		runtime.WindowUnfullscreen(a.ctx)
	} else {
		runtime.WindowFullscreen(a.ctx)
	}

	// 发送状态变化事件
	go func() {
		time.Sleep(100 * time.Millisecond) // 等待状态变化完成
		newState := a.GetWindowState()
		runtime.EventsEmit(a.ctx, "window_state_changed", newState)
	}()
}

// OTAResponse OTA响应结构体
type OTAResponse struct {
	Websocket struct {
		URL   string `json:"url"`
		Token string `json:"token"`
	} `json:"websocket"`
}

// DoOTARequest 执行OTA POST请求并打印响应数据
func (a *App) DoOTARequest(otaURL, deviceID string, postBody map[string]interface{}) error {
	log := logging.L().With("module", "ota")
	// 构造请求体
	bodyBytes, err := json.Marshal(postBody)
	if err != nil {
		return fmt.Errorf("JSON序列化失败: %v", err)
	}

	// 创建HTTP请求
	req, err := http.NewRequest("POST", otaURL, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return fmt.Errorf("创建请求失败: %v", err)
	}

	// 设置请求头
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "*/*")
	if deviceID != "" {
		req.Header.Set("Device-Id", deviceID)
	}

	// 打印请求信息（分级日志）
	log.Info("OTA 请求", "url", otaURL, "device_id", deviceID)
	log.Debug("OTA 请求体", "body", string(bodyBytes))

	// 发送请求
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应体
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败: %v", err)
	}

	// 打印响应信息（分级日志）
	log.Info("OTA 响应", "status", resp.StatusCode)
	log.Debug("OTA 响应体", "body", string(respBody))

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP请求失败: %d %s", resp.StatusCode, resp.Status)
	}

	// 解析响应JSON
	var otaResp OTAResponse
	if err := json.Unmarshal(respBody, &otaResp); err != nil {
		log.Warn("JSON解析失败", "err", err)
		log.Debug("原始响应", "body", string(respBody))
		return err
	}

	// 提取并输出关键信息
	log.Info("OTA 关键信息", "ws_url", otaResp.Websocket.URL)

	// 发送事件给前端
	runtime.EventsEmit(a.ctx, "ota_response", map[string]string{
		"websocket_url": otaResp.Websocket.URL,
		"token":         otaResp.Websocket.Token,
		"raw_response":  string(respBody),
	})

	return nil
}

// handleOpusAudio 处理 Opus 音频数据，在 Go 端解码后发送 PCM 给前端
func (a *App) handleOpusAudio(opusData []byte) {
	log := logging.L().With("module", "audio")
	if a.opusDecoder == nil {
		log.Warn("Opus 解码器未初始化，回退发送原始数据", "len", len(opusData))
		runtime.EventsEmit(a.ctx, "audio", opusData)
		return
	}

	log.Debug("收到 Opus 数据", "len", len(opusData))

	// 使用 Go 端的 Opus 解码器解码
	pcmData, err := a.opusDecoder.DecodeFrameToFloat32(opusData)
	if err != nil {
		log.Warn("Go Opus 解码失败，回退发送原始数据", "len", len(opusData), "err", err)
		runtime.EventsEmit(a.ctx, "audio", opusData)
		return
	}

	log.Debug("Go Opus 解码成功", "opus_bytes", len(opusData), "samples", len(pcmData))

	// 发送解码后的 PCM 数据给前端
	runtime.EventsEmit(a.ctx, "audio_pcm", pcmData)
}

// GetSystemVolume 获取系统音量 (0.0 - 1.0)
func (a *App) GetSystemVolume() float64 {
	if a.volumeController == nil {
		return 1.0 // 默认音量
	}

	volume, err := a.volumeController.GetSystemVolume()
	if err != nil {
		logging.L().With("module", "audio").Warn("获取系统音量失败", "err", err)
		return 1.0
	}

	return volume
}

// SetSystemVolume 设置系统音量 (0.0 - 1.0)
func (a *App) SetSystemVolume(volume float64) error {
	if a.volumeController == nil {
		return fmt.Errorf("音量控制器未初始化")
	}

	err := a.volumeController.SetSystemVolume(volume)
	if err != nil {
		logging.L().With("module", "audio").Warn("设置系统音量失败", "err", err)
		return err
	}

	logging.L().With("module", "audio").Info("系统音量设置", "volume", volume)
	return nil
}

// IsSystemVolumeSupported 检查是否支持系统音量控制
func (a *App) IsSystemVolumeSupported() bool {
	if a.volumeController == nil {
		return false
	}
	return a.volumeController.IsVolumeSupported()
}

// GetDefaultDeviceID 返回后端推断的默认设备ID（系统首选物理网卡 MAC）
func (a *App) GetDefaultDeviceID() string {
	// 直接利用 client.DefaultConfig() 中的默认逻辑
	cfg := client.DefaultConfig()
	return cfg.DeviceID
}

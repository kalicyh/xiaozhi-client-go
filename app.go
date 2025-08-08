package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"myproject/internal/client"
	"myproject/internal/store"
)

// App struct
type App struct {
	client *client.Client
	store  *store.DB
	ctx    context.Context
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
	a.store, _ = store.Open("xiaozhi.db")
	_ = a.store.InitConfig()
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
			cfg.DeviceID = getStr(kv, "device_id")
			cfg.AuthToken = getStr(kv, "token")
			cfg.MQTTKeepAliveSec = 240
			c := client.New(cfg)
			c.OnJSON = func(ctx context.Context, msg map[string]any) {
				b, _ := json.Marshal(msg)
				_ = a.store.SaveMessage(context.Background(), c.SessionID, "in", "json", string(b), time.Now().Unix())
				runtime.EventsEmit(a.ctx, "text", string(b))
			}
			c.OnBinary = func(ctx context.Context, data []byte) { runtime.EventsEmit(a.ctx, "audio", data) }
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
				for k, v := range m2 {
					kv[k] = v
				}
			} else {
				runtime.EventsEmit(a.ctx, "error", "invalid connect_ws payload")
				return
			}
			cfg := client.DefaultConfig()
			cfg.WebsocketURL = getStr(kv, "url")
			cfg.ClientID = getStr(kv, "client_id")
			cfg.DeviceID = getStr(kv, "device_id")
			cfg.AuthToken = getStr(kv, "token")
			c := client.New(cfg)
			c.OnJSON = func(ctx context.Context, msg map[string]any) {
				b, _ := json.Marshal(msg)
				_ = a.store.SaveMessage(context.Background(), c.SessionID, "in", "json", string(b), time.Now().Unix())
				runtime.EventsEmit(a.ctx, "text", string(b))
			}
			c.OnBinary = func(ctx context.Context, data []byte) { runtime.EventsEmit(a.ctx, "audio", data) }
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
				cfg.WebsocketURL = getStr(kv, "url")
				cfg.MQTTBroker = getStr(kv, "broker")
				cfg.MQTTUsername = getStr(kv, "username")
				cfg.MQTTPassword = getStr(kv, "password")
				cfg.MQTTPublishTopic = getStr(kv, "pub")
				cfg.MQTTSubscribeTopic = getStr(kv, "sub")
				cfg.ClientID = getStr(kv, "client_id")
				cfg.DeviceID = getStr(kv, "device_id")
				cfg.AuthToken = getStr(kv, "token")
				a.client = client.New(cfg)
				a.client.OnJSON = func(ctx context.Context, msg map[string]any) {
					b, _ := json.Marshal(msg)
					_ = a.store.SaveMessage(context.Background(), a.client.SessionID, "in", "json", string(b), time.Now().Unix())
					runtime.EventsEmit(a.ctx, "text", string(b))
				}
				a.client.OnBinary = func(ctx context.Context, data []byte) { runtime.EventsEmit(a.ctx, "audio", data) }
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

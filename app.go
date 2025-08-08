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

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.store, _ = store.Open("xiaozhi.db")
	_ = a.store.InitConfig()
	// events
	runtime.EventsOn(ctx, "save_config", func(args ...interface{}) {
		if len(args) == 1 {
			if kv, ok := args[0].(map[string]string); ok {
				_ = a.store.SetConfig(context.Background(), kv)
			}
		}
	})
	runtime.EventsOn(ctx, "load_config", func(_ ...interface{}) {
		if m, err := a.store.GetConfig(context.Background()); err == nil {
			runtime.EventsEmit(ctx, "config", m)
		}
	})
	runtime.EventsOn(ctx, "connect_mqtt", func(args ...interface{}) {
		if len(args) == 1 {
			if kv, ok := args[0].(map[string]string); ok {
				cfg := client.DefaultConfig()
				cfg.MQTTBroker = kv["broker"]
				cfg.MQTTUsername = kv["username"]
				cfg.MQTTPassword = kv["password"]
				cfg.MQTTPublishTopic = kv["pub"]
				cfg.MQTTSubscribeTopic = kv["sub"]
				cfg.ClientID = kv["client_id"]
				cfg.DeviceID = kv["device_id"]
				cfg.AuthToken = kv["token"]
				cfg.MQTTKeepAliveSec = 240
				c := client.New(cfg)
				c.OnJSON = func(ctx context.Context, msg map[string]any) {
					b, _ := json.Marshal(msg)
					_ = a.store.SaveMessage(context.Background(), c.SessionID, "in", "json", string(b), time.Now().Unix())
					runtime.EventsEmit(a.ctx, "text", string(b))
				}
				c.OnBinary = func(ctx context.Context, data []byte) { runtime.EventsEmit(a.ctx, "audio", data) }
				if err := c.OpenMQTT(context.Background()); err == nil {
					a.client = c
				}
			}
		}
	})
	runtime.EventsOn(ctx, "send_text", func(args ...interface{}) {
		if len(args) == 1 {
			if s, ok := args[0].(string); ok {
				_ = a.SendTextMessage(s)
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

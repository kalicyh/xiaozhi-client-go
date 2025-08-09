package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"myproject/internal/logging"
	"myproject/internal/transport"
)

type Client struct {
	cfg Config

	ws   *transport.WebsocketTransport
	mqtt *transport.MQTTControl
	udp  *transport.UDPAudio

	SessionID string

	OnJSON    func(ctx context.Context, msg map[string]any)
	OnBinary  func(ctx context.Context, data []byte)
	OnError   func(ctx context.Context, err error)
	OnClosed  func()

	mu      sync.RWMutex
	helloCh chan struct{}
}

func New(cfg Config) *Client { return &Client{cfg: cfg} }

// Open 根据协议打开连接："ws" 或 "mqtt"（对应 MQTT+UDP）
func (c *Client) Open(ctx context.Context, protocol string) error {
	switch protocol {
	case "ws", "websocket":
		return c.OpenWebsocket(ctx)
	case "mqtt":
		return c.OpenMQTT(ctx)
	default:
		return fmt.Errorf("unknown protocol: %s", protocol)
	}
}

// SwitchProtocol 关闭现有通道后切换协议
func (c *Client) SwitchProtocol(ctx context.Context, protocol string) error {
	c.Close()
	return c.Open(ctx, protocol)
}

func (c *Client) OpenWebsocket(ctx context.Context) error {
	if c.cfg.WebsocketURL == "" {
		return errors.New("websocket url required")
	}
	baseURL := c.cfg.WebsocketURL

	// 构造鉴权配置
	type attempt struct {
		url            string
		headers        map[string]string
		tokenPlacement string
	}

	var att attempt

	// 公共头
	commonHeaders := map[string]string{
		"Protocol-Version": "1",
	}
	if c.cfg.DeviceID != "" {
		commonHeaders["Device-Id"] = c.cfg.DeviceID
	}
	if c.cfg.ClientID != "" {
		commonHeaders["Client-Id"] = c.cfg.ClientID
	}

	// 根据用户选择的方式携带 token
	if c.cfg.EnableToken && c.cfg.AuthToken != "" {
		switch c.cfg.TokenMethod {
		case "header":
			// Authorization 头
			h := make(map[string]string, len(commonHeaders)+1)
			for k, v := range commonHeaders {
				h[k] = v
			}
			h["Authorization"] = "Bearer " + c.cfg.AuthToken
			att = attempt{
				url:            baseURL,
				headers:        h,
				tokenPlacement: "header:authorization",
			}
		case "query_access_token":
			// query: access_token
			if u, err := url.Parse(baseURL); err == nil && u != nil {
				q := u.Query()
				q.Set("access_token", c.cfg.AuthToken)
				u.RawQuery = q.Encode()
				h := make(map[string]string, len(commonHeaders))
				for k, v := range commonHeaders {
					h[k] = v
				}
				att = attempt{
					url:            u.String(),
					headers:        h,
					tokenPlacement: "query:access_token",
				}
			}
		case "query_token":
			// query: token
			if u, err := url.Parse(baseURL); err == nil && u != nil {
				q := u.Query()
				q.Set("token", c.cfg.AuthToken)
				u.RawQuery = q.Encode()
				h := make(map[string]string, len(commonHeaders))
				for k, v := range commonHeaders {
					h[k] = v
				}
				att = attempt{
					url:            u.String(),
					headers:        h,
					tokenPlacement: "query:token",
				}
			}
		default:
			// 默认使用 Authorization 头
			h := make(map[string]string, len(commonHeaders)+1)
			for k, v := range commonHeaders {
				h[k] = v
			}
			h["Authorization"] = "Bearer " + c.cfg.AuthToken
			att = attempt{
				url:            baseURL,
				headers:        h,
				tokenPlacement: "header:authorization",
			}
		}
	} else {
		// 无鉴权
		att = attempt{
			url:            baseURL,
			headers:        commonHeaders,
			tokenPlacement: "none",
		}
	}

	// 脱敏 URL/Headers 助手
	sanitizeURL := func(raw string) string {
		u, err := url.Parse(raw)
		if err != nil || u == nil {
			return raw
		}
		q := u.Query()
		for _, k := range []string{"access_token", "token"} {
			if q.Has(k) {
				q.Set(k, "***")
			}
		}
		u.RawQuery = q.Encode()
		return u.String()
	}
	sanitizeHeaders := func(h map[string]string) map[string]string {
		out := make(map[string]string, len(h))
		for k, v := range h {
			if strings.EqualFold(k, "Authorization") {
				if strings.HasPrefix(v, "Bearer ") {
					out[k] = "Bearer ***"
				} else {
					out[k] = "***"
				}
			} else {
				out[k] = v
			}
		}
		return out
	}

	helloSent := false
	helloRecv := false

	log := logging.L().With("module", "ws")
	// 在尝试前输出请求内容（已脱敏）
	log.Info("ws open", "url", sanitizeURL(att.url), "headers", sanitizeHeaders(att.headers), "token", att.tokenPlacement)

	report := func(phase string, base error) error {
		diag := fmt.Errorf("ws %s: %v", phase, base)
		log.Warn("ws error", "phase", phase, "err", base, "url", sanitizeURL(att.url), "helloSent", helloSent, "serverHello", helloRecv, "token", att.tokenPlacement)
		if c.OnError != nil {
			c.OnError(ctx, diag)
		}
		return diag
	}

	w := transport.NewWebsocketTransport(att.url, transport.Handlers{
		OnText: func(ctx2 context.Context, text []byte) {
			var msg map[string]any
			if err := json.Unmarshal(text, &msg); err == nil {
				if t, ok := msg["type"].(string); ok && t == "hello" {
					if sid, ok := msg["session_id"].(string); ok {
						c.SessionID = sid
					}
					helloRecv = true
					c.mu.Lock()
					ch := c.helloCh
					c.helloCh = nil
					c.mu.Unlock()
					if ch != nil {
						close(ch)
					}
				}
				if c.OnJSON != nil {
					c.OnJSON(ctx2, msg)
				}
			}
		},
		OnBinary: func(ctx2 context.Context, data []byte) {
			if c.OnBinary != nil {
				c.OnBinary(ctx2, data)
			}
		},
		OnError: func(ctx2 context.Context, err error) {
			_ = report("error", err)
		},
		OnClosed: func() {
			if c.OnClosed != nil {
				c.OnClosed()
			}
		},
	})

	c.ws = w
	if err := c.ws.Open(ctx, att.headers); err != nil {
		return report("handshake", err)
	}

	// 发送 hello（version=1，含 transport=websocket）
	hello := HelloMessage{
		Type:        "hello",
		Version:     c.cfg.ProtocolVersion,
		Transport:   "websocket",
		AudioParams: c.cfg.Audio,
		Features:    map[string]any{"mcp": true},
	}
	b, _ := json.Marshal(hello)

	// 在发送前输出 hello payload
	log.Debug("ws hello", "payload", string(b))

	if err := c.ws.SendText(ctx, b); err != nil {
		_ = c.ws.Close()
		return report("send-hello", err)
	}
	helloSent = true

	// 等待服务端 hello
	c.mu.Lock()
	c.helloCh = make(chan struct{})
	ch := c.helloCh
	c.mu.Unlock()

	select {
	case <-ch:
		return nil
	case <-time.After(c.cfg.HelloTimeout):
		_ = c.ws.Close()
		return report("hello-timeout", errors.New("hello timeout"))
	case <-ctx.Done():
		_ = c.ws.Close()
		return report("ctx-cancel", ctx.Err())
	}
}

func (c *Client) OpenMQTT(ctx context.Context) error {
	if c.cfg.MQTTBroker == "" { return errors.New("mqtt broker required") }
	clientID := c.cfg.ClientID; if clientID == "" { clientID = uuid.NewString() }
	c.mqtt = transport.NewMQTTControl(c.cfg.MQTTBroker, clientID, c.cfg.MQTTUsername, c.cfg.MQTTPassword, c.cfg.MQTTPublishTopic, c.cfg.MQTTSubscribeTopic, c.cfg.MQTTKeepAliveSec, transport.Handlers{
		OnText:   func(ctx context.Context, text []byte) { c.onMQTTMessage(ctx, text) },
		OnError:  func(ctx context.Context, err error) { if c.OnError != nil { c.OnError(ctx, err) } },
		OnClosed: func() { if c.OnClosed != nil { c.OnClosed() } },
	})
	if err := c.mqtt.Open(ctx, nil); err != nil { if c.OnError != nil { c.OnError(ctx, err) }; return err }
	hello := HelloMessage{Type: "hello", Version: c.cfg.ProtocolVersion, Transport: "udp", AudioParams: c.cfg.Audio, Features: map[string]any{"mcp": true}}
	b, _ := json.Marshal(hello)
	logging.L().With("module", "mqtt").Debug("mqtt hello", "payload", string(b))
	return c.mqtt.SendText(ctx, b)
}

func (c *Client) onMQTTMessage(ctx context.Context, text []byte) {
	var resp MqttHelloResponse
	if err := json.Unmarshal(text, &resp); err == nil {
		if resp.Type == "hello" && resp.Transport == "udp" && resp.UDP != nil {
			c.SessionID = resp.SessionID
			// 若已存在 UDP 连接，先关闭，避免泄漏
			if c.udp != nil {
				_ = c.udp.Close()
				c.udp = nil
			}
			u := transport.NewUDPAudio(resp.UDP.Server, resp.UDP.Port, resp.UDP.KeyHex, resp.UDP.NonceHex, transport.UDPAudioHandlers{
				OnAudioFrame: func(ctx context.Context, opus []byte) { if c.OnBinary != nil { c.OnBinary(ctx, opus) } },
				OnError: func(ctx context.Context, err error) { if c.OnError != nil { c.OnError(ctx, err) } },
				OnClosed: func() { if c.OnClosed != nil { c.OnClosed() } },
			})
			if err := u.Open(); err == nil { c.udp = u } else { if c.OnError != nil { c.OnError(ctx, err) } }
		}
	}
	var msg map[string]any
	if err := json.Unmarshal(text, &msg); err == nil { if c.OnJSON != nil { c.OnJSON(ctx, msg) } }
}

func (c *Client) SendListenStart(ctx context.Context, mode string) error {
	if c.SessionID == "" { return errors.New("no session") }
	msg := map[string]any{"session_id": c.SessionID, "type": "listen", "state": "start", "mode": mode}
	b, _ := json.Marshal(msg)
	if c.ws != nil { return c.ws.SendText(ctx, b) }
	if c.mqtt != nil { return c.mqtt.SendText(ctx, b) }
	return errors.New("no transport")
}

func (c *Client) SendDetectText(ctx context.Context, text string) error {
	if c.SessionID == "" { return errors.New("no session") }
	msg := map[string]any{"session_id": c.SessionID, "type": "listen", "state": "detect", "text": text, "source": "text"}
	b, _ := json.Marshal(msg)
	if c.ws != nil { return c.ws.SendText(ctx, b) }
	if c.mqtt != nil { return c.mqtt.SendText(ctx, b) }
	return errors.New("no transport")
}

func (c *Client) SendListenStop(ctx context.Context, mode string) error {
	if c.SessionID == "" { return errors.New("no session") }
	msg := map[string]any{"session_id": c.SessionID, "type": "listen", "state": "stop", "mode": mode}
	b, _ := json.Marshal(msg)
	if c.ws != nil { return c.ws.SendText(ctx, b) }
	if c.mqtt != nil { return c.mqtt.SendText(ctx, b) }
	return errors.New("no transport")
}

func (c *Client) SendAbort(ctx context.Context, reason string) error {
	if c.SessionID == "" { return nil }
	msg := map[string]any{"session_id": c.SessionID, "type": "abort", "reason": reason}
	b, _ := json.Marshal(msg)
	if c.ws != nil { return c.ws.SendText(ctx, b) }
	if c.mqtt != nil { return c.mqtt.SendText(ctx, b) }
	return errors.New("no transport")
}

// 新增：发送 Goodbye，遵循文档 3.3.1/3.3.2 关闭流程
func (c *Client) SendGoodbye(ctx context.Context) error {
	if c.SessionID == "" { return nil }
	msg := map[string]any{"session_id": c.SessionID, "type": "goodbye"}
	b, _ := json.Marshal(msg)
	if c.ws != nil { return c.ws.SendText(ctx, b) }
	if c.mqtt != nil { return c.mqtt.SendText(ctx, b) }
	return errors.New("no transport")
}

func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()

	// 按文档先发送 Goodbye（忽略发送错误）
	_ = c.SendGoodbye(context.Background())

	if c.udp != nil {
		_ = c.udp.Close()
		c.udp = nil
	}
	if c.ws != nil {
		_ = c.ws.Close()
		c.ws = nil
	}
	if c.mqtt != nil {
		_ = c.mqtt.Close()
		c.mqtt = nil
	}
	c.SessionID = ""
}

func (c *Client) SendOpusUpstream(ctx context.Context, opus []byte) error {
	c.mu.RLock()
	udp := c.udp
	ws := c.ws
	c.mu.RUnlock()

	if udp != nil {
		return udp.SendOpusFrame(opus)
	}
	if ws != nil {
		return ws.SendBinary(ctx, opus)
	}
	return errors.New("no audio channel")
}

func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.ws != nil {
		return c.ws.IsConnected()
	}
	if c.mqtt != nil {
		// 可以添加MQTT连接状态检查
		return c.mqtt != nil
	}
	return false
}

func (c *Client) GetSessionID() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.SessionID
}

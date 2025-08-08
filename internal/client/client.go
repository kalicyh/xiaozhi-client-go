package client

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"myproject/internal/transport"
)

type Client struct {
	cfg Config

	ws   *transport.WebsocketTransport
	mqtt *transport.MQTTControl
	udp  *transport.UDPAudio

	SessionID string

	OnJSON   func(ctx context.Context, msg map[string]any)
	OnBinary func(ctx context.Context, data []byte)
}

func New(cfg Config) *Client { return &Client{cfg: cfg} }

func (c *Client) OpenWebsocket(ctx context.Context) error {
	if c.cfg.WebsocketURL == "" { return errors.New("websocket url required") }
	headers := map[string]string{
		"Authorization":    fmt.Sprintf("Bearer %s", c.cfg.AuthToken),
		"Protocol-Version": fmt.Sprintf("%d", c.cfg.ProtocolVersion),
		"Device-Id":        c.cfg.DeviceID,
		"Client-Id":        c.cfg.ClientID,
	}
	c.ws = transport.NewWebsocketTransport(c.cfg.WebsocketURL, transport.Handlers{
		OnText:   func(ctx context.Context, text []byte) { c.onWSMessage(ctx, text) },
		OnBinary: func(ctx context.Context, data []byte) { if c.OnBinary != nil { c.OnBinary(ctx, data) } },
		OnError:  func(ctx context.Context, err error) {},
		OnClosed: func() {},
	})
	if err := c.ws.Open(ctx, headers); err != nil { return err }
	hello := HelloMessage{Type: "hello", Version: c.cfg.ProtocolVersion, Transport: "websocket", AudioParams: c.cfg.Audio, Features: map[string]any{"mcp": true}}
	b, _ := json.Marshal(hello)
	return c.ws.SendText(ctx, b)
}

func (c *Client) onWSMessage(ctx context.Context, text []byte) {
	var msg map[string]any
	if err := json.Unmarshal(text, &msg); err != nil { return }
	if t, ok := msg["type"].(string); ok && t == "hello" {
		if sid, ok := msg["session_id"].(string); ok { c.SessionID = sid }
	}
	if c.OnJSON != nil { c.OnJSON(ctx, msg) }
}

func (c *Client) OpenMQTT(ctx context.Context) error {
	if c.cfg.MQTTBroker == "" { return errors.New("mqtt broker required") }
	clientID := c.cfg.ClientID; if clientID == "" { clientID = uuid.NewString() }
	c.mqtt = transport.NewMQTTControl(c.cfg.MQTTBroker, clientID, c.cfg.MQTTUsername, c.cfg.MQTTPassword, c.cfg.MQTTPublishTopic, c.cfg.MQTTSubscribeTopic, c.cfg.MQTTKeepAliveSec, transport.Handlers{
		OnText:   func(ctx context.Context, text []byte) { c.onMQTTMessage(ctx, text) },
		OnError:  func(ctx context.Context, err error) {},
		OnClosed: func() {},
	})
	if err := c.mqtt.Open(ctx, nil); err != nil { return err }
	hello := HelloMessage{Type: "hello", Version: c.cfg.ProtocolVersion, Transport: "udp", AudioParams: c.cfg.Audio, Features: map[string]any{"mcp": true}}
	b, _ := json.Marshal(hello)
	return c.mqtt.SendText(ctx, b)
}

func (c *Client) onMQTTMessage(ctx context.Context, text []byte) {
	var resp MqttHelloResponse
	if err := json.Unmarshal(text, &resp); err == nil {
		if resp.Type == "hello" && resp.Transport == "udp" && resp.UDP != nil {
			c.SessionID = resp.SessionID
			u := transport.NewUDPAudio(resp.UDP.Server, resp.UDP.Port, resp.UDP.KeyHex, resp.UDP.NonceHex, transport.UDPAudioHandlers{
				OnAudioFrame: func(ctx context.Context, opus []byte) { if c.OnBinary != nil { c.OnBinary(ctx, opus) } },
				OnError: func(ctx context.Context, err error) {},
				OnClosed: func() {},
			})
			if err := u.Open(); err == nil { c.udp = u }
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

func (c *Client) Close() {
	if c.udp != nil { _ = c.udp.Close() }
	if c.ws != nil { _ = c.ws.Close() }
	if c.mqtt != nil { _ = c.mqtt.Close() }
}

func (c *Client) SendOpusUpstream(_ context.Context, opus []byte) error {
	if c.udp != nil { return c.udp.SendOpusFrame(opus) }
	if c.ws != nil { return c.ws.SendBinary(context.Background(), opus) }
	return errors.New("no audio channel")
}

package transport

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

type WebsocketTransport struct {
	URL          string
	Handlers     Handlers
	Subprotocols []string

	conn *websocket.Conn
}

func NewWebsocketTransport(url string, handlers Handlers) *WebsocketTransport {
	return &WebsocketTransport{URL: url, Handlers: handlers}
}

func (w *WebsocketTransport) Open(ctx context.Context, headers map[string]string) error {
	var dialer websocket.Dialer
	dialer.HandshakeTimeout = 15 * time.Second
	if len(w.Subprotocols) > 0 { dialer.Subprotocols = append([]string(nil), w.Subprotocols...) }
	reqHeader := http.Header{}
	for k, v := range headers { reqHeader.Set(k, v) }
	conn, resp, err := dialer.DialContext(ctx, w.URL, reqHeader)
	if err != nil {
		if w.Handlers.OnError != nil {
			status := 0
			var body []byte
			if resp != nil {
				status = resp.StatusCode
				if resp.Body != nil { b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096)); _ = resp.Body.Close(); body = b }
			}
			w.Handlers.OnError(context.Background(), fmt.Errorf("ws handshake failed: status=%d, err=%v, body=%s", status, err, string(body)))
		}
		return err
	}
	w.conn = conn
	// 捕获关闭事件，输出关闭码与原因
	w.conn.SetCloseHandler(func(code int, text string) error {
		if w.Handlers.OnError != nil {
			w.Handlers.OnError(context.Background(), fmt.Errorf("ws closed: code=%d, reason=%s", code, text))
		}
		return nil
	})
	// 启动读循环与保活
	go w.readLoop()
	go w.keepAlive()
	return nil
}

func (w *WebsocketTransport) keepAlive() {
	if w.conn == nil { return }
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if w.conn == nil { return }
		_ = w.conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
	}
}

func (w *WebsocketTransport) readLoop() {
	defer func() { if w.Handlers.OnClosed != nil { w.Handlers.OnClosed() } }()
	w.conn.SetReadLimit(32 << 20)
	_ = w.conn.SetReadDeadline(time.Time{})
	for {
		typeCode, data, err := w.conn.ReadMessage()
		if err != nil { if w.Handlers.OnError != nil { w.Handlers.OnError(context.Background(), err) }; return }
		switch typeCode {
		case websocket.TextMessage:
			if w.Handlers.OnText != nil { w.Handlers.OnText(context.Background(), data) }
		case websocket.BinaryMessage:
			if w.Handlers.OnBinary != nil { w.Handlers.OnBinary(context.Background(), data) }
		}
	}
}

func (w *WebsocketTransport) SendText(ctx context.Context, data []byte) error { return w.conn.WriteMessage(websocket.TextMessage, data) }
func (w *WebsocketTransport) SendBinary(ctx context.Context, data []byte) error { return w.conn.WriteMessage(websocket.BinaryMessage, data) }
func (w *WebsocketTransport) Close() error { if w.conn != nil { return w.conn.Close() }; return nil }

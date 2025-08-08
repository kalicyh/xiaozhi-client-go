package transport

import (
	"context"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

type WebsocketTransport struct {
	URL      string
	Handlers Handlers

	conn *websocket.Conn
}

func NewWebsocketTransport(url string, handlers Handlers) *WebsocketTransport {
	return &WebsocketTransport{URL: url, Handlers: handlers}
}

func (w *WebsocketTransport) Open(ctx context.Context, headers map[string]string) error {
	var dialer websocket.Dialer
	reqHeader := http.Header{}
	for k, v := range headers { reqHeader.Set(k, v) }
	conn, _, err := dialer.DialContext(ctx, w.URL, reqHeader)
	if err != nil { return err }
	w.conn = conn
	go w.readLoop()
	return nil
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

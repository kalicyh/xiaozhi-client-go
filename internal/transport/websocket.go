package transport

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type WebsocketTransport struct {
	URL          string
	Handlers     Handlers
	Subprotocols []string

	conn     *websocket.Conn
	mu       sync.RWMutex
	closed   int32
	stopCh   chan struct{}
	stopOnce sync.Once

	// 心跳和连接监控
	lastPong     int64
	lastPing     int64
	pingInterval time.Duration
	pongTimeout  time.Duration
}

func NewWebsocketTransport(url string, handlers Handlers) *WebsocketTransport {
	return &WebsocketTransport{
		URL:          url,
		Handlers:     handlers,
		stopCh:       make(chan struct{}),
		pingInterval: 20 * time.Second,
		pongTimeout:  10 * time.Second,
	}
}

func (w *WebsocketTransport) Open(ctx context.Context, headers map[string]string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.conn != nil {
		return fmt.Errorf("connection already open")
	}

	var dialer websocket.Dialer
	dialer.HandshakeTimeout = 15 * time.Second
	dialer.EnableCompression = false // 禁用压缩以提高稳定性

	if len(w.Subprotocols) > 0 {
		dialer.Subprotocols = append([]string(nil), w.Subprotocols...)
	}

	reqHeader := http.Header{}
	for k, v := range headers {
		reqHeader.Set(k, v)
	}

	// 设置User-Agent
	reqHeader.Set("User-Agent", "XiaozhiClient/1.0 (Go)")

	conn, resp, err := dialer.DialContext(ctx, w.URL, reqHeader)
	if err != nil {
		if w.Handlers.OnError != nil {
			status := 0
			var body []byte
			if resp != nil {
				status = resp.StatusCode
				if resp.Body != nil {
					b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
					_ = resp.Body.Close()
					body = b
				}
			}
			w.Handlers.OnError(context.Background(), fmt.Errorf("ws handshake failed: status=%d, err=%v, body=%s", status, err, string(body)))
		}
		return err
	}

	w.conn = conn
	atomic.StoreInt32(&w.closed, 0)
	w.stopCh = make(chan struct{})

	// 设置连接参数
	w.conn.SetReadLimit(10 * 1024 * 1024) // 10MB

	// 设置Pong处理器
	w.conn.SetPongHandler(func(appData string) error {
		atomic.StoreInt64(&w.lastPong, time.Now().Unix())
		return nil
	})

	// 设置关闭处理器
	w.conn.SetCloseHandler(func(code int, text string) error {
		if w.Handlers.OnError != nil {
			w.Handlers.OnError(context.Background(), fmt.Errorf("ws closed: code=%d, reason=%s", code, text))
		}
		w.Close()
		return nil
	})

	// 启动各种循环
	go w.readLoop()
	go w.pingLoop()
	go w.connectionMonitor()

	return nil
}

func (w *WebsocketTransport) pingLoop() {
	ticker := time.NewTicker(w.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-w.stopCh:
			return
		case <-ticker.C:
			if atomic.LoadInt32(&w.closed) == 1 {
				return
			}

			w.mu.RLock()
			conn := w.conn
			w.mu.RUnlock()

			if conn == nil {
				return
			}

			// 发送ping
			atomic.StoreInt64(&w.lastPing, time.Now().Unix())
			err := conn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(5*time.Second))
			if err != nil {
				if w.Handlers.OnError != nil {
					w.Handlers.OnError(context.Background(), fmt.Errorf("ping failed: %v", err))
				}
				w.Close()
				return
			}
		}
	}
}

func (w *WebsocketTransport) connectionMonitor() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-w.stopCh:
			return
		case <-ticker.C:
			if atomic.LoadInt32(&w.closed) == 1 {
				return
			}

			w.mu.RLock()
			conn := w.conn
			w.mu.RUnlock()

			if conn == nil {
				return
			}

			// 检查连接状态
			lastPing := atomic.LoadInt64(&w.lastPing)
			lastPong := atomic.LoadInt64(&w.lastPong)
			now := time.Now().Unix()

			// 如果发送了ping但超时未收到pong，则认为连接断开
			if lastPing > 0 && lastPong < lastPing && (now-lastPing) > int64(w.pongTimeout.Seconds()) {
				if w.Handlers.OnError != nil {
					w.Handlers.OnError(context.Background(), fmt.Errorf("pong timeout: last_ping=%d, last_pong=%d, timeout=%v", lastPing, lastPong, w.pongTimeout))
				}
				w.Close()
				return
			}
		}
	}
}

func (w *WebsocketTransport) readLoop() {
	defer func() {
		w.Close()
		if w.Handlers.OnClosed != nil {
			w.Handlers.OnClosed()
		}
	}()

	for {
		if atomic.LoadInt32(&w.closed) == 1 {
			return
		}

		w.mu.RLock()
		conn := w.conn
		w.mu.RUnlock()

		if conn == nil {
			return
		}

		// 设置读取超时
		err := conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		if err != nil {
			if w.Handlers.OnError != nil {
				w.Handlers.OnError(context.Background(), fmt.Errorf("set read deadline failed: %v", err))
			}
			return
		}

		typeCode, data, err := conn.ReadMessage()
		if err != nil {
			if atomic.LoadInt32(&w.closed) == 0 {
				if w.Handlers.OnError != nil {
					w.Handlers.OnError(context.Background(), fmt.Errorf("read message failed: %v", err))
				}
			}
			return
		}

		switch typeCode {
		case websocket.TextMessage:
			if w.Handlers.OnText != nil {
				w.Handlers.OnText(context.Background(), data)
			}
		case websocket.BinaryMessage:
			if w.Handlers.OnBinary != nil {
				w.Handlers.OnBinary(context.Background(), data)
			}
		case websocket.CloseMessage:
			return
		}
	}
}

func (w *WebsocketTransport) SendText(ctx context.Context, data []byte) error {
	if atomic.LoadInt32(&w.closed) == 1 {
		return fmt.Errorf("connection closed")
	}

	w.mu.RLock()
	conn := w.conn
	w.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("connection not established")
	}

	return conn.WriteMessage(websocket.TextMessage, data)
}

func (w *WebsocketTransport) SendBinary(ctx context.Context, data []byte) error {
	if atomic.LoadInt32(&w.closed) == 1 {
		return fmt.Errorf("connection closed")
	}

	w.mu.RLock()
	conn := w.conn
	w.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("connection not established")
	}

	return conn.WriteMessage(websocket.BinaryMessage, data)
}

func (w *WebsocketTransport) Close() error {
	w.stopOnce.Do(func() {
		atomic.StoreInt32(&w.closed, 1)
		close(w.stopCh)

		w.mu.Lock()
		defer w.mu.Unlock()

		if w.conn != nil {
			// 发送关闭消息
			_ = w.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second))
			_ = w.conn.Close()
			w.conn = nil
		}
	})
	return nil
}

func (w *WebsocketTransport) IsConnected() bool {
	return atomic.LoadInt32(&w.closed) == 0 && w.conn != nil
}

package transport

import "context"

type Handlers struct {
	OnText   func(ctx context.Context, text []byte)
	OnBinary func(ctx context.Context, data []byte)
	OnError  func(ctx context.Context, err error)
	OnClosed func()
}

type Transport interface {
	Open(ctx context.Context, headers map[string]string) error
	SendText(ctx context.Context, data []byte) error
	SendBinary(ctx context.Context, data []byte) error
	Close() error
}

package logging

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

var (
	logger   *slog.Logger
	levelVar slog.LevelVar
)

// 行式处理器：将日志渲染为一行文本。
// verbose=true 时：输出 时间 源文件:行号 [LEVEL] msg 以及 attrs（k: v）。
// verbose=false 时：仅输出 [LEVEL] msg。
type lineHandler struct {
	w        io.Writer
	minLevel *slog.LevelVar
	verbose  bool
	attrs    []slog.Attr
	groups   []string
	mu       sync.Mutex
}

func newLineHandler(w io.Writer, min *slog.LevelVar, verbose bool) *lineHandler {
	return &lineHandler{w: w, minLevel: min, verbose: verbose}
}

func (h *lineHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.minLevel.Level()
}

func (h *lineHandler) Handle(ctx context.Context, r slog.Record) error {
	var b bytes.Buffer

	// header
	if h.verbose {
		// time (HH:MM:SS.mmm)
		b.WriteString(r.Time.Format("15:04:05.000"))
		b.WriteByte(' ')
		// source file:line
		if r.PC != 0 {
			fr := runtime.CallersFrames([]uintptr{r.PC})
			f, _ := fr.Next()
			if f.File != "" {
				b.WriteString(filepath.Base(f.File))
				b.WriteByte(':')
				b.WriteString(fmt.Sprint(f.Line))
				b.WriteByte(' ')
			}
		}
	}

	// level + message
	b.WriteByte('[')
	b.WriteString(levelText(r.Level))
	b.WriteString("] ")
	b.WriteString(r.Message)

	// attrs
	if h.verbose {
		attrs := make([]slog.Attr, 0, len(h.attrs))
		attrs = append(attrs, h.attrs...)
		r.Attrs(func(a slog.Attr) bool { attrs = append(attrs, a); return true })
		for _, a := range attrs {
			key := a.Key
			if len(h.groups) > 0 {
				key = strings.Join(append(append([]string{}, h.groups...), key), ".")
			}
			b.WriteByte(' ')
			b.WriteString(key)
			b.WriteString(": ")
			b.WriteString(fmt.Sprint(a.Value.Any()))
		}
	}

	b.WriteByte('\n')

	h.mu.Lock()
	_, err := h.w.Write(b.Bytes())
	h.mu.Unlock()
	return err
}

func (h *lineHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if !h.verbose {
		return h // info 模式忽略 attrs
	}
	nh := *h
	nh.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &nh
}

func (h *lineHandler) WithGroup(name string) slog.Handler {
	if !h.verbose {
		return h // info 模式忽略分组
	}
	nh := *h
	nh.groups = append(append([]string{}, h.groups...), name)
	return &nh
}

// 一个分流处理器：debug 级别用 verbose=true，其它级别 verbose=false
type splitHandler struct {
	debug slog.Handler
	info  slog.Handler
}

func (s *splitHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return s.debug.Enabled(ctx, level) || s.info.Enabled(ctx, level)
}

func (s *splitHandler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level <= slog.LevelDebug {
		return s.debug.Handle(ctx, r)
	}
	// info/warn/error：仅保留 level 与 message（不携带 attrs）
	nr := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	return s.info.Handle(ctx, nr)
}

func (s *splitHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &splitHandler{debug: s.debug.WithAttrs(attrs), info: s.info}
}

func (s *splitHandler) WithGroup(name string) slog.Handler {
	return &splitHandler{debug: s.debug.WithGroup(name), info: s.info}
}

// Init initializes the global logger with a given level string (debug, info, warn, error).
// If level is empty, it will be read from the LOG_LEVEL environment variable (default: info).
// 自定义无等号样式：
// - info/warn/error: [LEVEL] msg
// - debug: time file:line [LEVEL] msg k: v ...
func Init(level string) {
	if level == "" {
		level = os.Getenv("LOG_LEVEL")
	}
	lvl := parseLevel(level)
	levelVar.Set(lvl)

	debugH := newLineHandler(os.Stdout, &levelVar, true)
	infoH := newLineHandler(os.Stdout, &levelVar, false)
	logger = slog.New(&splitHandler{debug: debugH, info: infoH})
}

// L returns the global logger, initializing it if needed.
func L() *slog.Logger {
	if logger == nil {
		Init("")
	}
	return logger
}

// SetLevel updates the runtime logging level.
func SetLevel(level string) { levelVar.Set(parseLevel(level)) }

func parseLevel(s string) slog.Level {
	s = strings.TrimSpace(strings.ToLower(s))
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func levelText(level slog.Level) string {
	switch {
	case level <= slog.LevelDebug:
		return "DEBUG"
	case level == slog.LevelInfo:
		return "INFO"
	case level == slog.LevelWarn:
		return "WARN"
	case level >= slog.LevelError:
		return "ERROR"
	default:
		return "INFO"
	}
}

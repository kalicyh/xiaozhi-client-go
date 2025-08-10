package main

import (
    "context"
    "encoding/json"
    "flag"
    "fmt"
    "math"
    "os"
    "sort"
    "strings"
    "sync"
    "sync/atomic"
    "time"

    "myproject/internal/client"
    "myproject/internal/logging"
)

type summary struct {
    Protocol        string        `json:"protocol"`
    Concurrency     int           `json:"concurrency"`
    RequestsPerConn int           `json:"requests_per_conn"`
    TotalRequests   int           `json:"total_requests"`
    ConnectOK       int64         `json:"connect_ok"`
    ConnectFail     int64         `json:"connect_fail"`
    ReqOK           int64         `json:"req_ok"`
    ReqTimeout      int64         `json:"req_timeout"`
    Errors          int64         `json:"errors"`
    Closed          int64         `json:"closed"`
    HelloLatencyMs  stats         `json:"hello_latency_ms"`
    RespLatencyMs   stats         `json:"resp_latency_ms"`
    Duration        time.Duration `json:"duration"`
}

type stats struct {
    Count int     `json:"count"`
    Min   float64 `json:"min"`
    Avg   float64 `json:"avg"`
    P50   float64 `json:"p50"`
    P90   float64 `json:"p90"`
    P95   float64 `json:"p95"`
    P99   float64 `json:"p99"`
    Max   float64 `json:"max"`
}

func makeStats(values []float64) stats {
    if len(values) == 0 {
        return stats{}
    }
    sort.Float64s(values)
    sum := 0.0
    for _, v := range values { sum += v }
    pick := func(p float64) float64 {
        if len(values) == 0 { return 0 }
        idx := int(math.Ceil((p/100.0)*float64(len(values)))) - 1
        if idx < 0 { idx = 0 }
        if idx >= len(values) { idx = len(values)-1 }
        return values[idx]
    }
    return stats{
        Count: len(values),
        Min:   values[0],
        Avg:   sum / float64(len(values)),
        P50:   pick(50),
        P90:   pick(90),
        P95:   pick(95),
        P99:   pick(99),
        Max:   values[len(values)-1],
    }
}

func main() {
    // Flags
    var (
        protocol   = flag.String("protocol", "ws", "Protocol: ws|mqtt")
        // WebSocket
        wsURL      = flag.String("ws", "", "WebSocket URL (e.g., ws://127.0.0.1:8000)")
        // MQTT
        mqttBroker = flag.String("broker", "", "MQTT broker URL (e.g., ssl://host:8883)")
        mqttUser   = flag.String("username", "", "MQTT username")
        mqttPass   = flag.String("password", "", "MQTT password")
        mqttPub    = flag.String("pub", "device-server", "MQTT publish topic")
        mqttSub    = flag.String("sub", "null", "MQTT subscribe topic (use 'null' to not subscribe)")
        mqttKeep   = flag.Int("keepalive", 240, "MQTT keepalive seconds")

        // Auth / IDs
        token      = flag.String("token", "", "Auth token (if any)")
        tokenMethod= flag.String("token-method", "header", "Token method: header|query_access_token|query_token")
        clientID   = flag.String("client-id", "", "Client ID")
        deviceID   = flag.String("device-id", "", "Device ID (defaults to system MAC if empty)")

        // Load params
        conc       = flag.Int("c", 10, "Concurrency (number of connections)")
        perConn    = flag.Int("n", 10, "Requests per connection")
        message    = flag.String("message", "hello", "Text to send for each request")
        helloTO    = flag.Duration("hello-timeout", 10*time.Second, "Hello wait timeout")
        respTO     = flag.Duration("resp-timeout", 10*time.Second, "Response wait timeout per request")
        jsonOut    = flag.Bool("json", false, "Output JSON summary")
        logLevel   = flag.String("log-level", "info", "Log level: debug|info|warn|error")
    )
    flag.Parse()

    logging.Init(*logLevel)

    cfg := client.DefaultConfig()
    cfg.ProtocolVersion = 3
    cfg.HelloTimeout = *helloTO
    cfg.EnableToken = *token != ""
    cfg.AuthToken = *token
    cfg.TokenMethod = *tokenMethod
    if *clientID != "" { cfg.ClientID = *clientID }
    if *deviceID != "" { cfg.DeviceID = strings.ToLower(*deviceID) }

    switch strings.ToLower(*protocol) {
    case "ws", "websocket":
        if *wsURL == "" {
            fmt.Fprintln(os.Stderr, "--ws is required for protocol=ws")
            os.Exit(2)
        }
        cfg.WebsocketURL = *wsURL
    case "mqtt":
        if *mqttBroker == "" {
            fmt.Fprintln(os.Stderr, "--broker is required for protocol=mqtt")
            os.Exit(2)
        }
        cfg.MQTTBroker = *mqttBroker
        cfg.MQTTUsername = *mqttUser
        cfg.MQTTPassword = *mqttPass
        cfg.MQTTPublishTopic = *mqttPub
        cfg.MQTTSubscribeTopic = *mqttSub
        cfg.MQTTKeepAliveSec = *mqttKeep
    default:
        fmt.Fprintln(os.Stderr, "unsupported protocol")
        os.Exit(2)
    }

    totalReq := (*conc) * (*perConn)

    var (
        connectOK int64
        connectNG int64
        reqOK     int64
        reqTO     int64
        errCnt    int64
        closedCnt int64
        muHello   sync.Mutex
        muResp    sync.Mutex
        hellos    []float64
        resps     []float64
    )

    startAll := time.Now()
    wg := sync.WaitGroup{}
    wg.Add(*conc)
    for i := 0; i < *conc; i++ {
        go func(worker int) {
            defer wg.Done()
            // Separate config copy per worker (unique ClientID optional)
            cfgW := cfg
            if cfgW.ClientID == "" {
                cfgW.ClientID = fmt.Sprintf("loadtest-%d-%d", time.Now().UnixNano(), worker)
            }

            c := client.New(cfgW)
            // channel to receive first response after each detect
            respCh := make(chan struct{}, 16)
            // ignore binary
            c.OnBinary = func(ctx context.Context, data []byte) {}
            c.OnClosed = func() { atomic.AddInt64(&closedCnt, 1) }
            c.OnError = func(ctx context.Context, err error) { atomic.AddInt64(&errCnt, 1) }
            c.OnJSON = func(ctx context.Context, msg map[string]any) {
                // classify hello vs others
                if t, ok := msg["type"].(string); ok {
                    if t == "hello" {
                        return
                    }
                    // tts or any non-hello counts as a response
                    select { case respCh <- struct{}{}: default: }
                    return
                }
                // also consider payloads with text/content fields
                if _, ok := msg["text"]; ok {
                    select { case respCh <- struct{}{}: default: }
                    return
                }
                if _, ok := msg["content"]; ok {
                    select { case respCh <- struct{}{}: default: }
                    return
                }
            }

            // connect
            ctx, cancel := context.WithTimeout(context.Background(), cfgW.HelloTimeout)
            defer cancel()
            t0 := time.Now()
            if err := c.Open(ctx, strings.ToLower(*protocol)); err != nil {
                atomic.AddInt64(&connectNG, 1)
                return
            }
            helloMs := float64(time.Since(t0).Milliseconds())
            muHello.Lock(); hellos = append(hellos, helloMs); muHello.Unlock()
            atomic.AddInt64(&connectOK, 1)

            // requests
            for j := 0; j < *perConn; j++ {
                // drain stale responses
                for {
                    select { case <-respCh: continue; default: }
                    break
                }
                t1 := time.Now()
                // send detect text
                _ = c.SendListenStart(context.Background(), "ptt") // optional; ignore error
                if err := c.SendDetectText(context.Background(), fmt.Sprintf("%s #%d.%d", *message, worker, j)); err != nil {
                    atomic.AddInt64(&errCnt, 1)
                }

                // wait for response
                select {
                case <-respCh:
                    ms := float64(time.Since(t1).Milliseconds())
                    muResp.Lock(); resps = append(resps, ms); muResp.Unlock()
                    atomic.AddInt64(&reqOK, 1)
                case <-time.After(*respTO):
                    atomic.AddInt64(&reqTO, 1)
                }
                _ = c.SendListenStop(context.Background(), "ptt") // optional; ignore error
            }
            c.Close()
        }(i)
    }
    wg.Wait()
    dur := time.Since(startAll)

    summ := summary{
        Protocol:        strings.ToLower(*protocol),
        Concurrency:     *conc,
        RequestsPerConn: *perConn,
        TotalRequests:   totalReq,
        ConnectOK:       connectOK,
        ConnectFail:     connectNG,
        ReqOK:           reqOK,
        ReqTimeout:      reqTO,
        Errors:          errCnt,
        Closed:          closedCnt,
        HelloLatencyMs:  makeStats(hellos),
        RespLatencyMs:   makeStats(resps),
        Duration:        dur,
    }

    if *jsonOut {
        enc := json.NewEncoder(os.Stdout)
        enc.SetIndent("", "  ")
        _ = enc.Encode(summ)
        return
    }

    // human text
    fmt.Printf("Load Test Summary:\n")
    fmt.Printf("  Protocol:          %s\n", summ.Protocol)
    fmt.Printf("  Concurrency:       %d\n", summ.Concurrency)
    fmt.Printf("  Requests/Conn:     %d\n", summ.RequestsPerConn)
    fmt.Printf("  Total Requests:    %d\n", summ.TotalRequests)
    fmt.Printf("  Connect OK/Fail:   %d / %d\n", summ.ConnectOK, summ.ConnectFail)
    fmt.Printf("  Req OK/Timeout:    %d / %d\n", summ.ReqOK, summ.ReqTimeout)
    fmt.Printf("  Errors:            %d\n", summ.Errors)
    fmt.Printf("  Closed events:     %d\n", summ.Closed)
    fmt.Printf("  Duration:          %s\n", summ.Duration)
    fmt.Printf("  Hello Latency (ms): n=%d min=%.0f avg=%.1f p50=%.0f p90=%.0f p95=%.0f p99=%.0f max=%.0f\n",
        summ.HelloLatencyMs.Count, summ.HelloLatencyMs.Min, summ.HelloLatencyMs.Avg, summ.HelloLatencyMs.P50, summ.HelloLatencyMs.P90, summ.HelloLatencyMs.P95, summ.HelloLatencyMs.P99, summ.HelloLatencyMs.Max)
    fmt.Printf("  Resp Latency  (ms): n=%d min=%.0f avg=%.1f p50=%.0f p90=%.0f p95=%.0f p99=%.0f max=%.0f\n",
        summ.RespLatencyMs.Count, summ.RespLatencyMs.Min, summ.RespLatencyMs.Avg, summ.RespLatencyMs.P50, summ.RespLatencyMs.P90, summ.RespLatencyMs.P95, summ.RespLatencyMs.P99, summ.RespLatencyMs.Max)
}

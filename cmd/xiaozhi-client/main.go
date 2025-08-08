package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"strings"

	"myproject/internal/client"
)

func main() {
	protocol := flag.String("protocol", "mqtt", "protocol: mqtt or ws")
	broker := flag.String("broker", "", "mqtt broker url, e.g. tcp://localhost:1883")
	pub := flag.String("pub", "devices/+/tx", "mqtt publish topic")
	sub := flag.String("sub", "devices/+/rx", "mqtt subscribe topic")
	wsURL := flag.String("ws", "", "websocket url")
	clientID := flag.String("client", "", "client id")
	deviceID := flag.String("device", "", "device id")
	token := flag.String("token", "", "auth token")
	flag.Parse()

	cfg := client.DefaultConfig()
	cfg.ClientID = *clientID
	cfg.DeviceID = *deviceID
	cfg.AuthToken = *token
	cfg.WebsocketURL = *wsURL
	cfg.MQTTBroker = *broker
	cfg.MQTTPublishTopic = *pub
	cfg.MQTTSubscribeTopic = *sub

	c := client.New(cfg)
	c.OnJSON = func(_ context.Context, msg map[string]any) { fmt.Println("[JSON]", msg) }
	c.OnBinary = func(_ context.Context, data []byte) { fmt.Println("[AUDIO]", len(data), "bytes") }
	if err := c.Open(context.Background(), *protocol); err != nil { fmt.Println("open error:", err); os.Exit(1) }
	defer c.Close()

	fmt.Println("Connected. type 'help' for commands.")
	s := bufio.NewScanner(os.Stdin)
	for {
		fmt.Print("> ")
		if !s.Scan() { break }
		line := strings.TrimSpace(s.Text())
		if line == "" { continue }
		parts := strings.SplitN(line, " ", 2)
		cmd := strings.ToLower(parts[0])
		arg := ""
		if len(parts) > 1 { arg = parts[1] }
		switch cmd {
		case "help":
			fmt.Println("commands: help, start, stop, abort, say <text>, proto <mqtt|ws>, quit")
		case "start":
			_ = c.SendListenStart(context.Background(), "manual")
		case "stop":
			_ = c.SendListenStop(context.Background(), "manual")
		case "abort":
			_ = c.SendAbort(context.Background(), "user")
		case "say":
			if arg != "" { _ = c.SendDetectText(context.Background(), arg) }
		case "proto":
			if arg == "mqtt" || arg == "ws" {
				if err := c.SwitchProtocol(context.Background(), arg); err != nil { fmt.Println("switch error:", err) } else { fmt.Println("switched to", arg) }
			}
		case "quit", "exit":
			return
		default:
			fmt.Println("unknown command")
		}
	}
}

package transport

import (
	"context"
	"errors"
	"fmt"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type MQTTControl struct {
	BrokerURL  string
	ClientID   string
	Username   string
	Password   string
	KeepAlive  time.Duration

	PublishTopic   string
	SubscribeTopic string

	Handlers Handlers

	client mqtt.Client
}

func NewMQTTControl(broker, clientID, username, password, pubTopic, subTopic string, keepAliveSec int, handlers Handlers) *MQTTControl {
	return &MQTTControl{ BrokerURL: broker, ClientID: clientID, Username: username, Password: password, KeepAlive: time.Duration(keepAliveSec)*time.Second, PublishTopic: pubTopic, SubscribeTopic: subTopic, Handlers: handlers }
}

func (m *MQTTControl) Open(ctx context.Context, headers map[string]string) error {
	opts := mqtt.NewClientOptions().AddBroker(m.BrokerURL)
	opts.SetClientID(m.ClientID)
	if m.Username != "" { opts.SetUsername(m.Username) }
	if m.Password != "" { opts.SetPassword(m.Password) }
	if m.KeepAlive > 0 { opts.SetKeepAlive(m.KeepAlive) }
	opts.SetAutoReconnect(true)
	opts.SetConnectionLostHandler(func(_ mqtt.Client, err error) { if m.Handlers.OnError != nil { m.Handlers.OnError(context.Background(), err) }; if m.Handlers.OnClosed != nil { m.Handlers.OnClosed() } })
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		if token := c.Subscribe(m.SubscribeTopic, 1, func(_ mqtt.Client, msg mqtt.Message) { if m.Handlers.OnText != nil { m.Handlers.OnText(context.Background(), msg.Payload()) } }); token.Wait() && token.Error() != nil {
			if m.Handlers.OnError != nil { m.Handlers.OnError(context.Background(), token.Error()) }
		}
	})
	m.client = mqtt.NewClient(opts)
	token := m.client.Connect()
	if !token.WaitTimeout(20*time.Second) { return fmt.Errorf("mqtt connect timeout") }
	return token.Error()
}

func (m *MQTTControl) SendText(ctx context.Context, data []byte) error {
	if m.client == nil || !m.client.IsConnectionOpen() { return errors.New("mqtt not connected") }
	tok := m.client.Publish(m.PublishTopic, 1, false, data)
	if !tok.WaitTimeout(10*time.Second) { return fmt.Errorf("mqtt publish timeout") }
	return tok.Error()
}

func (m *MQTTControl) SendBinary(ctx context.Context, data []byte) error { return errors.New("mqtt does not support binary in this client; use UDP for audio") }

func (m *MQTTControl) Close() error { if m.client != nil && m.client.IsConnectionOpen() { m.client.Disconnect(100) }; return nil }

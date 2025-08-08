package transport

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"sync"
	"time"
)

type UDPAudioHandlers struct {
	OnAudioFrame func(ctx context.Context, opus []byte)
	OnError      func(ctx context.Context, err error)
	OnClosed     func()
}

type UDPAudio struct {
	RemoteHost string
	RemotePort int
	KeyHex     string
	NonceHex   string

	Handlers UDPAudioHandlers

	conn       *net.UDPConn
	remote     *net.UDPAddr
	key        []byte
	nonce      []byte
	ssrc       uint32
	localSeq   uint32
	remoteSeq  uint32
	closedOnce sync.Once
	mu         sync.Mutex
	ctx        context.Context
	cancel     context.CancelFunc
}

func NewUDPAudio(host string, port int, keyHex, nonceHex string, handlers UDPAudioHandlers) *UDPAudio {
	ctx, cancel := context.WithCancel(context.Background())
	return &UDPAudio{RemoteHost: host, RemotePort: port, KeyHex: keyHex, NonceHex: nonceHex, Handlers: handlers, ctx: ctx, cancel: cancel}
}

func (u *UDPAudio) Open() error {
	var err error
	u.key, err = hex.DecodeString(u.KeyHex); if err != nil { return fmt.Errorf("invalid key hex: %w", err) }
	u.nonce, err = hex.DecodeString(u.NonceHex); if err != nil { return fmt.Errorf("invalid nonce hex: %w", err) }
	if len(u.key) != 16 || len(u.nonce) != 16 { return errors.New("AES-CTR requires 128-bit key and nonce") }
	u.remote, err = net.ResolveUDPAddr("udp", fmt.Sprintf("%s:%d", u.RemoteHost, u.RemotePort)); if err != nil { return err }
	u.conn, err = net.DialUDP("udp", nil, u.remote); if err != nil { return err }
	u.ssrc = rand.Uint32(); u.localSeq = 1; u.remoteSeq = 0
	go u.readLoop()
	return nil
}

func (u *UDPAudio) Close() error { u.closedOnce.Do(func(){ u.cancel(); if u.conn != nil { _ = u.conn.Close() }; if u.Handlers.OnClosed != nil { u.Handlers.OnClosed() } }); return nil }

func deriveIV(nonce []byte, ts uint32, seq uint32) []byte {
	iv := make([]byte, 16)
	copy(iv, nonce)
	binary.BigEndian.PutUint32(iv[0:4], ts)
	binary.BigEndian.PutUint32(iv[4:8], seq)
	copy(iv[8:], nonce[8:])
	return iv
}

func (u *UDPAudio) SendOpusFrame(opus []byte) error {
	u.mu.Lock(); defer u.mu.Unlock()
	if u.conn == nil { return errors.New("udp not open") }
	const pktType byte = 0x01
	var flags byte = 0x00
	payloadLen := uint16(len(opus))
	ssrc := u.ssrc
	ts := uint32(time.Now().UnixNano() / 1e6)
	seq := u.localSeq
	block, err := aes.NewCipher(u.key); if err != nil { return err }
	iv := deriveIV(u.nonce, ts, seq)
	stream := cipher.NewCTR(block, iv)
	enc := make([]byte, len(opus))
	stream.XORKeyStream(enc, opus)
	buf := make([]byte, 1+1+2+4+4+4+len(enc))
	i := 0
	buf[i] = pktType; i++
	buf[i] = flags; i++
	binary.BigEndian.PutUint16(buf[i:i+2], payloadLen); i += 2
	binary.BigEndian.PutUint32(buf[i:i+4], ssrc); i += 4
	binary.BigEndian.PutUint32(buf[i:i+4], ts); i += 4
	binary.BigEndian.PutUint32(buf[i:i+4], seq); i += 4
	copy(buf[i:], enc)
	_, err = u.conn.Write(buf)
	if err == nil { u.localSeq++ }
	return err
}

func (u *UDPAudio) readLoop() {
	buf := make([]byte, 65535)
	for {
		select { case <-u.ctx.Done(): return; default: }
		n, _, err := u.conn.ReadFromUDP(buf)
		if err != nil { if u.ctx.Err() != nil { return }; if u.Handlers.OnError != nil { u.Handlers.OnError(context.Background(), err) }; return }
		if n < 16 { if u.Handlers.OnError != nil { u.Handlers.OnError(context.Background(), errors.New("udp packet too short")) }; continue }
		p := buf[:n]
		if p[0] != 0x01 { continue }
		payloadLen := binary.BigEndian.Uint16(p[2:4])
		_ = binary.BigEndian.Uint32(p[4:8])
		ts := binary.BigEndian.Uint32(p[8:12])
		seq := binary.BigEndian.Uint32(p[12:16])
		if int(16+payloadLen) > len(p) { if u.Handlers.OnError != nil { u.Handlers.OnError(context.Background(), errors.New("udp payload len mismatch")) }; continue }
		cipherPayload := p[16 : 16+payloadLen]
		block, err := aes.NewCipher(u.key); if err != nil { if u.Handlers.OnError != nil { u.Handlers.OnError(context.Background(), err) }; continue }
		iv := deriveIV(u.nonce, ts, seq)
		stream := cipher.NewCTR(block, iv)
		plain := make([]byte, len(cipherPayload))
		stream.XORKeyStream(plain, cipherPayload)
		if u.remoteSeq != 0 && seq <= u.remoteSeq { continue }
		u.remoteSeq = seq
		if u.Handlers.OnAudioFrame != nil { u.Handlers.OnAudioFrame(context.Background(), plain) }
	}
}

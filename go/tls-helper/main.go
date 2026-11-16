package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
)

type upstream struct {
	Protocol string `json:"protocol"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type request struct {
	Token    string    `json:"token"`
	Host     string    `json:"host"`
	Port     int       `json:"port"`
	Profile  string    `json:"profile"`
	Upstream *upstream `json:"upstream"`
}

func profile(name string) (utls.ClientHelloID, error) {
	switch name {
	case "chrome-120":
		return utls.HelloChrome_120, nil
	case "chrome-131":
		return utls.HelloChrome_131, nil
	case "chrome-133":
		return utls.HelloChrome_133, nil
	default:
		return utls.ClientHelloID{}, errors.New("unsupported TLS profile")
	}
}

func dialTarget(ctx context.Context, r request) (net.Conn, error) {
	target := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	if r.Upstream == nil {
		return dialer.DialContext(ctx, "tcp", target)
	}
	u := r.Upstream
	if u.Port < 1 || u.Port > 65535 || u.Host == "" {
		return nil, errors.New("invalid upstream")
	}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(u.Host, strconv.Itoa(u.Port)))
	if err != nil {
		return nil, err
	}
	if u.Protocol == "https" {
		secure := tls.Client(conn, &tls.Config{ServerName: u.Host, MinVersion: tls.VersionTLS12})
		if err = secure.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, err
		}
		conn = secure
	} else if u.Protocol != "http" {
		conn.Close()
		return nil, errors.New("unsupported upstream protocol")
	}
	_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
	var auth string
	if u.Username != "" {
		auth = "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(u.Username+":"+u.Password)) + "\r\n"
	}
	if _, err = fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n%s\r\n", target, target, auth); err != nil {
		conn.Close()
		return nil, err
	}
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		conn.Close()
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		conn.Close()
		return nil, fmt.Errorf("upstream CONNECT returned %d", response.StatusCode)
	}
	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}

func handle(conn net.Conn, token string) {
	defer conn.Close()
	stageError := func(stage string, err error) {
		if os.Getenv("COMMENT_STUDIO_TLS_DEBUG") == "1" {
			fmt.Fprintln(os.Stderr, stage, err)
		}
		_, _ = conn.Write([]byte("ERR " + stage + "\n"))
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	reader := bufio.NewReaderSize(conn, 4096)
	line, err := reader.ReadSlice('\n')
	if err != nil || len(line) > 4096 {
		return
	}
	var r request
	if json.Unmarshal(line, &r) != nil || r.Token != token || r.Port != 443 || r.Host == "" ||
		strings.ContainsAny(r.Host, "/\\:\r\n ") || len(r.Host) > 253 {
		return
	}
	hello, err := profile(r.Profile)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	remote, err := dialTarget(ctx, r)
	if err != nil {
		stageError("dial", err)
		return
	}
	defer remote.Close()
	secure := utls.UClient(remote, &utls.Config{
		ServerName: r.Host, MinVersion: utls.VersionTLS12, NextProtos: []string{"http/1.1"},
	}, hello)
	if err = secure.BuildHandshakeState(); err != nil {
		stageError("hello", err)
		return
	}
	// The Node side relays HTTP/1.1 bytes. Keep the preset's JA3 fields, but
	// offer only HTTP/1.1 here; this intentionally differs from full browser JA4.
	for _, extension := range secure.Extensions {
		if alpn, ok := extension.(*utls.ALPNExtension); ok {
			alpn.AlpnProtocols = []string{"http/1.1"}
		}
	}
	if err = secure.HandshakeContext(ctx); err != nil {
		stageError("handshake", err)
		return
	}
	if secure.ConnectionState().NegotiatedProtocol != "" && secure.ConnectionState().NegotiatedProtocol != "http/1.1" {
		stageError("alpn", errors.New("unexpected ALPN"))
		return
	}
	_ = conn.SetDeadline(time.Time{})
	if _, err = conn.Write([]byte("OK\n")); err != nil {
		return
	}
	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(secure, reader)
		_ = secure.CloseWrite()
		close(done)
	}()
	_, _ = io.Copy(conn, secure)
	_ = conn.Close()
	<-done
}

func main() {
	token := os.Getenv("COMMENT_STUDIO_TLS_TOKEN")
	if len(token) < 32 {
		os.Exit(2)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(2)
	}
	defer listener.Close()
	fmt.Printf("READY %d\n", listener.Addr().(*net.TCPAddr).Port)
	for {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		go handle(conn, token)
	}
}

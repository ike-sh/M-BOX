// Package core 封装与 mihomo external-controller 的交互，以及 mihomo 子进程的
// 生命周期管理。daemon 通过本包获取实时数据并下发控制指令。
package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Client 是 mihomo external-controller 的 REST/WS 客户端。
type Client struct {
	addr   string // host:port，例如 127.0.0.1:9090
	secret string
	http   *http.Client
}

// NewClient 创建一个指向 mihomo external-controller 的客户端。
func NewClient(addr, secret string) *Client {
	return &Client{
		addr:   addr,
		secret: secret,
		http:   &http.Client{Timeout: 8 * time.Second},
	}
}

func (c *Client) baseURL() string { return "http://" + c.addr }

func (c *Client) newReq(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL()+path, body)
	if err != nil {
		return nil, err
	}
	if c.secret != "" {
		req.Header.Set("Authorization", "Bearer "+c.secret)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

// getJSON 发起 GET 并把响应解码到 out。
func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	req, err := c.newReq(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("mihomo %s -> %d: %s", path, resp.StatusCode, bytes.TrimSpace(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Available 探测 mihomo 是否在线（external-controller 是否可达）。
func (c *Client) Available(ctx context.Context) bool {
	var v Version
	return c.Version(ctx, &v) == nil
}

// Version 表示 mihomo 版本信息。
type Version struct {
	Meta    bool   `json:"meta"`
	Version string `json:"version"`
}

// Version 查询 mihomo 版本。
func (c *Client) Version(ctx context.Context, out *Version) error {
	return c.getJSON(ctx, "/version", out)
}

// Proxies 返回 mihomo 全部代理/策略组的原始映射。
func (c *Client) Proxies(ctx context.Context) (map[string]json.RawMessage, error) {
	var wrap struct {
		Proxies map[string]json.RawMessage `json:"proxies"`
	}
	if err := c.getJSON(ctx, "/proxies", &wrap); err != nil {
		return nil, err
	}
	return wrap.Proxies, nil
}

// Connections 返回 mihomo 当前连接快照（原始 JSON，由上层解析）。
func (c *Client) Connections(ctx context.Context) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := c.getJSON(ctx, "/connections", &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// GetRaw 发起 GET 并返回原始 JSON，供上层灵活解析（如 /rules、/providers/rules）。
func (c *Client) GetRaw(ctx context.Context, path string) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := c.getJSON(ctx, path, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// Configs 返回 mihomo 当前运行配置。
func (c *Client) Configs(ctx context.Context) (map[string]any, error) {
	out := map[string]any{}
	if err := c.getJSON(ctx, "/configs", &out); err != nil {
		return nil, err
	}
	return out, nil
}

// SelectProxy 在策略组 group 中选择节点 name（PUT /proxies/{group}）。
func (c *Client) SelectProxy(ctx context.Context, group, name string) error {
	body, _ := json.Marshal(map[string]string{"name": name})
	req, err := c.newReq(ctx, http.MethodPut, "/proxies/"+url.PathEscape(group), bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("select %s/%s -> %d: %s", group, name, resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}

// UpdateRuleProvider 触发 mihomo 重新拉取指定规则集（PUT /providers/rules/{name}）。
func (c *Client) UpdateRuleProvider(ctx context.Context, name string) error {
	return c.updateProvider(ctx, "rules", name)
}

// UpdateProxyProvider 触发 mihomo 重新拉取指定代理集（PUT /providers/proxies/{name}）。
func (c *Client) UpdateProxyProvider(ctx context.Context, name string) error {
	return c.updateProvider(ctx, "proxies", name)
}

// providerHTTP 用于规则集/代理集更新：下载远程列表可能耗时较久，
// 用比常规 8s 更宽松的超时，避免大列表正常下载被误判超时。
var providerHTTP = &http.Client{Timeout: 90 * time.Second}

func (c *Client) updateProvider(ctx context.Context, kind, name string) error {
	req, err := c.newReq(ctx, http.MethodPut, "/providers/"+kind+"/"+url.PathEscape(name), nil)
	if err != nil {
		return err
	}
	resp, err := providerHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update %s provider %s -> %d: %s", kind, name, resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}

// UpdateGeo 触发 mihomo 重新下载 GeoIP/GeoSite 数据库并热加载（POST /configs/geo）。
// 下载体积较大、可能较慢，复用宽松超时的 providerHTTP。
func (c *Client) UpdateGeo(ctx context.Context) error {
	req, err := c.newReq(ctx, http.MethodPost, "/configs/geo", bytes.NewReader([]byte("{}")))
	if err != nil {
		return err
	}
	resp, err := providerHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update geo -> %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}

// RuleProviderNames 返回当前所有规则集名称（用于「全部更新」）。
func (c *Client) RuleProviderNames(ctx context.Context) ([]string, error) {
	var wrap struct {
		Providers map[string]struct {
			Name string `json:"name"`
		} `json:"providers"`
	}
	if err := c.getJSON(ctx, "/providers/rules", &wrap); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(wrap.Providers))
	for key, p := range wrap.Providers {
		if p.Name != "" {
			names = append(names, p.Name)
		} else {
			names = append(names, key)
		}
	}
	return names, nil
}

// DelayResult 是节点测速结果。
type DelayResult struct {
	Delay int `json:"delay"`
}

// ProxyDelay 对单个节点测速（GET /proxies/{name}/delay）。
func (c *Client) ProxyDelay(ctx context.Context, name, testURL string, timeoutMS int) (int, error) {
	q := url.Values{}
	q.Set("url", testURL)
	q.Set("timeout", fmt.Sprint(timeoutMS))
	var r DelayResult
	err := c.getJSON(ctx, "/proxies/"+url.PathEscape(name)+"/delay?"+q.Encode(), &r)
	if err != nil {
		return 0, err
	}
	return r.Delay, nil
}

// PatchConfigs 热更新 mihomo 运行态配置（PATCH /configs），如 {"mode":"global"}。
func (c *Client) PatchConfigs(ctx context.Context, patch map[string]any) error {
	body, _ := json.Marshal(patch)
	req, err := c.newReq(ctx, http.MethodPatch, "/configs", bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("patch configs -> %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}

// ReloadConfig 让 mihomo 重新加载配置文件（PUT /configs?force=true）。
func (c *Client) ReloadConfig(ctx context.Context, path string, force bool) error {
	body, _ := json.Marshal(map[string]string{"path": path})
	suffix := "/configs"
	if force {
		suffix += "?force=true"
	}
	req, err := c.newReq(ctx, http.MethodPut, suffix, bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("reload -> %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}

// CloseConnection 断开 mihomo 中指定 id 的连接（DELETE /connections/{id}）。
func (c *Client) CloseConnection(ctx context.Context, id string) error {
	req, err := c.newReq(ctx, http.MethodDelete, "/connections/"+url.PathEscape(id), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("close conn %s -> %d: %s", id, resp.StatusCode, bytes.TrimSpace(b))
	}
	return nil
}

// DialTraffic 以 WebSocket 客户端身份连接 mihomo /traffic，持续返回上下行字节速率。
// 返回的 conn 由调用方负责关闭。
func (c *Client) DialTraffic(ctx context.Context) (*websocket.Conn, error) {
	return c.dialWS(ctx, "/traffic")
}

func (c *Client) dialWS(ctx context.Context, path string) (*websocket.Conn, error) {
	// 注意：path 可能带 query（如 "/logs?level=info"）。必须拆开放进 RawQuery，
	// 否则 url.URL{Path: ...} 会把 "?" 转义成 %3F，导致 mihomo 收到 "/logs%3Flevel=info"
	// 而握手失败——这正是「实时日志」一直连不上、显示“未运行”的根因。
	u := url.URL{Scheme: "ws", Host: c.addr, Path: path}
	if i := strings.IndexByte(path, '?'); i >= 0 {
		u.Path = path[:i]
		u.RawQuery = path[i+1:]
	}
	hdr := http.Header{}
	if c.secret != "" {
		hdr.Set("Authorization", "Bearer "+c.secret)
	}
	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
		NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, address)
		},
	}
	conn, _, err := dialer.DialContext(ctx, u.String(), hdr)
	return conn, err
}

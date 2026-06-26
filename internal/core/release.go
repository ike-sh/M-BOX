package core

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/gorilla/websocket"
)

// DownloadMihomo 下载指定版本的 mihomo 内核到 destPath（按本机架构选择资产，
// amd64 用 -compatible 以兼容老 CPU / 各类 VM）。下载 .gz 后解压、置可执行、原子替换。
func DownloadMihomo(ctx context.Context, version, destPath string) error {
	if version == "" {
		return fmt.Errorf("缺少版本号")
	}
	token := runtime.GOARCH
	if token == "amd64" {
		token = "amd64-compatible"
	}
	url := fmt.Sprintf("https://github.com/MetaCubeX/mihomo/releases/download/%s/mihomo-linux-%s-%s.gz", version, token, version)

	ctx, cancel := context.WithTimeout(ctx, 100*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载 mihomo 失败：%s -> %d", url, resp.StatusCode)
	}

	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("解压失败：%v", err)
	}
	defer gz.Close()

	tmp := destPath + ".dl"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, io.LimitReader(gz, 200<<20)); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	out.Close()
	if err := os.Chmod(tmp, 0o755); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, destPath)
}

// LatestVersion 查询 GitHub 上指定内核仓库最新 stable release 的 tag。
// repo 形如 "MetaCubeX/mihomo"；为空时回退到 mihomo。
func LatestVersion(ctx context.Context, repo string) (string, error) {
	if repo == "" {
		repo = "MetaCubeX/mihomo"
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var r struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return "", err
	}
	return r.TagName, nil
}

// DialLogs 以 WS 客户端连接 mihomo /logs，level 可为 info/warning/error/debug。
func (c *Client) DialLogs(ctx context.Context, level string) (*websocket.Conn, error) {
	path := "/logs"
	if level != "" {
		path += "?level=" + level
	}
	return c.dialWS(ctx, path)
}

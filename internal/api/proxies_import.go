package api

import (
	"encoding/json"
	"net/http"

	"github.com/mbox/mbox/internal/config"
)

// handleImportProxies 接收一段（可多行）分享链接文本，解析为 mihomo 节点写入
// config.yaml 并加入策略组，随后热重载。返回成功节点名、数量与逐条失败原因。
func (s *Server) handleImportProxies(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Links string `json:"links"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	text := body.Links
	if text == "" {
		text = body.Text
	}
	parsed := config.ParseProxyLinks(text)
	if len(parsed.Proxies) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"added":  []string{},
			"count":  0,
			"errors": nilSafe(parsed.Errors),
		})
		return
	}
	s.cfgMu.Lock()
	added, err := config.AddInlineProxies(s.cfg.ConfigPath(), parsed.Proxies)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"added":  nilSafe(added),
		"count":  len(added),
		"errors": nilSafe(parsed.Errors),
	})
}

// handleManualProxy 接收一个结构化的 mihomo 节点对象（前端按协议填表生成），
// 校验必填字段后写入 config.yaml 并加入策略组，随后热重载。
func (s *Server) handleManualProxy(w http.ResponseWriter, r *http.Request) {
	var px map[string]any
	if err := json.NewDecoder(r.Body).Decode(&px); err != nil || px == nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	typ, _ := px["type"].(string)
	server, _ := px["server"].(string)
	if typ == "" || server == "" {
		writeErr(w, http.StatusBadRequest, "缺少 type 或 server")
		return
	}
	// JSON 数字会解码成 float64，端口/alterId 需转回整数，避免 YAML 写成浮点。
	coerceInt(px, "port")
	coerceInt(px, "alterId")
	if p, ok := px["port"].(int); !ok || p <= 0 || p > 65535 {
		writeErr(w, http.StatusBadRequest, "端口无效")
		return
	}
	// 清理空字符串字段，避免写入一堆空值。
	pruneEmpty(px)

	s.cfgMu.Lock()
	added, err := config.AddInlineProxies(s.cfg.ConfigPath(), []map[string]any{px})
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"added": nilSafe(added), "count": len(added)})
}

// coerceInt 把 map 中某个 JSON 数字字段（float64）转成 int。
func coerceInt(m map[string]any, key string) {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			m[key] = int(n)
		case int:
			m[key] = n
		}
	}
}

// pruneEmpty 递归删除值为空字符串、空 map 的字段，保持生成配置整洁。
func pruneEmpty(m map[string]any) {
	for k, v := range m {
		switch x := v.(type) {
		case string:
			if x == "" {
				delete(m, k)
			}
		case map[string]any:
			pruneEmpty(x)
			if len(x) == 0 {
				delete(m, k)
			}
		}
	}
}

// handleDeleteNode 删除一个手动添加的内联节点（含策略组引用），随后热重载。
func (s *Server) handleDeleteNode(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if name == "" {
		writeErr(w, http.StatusBadRequest, "缺少节点名")
		return
	}
	s.cfgMu.Lock()
	err := config.RemoveInlineProxy(s.cfg.ConfigPath(), name)
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

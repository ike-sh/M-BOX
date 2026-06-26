package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/store"
)

func (s *Server) handleSubscriptions(w http.ResponseWriter, r *http.Request) {
	subs := s.store.Subscriptions()
	out := make([]Subscription, 0, len(subs))
	for i, sub := range subs {
		out = append(out, toSubDTO(i, sub))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleUpsertSubscription(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name     string `json:"name"`
		URL      string `json:"url"`
		Interval int    `json:"interval"` // 小时
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "缺少 name")
		return
	}
	// 查已有订阅：用于编辑场景沿用原链接、并保留启用/停用状态。
	var existing *store.Subscription
	for _, sub := range s.store.Subscriptions() {
		if sub.Name == body.Name {
			cp := sub
			existing = &cp
			break
		}
	}
	// 编辑场景：URL 留空表示「沿用原链接，只改更新间隔」——因为面板回显的 URL 是脱敏的，
	// 不能把脱敏串当成新链接写回。仅当该订阅已存在时允许 URL 为空。
	if body.URL == "" {
		if existing != nil {
			body.URL = existing.URL
		} else {
			writeErr(w, http.StatusBadRequest, "缺少 url")
			return
		}
	}
	interval := body.Interval
	if interval <= 0 {
		interval = 24
	}
	sub := store.Subscription{
		Name:      body.Name,
		URL:       body.URL,
		Interval:  interval * 3600,
		UpdatedAt: time.Time{},
	}
	if existing != nil {
		sub.Disabled = existing.Disabled // 编辑不改变启用/停用状态
	}
	if err := s.store.UpsertSubscription(sub); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// 拉取订阅 -> 写 provider 文件 -> 注入 mihomo config -> 重载。
	s.fetchInto(r.Context(), &sub)
	providerRel := "./providers/" + safeFile(sub.Name) + ".yaml"
	s.cfgMu.Lock()
	var injectErr error
	if sub.Disabled {
		// 停用中的订阅：保证 config 里不残留其 provider（编辑停用订阅时不重新注入）。
		injectErr = config.RemoveProxyProvider(s.cfg.ConfigPath(), sub.Name)
	} else {
		injectErr = config.AddProxyProvider(s.cfg.ConfigPath(), sub.Name, sub.URL, providerRel, sub.Interval)
		if injectErr == nil {
			// 默认布局下自动补齐 自动测速 + 地区分桶，使加完订阅即出现完整策略。
			s.autoApplyTemplateIfPending()
		}
	}
	s.cfgMu.Unlock()
	if injectErr != nil {
		log.Printf("[M-BOX] 同步 proxy-provider 失败: %v", injectErr)
	} else {
		s.reloadCore(r.Context())
	}
	writeJSON(w, http.StatusOK, toSubDTO(0, sub))
}

func (s *Server) handleUpdateSubscription(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var target *store.Subscription
	for _, sub := range s.store.Subscriptions() {
		if sub.Name == name {
			cp := sub
			target = &cp
			break
		}
	}
	if target == nil {
		writeErr(w, http.StatusNotFound, "订阅不存在")
		return
	}
	s.fetchInto(r.Context(), target)
	// 幂等重注入：确保 provider 已写入 config 且已加入策略组的 use（兼容旧配置/
	// 历史上未正确注入的情况），随后热重载，使「立即更新」也能自愈节点不显示问题。
	if !target.Disabled {
		providerRel := "./providers/" + safeFile(target.Name) + ".yaml"
		s.cfgMu.Lock()
		injectErr := config.AddProxyProvider(s.cfg.ConfigPath(), target.Name, target.URL, providerRel, target.Interval)
		if injectErr == nil {
			// 仍处于默认布局时，借「立即更新」自愈出完整策略（兼容旧安装：升级二进制后
			// 只需对订阅点一次「立即更新」即可补齐 自动测速 + 地区分桶）。
			s.autoApplyTemplateIfPending()
		}
		s.cfgMu.Unlock()
		if injectErr == nil {
			s.reloadCore(r.Context())
		}
	}
	writeJSON(w, http.StatusOK, toSubDTO(0, *target))
}

// handleSetSubscriptionEnabled 启用/停用一条订阅：停用时从 mihomo config 移除其
// proxy-provider（保留 store 元数据与 provider 文件），启用时重新注入；随后热重载。
func (s *Server) handleSetSubscriptionEnabled(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "请求体无效")
		return
	}
	sub, ok, err := s.store.SetSubscriptionEnabled(name, body.Enabled)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeErr(w, http.StatusNotFound, "订阅不存在")
		return
	}
	s.cfgMu.Lock()
	if body.Enabled {
		providerRel := "./providers/" + safeFile(sub.Name) + ".yaml"
		err = config.AddProxyProvider(s.cfg.ConfigPath(), sub.Name, sub.URL, providerRel, sub.Interval)
	} else {
		err = config.RemoveProxyProvider(s.cfg.ConfigPath(), sub.Name)
	}
	s.cfgMu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "写入配置失败："+err.Error())
		return
	}
	s.reloadCore(r.Context())
	writeJSON(w, http.StatusOK, toSubDTO(0, sub))
}

func (s *Server) handleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.store.RemoveSubscription(name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// 从 mihomo config 移除该 provider 并重载；删除 provider 文件。
	s.cfgMu.Lock()
	rmErr := config.RemoveProxyProvider(s.cfg.ConfigPath(), name)
	s.cfgMu.Unlock()
	if rmErr == nil {
		s.reloadCore(r.Context())
	}
	_ = os.Remove(config.ProviderFilePath(s.cfg.WorkDir, safeFile(name)))
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// enabledSubProviders 返回所有「启用中」订阅的 provider 名称，以及它们 provider 文件里
// 的全部节点名（后者用于推荐模板按地区分桶时只生成确有节点的地区组）。
func (s *Server) enabledSubProviders() (names []string, nodeNames []string) {
	for _, sub := range s.store.Subscriptions() {
		if sub.Disabled {
			continue
		}
		names = append(names, sub.Name)
		f := config.ProviderFilePath(s.cfg.WorkDir, safeFile(sub.Name))
		nodeNames = append(nodeNames, config.ProviderNodeNames(f)...)
	}
	return
}

// autoApplyTemplateIfPending 在「节点感知的完整策略尚未生成」时（默认布局只有 select 组、
// 还没有自动测速/地区 url-test 组）自动套用推荐策略，把默认布局升级成「自动测速 + 地区分桶
// + 分类分流 + 内置 GEOSITE 规则」的完整布局（节点感知，只建确有节点的地区组）。
// 已套用过模板或用户自建过 url-test 组的配置不会被改动。调用方须已持有 s.cfgMu。
// 返回是否实际套用。
func (s *Server) autoApplyTemplateIfPending() bool {
	if !config.IsTemplatePending(s.cfg.ConfigPath()) {
		return false
	}
	names, nodeNames := s.enabledSubProviders()
	if len(names) == 0 {
		return false
	}
	_, _ = config.CreateBackup(s.cfg.WorkDir, "before-template", backupKeep)
	if err := config.ApplyRecommendedTemplate(s.cfg.ConfigPath(), names, nodeNames); err != nil {
		log.Printf("[M-BOX] 自动套用推荐策略失败: %v", err)
		return false
	}
	log.Printf("[M-BOX] 已自动套用推荐策略（自动测速+地区分桶+分类分流），订阅: %v", names)
	return true
}

// fetchInto 拉取订阅写入 provider 文件，并把流量/节点数信息回写到 store。
func (s *Server) fetchInto(ctx context.Context, sub *store.Subscription) {
	ctx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	dest := config.ProviderFilePath(s.cfg.WorkDir, safeFile(sub.Name))
	info, err := config.FetchSubscription(ctx, sub.URL, dest)
	sub.UpdatedAt = time.Now()
	if err != nil {
		sub.LastError = err.Error()
	} else {
		sub.LastError = ""
		sub.NodeCount = config.CountProviderNodes(dest)
		if info != nil {
			sub.Upload = info.Upload
			sub.Download = info.Download
			sub.Total = info.Total
			sub.Expire = info.Expire
		}
	}
	_ = s.store.UpsertSubscription(*sub)
}

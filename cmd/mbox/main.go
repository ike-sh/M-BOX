// Command mbox 是 M-BOX 网关守护进程：托管 mihomo 子进程、反代其
// external-controller，并对外提供 REST/WS 面板 API 与静态前端。
package main

import (
	"context"
	"flag"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mbox/mbox/internal/api"
	"github.com/mbox/mbox/internal/config"
	"github.com/mbox/mbox/internal/core"
	"github.com/mbox/mbox/internal/logbuf"
	"github.com/mbox/mbox/internal/store"
	"github.com/mbox/mbox/internal/version"
)

func main() {
	// 捕获 daemon 自身日志到环形缓冲（供面板「日志」页的「后端日志」区），同时仍输出
	// stderr/journal。去掉 Go log 默认时间前缀：缓冲条目与 journal 各自带时间，避免重复。
	logHub := logbuf.New(500)
	log.SetFlags(0)
	log.SetOutput(io.MultiWriter(os.Stderr, logHub))

	cfg := config.Default()

	flag.StringVar(&cfg.Listen, "listen", cfg.Listen, "面板服务监听地址 host:port")
	flag.StringVar(&cfg.WorkDir, "workdir", cfg.WorkDir, "mihomo 工作目录 (-d)")
	flag.StringVar(&cfg.MihomoBin, "mihomo", cfg.MihomoBin, "mihomo 可执行文件路径（空=仅反代）")
	flag.StringVar(&cfg.Controller, "controller", cfg.Controller, "mihomo external-controller 地址")
	flag.StringVar(&cfg.Secret, "secret", cfg.Secret, "mihomo external-controller secret")
	flag.StringVar(&cfg.WebDir, "webdir", cfg.WebDir, "前端静态资源目录（空=自动探测 web/dist）")
	flag.StringVar(&cfg.Kernel, "kernel", cfg.Kernel, "代理内核类型 mihomo|sing-box")
	manage := flag.Bool("manage", cfg.Manage, "是否由 daemon 托管内核子进程")
	flag.Parse()
	cfg.Manage = *manage

	if err := os.MkdirAll(cfg.WorkDir, 0o755); err != nil {
		log.Fatalf("[M-BOX] 创建工作目录失败: %v", err)
	}

	// 开箱即用：工作目录若缺主配置，则写出内嵌默认配置，保证内核能正常启动。
	if created, err := cfg.EnsureConfig(); err != nil {
		log.Printf("[M-BOX] 写出默认配置失败（继续）: %v", err)
	} else if created {
		log.Printf("[M-BOX] 工作目录无配置，已写出默认配置: %s", cfg.ConfigPath())
	}

	// 托管 mihomo 时，确保 external-controller 配了非空 secret：config 里为空则自动生成随机
	// secret 写回，避免控制器“空口令”在本机被其它进程或误暴露时被滥用控制。client 用同一 secret。
	if cfg.Manage && cfg.Kernel != "sing-box" {
		if sec, err := config.EnsureControllerSecret(cfg.ConfigPath(), cfg.Secret); err != nil {
			log.Printf("[M-BOX] 注入 external-controller secret 失败（继续，沿用现值）: %v", err)
		} else {
			cfg.Secret = sec
		}
	}

	client := core.NewClient(cfg.Controller, cfg.Secret)

	spec := core.ResolveKernel(core.Kind(cfg.Kernel))

	bin := cfg.MihomoBin
	if !cfg.Manage {
		bin = "" // 不托管：manager 只读状态
	}
	manager := core.NewManager(bin, cfg.WorkDir, client, spec)

	st, err := store.Open(cfg.StatePath())
	if err != nil {
		log.Fatalf("[M-BOX] 打开状态文件失败: %v", err)
	}

	if cfg.Manage && manager.Managed() {
		if err := manager.Start(); err != nil {
			log.Printf("[M-BOX] 启动 mihomo 失败（继续以反代模式运行）: %v", err)
		} else {
			log.Printf("[M-BOX] 已托管 mihomo: %s -d %s", cfg.MihomoBin, cfg.WorkDir)
		}
	}

	srv := api.New(cfg, client, manager, st, logHub)

	// 订阅定时自动更新调度器。
	schedCtx, schedCancel := context.WithCancel(context.Background())
	defer schedCancel()
	srv.StartScheduler(schedCtx)

	httpServer := &http.Server{
		Addr:              announceAddr(cfg.Listen),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[M-BOX] M-BOX v%s 启动", version.Version)
		log.Printf("[M-BOX] 面板服务监听 http://%s", cfg.Listen)
		log.Printf("[M-BOX] mihomo external-controller: %s", cfg.Controller)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[M-BOX] HTTP 服务异常: %v", err)
		}
	}()

	// 优雅退出。
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("[M-BOX] 收到退出信号，正在关闭…")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	if cfg.Manage {
		_ = manager.Stop()
	}
	log.Println("[M-BOX] 已退出")
}

func announceAddr(listen string) string { return listen }

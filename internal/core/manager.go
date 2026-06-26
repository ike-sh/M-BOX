package core

import (
	"errors"
	"os"
	"os/exec"
	"sync"
	"time"
)

// State 描述 mihomo 内核当前状态。
type State string

const (
	StateStopped State = "stopped"
	StateRunning State = "running"
	StateFailed  State = "failed"
)

// Manager 负责托管内核子进程：启动、停止、重启与意外退出自动拉起。
// 内核类型通过 KernelSpec 抽象，Manager 本身与具体内核无关。
type Manager struct {
	bin     string
	workDir string
	client  *Client
	spec    KernelSpec

	mu      sync.Mutex
	cmd     *exec.Cmd
	state   State
	lastErr error
	watch   bool // 期望保持运行；为 false 时进程退出不自动重启
}

// NewManager 创建进程管理器。bin 为空表示不托管（仅反代已有内核实例）。
// spec 描述内核类型与启动方式。
func NewManager(bin, workDir string, client *Client, spec KernelSpec) *Manager {
	return &Manager{
		bin:     bin,
		workDir: workDir,
		client:  client,
		spec:    spec,
		state:   StateStopped,
	}
}

// Managed 表示该 manager 是否真正托管进程。
func (m *Manager) Managed() bool { return m.bin != "" }

// Spec 返回当前内核规格。
func (m *Manager) Spec() KernelSpec { return m.spec }

// Start 启动 mihomo。进程意外退出时会自动重启（直到 Stop）。
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.Managed() {
		return errors.New("未配置 mihomo 可执行文件，daemon 仅作反代")
	}
	if m.cmd != nil && m.cmd.Process != nil {
		return nil // 已在运行
	}
	m.watch = true
	// 启动前清理同工作目录的残留内核（上次崩溃遗留的孤儿 / 手动启动的重复实例），
	// 避免多个内核抢占 TUN / 控制器 / DNS 端口导致 "address already in use"。
	reapStrayKernels(m.bin, m.workDir)
	if err := m.spawn(); err != nil {
		m.state = StateFailed
		m.lastErr = err
		return err
	}
	return nil
}

// spawn 必须在持有 m.mu 时调用。
func (m *Manager) spawn() error {
	cmd := exec.Command(m.bin, m.spec.Args(m.bin, m.workDir)...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	// 让内核随 daemon 一同退出（Linux Pdeathsig），杜绝 daemon 崩溃 / 被 kill -9
	// 后遗留 ppid=1 的游离内核实例（会与重启后的新实例抢占 TUN / 控制器 / 53 端口）。
	configureSysProcAttr(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	m.cmd = cmd
	m.state = StateRunning
	m.lastErr = nil
	go m.supervise(cmd)
	return nil
}

// supervise 等待某个 mihomo 进程退出，并在仍处于托管态时自动重启。
// 通过比较 m.cmd == cmd 判断该进程是否仍是「当前进程」，避免被 Stop/Restart
// 替换后的旧进程触发误重启或重复 spawn。
func (m *Manager) supervise(cmd *exec.Cmd) {
	waitErr := cmd.Wait()

	m.mu.Lock()
	// 已被 Stop/Restart 替换为别的进程：旧进程退出无需处理。
	if m.cmd != cmd {
		m.mu.Unlock()
		return
	}
	m.cmd = nil
	if !m.watch {
		m.state = StateStopped
		m.mu.Unlock()
		return
	}
	// 意外退出：记录并退避后重启。
	if waitErr != nil {
		m.lastErr = waitErr
	}
	m.state = StateFailed
	m.mu.Unlock()

	time.Sleep(2 * time.Second)

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.watch && m.cmd == nil {
		_ = m.spawn()
	}
}

// Stop 停止 mihomo 并停止自动重启。
func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.watch = false
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
		m.cmd = nil
	}
	m.state = StateStopped
	return nil
}

// Restart 重启 mihomo。
func (m *Manager) Restart() error {
	_ = m.Stop()
	time.Sleep(300 * time.Millisecond)
	return m.Start()
}

// Status 返回当前状态及最后错误。
func (m *Manager) Status() (State, string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastErr != nil {
		return m.state, m.lastErr.Error()
	}
	return m.state, ""
}

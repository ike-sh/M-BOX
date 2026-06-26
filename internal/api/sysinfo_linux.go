//go:build linux

package api

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func collectStats(workDir string) sysStats {
	s := sysStats{
		Hostname: hostname(),
		OS:       readOSPretty(),
		Kernel:   readKernel(),
	}
	s.UptimeS = readUptime()
	s.CPU = sampleCPU()
	s.MemUsed, s.MemTotal = readMem()
	s.DiskUsed, s.DiskTot = readDisk(workDir)
	s.Load = readLoadavg()
	return s
}

func readOSPretty() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return "Linux"
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
		}
	}
	return "Linux"
}

// readKernel 直接读 /proc 而非 syscall.Uname：后者的 Utsname.Release 字段在
// 不同架构上类型不一（amd64/arm64 为 [65]int8，armv7 为 [65]uint8），会导致
// 跨架构编译失败。读 procfs 既可移植又简单。
func readKernel() string {
	if b, e := os.ReadFile("/proc/sys/kernel/osrelease"); e == nil {
		return strings.TrimSpace(string(b))
	}
	return "—"
}

func readUptime() int64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0
	}
	f, _ := strconv.ParseFloat(fields[0], 64)
	return int64(f)
}

func cpuTimes() (idle, total uint64) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)[1:]
			for i, f := range fields {
				v, _ := strconv.ParseUint(f, 10, 64)
				total += v
				if i == 3 || i == 4 { // idle + iowait
					idle += v
				}
			}
			return idle, total
		}
	}
	return 0, 0
}

func sampleCPU() float64 {
	i1, t1 := cpuTimes()
	time.Sleep(200 * time.Millisecond)
	i2, t2 := cpuTimes()
	dt := float64(t2 - t1)
	di := float64(i2 - i1)
	if dt <= 0 {
		return 0
	}
	usage := (1 - di/dt) * 100
	if usage < 0 {
		usage = 0
	}
	return round1(usage)
}

func readMem() (used, total float64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	var memTotal, memAvail float64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.ParseFloat(fields[1], 64) // kB
		switch fields[0] {
		case "MemTotal:":
			memTotal = v
		case "MemAvailable:":
			memAvail = v
		}
	}
	total = round1(memTotal / 1024)
	used = round1((memTotal - memAvail) / 1024)
	return used, total
}

func readDisk(path string) (used, total float64) {
	var st syscall.Statfs_t
	if path == "" {
		path = "/"
	}
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	bs := float64(st.Bsize)
	totalB := float64(st.Blocks) * bs
	freeB := float64(st.Bavail) * bs
	const gb = 1 << 30
	total = round1(totalB / gb)
	used = round1((totalB - freeB) / gb)
	return used, total
}

func readLoadavg() [3]float64 {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return [3]float64{}
	}
	fields := strings.Fields(string(b))
	var out [3]float64
	for i := 0; i < 3 && i < len(fields); i++ {
		out[i], _ = strconv.ParseFloat(fields[i], 64)
	}
	return out
}

func round1(f float64) float64 {
	return float64(int64(f*10+0.5)) / 10
}

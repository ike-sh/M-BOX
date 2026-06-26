package config

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Backup 描述一份配置备份。
type Backup struct {
	ID        string    `json:"id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"createdAt"`
	Size      int64     `json:"size"`
}

// backupsDir 返回备份目录。
func backupsDir(workDir string) string { return filepath.Join(workDir, "backups") }

// 文件名格式：<unixMillis>__<note>.yaml.bak（note 经过安全化处理）。
func backupName(ts int64, note string) string {
	return strconv.FormatInt(ts, 10) + "__" + safeBackupNote(note) + ".yaml.bak"
}

func safeBackupNote(note string) string {
	note = strings.TrimSpace(note)
	if note == "" {
		note = "manual"
	}
	r := strings.NewReplacer("/", "-", "\\", "-", "_", "-", " ", "-", ".", "-", ":", "-")
	out := r.Replace(note)
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func parseBackupName(fname string) (ts int64, note string, ok bool) {
	if !strings.HasSuffix(fname, ".yaml.bak") {
		return 0, "", false
	}
	base := strings.TrimSuffix(fname, ".yaml.bak")
	parts := strings.SplitN(base, "__", 2)
	if len(parts) != 2 {
		return 0, "", false
	}
	n, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", false
	}
	return n, strings.ReplaceAll(parts[1], "-", " "), true
}

// CreateBackup 把当前 config.yaml 复制到备份目录，note 为说明。返回备份元信息。
// 同时执行保留策略（最多保留 keep 份，删除最旧的）。
func CreateBackup(workDir, note string, keep int) (*Backup, error) {
	src := filepath.Join(workDir, "config.yaml")
	raw, err := os.ReadFile(src)
	if err != nil {
		return nil, err
	}
	dir := backupsDir(workDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	ts := time.Now().UnixMilli()
	fname := backupName(ts, note)
	if err := os.WriteFile(filepath.Join(dir, fname), raw, 0o644); err != nil {
		return nil, err
	}
	pruneBackups(dir, keep)
	return &Backup{
		ID:        strings.TrimSuffix(fname, ".yaml.bak"),
		Note:      strings.TrimSpace(note),
		CreatedAt: time.UnixMilli(ts),
		Size:      int64(len(raw)),
	}, nil
}

func pruneBackups(dir string, keep int) {
	if keep <= 0 {
		return
	}
	list, _ := ListBackupsDir(dir)
	if len(list) <= keep {
		return
	}
	// list 已按时间倒序；删除超出保留数量的旧备份。
	for _, b := range list[keep:] {
		_ = os.Remove(filepath.Join(dir, b.ID+".yaml.bak"))
	}
}

// ListBackups 列出某工作目录下的全部备份（按时间倒序）。
func ListBackups(workDir string) ([]Backup, error) {
	return ListBackupsDir(backupsDir(workDir))
}

// ListBackupsDir 列出指定目录中的备份。
func ListBackupsDir(dir string) ([]Backup, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Backup{}, nil
		}
		return nil, err
	}
	out := []Backup{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ts, note, ok := parseBackupName(e.Name())
		if !ok {
			continue
		}
		info, err := e.Info()
		var size int64
		if err == nil {
			size = info.Size()
		}
		out = append(out, Backup{
			ID:        strings.TrimSuffix(e.Name(), ".yaml.bak"),
			Note:      note,
			CreatedAt: time.UnixMilli(ts),
			Size:      size,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// backupPath 校验 id 合法并返回备份文件路径（防目录穿越）。
func backupPath(workDir, id string) (string, bool) {
	if id == "" || strings.ContainsAny(id, "/\\") || strings.Contains(id, "..") {
		return "", false
	}
	p := filepath.Join(backupsDir(workDir), id+".yaml.bak")
	return p, true
}

// ReadBackup 返回某份备份的内容。
func ReadBackup(workDir, id string) ([]byte, error) {
	p, ok := backupPath(workDir, id)
	if !ok {
		return nil, os.ErrInvalid
	}
	return os.ReadFile(p)
}

// RestoreBackup 在恢复前先自动备份当前配置，再用指定备份覆盖 config.yaml。
func RestoreBackup(workDir, id string, keep int) error {
	p, ok := backupPath(workDir, id)
	if !ok {
		return os.ErrInvalid
	}
	raw, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	if _, err := CreateBackup(workDir, "restore-snapshot", keep); err != nil {
		return err
	}
	return WriteConfigRaw(workDir, raw)
}

// DeleteBackup 删除一份备份。
func DeleteBackup(workDir, id string) error {
	p, ok := backupPath(workDir, id)
	if !ok {
		return os.ErrInvalid
	}
	return os.Remove(p)
}

// ReadConfigRaw 读取当前 config.yaml 原文。
func ReadConfigRaw(workDir string) ([]byte, error) {
	return os.ReadFile(filepath.Join(workDir, "config.yaml"))
}

// WriteConfigRaw 校验 YAML 合法后原子写入 config.yaml。
func WriteConfigRaw(workDir string, content []byte) error {
	var probe map[string]any
	if err := yaml.Unmarshal(content, &probe); err != nil {
		return err
	}
	dst := filepath.Join(workDir, "config.yaml")
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

package config

// writer.go 只保留 config.yaml 的 YAML 节点读改写「核心工具」（editConfig + 节点
// 构造/查找 helper），被各域写入文件（writer_tun.go / writer_dns.go / writer_general.go /
// writer_rules.go / writer_providers.go / writer_template.go）共享。
// 按域拆分是为了「每个功能一个文件」，便于维护与定位。

import (
	"bytes"
	"fmt"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

// editConfig 以 yaml.Node 方式读取配置、调用 mutate 修改、再原子写回。
// 使用 Node 而非 map 是为了尽量保留注释与键顺序（yaml.v3 Node 支持注释往返）。
func editConfig(path string, mutate func(root *yaml.Node) error) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return err
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return fmt.Errorf("config.yaml 顶层不是映射，无法安全修改")
	}
	if err := mutate(doc.Content[0]); err != nil {
		return err
	}
	out, err := yaml.Marshal(&doc)
	if err != nil {
		return err
	}
	// yaml.v3 会把星标平面字符(>U+FFFF，如 🚀🇭🇰🎯 等 emoji)转义成 \U0001F680，
	// 让 raw 配置很难看。这里把这类转义还原为字面 emoji（不动 \\，正则反斜杠安全）。
	out = unescapeYAMLAstral(out)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// unescapeYAMLAstral 把 yaml.v3 生成的 \Uxxxxxxxx（星标平面字符）还原为字面 UTF-8。
// 仅处理 \U 八位十六进制转义；遇到 \\（转义反斜杠，如双引号里的正则 \\b）原样跳过，
// 避免误伤。其它 \n \" \t 等转义一律保留不动。
func unescapeYAMLAstral(b []byte) []byte {
	if !bytes.Contains(b, []byte(`\U`)) {
		return b
	}
	s := string(b)
	var sb strings.Builder
	sb.Grow(len(s))
	for i := 0; i < len(s); {
		if s[i] == '\\' && i+1 < len(s) {
			if s[i+1] == '\\' { // 转义反斜杠：原样保留两个字符
				sb.WriteByte('\\')
				sb.WriteByte('\\')
				i += 2
				continue
			}
			if s[i+1] == 'U' && i+10 <= len(s) {
				if v, err := strconv.ParseUint(s[i+2:i+10], 16, 32); err == nil {
					if r := rune(v); r > 0xFFFF && utf8.ValidRune(r) {
						sb.WriteRune(r)
						i += 10
						continue
					}
				}
			}
		}
		sb.WriteByte(s[i])
		i++
	}
	return []byte(sb.String())
}

// mapGet 在映射节点中按 key 找到 value 节点。
func mapGet(m *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

// mapSet 设置/新增映射节点中的 key（value 为已构造的节点）。
func mapSet(m *yaml.Node, key string, val *yaml.Node) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			m.Content[i+1] = val
			return
		}
	}
	m.Content = append(m.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key},
		val,
	)
}

func scalarBool(b bool) *yaml.Node {
	v := "false"
	if b {
		v = "true"
	}
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: v}
}

func scalarStr(s string) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: s}
}

func scalarInt(i int) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: fmt.Sprint(i)}
}

// ensureMap 确保 parent[key] 是一个映射节点并返回它。
func ensureMap(parent *yaml.Node, key string) *yaml.Node {
	if v := mapGet(parent, key); v != nil && v.Kind == yaml.MappingNode {
		return v
	}
	m := &yaml.Node{Kind: yaml.MappingNode}
	mapSet(parent, key, m)
	return m
}

// seqOf 用一组字符串构造序列节点。
func seqOf(vals []string) *yaml.Node {
	seq := &yaml.Node{Kind: yaml.SequenceNode}
	for _, v := range vals {
		seq.Content = append(seq.Content, scalarStr(v))
	}
	return seq
}

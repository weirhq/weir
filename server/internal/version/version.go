// Package version holds the server's release version and the engine
// versions it works with.
package version

import (
	"fmt"
	"strconv"
	"strings"
)

// Server is this build's release version. The release workflow refuses a
// server/v* tag that doesn't match it.
const Server = "0.1.0"

// The engine versions this server talks to: MinEngine or later, and earlier
// than MaxEngine. Before 1.0, a minor release may change the engine contract.
const (
	MinEngine = "0.1.0"
	MaxEngine = "0.2.0"
)

// CheckEngine says why this server won't use an engine of version v, or
// returns nil if it will.
func CheckEngine(v string) error {
	got, err := parse(v)
	if err != nil {
		return fmt.Errorf("weir-engine reported version %q, which isn't a release version", v)
	}
	minV, _ := parse(MinEngine)
	maxV, _ := parse(MaxEngine)
	if got.less(minV) || !got.core().less(maxV) {
		return fmt.Errorf("weir-engine %s doesn't work with weir-server %s, which needs an engine from %s up to but not including %s",
			v, Server, MinEngine, MaxEngine)
	}
	return nil
}

// semver is a major.minor.patch version with an optional pre-release tag;
// build metadata is ignored.
type semver struct {
	n   [3]int
	pre string
}

func parse(v string) (semver, error) {
	v, _, _ = strings.Cut(v, "+")
	core, pre, _ := strings.Cut(v, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return semver{}, fmt.Errorf("%q: want major.minor.patch", v)
	}
	var s semver
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || (len(p) > 1 && p[0] == '0') {
			return semver{}, fmt.Errorf("%q: bad number %q", v, p)
		}
		s.n[i] = n
	}
	s.pre = pre
	return s, nil
}

func (s semver) core() semver { return semver{n: s.n} }

// less orders by number, then puts a pre-release before its release.
// Pre-releases of the same number compare as strings, which is enough for
// the -rc.N tags this project uses below ten.
func (s semver) less(o semver) bool {
	for i := range s.n {
		if s.n[i] != o.n[i] {
			return s.n[i] < o.n[i]
		}
	}
	switch {
	case s.pre == o.pre:
		return false
	case s.pre == "":
		return false
	case o.pre == "":
		return true
	}
	return s.pre < o.pre
}

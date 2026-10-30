package auth

import (
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// limiter is an in-process token bucket per key (an IP or a username).
type limiter struct {
	mu        sync.Mutex
	every     rate.Limit
	burst     int
	buckets   map[string]*bucket
	lastSweep time.Time
	now       func() time.Time
}

type bucket struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func newLimiter(perMinute, burst int) *limiter {
	return &limiter{
		every:   rate.Limit(float64(perMinute) / 60),
		burst:   burst,
		buckets: map[string]*bucket{},
		now:     time.Now,
	}
}

// Allow spends one token from every key's bucket, and reports false if any
// of them was empty.
func (l *limiter) Allow(keys ...string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.lastSweep) > time.Minute {
		l.sweep(now)
	}
	ok := true
	for _, k := range keys {
		b, found := l.buckets[k]
		if !found {
			b = &bucket{limiter: rate.NewLimiter(l.every, l.burst)}
			l.buckets[k] = b
		}
		b.lastSeen = now
		if !b.limiter.AllowN(now, 1) {
			ok = false
		}
	}
	return ok
}

// sweep drops buckets idle long enough to have refilled completely.
func (l *limiter) sweep(now time.Time) {
	l.lastSweep = now
	full := time.Duration(float64(l.burst) / float64(l.every) * float64(time.Second))
	for k, b := range l.buckets {
		if now.Sub(b.lastSeen) > full {
			delete(l.buckets, k)
		}
	}
}

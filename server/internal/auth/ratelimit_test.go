package auth

import (
	"testing"
	"time"
)

func TestLimiter(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newLimiter(60, 3) // one a second, burst of three
	l.now = func() time.Time { return now }

	for i := range 3 {
		if !l.Allow("ip:a") {
			t.Fatalf("call %d refused within the burst", i+1)
		}
	}
	if l.Allow("ip:a") {
		t.Fatal("fourth call allowed")
	}
	if !l.Allow("ip:b") {
		t.Fatal("a different key shares the bucket")
	}
	now = now.Add(time.Second)
	if !l.Allow("ip:a") {
		t.Fatal("bucket did not refill")
	}
}

func TestLimiterChecksEveryKey(t *testing.T) {
	l := newLimiter(60, 1)
	if !l.Allow("ip:a", "user:x") {
		t.Fatal("first call refused")
	}
	if l.Allow("ip:b", "user:x") {
		t.Fatal("allowed although user:x was empty")
	}
}

func TestLimiterSweepsIdleBuckets(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newLimiter(60, 3)
	l.now = func() time.Time { return now }
	l.Allow("ip:a")
	now = now.Add(2 * time.Minute)
	l.Allow("ip:b")
	if _, ok := l.buckets["ip:a"]; ok {
		t.Error("idle bucket was not swept")
	}
}

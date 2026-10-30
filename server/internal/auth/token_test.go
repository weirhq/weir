package auth

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"

	"github.com/google/uuid"
)

func newTestTokens(t *testing.T, issuer string) *Tokens {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return NewTokens(key, issuer)
}

func TestTokenRoundTrip(t *testing.T) {
	tokens := newTestTokens(t, "https://weir.example.org")
	user, device := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	authTime := time.Now().Add(-3 * time.Minute).Truncate(time.Second)

	token, expires, err := tokens.Issue(user, device, RoleAdmin, authTime)
	if err != nil {
		t.Fatal(err)
	}
	if d := time.Until(expires); d < AccessTokenTTL-time.Minute || d > AccessTokenTTL {
		t.Errorf("expires in %v, want about %v", d, AccessTokenTTL)
	}
	claims, err := tokens.Parse(token)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := claims.UserID(); got != user {
		t.Errorf("user = %v, want %v", got, user)
	}
	if claims.DeviceID != device || claims.Role != RoleAdmin || !claims.AuthenticatedAt().Equal(authTime) {
		t.Errorf("unexpected claims: %+v", claims)
	}
}

func TestTokenRejections(t *testing.T) {
	tokens := newTestTokens(t, "https://weir.example.org")
	token, _, err := tokens.Issue(uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7()), RoleMember, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	t.Run("other key", func(t *testing.T) {
		if _, err := newTestTokens(t, "https://weir.example.org").Parse(token); err == nil {
			t.Error("accepted a token signed by another server")
		}
	})
	t.Run("other issuer", func(t *testing.T) {
		other := NewTokens(tokens.key, "https://elsewhere.example.org")
		if _, err := other.Parse(token); err == nil {
			t.Error("accepted a token for another issuer")
		}
	})
	t.Run("expired", func(t *testing.T) {
		late := NewTokens(tokens.key, tokens.issuer)
		late.now = func() time.Time { return time.Now().Add(AccessTokenTTL + time.Minute) }
		if _, err := late.Parse(token); err == nil {
			t.Error("accepted an expired token")
		}
	})
	t.Run("tampered", func(t *testing.T) {
		b := []byte(token)
		b[len(b)/2] ^= 1
		if _, err := tokens.Parse(string(b)); err == nil {
			t.Error("accepted a tampered token")
		}
	})
}

func TestRefreshTokens(t *testing.T) {
	a, hashA, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := NewRefreshToken()
	if a == b {
		t.Error("two refresh tokens are identical")
	}
	if !bytes.Equal(HashRefreshToken(a), hashA) {
		t.Error("stored hash does not match the token")
	}
}

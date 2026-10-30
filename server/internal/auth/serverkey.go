package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"

	"github.com/weirhq/weir/server/internal/store"
)

// LoadServerKey returns the server's Ed25519 key, generating and storing it
// on first run.
func LoadServerKey(ctx context.Context, st *store.Store) (ed25519.PrivateKey, error) {
	_, fresh, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	// A no-op once a key exists, so concurrent first starts agree on one key.
	if err := st.InsertServerKey(ctx, fresh.Seed()); err != nil {
		return nil, fmt.Errorf("store server key: %w", err)
	}
	seed, err := st.GetServerKey(ctx)
	if err != nil {
		return nil, fmt.Errorf("load server key: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("server key has %d bytes, want %d", len(seed), ed25519.SeedSize)
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

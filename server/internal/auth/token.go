package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	AccessTokenTTL  = 15 * time.Minute
	RefreshTokenTTL = 30 * 24 * time.Hour
)

// Claims are the access token's contents. Role is a hint for clients; the
// server re-reads it from the database wherever it grants something.
type Claims struct {
	jwt.RegisteredClaims
	DeviceID uuid.UUID `json:"did"`
	Role     string    `json:"role"`
	// When the user last entered their password, carried across refreshes.
	AuthTime int64 `json:"auth_time"`
}

func (c *Claims) UserID() (uuid.UUID, error) { return uuid.Parse(c.Subject) }

func (c *Claims) AuthenticatedAt() time.Time { return time.Unix(c.AuthTime, 0) }

// Tokens issues and checks access tokens signed with the server's key.
type Tokens struct {
	key    ed25519.PrivateKey
	issuer string
	now    func() time.Time
}

func NewTokens(key ed25519.PrivateKey, issuer string) *Tokens {
	return &Tokens{key: key, issuer: issuer, now: time.Now}
}

func (t *Tokens) Issue(userID, deviceID uuid.UUID, role string, authTime time.Time) (string, time.Time, error) {
	now := t.now()
	expires := now.Add(AccessTokenTTL)
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    t.issuer,
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
		DeviceID: deviceID,
		Role:     role,
		AuthTime: authTime.Unix(),
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(t.key)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expires, nil
}

func (t *Tokens) Parse(token string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(token, claims,
		func(*jwt.Token) (any, error) { return t.key.Public(), nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(t.issuer),
		jwt.WithExpirationRequired(),
		jwt.WithTimeFunc(t.now),
	)
	if err != nil {
		return nil, err
	}
	if claims.DeviceID == uuid.Nil {
		return nil, errors.New("token has no device")
	}
	return claims, nil
}

// NewRefreshToken returns an opaque token for the client and the hash the
// server stores in its place.
func NewRefreshToken() (token string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("generate refresh token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashRefreshToken(token), nil
}

// HashRefreshToken is a plain SHA-256: refresh tokens are 256 random bits,
// so a slow hash adds nothing.
func HashRefreshToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

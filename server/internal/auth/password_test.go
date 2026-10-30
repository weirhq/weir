package auth

import (
	"strings"
	"testing"
)

func TestPasswordRoundTrip(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=4$") {
		t.Errorf("unexpected hash format: %s", hash)
	}
	for password, want := range map[string]bool{
		"correct horse battery staple":  true,
		"correct horse battery staple ": false,
		"":                              false,
	} {
		got, err := VerifyPassword(password, hash)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("VerifyPassword(%q) = %v, want %v", password, got, want)
		}
	}
}

func TestHashesAreSalted(t *testing.T) {
	a, _ := HashPassword("same password")
	b, _ := HashPassword("same password")
	if a == b {
		t.Error("two hashes of the same password are identical")
	}
}

func TestVerifyRejectsMalformedHashes(t *testing.T) {
	for _, hash := range []string{
		"",
		"plaintext",
		"$argon2i$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
		"$argon2id$v=18$m=65536,t=3,p=4$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=65536,t=3,p=4$!!!$aGFzaA",
	} {
		if _, err := VerifyPassword("x", hash); err == nil {
			t.Errorf("VerifyPassword accepted %q", hash)
		}
	}
}

func TestValidatePassword(t *testing.T) {
	if ValidatePassword("1234567") == nil {
		t.Error("accepted a 7-character password")
	}
	if err := ValidatePassword("12345678"); err != nil {
		t.Error(err)
	}
	if ValidatePassword(strings.Repeat("x", MaxPasswordLength+1)) == nil {
		t.Error("accepted an over-long password")
	}
}

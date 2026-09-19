package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gogpu/systray"
)

var updateFeedURL string

// Raw 32-byte Ed25519 public key (base64), same keypair that signs the
// plugin catalog - server/src/plugin-platform/release-public-key.ts's
// PLUGIN_RELEASE_PUBLIC_KEY in its other encoding (SPKI PEM there, since
// Node's crypto.verify wants that; raw bytes here, since ed25519.Verify
// wants that). One first-party signing key for everything MemoryLane ships,
// not a second keypair to generate and guard.
var updatePublicKey = "6fSlBqpHIuoB26XKwmc1lKkk4ouFJh381CrWIaQhgRM="

type updateManifest struct {
	Version   string `json:"version"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	Signature string `json:"signature"`
}

type coreUpdater struct {
	mu        sync.Mutex
	manifest  *updateManifest
	installer string
	checking  bool
	setMenu   func(string, bool)
}

func newCoreUpdater(setMenu func(string, bool)) *coreUpdater {
	if value := os.Getenv("MEMORYLANE_UPDATE_FEED_URL"); value != "" {
		updateFeedURL = value
	}
	return &coreUpdater{setMenu: setMenu}
}

func (u *coreUpdater) start() {
	if updateFeedURL == "" {
		u.setMenu("Updates not configured", false)
		return
	}
	u.setMenu("Check for Updates", true)
	_ = u.check()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		_ = u.check()
	}
}

func (u *coreUpdater) activate(s *supervisor, tray *systray.SystemTray) {
	u.mu.Lock()
	installer := u.installer
	u.mu.Unlock()
	if installer == "" {
		_ = u.check()
		return
	}
	ready, reasons := s.updateReadiness()
	if !ready {
		u.setMenu("Update waits for: "+strings.Join(reasons, ", "), true)
		return
	}
	s.stop()
	if !s.waitForState("stopped", 10*time.Second) {
		u.setMenu("Could not stop server for update", true)
		return
	}
	if err := launchInstaller(installer); err != nil {
		u.setMenu("Update launch failed", true)
		return
	}
	tray.Remove()
}

func (u *coreUpdater) check() error {
	u.mu.Lock()
	if u.checking {
		u.mu.Unlock()
		return nil
	}
	u.checking = true
	u.mu.Unlock()
	defer func() { u.mu.Lock(); u.checking = false; u.mu.Unlock() }()
	u.setMenu("Checking for Updates...", false)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, updateFeedURL, nil)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		u.setMenu("Update check failed", true)
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		err = fmt.Errorf("update feed returned %s", response.Status)
		u.setMenu("Update check failed", true)
		return err
	}
	var manifest updateManifest
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&manifest); err != nil {
		u.setMenu("Invalid update feed", true)
		return err
	}
	if err = verifyManifest(manifest); err != nil {
		u.setMenu("Update signature invalid", true)
		return err
	}
	if compareVersions(manifest.Version, version) <= 0 {
		u.setMenu("MemoryLane is up to date", true)
		return nil
	}
	u.setMenu("Downloading MemoryLane "+manifest.Version+"...", false)
	installer, err := downloadInstaller(ctx, manifest)
	if err != nil {
		u.setMenu("Update download failed", true)
		return err
	}
	u.mu.Lock()
	u.manifest, u.installer = &manifest, installer
	u.mu.Unlock()
	u.setMenu("Install MemoryLane "+manifest.Version, true)
	return nil
}

func verifyManifest(m updateManifest) error {
	parsedURL, err := url.Parse(m.URL)
	if err != nil || (parsedURL.Scheme != "https" && parsedURL.Hostname() != "127.0.0.1" && parsedURL.Hostname() != "localhost") {
		return fmt.Errorf("update URL must use HTTPS")
	}
	key, err := base64.StdEncoding.DecodeString(updatePublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid update public key")
	}
	signature, err := base64.StdEncoding.DecodeString(m.Signature)
	if err != nil {
		return err
	}
	message := []byte(m.Version + "\n" + m.URL + "\n" + strings.ToLower(m.SHA256))
	if !ed25519.Verify(ed25519.PublicKey(key), message, signature) {
		return fmt.Errorf("invalid manifest signature")
	}
	return nil
}

func downloadInstaller(ctx context.Context, m updateManifest) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download returned %s", response.Status)
	}
	dir := filepath.Join(appDataDir(), "updates")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	ext := ".exe"
	if runtime.GOOS == "darwin" {
		ext = ".dmg"
	}
	target := filepath.Join(dir, "MemoryLane-"+m.Version+ext+".part")
	f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(f, hash), io.LimitReader(response.Body, 1<<31))
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(target)
		return "", copyErr
	}
	if closeErr != nil {
		_ = os.Remove(target)
		return "", closeErr
	}
	expected, err := hex.DecodeString(m.SHA256)
	if err != nil || len(expected) != sha256.Size || subtle.ConstantTimeCompare(expected, hash.Sum(nil)) != 1 {
		_ = os.Remove(target)
		return "", fmt.Errorf("update checksum mismatch")
	}
	final := strings.TrimSuffix(target, ".part")
	_ = os.Remove(final)
	if err = os.Rename(target, final); err != nil {
		return "", err
	}
	return final, nil
}

func compareVersions(left, right string) int {
	parse := func(value string) []int {
		var a, b, c int
		_, _ = fmt.Sscanf(strings.TrimPrefix(value, "v"), "%d.%d.%d", &a, &b, &c)
		return []int{a, b, c}
	}
	l, r := parse(left), parse(right)
	for i := range l {
		if l[i] < r[i] {
			return -1
		}
		if l[i] > r[i] {
			return 1
		}
	}
	return 0
}

func (s *supervisor) updateReadiness() (bool, []string) {
	state := s.currentState()
	if state == "stopped" || state == "error" {
		return true, nil
	}
	if state != "running" {
		return false, []string{"server is " + state}
	}
	request, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/api/internal/update-readiness", s.port), nil)
	request.Header.Set("x-memorylane-desktop-token", s.token)
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return false, []string{"could not verify background work"}
	}
	defer response.Body.Close()
	var result struct {
		Ready   bool     `json:"ready"`
		Reasons []string `json:"reasons"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&result) != nil {
		return false, []string{"could not verify background work"}
	}
	return result.Ready, result.Reasons
}

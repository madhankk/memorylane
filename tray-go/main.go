package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gogpu/systray"
)

var version = "0.2.0"

type config struct {
	Port          int  `json:"port"`
	AutoStart     bool `json:"autoStart"`
	LaunchAtLogin bool `json:"launchAtLogin"`
}

type supervisor struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	state   string
	port    int
	token   string
	logFile *os.File
	onState func(string)
}

var (
	sup           *supervisor
	menuState     *systray.MenuItem
	menuStart     *systray.MenuItem
	menuStop      *systray.MenuItem
	menuOpen      *systray.MenuItem
	menuAutoStart *systray.MenuItem
	menuLogin     *systray.MenuItem
	menuUpdate    *systray.MenuItem
	tray          *systray.SystemTray
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--smoke-test" {
		os.Exit(runSmokeTest())
	}
	if err := acquireSingleInstance(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return
	}
	sup = &supervisor{state: "stopped"}
	onReady()
	if err := tray.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
	onExit()
}

func runSmokeTest() int {
	cfg := loadConfig()
	testSupervisor := &supervisor{state: "stopped", port: cfg.Port}
	started := time.Now()
	go testSupervisor.start(cfg.Port)
	if !testSupervisor.waitForState("running", 30*time.Second) {
		fmt.Fprintf(os.Stderr, "server did not reach running state (state=%s)\n", testSupervisor.currentState())
		testSupervisor.stop()
		return 1
	}
	startup := time.Since(started)
	testSupervisor.stop()
	if !testSupervisor.waitForState("stopped", 10*time.Second) {
		fmt.Fprintf(os.Stderr, "server did not stop (state=%s)\n", testSupervisor.currentState())
		return 1
	}
	fmt.Printf("{\"serverStartupMs\":%d,\"stoppedCleanly\":true}\n", startup.Milliseconds())
	return 0
}

func (s *supervisor) currentState() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *supervisor) waitForState(want string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if s.currentState() == want {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return s.currentState() == want
}

func onReady() {
	cfg := loadConfig()
	sup.port = cfg.Port
	sup.onState = updateMenu
	menu := systray.NewMenu()
	menuState = menu.Add("MemoryLane stopped", nil)
	menuState.SetDisabled(true)
	versionItem := menu.Add("Version "+version, nil)
	versionItem.SetDisabled(true)
	menu.AddSeparator()
	menuStart = menu.Add("Start Server", func() { go sup.start(cfg.Port) })
	menuStop = menu.Add("Stop Server", func() { go sup.stop() })
	menuOpen = menu.Add("Open in Browser", func() {
		_ = openBrowser(fmt.Sprintf("http://127.0.0.1:%d", cfg.Port))
	})
	menu.AddSeparator()
	menuAutoStart = menu.AddCheckbox("Start server with MemoryLane", cfg.AutoStart, func() {
		cfg.AutoStart = !menuAutoStart.IsChecked()
		menuAutoStart.SetChecked(cfg.AutoStart)
		_ = saveConfig(cfg)
	})
	loginEnabled := launchAtLoginEnabled()
	menuLogin = menu.AddCheckbox("Launch MemoryLane at login", loginEnabled, func() {
		enable := !menuLogin.IsChecked()
		if err := setLaunchAtLogin(enable); err == nil {
			cfg.LaunchAtLogin = enable
			menuLogin.SetChecked(enable)
			_ = saveConfig(cfg)
		}
	})
	menu.AddSeparator()
	updater := newCoreUpdater(func(label string, enabled bool) {
		menuUpdate.SetLabel(label)
		menuUpdate.SetDisabled(!enabled)
	})
	menuUpdate = menu.Add("Check for Updates", func() { go updater.activate(sup, tray) })
	go updater.start()
	menu.AddSeparator()
	menu.Add("Quit", func() { tray.Remove() })

	tray = systray.New()
	tray.SetIcon(trayIcon).SetTooltip("MemoryLane").SetMenu(menu).Show()
	updateMenu("stopped")
	writeReadyMarker()

	if cfg.AutoStart && os.Getenv("MEMORYLANE_TRAY_NO_AUTOSTART") != "1" {
		go sup.start(cfg.Port)
	}
}

func onExit() {
	if sup != nil {
		sup.stop()
	}
	releaseSingleInstance()
}

func updateMenu(state string) {
	if menuState == nil {
		return
	}
	label := map[string]string{
		"stopped":  "MemoryLane stopped",
		"starting": "MemoryLane starting...",
		"running":  fmt.Sprintf("MemoryLane running on port %d", sup.port),
		"stopping": "MemoryLane stopping...",
		"error":    "MemoryLane failed to start",
	}[state]
	menuState.SetLabel(label)
	tray.SetTooltip(label)
	if state == "stopped" || state == "error" {
		menuStart.SetDisabled(false)
	} else {
		menuStart.SetDisabled(true)
	}
	if state == "running" || state == "starting" {
		menuStop.SetDisabled(false)
	} else {
		menuStop.SetDisabled(true)
	}
	if state == "running" {
		menuOpen.SetDisabled(false)
	} else {
		menuOpen.SetDisabled(true)
	}
}

func (s *supervisor) setState(state string) {
	s.mu.Lock()
	s.state = state
	callback := s.onState
	s.mu.Unlock()
	if callback != nil {
		callback(state)
	}
}

func (s *supervisor) start(port int) {
	s.mu.Lock()
	if s.cmd != nil {
		s.mu.Unlock()
		return
	}
	s.port = port
	s.mu.Unlock()
	s.setState("starting")

	runtimeDir, err := resolveRuntimeDir()
	if err != nil {
		s.fail(err)
		return
	}
	node := filepath.Join(runtimeDir, nodeBinaryName())
	server := filepath.Join(runtimeDir, "dist", "server.js")
	if _, err = os.Stat(node); err != nil {
		s.fail(fmt.Errorf("runtime executable missing: %s", node))
		return
	}
	if _, err = os.Stat(server); err != nil {
		s.fail(fmt.Errorf("server missing: %s", server))
		return
	}

	tokenBytes := make([]byte, 32)
	if _, err = rand.Read(tokenBytes); err != nil {
		s.fail(err)
		return
	}
	s.token = base64.RawURLEncoding.EncodeToString(tokenBytes)
	cmd := exec.Command(node, server)
	cmd.Dir = runtimeDir
	cmd.Env = append(os.Environ(),
		"MEMORYLANE_PORT="+strconv.Itoa(port),
		"MEMORYLANE_NO_OPEN=1",
		"MEMORYLANE_DESKTOP_TOKEN="+s.token,
	)
	if plugins := bundledPluginsDir(runtimeDir); plugins != "" {
		cmd.Env = append(cmd.Env, "MEMORYLANE_BUNDLED_PLUGIN_REPOSITORY="+plugins)
	}
	configureChildProcess(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.fail(err)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.fail(err)
		return
	}
	logPath := filepath.Join(appDataDir(), "tray.log")
	_ = os.MkdirAll(filepath.Dir(logPath), 0700)
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)

	s.mu.Lock()
	s.cmd, s.logFile = cmd, logFile
	s.mu.Unlock()
	if err = cmd.Start(); err != nil {
		s.mu.Lock()
		s.cmd = nil
		s.mu.Unlock()
		s.fail(err)
		return
	}
	go s.consume(stdout)
	go s.consume(stderr)
	err = cmd.Wait()
	s.mu.Lock()
	wasStopping := s.state == "stopping"
	s.cmd = nil
	if s.logFile != nil {
		_ = s.logFile.Close()
		s.logFile = nil
	}
	s.mu.Unlock()
	if err != nil && !wasStopping {
		s.setState("error")
	} else {
		s.setState("stopped")
	}
}

func (s *supervisor) consume(reader io.Reader) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		s.mu.Lock()
		if s.logFile != nil {
			_, _ = fmt.Fprintln(s.logFile, line)
		}
		state := s.state
		s.mu.Unlock()
		if state == "starting" && strings.Contains(line, "Server listening") {
			s.setState("running")
		}
	}
}

func (s *supervisor) stop() {
	s.mu.Lock()
	cmd := s.cmd
	s.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return
	}
	s.setState("stopping")
	_ = terminateProcessTree(cmd)
}

func (s *supervisor) fail(err error) {
	logPath := filepath.Join(appDataDir(), "tray.log")
	_ = os.MkdirAll(filepath.Dir(logPath), 0700)
	f, _ := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if f != nil {
		_, _ = fmt.Fprintf(f, "%s: %v\n", time.Now().Format(time.RFC3339), err)
		_ = f.Close()
	}
	s.setState("error")
}

func loadConfig() config {
	cfg := config{Port: 4280, AutoStart: true}
	data, err := os.ReadFile(filepath.Join(appDataDir(), "desktop-config.json"))
	if err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	if value := os.Getenv("MEMORYLANE_PORT"); value != "" {
		if port, err := strconv.Atoi(value); err == nil {
			cfg.Port = port
		}
	}
	return cfg
}

func saveConfig(cfg config) error {
	path := filepath.Join(appDataDir(), "desktop-config.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func appDataDir() string {
	if override := os.Getenv("MEMORYLANE_TRAY_DATA_DIR"); override != "" {
		return override
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "MemoryLane")
}

func resolveRuntimeDir() (string, error) {
	if override := os.Getenv("MEMORYLANE_RUNTIME_DIR"); override != "" {
		return filepath.Abs(override)
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	workingDir, _ := os.Getwd()
	candidates := []string{
		filepath.Join(workingDir, "tray-go", "runtime"),
		filepath.Join(workingDir, "runtime"),
		filepath.Join(filepath.Dir(executable), "runtime"),
		filepath.Join(filepath.Dir(executable), "..", "runtime"),
		filepath.Join(filepath.Dir(executable), "resources", "runtime"),
		filepath.Join(filepath.Dir(executable), "..", "Resources", "runtime"),
	}
	for _, candidate := range candidates {
		if _, err = os.Stat(filepath.Join(candidate, "dist", "server.js")); err == nil {
			return filepath.Clean(candidate), nil
		}
	}
	return "", errors.New("MemoryLane runtime not found; set MEMORYLANE_RUNTIME_DIR")
}

func bundledPluginsDir(runtimeDir string) string {
	if explicit := os.Getenv("MEMORYLANE_BUNDLED_PLUGIN_REPOSITORY"); explicit != "" {
		return explicit
	}
	candidates := []string{filepath.Join(filepath.Dir(runtimeDir), "bundled-plugins"), filepath.Join(runtimeDir, "..", "bundled-plugins")}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return filepath.Clean(candidate)
		}
	}
	return ""
}

func writeReadyMarker() {
	if marker := os.Getenv("MEMORYLANE_TRAY_READY_FILE"); marker != "" {
		_ = os.WriteFile(marker, []byte(strconv.FormatInt(time.Now().UnixMilli(), 10)), 0600)
	}
}

func nodeBinaryName() string { return platformNodeBinaryName() }

func validLocalURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "http" && u.Hostname() == "127.0.0.1"
}

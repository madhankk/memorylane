//go:build darwin

package main

import (
	_ "embed"
	"fmt"
	"html"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

//go:embed assets/trayTemplate.png
var trayIcon []byte

var instanceFile *os.File

func platformNodeBinaryName() string      { return "node-runtime" }
func configureChildProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func terminateProcessTree(cmd *exec.Cmd) error {
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
}
func openBrowser(raw string) error {
	if !validLocalURL(raw) {
		return fmt.Errorf("refusing non-local URL")
	}
	return exec.Command("open", raw).Start()
}
func launchAgentPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.memorylane.desktop.plist")
}
func launchAtLoginEnabled() bool { _, err := os.Stat(launchAgentPath()); return err == nil }
func setLaunchAtLogin(enabled bool) error {
	path := launchAgentPath()
	if !enabled {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	plist := `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.memorylane.desktop</string><key>ProgramArguments</key><array><string>` + html.EscapeString(executable) + `</string></array><key>RunAtLoad</key><true/></dict></plist>`
	return os.WriteFile(path, []byte(plist), 0600)
}
func launchInstaller(path string) error { return exec.Command("open", path).Start() }
func acquireSingleInstance() error {
	path := filepath.Join(appDataDir(), "tray.lock")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = f.Close()
		return fmt.Errorf("MemoryLane tray is already running")
	}
	instanceFile = f
	_ = f.Truncate(0)
	_, _ = fmt.Fprint(f, os.Getpid())
	return nil
}
func releaseSingleInstance() {
	if instanceFile != nil {
		path := instanceFile.Name()
		_ = syscall.Flock(int(instanceFile.Fd()), syscall.LOCK_UN)
		_ = instanceFile.Close()
		_ = os.Remove(path)
	}
}

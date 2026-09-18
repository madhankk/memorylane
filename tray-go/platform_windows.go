//go:build windows

package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

//go:embed assets/icon-32.png
var trayIcon []byte

var instanceMutex windows.Handle

func platformNodeBinaryName() string { return "node-runtime.exe" }

func configureChildProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }

func terminateProcessTree(cmd *exec.Cmd) error {
	kill := exec.Command("taskkill", "/PID", fmt.Sprint(cmd.Process.Pid), "/T", "/F")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := kill.Run(); err == nil {
		return nil
	}
	return cmd.Process.Kill()
}

func openBrowser(raw string) error {
	if !validLocalURL(raw) {
		return fmt.Errorf("refusing non-local URL")
	}
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", raw).Start()
}

func launchAtLoginEnabled() bool {
	cmd := exec.Command("reg", "query", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "MemoryLane")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run() == nil
}

func setLaunchAtLogin(enabled bool) error {
	cmd := exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "MemoryLane", "/f")
	if enabled {
		executable, err := os.Executable()
		if err != nil {
			return err
		}
		cmd = exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "MemoryLane", "/t", "REG_SZ", "/d", `"`+executable+`"`, "/f")
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

func launchInstaller(path string) error {
	cmd := exec.Command(path, "/SILENT", "/CLOSEAPPLICATIONS")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func acquireSingleInstance() error {
	name, err := windows.UTF16PtrFromString("Local\\MemoryLaneTray")
	if err != nil {
		return err
	}
	// golang.org/x/sys/windows's CreateMutex wrapper sets err whenever the
	// named mutex already existed, even though that's a successful "attached
	// to an existing mutex" outcome, not a failure - the real failure signal
	// is a zero handle. Checking err != nil here (as this used to) meant the
	// friendly "already running" message below could never be reached; any
	// second launch attempt crashed instead with the raw, unhelpful Windows
	// error text for ERROR_ALREADY_EXISTS ("Cannot create a file when that
	// file already exists").
	instanceMutex, err = windows.CreateMutex(nil, false, name)
	if instanceMutex == 0 {
		return err
	}
	if windows.GetLastError() == windows.ERROR_ALREADY_EXISTS {
		_ = windows.CloseHandle(instanceMutex)
		instanceMutex = 0
		return fmt.Errorf("MemoryLane tray is already running")
	}
	return nil
}

func releaseSingleInstance() {
	if instanceMutex != 0 {
		_ = windows.CloseHandle(instanceMutex)
		instanceMutex = 0
	}
}

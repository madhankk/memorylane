// One command for the whole Windows release: builds core, prepares and
// (optionally) signs AI Runtime's native binary, builds and verifies the
// win32-x64 plugin catalog, then builds MemoryLane-Setup.exe (the
// `desktop:installer` script already stages the app and zips it as part of
// producing the installer, so there's no separate "package" step to run
// here - see README.md's "Building for production").
//
// Signing is entirely env-driven, same as every other script in this
// pipeline: set SIGN_RELEASE=1 (and the Azure Trusted Signing credentials
// tray-go/scripts/sign-app-windows.ps1 needs) before running this for a
// signed installer and a signed plugin catalog; leave it unset for a plain
// local/unsigned build. Nothing here decides that on its own.
import { execFileSync } from "node:child_process";
import path from "node:path";

if (process.platform !== "win32") throw new Error("build-windows-install.mjs only runs on Windows (produces MemoryLane-Setup.exe via Inno Setup and the Windows tray build)");

const root = path.resolve(import.meta.dirname, "..");
const sign = process.env.SIGN_RELEASE === "1";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit", shell: true });
}

console.log(sign ? "SIGN_RELEASE=1 - building a signed installer and a signed plugin catalog." : "SIGN_RELEASE not set - building a plain, unsigned local installer.");

run("npm", ["install"]);
run("npm", ["run", "build"]);

// Apple Photos needs macOS to build at all (prepare-apple-photos-plugin.mjs
// no-ops there) and isn't part of a Windows release, so it's not run here.
run("npm", ["run", "plugins:prepare-ai-runtime"]);
if (sign) run("npm", ["run", "plugins:sign-native"]);
run("npm", ["run", "plugins:build", "--", "stable", "--platforms", "win32-x64"]);
run("npm", ["run", "plugins:verify", "--", "dist/plugin-repository/v1/stable/win32-x64"]);

// Stages the app, builds MemoryLane.exe, signs everything under
// SIGN_RELEASE=1 (package-windows.ps1 already checks that env var itself -
// nothing extra to pass through here), zips it, and runs Inno Setup to
// produce MemoryLane-Setup.exe.
run("npm", ["run", "desktop:installer"]);

console.log("\nDone: tray-go/release/<version>/MemoryLane-Setup.exe");

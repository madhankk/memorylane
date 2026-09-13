import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import packageJson from "./package.json";

// Reuses the same Windows (Azure Trusted Signing) and macOS (Developer ID +
// notarization) signing setup as anydb-desktop - see
// scripts/sign-app-windows.ps1, scripts/sign-installer-windows.ps1, and the
// macOS hooks below. Signing only runs when SIGN_RELEASE=1 is set, so a
// plain `npm run package`/`make` during dev never touches the signing
// infrastructure.
const isMacRelease = process.platform === "darwin" && process.env.SIGN_RELEASE === "1";
const macSigningIdentity =
  process.env.MACOS_SIGNING_IDENTITY ?? "Developer ID Application: Humanly Incorporated (RNTVBNC62M)";
const macEntitlements = path.resolve(__dirname, "config/mac-entitlements.plist");
const macNotaryProfile = process.env.APPLE_NOTARY_KEYCHAIN_PROFILE;
if (isMacRelease && !macNotaryProfile) {
  throw new Error("APPLE_NOTARY_KEYCHAIN_PROFILE is required for a notarized macOS release");
}

const config: ForgeConfig = {
  outDir: `release/${packageJson.version}`,
  packagerConfig: {
    asar: true,
    appBundleId: "com.memorylane.desktop",
    // Platform icons are rebuilt by scripts/gen-icons.mjs.
    icon: "assets/icon",
    ...(isMacRelease
      ? {
          osxSign: {
            identity: macSigningIdentity,
            optionsForFile: (filePath: string) => ({
              hardenedRuntime: true,
              ...(path.basename(filePath) === `${packageJson.productName}.app` ? { entitlements: macEntitlements } : {}),
            }),
          },
        }
      : {}),
    executableName: "memorylane-desktop",
    win32metadata: {
      CompanyName: "MemoryLane",
      FileDescription: "MemoryLane Desktop",
      ProductName: "MemoryLane",
      InternalName: "MemoryLane",
      OriginalFilename: "memorylane-desktop.exe",
    },
    // The tray app's JavaScript dependencies are bundled into dist/ by
    // scripts/build.mjs. The actual server and its native modules
    // (better-sqlite3, sharp) live entirely in runtime/, added here as an
    // extraResource rather than bundled into the asar. See
    // scripts/prepare-runtime.mjs and server-manager.ts's resolveRuntimeDir().
    extraResource: ["runtime"],
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (forgeConfig, options) => {
      if (process.platform === "win32") {
        if (process.env.SIGN_RELEASE !== "1") return;

        const outputPath = options.outputPaths[0];
        if (!outputPath) throw new Error("Forge did not provide a packaged application output path");

        // Both need signing, not just the app exe: node-runtime.exe (added
        // via packagerConfig.extraResource, so it lands under
        // resources/runtime/ rather than next to the app exe) is spawned
        // directly as its own process by server-manager.ts, not loaded as a
        // library by the already-signed app - Windows SmartScreen evaluates
        // it completely independently on execution. It's also literally a
        // renamed copy of the official Node.js binary, which unsigned reads
        // as exactly the kind of thing AV reputation heuristics flag.
        const signTargets = [
          path.join(outputPath, "memorylane-desktop.exe"),
          path.join(outputPath, "resources", "runtime", "node-runtime.exe"),
        ];
        for (const target of signTargets) {
          if (!existsSync(target)) throw new Error(`Expected to sign ${target}, but it doesn't exist`);
          execFileSync(
            "powershell.exe",
            ["-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "scripts/sign-app-windows.ps1"), target],
            { stdio: "inherit" },
          );
        }
        return;
      }

      if (options.platform !== "darwin") return;
      // TODO before a real macOS release: the automatic osxSign pass above
      // signs the .app bundle's own code, but runtime/ (added via
      // extraResource) sits under Resources/ as opaque extra files, not code
      // osxSign recursively signs - node-runtime.exe and the native .node/
      // dylib files inside runtime/node_modules (better-sqlite3, sharp) need
      // their own explicit `codesign` pass here before notarization will
      // pass. Deferred until the Windows build is solid and a Mac is
      // actually available to test against - see the desktop-packaging
      // investigation for the full signing requirements.
      for (const outputPath of options.outputPaths) {
        const appPath = outputPath.endsWith(".app") ? outputPath : path.join(outputPath, `${packageJson.productName}.app`);
        if (!existsSync(appPath)) continue;
        try {
          execFileSync("codesign", ["--verify", "--deep", "--strict", appPath]);
        } catch (error) {
          if (forgeConfig.packagerConfig.osxSign) throw error;
          // Forge's fuse step can invalidate Electron's original ad-hoc
          // signature. Repair unsigned local builds so macOS Keychain and
          // Launch Services see one stable application identity. A valid
          // Developer ID signature is verified above and left untouched.
          execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath]);
        }
      }
    },
    postMake: async (_forgeConfig, makeResults) => {
      if (process.env.SIGN_RELEASE !== "1") return;

      if (process.platform === "win32") {
        for (const result of makeResults) {
          for (const artifact of result.artifacts) {
            if (!artifact.endsWith(".exe")) continue;
            execFileSync(
              "powershell.exe",
              ["-ExecutionPolicy", "Bypass", "-File", path.resolve(__dirname, "scripts/sign-installer-windows.ps1"), artifact],
              { stdio: "inherit" },
            );
          }
        }
        return;
      }

      if (process.platform !== "darwin") return;
      for (const result of makeResults) {
        for (const artifact of result.artifacts) {
          if (!artifact.endsWith(".dmg")) continue;
          execFileSync("codesign", ["--force", "--sign", macSigningIdentity, "--timestamp", artifact], { stdio: "inherit" });
          execFileSync("xcrun", ["notarytool", "submit", artifact, "--keychain-profile", macNotaryProfile!, "--wait"], {
            stdio: "inherit",
          });
          execFileSync("xcrun", ["stapler", "staple", "-v", artifact], { stdio: "inherit" });
          execFileSync("xcrun", ["stapler", "validate", "-v", artifact], { stdio: "inherit" });
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({ name: "memorylane_desktop", setupExe: "MemoryLane-Setup.exe", setupIcon: "assets/icon.ico" }),
    new MakerDMG((arch) => ({ name: `MemoryLane-${arch}`, format: "ULFO" })),
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;

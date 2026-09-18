import type { PluginPlatformDto } from "@memorylane/shared";

// "ready" only applies to service-kind plugins (spawned as a supervised
// child process - see server/src/plugin-platform/service-supervisor.ts). A
// module-kind plugin (e.g. ai-search, people) is loaded in-process and can
// never satisfy that check, so its enabled/healthy steady state is
// "installed" instead. Checking only for "ready" leaves module-kind plugins
// looking permanently un-enabled even once they're fully on - use this
// everywhere the UI needs to know "is this plugin actually active right now".
export function isPluginActive(item: Pick<PluginPlatformDto, "state">): boolean {
  return item.state === "ready" || item.state === "installed";
}

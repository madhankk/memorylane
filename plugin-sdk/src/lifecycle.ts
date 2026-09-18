export const PLUGIN_LIFECYCLE_STATES = [
  "available",
  "downloading",
  "installed",
  "starting",
  "ready",
  "failed",
  "update-available",
  "disabled",
  "incompatible",
] as const;

export type PluginLifecycleState = (typeof PLUGIN_LIFECYCLE_STATES)[number];

export interface PluginInventoryItem {
  id: string;
  name: string;
  version: string | null;
  state: PluginLifecycleState;
  required: boolean;
  capabilities: string[];
  error: string | null;
}

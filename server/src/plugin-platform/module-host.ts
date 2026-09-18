import { pathToFileURL } from "node:url";

interface PluginModule {
  activate?: (context: { pluginId: string; dataDir: string }) => Promise<PluginModuleInstance> | PluginModuleInstance;
}

interface PluginModuleInstance {
  call?: (method: string, payload: unknown) => Promise<unknown> | unknown;
  stop?: () => Promise<void> | void;
}

const loaded = new Map<string, PluginModuleInstance>();

process.on("message", async (message: unknown) => {
  const request = message as { requestId: number; type: string; pluginId?: string; entry?: string; dataDir?: string; method?: string; payload?: unknown };
  const respond = (response: object) => process.send?.({ requestId: request.requestId, ...response });
  try {
    if (request.type === "load" && request.pluginId && request.entry && request.dataDir) {
      const plugin = await import(pathToFileURL(request.entry).href) as PluginModule;
      const instance = await plugin.activate?.({ pluginId: request.pluginId, dataDir: request.dataDir }) ?? {};
      loaded.set(request.pluginId, instance);
      return respond({ ok: true });
    }
    if (request.type === "call" && request.pluginId && request.method) {
      const instance = loaded.get(request.pluginId);
      if (!instance?.call) throw new Error("Plugin does not expose a call handler");
      return respond({ ok: true, result: await instance.call(request.method, request.payload) });
    }
    if (request.type === "unload" && request.pluginId) {
      await loaded.get(request.pluginId)?.stop?.();
      loaded.delete(request.pluginId);
      return respond({ ok: true });
    }
    if (request.type === "shutdown") {
      for (const instance of loaded.values()) await instance.stop?.();
      respond({ ok: true });
      return process.disconnect?.();
    }
    throw new Error("Unknown module-host request");
  } catch (error) {
    respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

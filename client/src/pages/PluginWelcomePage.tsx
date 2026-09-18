import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PluginPlatformDto } from "@memorylane/shared";
import { api } from "../api/client";

export default function PluginWelcomePage() {
  const navigate=useNavigate(),[plugins,setPlugins]=useState<PluginPlatformDto[]>([]),[selected,setSelected]=useState<Set<string>>(new Set()),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[storage,setStorage]=useState<string>("");
  const load=async()=>{const data=await api.pluginPlatform.onboarding();setPlugins(data.plugins);setSelected(new Set(data.plugins.filter(p=>p.required).map(p=>p.id)));if(data.complete)navigate("/",{replace:true});};
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Could not load plugins"));void navigator.storage?.estimate?.().then(s=>setStorage(s.quota?`${Math.round((s.quota-(s.usage??0))/1024/1024/1024)} GB available`:""));},[]);
  const optional=useMemo(()=>plugins.filter(p=>!p.required),[plugins]);
  const install=async()=>{setBusy(true);setError(null);try{for(const plugin of plugins){if(!selected.has(plugin.id)||!plugin.version)continue;if(plugin.state==="available")await api.pluginPlatform.install(plugin.id,plugin.version);if(plugin.state!=="ready")await api.pluginPlatform.setEnabled(plugin.id,true,plugin.version);await load();}await api.pluginPlatform.completeOnboarding();navigate("/",{replace:true});}catch(e){setError(e instanceof Error?e.message:"Plugin installation failed");}finally{setBusy(false);}};
  return <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-6 py-12 text-ink"><div><p className="text-sm text-muted">MemoryLane setup</p><h1 className="text-3xl font-semibold">Install components</h1><p className="mt-2 text-muted">Required media tools restore metadata, RAW, and video support. Optional features can be installed later in Settings.</p>{storage&&<p className="mt-1 text-xs text-muted">Browser storage estimate: {storage}</p>}</div>
    {error&&<p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-red-500">{error}</p>}
    <div className="space-y-3">{plugins.map(p=><label key={p.id} className="flex items-start gap-3 rounded-xl border border-border p-4"><input type="checkbox" className="mt-1" checked={p.required||selected.has(p.id)} disabled={p.required||busy} onChange={e=>setSelected(old=>{const n=new Set(old);e.target.checked?n.add(p.id):n.delete(p.id);return n;})}/><span className="flex-1"><span className="font-medium">{p.name}</span><span className="ml-2 text-xs text-muted">{p.required?"Required":"Optional"} · {p.state}</span><span className="mt-1 block text-sm text-muted">{p.capabilities.join(", ")||"Feature component"}</span><span className="mt-1 block text-xs text-muted">Includes first-party software and bundled dependency license notices.</span>{p.error&&<span className="block text-xs text-red-500">{p.error}</span>}</span></label>)}</div>
    {optional.length===0&&<p className="text-sm text-muted">Optional plugins will appear when a catalog for this platform is available.</p>}
    <button type="button" disabled={busy||plugins.some(p=>p.required&&!p.version)} onClick={()=>void install()} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy?"Installing and checking…":"Continue"}</button>
  </main>;
}

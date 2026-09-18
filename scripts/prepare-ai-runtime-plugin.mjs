import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root=path.resolve(import.meta.dirname,".."), ai=path.join(root,"memorylane-ai"), plugin=path.join(root,"plugins","optional","com.memorylane.ai-runtime"), bin=path.join(plugin,"bin");
const python=path.join(ai,".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
if(!fs.existsSync(python)) execFileSync(process.env.PYTHON??(process.platform==="win32"?"python":"python3"),["-m","venv",path.join(ai,".venv")],{stdio:"inherit"});
try { execFileSync(python,["-c","import PyInstaller, memorylane_ai"],{stdio:"ignore"}); }
catch { execFileSync(python,["-m","pip","install","--quiet","-e",ai,"pyinstaller"],{stdio:"inherit"}); }
const work=path.join(root,"dist","ai-runtime-build"); fs.rmSync(work,{recursive:true,force:true}); fs.rmSync(bin,{recursive:true,force:true}); fs.mkdirSync(bin,{recursive:true});
execFileSync(python,["-m","PyInstaller","--noconfirm","--clean","--onefile","--name","memorylane-ai","--paths",ai,"--collect-all","onnxruntime","--collect-all","tokenizers","--collect-all","huggingface_hub","--distpath",bin,"--workpath",path.join(work,"work"),"--specpath",path.join(work,"spec"),path.join(ai,"pyinstaller_entry.py")],{cwd:ai,stdio:"inherit"});
const target=path.join(bin,process.platform==="win32"?"memorylane-ai.exe":"memorylane-ai"); if(process.platform!=="win32") fs.chmodSync(target,0o755);
console.log(`Prepared AI Runtime plugin: ${(fs.statSync(target).size/1024/1024).toFixed(1)} MiB`);

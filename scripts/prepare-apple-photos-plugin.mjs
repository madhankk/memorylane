import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
if(process.platform!=="darwin"){console.log("Apple Photos plugin is macOS-only; skipping on this host.");process.exit(0);}
const root=path.resolve(import.meta.dirname,".."), plugin=path.join(root,"plugins","optional","com.memorylane.apple-photos"), source=path.join(plugin,"python"), bin=path.join(plugin,"bin"), venv=path.join(root,"dist","apple-photos-venv"), python=path.join(venv,"bin","python");
if(!fs.existsSync(python))execFileSync("python3",["-m","venv",venv],{stdio:"inherit"});
execFileSync(python,["-m","pip","install","--quiet","-r",path.join(source,"requirements.txt"),"pyinstaller"],{stdio:"inherit"});
fs.rmSync(bin,{recursive:true,force:true});fs.mkdirSync(bin,{recursive:true});
execFileSync(python,["-m","PyInstaller","--noconfirm","--clean","--onefile","--name","memorylane-apple-photos","--paths",source,"--collect-all","osxphotos","--distpath",bin,"--workpath",path.join(root,"dist","apple-photos-build"),"--specpath",path.join(root,"dist","apple-photos-build"),path.join(plugin,"src","entry.py")],{stdio:"inherit"});
fs.chmodSync(path.join(bin,"memorylane-apple-photos"),0o755);

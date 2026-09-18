import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
const run = promisify(execFile), port=Number(process.env.MEMORYLANE_PLUGIN_PORT), token=process.env.MEMORYLANE_PLUGIN_TOKEN;
const pluginId=process.env.MEMORYLANE_PLUGIN_ID, version=process.env.MEMORYLANE_PLUGIN_VERSION, pluginApi=Number(process.env.MEMORYLANE_PLUGIN_API);
const server=http.createServer(async(req,res)=>{ if(req.headers.authorization!==`Bearer ${token}`) return send(res,401,{error:"unauthorized"});
  if(req.url==="/health") return send(res,200,{status:"ready",pluginId,version,pluginApi});
  if(req.url==="/shutdown"&&req.method==="POST"){send(res,200,{ok:true});return server.close(()=>process.exit(0));}
  try { const b=await readJson(req);
    if(req.url==="/probe"){ const {stdout}=await run(ffprobeStatic.path,["-v","error","-show_entries","stream=codec_type,codec_name,width,height:format=duration","-of","json",b.sourcePath]); const p=JSON.parse(stdout),v=p.streams?.find(s=>s.codec_type==="video"),a=p.streams?.find(s=>s.codec_type==="audio"),d=p.format?.duration?Number(p.format.duration):null; return send(res,200,{durationSeconds:Number.isFinite(d)?d:null,width:v?.width??null,height:v?.height??null,codec:v?.codec_name??null,audioCodec:a?.codec_name??null}); }
    if(req.url==="/poster"){ let out; try { ({stdout:out}=await run(ffmpegPath,["-ss","0.5","-i",b.sourcePath,"-frames:v","1","-f","image2pipe","-vcodec","mjpeg","-"],{encoding:"buffer",maxBuffer:67108864})); } catch { ({stdout:out}=await run(ffmpegPath,["-i",b.sourcePath,"-frames:v","1","-f","image2pipe","-vcodec","mjpeg","-"],{encoding:"buffer",maxBuffer:67108864})); } return send(res,200,{data:out?.length?out.toString("base64"):null}); }
    if(req.url==="/transcode"){ const q=b.quality==="high"?{preset:"veryslow",crf:"17",audio:"192k"}:{preset:"medium",crf:"23",audio:"128k"}; await run(ffmpegPath,["-y","-i",b.sourcePath,"-c:v","libx264","-preset",q.preset,"-crf",q.crf,"-pix_fmt","yuv420p","-c:a","aac","-b:a",q.audio,"-movflags","+faststart","-loglevel","error",b.destinationPath],{maxBuffer:16777216}); return send(res,200,{ok:true}); }
    return send(res,404,{error:"not found"});
  } catch(e){return send(res,500,{error:e instanceof Error?e.message:String(e)});} }); server.listen(port,"127.0.0.1");
function send(res,status,value){const data=JSON.stringify(value);res.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(data)});res.end(data);} function readJson(req){return new Promise((resolve,reject)=>{const c=[];let n=0;req.on("data",x=>{n+=x.length;if(n>16384)reject(new Error("request too large"));else c.push(x)});req.on("end",()=>{try{resolve(JSON.parse(Buffer.concat(c).toString("utf8")))}catch(e){reject(e)}});req.on("error",reject)})}

import http from "node:http";
import { ExifTool } from "exiftool-vendored";

const port = Number(process.env.MEMORYLANE_PLUGIN_PORT);
const token = process.env.MEMORYLANE_PLUGIN_TOKEN;
const pluginId = process.env.MEMORYLANE_PLUGIN_ID;
const version = process.env.MEMORYLANE_PLUGIN_VERSION;
const pluginApi = Number(process.env.MEMORYLANE_PLUGIN_API);
const exiftool = new ExifTool({ maxProcs: 2 });
let toolVersion = "unknown";
try { toolVersion = await exiftool.version(); } catch {}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "unauthorized" });
  if (req.url === "/health") return send(res, 200, { status: "ready", pluginId, version, pluginApi, toolVersion });
  if (req.url === "/shutdown" && req.method === "POST") {
    send(res, 200, { ok: true }); await exiftool.end(); return server.close(() => process.exit(0));
  }
  try {
    const body = await readJson(req);
    if (req.url === "/metadata" && req.method === "POST") {
      const tags = await exiftool.read(body.sourcePath);
      const problem = typeof tags?.Error === "string" ? tags.Error : Array.isArray(tags?.errors) && tags.errors.length ? String(tags.errors[0]) : null;
      if (problem) throw new Error(problem);
      return send(res, 200, { tags, toolVersion });
    }
    if (req.url === "/raw-preview" && req.method === "POST") {
      for (const tag of ["JpgFromRaw2", "JpgFromRaw", "PreviewImage", "OtherImage", "ThumbnailImage"]) {
        try { const data = await exiftool.extractBinaryTagToBuffer(tag, body.sourcePath); if (data?.length) return send(res, 200, { data: data.toString("base64") }); } catch {}
      }
      return send(res, 200, { data: null });
    }
    return send(res, 404, { error: "not found" });
  } catch (error) { return send(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1");

function send(res, status, value) { const data = JSON.stringify(value); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) }); res.end(data); }
function readJson(req) { return new Promise((resolve, reject) => { const chunks=[]; let n=0; req.on("data", c => { n += c.length; if (n > 8192) reject(new Error("request too large")); else chunks.push(c); }); req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch(e) { reject(e); } }); req.on("error", reject); }); }

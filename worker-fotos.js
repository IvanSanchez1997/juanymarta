/* ══════════════════════════════════════════════════════════════
   WORKER Cloudflare — boda-fotos-jm · api-fotos-jm.binvita.es

   CÓMO DESPLEGAR (por la persona con acceso a la cuenta):
   Cloudflare → Workers & Pages → «boda-fotos-jm» → Edit code →
   reemplazar TODO el código por este fichero → Deploy.

   No tocar el binding FOTOS (variable del Worker → bucket R2).

   Cambios respecto a la versión anterior:
   · Fotos: ídem (máx. 8 MB, jpeg/webp/png, nombres <id>_f.jpg/<id>_t.jpg).
   · Vídeos: nuevos (máx. 95 MB, mp4/mov/webm/3gp/m4v, nombres <id>_v.<ext>).
     El límite de cuerpo de petición de Cloudflare en Free es 100 MB,
     por eso el tope de vídeo es 95 MB.
   · La miniatura del vídeo (<id>_t.jpg) la genera el navegador y se
     sube como una foto normal.

   NOTAS operativas:
   · Sin autenticación (por diseño: la web es pública).
   · La bucket pública no lista la raíz: el listado va por /list.
   ══════════════════════════════════════════════════════════════ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-file-name",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    try {
      if (request.method === "POST" && url.pathname === "/upload") return await upload(request, env, cors);
      if (request.method === "POST" && url.pathname === "/log") return await logError(request, env, cors);
      if (request.method === "GET" && url.pathname === "/list") return await list(env, cors);
      return new Response("Not found", { status: 404, headers: cors });
    } catch (e) {
      return new Response("Error: " + e.message, { status: 500, headers: cors });
    }
  },
};

async function logError(request, env, cors) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.startsWith("text/plain"))
    return new Response("Tipo no permitido", { status: 415, headers: cors });
  const body = await request.text();
  if (!body || body.length > 2048)
    return new Response("Registro demasiado largo", { status: 413, headers: cors });
  let data;
  try { data = JSON.parse(body); } catch (e) {
    return new Response("Registro no valido", { status: 400, headers: cors });
  }
  if (!data || typeof data.e !== "string" || typeof data.d !== "string")
    return new Response("Registro no valido", { status: 400, headers: cors });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const key = "logs/" + ts + "_" + Math.random().toString(36).slice(2, 7) + ".json";
  await env.FOTOS.put(key, JSON.stringify(data), { contentType: "application/json" });
  return new Response(JSON.stringify({ key }), {
    headers: { ...cors, "content-type": "application/json" },
  });
}

const TIPOS_FOTO = ["image/jpeg", "image/webp", "image/png"];
const TIPOS_VIDEO = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-m4v"];
const MAX_FOTO = 8 * 1024 * 1024;
const MAX_VIDEO = 95 * 1024 * 1024;

async function upload(request, env, cors) {
  const ct = (request.headers.get("content-type") || "").toLowerCase().split(";")[0].trim();
  const name = (request.headers.get("x-file-name") || "").replace(/[^a-zA-Z0-9._-]/g, "");
  /* Fotos:  <id>_f.jpg (grande, 1600px) y <id>_t.jpg (miniatura 480px).
     Vídeos: <id>_v.<ext> (original) y <id>_t.jpg (miniatura que genera
     el navegador y se sube como una foto normal). */
  const esFoto = /^[a-zA-Z0-9._-]+_(f|t)\.jpg$/.test(name);
  const esVideo = /^[a-zA-Z0-9._-]+_v\.(mp4|mov|webm|3gp|m4v)$/.test(name);
  if (!esFoto && !esVideo)
    return new Response("Nombre no valido", { status: 400, headers: cors });
  if (esVideo && !TIPOS_VIDEO.includes(ct))
    return new Response("Tipo no permitido", { status: 415, headers: cors });
  if (esFoto && !TIPOS_FOTO.includes(ct))
    return new Response("Tipo no permitido", { status: 415, headers: cors });
  const body = await request.arrayBuffer();
  if (!body.byteLength) return new Response("Archivo vacio", { status: 400, headers: cors });
  const max = esVideo ? MAX_VIDEO : MAX_FOTO;
  if (body.byteLength > max)
    return new Response("Archivo demasiado grande", { status: 413, headers: cors });
  const key = "fotos/" + name;
  await env.FOTOS.put(key, body, { contentType: ct });
  return new Response(JSON.stringify({ key }), {
    headers: { ...cors, "content-type": "application/json" },
  });
}

async function list(env, cors) {
  let items = [], cursor;
  do {
    const res = await env.FOTOS.list({ prefix: "fotos/", limit: 1000, cursor });
    items = items.concat(res.objects.map(o => ({
      key: o.key, size: o.size, uploaded: o.uploaded.toISOString(),
    })));
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  items.sort((a, b) => b.key.localeCompare(a.key));
  return new Response(JSON.stringify(items), {
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-cache" },
  });
}
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || "0.0.0.0";
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function buildPrompt(profile) {
  return [
    "Voce e um personal trainer brasileiro senior, cuidadoso, comercialmente claro e conservador com seguranca.",
    "Crie um plano autonomo vendavel para consultoria online.",
    "Nao faca diagnostico medico. Quando houver risco, recomende liberacao profissional antes de progredir.",
    "Responda apenas JSON valido, sem markdown, com as chaves: title, summary, weekly, rules, nutrition, metric, safety, message.",
    "weekly deve ser array de strings com os dias de treino.",
    "rules deve ser array de regras automaticas de progressao/regressao.",
    "safety deve ser array de alertas e adaptacoes.",
    "message deve ser uma mensagem curta para WhatsApp ao aluno.",
    "",
    `Perfil: ${JSON.stringify(profile)}`
  ].join("\n");
}

async function generateWithOpenAI(profile) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: buildPrompt(profile),
      temperature: 0.5
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Falha ao gerar plano com IA.");
  }

  const text = data.output_text || data.output?.flatMap((item) => item.content || []).map((content) => content.text || "").join("") || "";
  return JSON.parse(text);
}

async function routeApi(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Metodo nao permitido." });
    return;
  }

  try {
    const profile = JSON.parse(await readBody(req));
    const plan = await generateWithOpenAI(profile);
    if (!plan) {
      sendJson(res, 200, { mode: "demo", plan: null });
      return;
    }
    sendJson(res, 200, { mode: "openai", model, plan });
  } catch (error) {
    const status = error.message.toLowerCase().includes("quota") ? 402 : 500;
    sendJson(res, status, { error: error.message });
  }
}

async function routeStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/api/plan") {
    routeApi(req, res);
    return;
  }
  routeStatic(req, res);
});

server.listen(port, host, () => {
  const localUrl = host === "0.0.0.0" ? `http://127.0.0.1:${port}` : `http://${host}:${port}`;
  console.log(`AtlasFit AI rodando em ${localUrl}`);
  console.log(process.env.OPENAI_API_KEY ? `IA real ativa com modelo ${model}` : "Sem OPENAI_API_KEY: usando demo local no navegador.");
});

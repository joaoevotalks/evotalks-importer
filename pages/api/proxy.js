// pages/api/proxy.js
// Proxy seguro que repassa requisições para o Evotalks, resolvendo o CORS

export default async function handler(req, res) {
  // Libera CORS para o frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { target, payload } = req.body;

  if (!target) {
    return res.status(400).json({ error: "Campo 'target' ausente no body" });
  }

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      return res.status(502).json({
        error: `Servidor Evotalks retornou resposta inválida (${response.status}): ${text.slice(0, 200)}`,
      });
    }

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: `Erro ao conectar no Evotalks: ${err.message}`,
    });
  }
}

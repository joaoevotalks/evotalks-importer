export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido" });
  const { type, target, payload, aiPrompt } = req.body;
  if (type === "ai") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: aiPrompt }] }),
    });
    return res.status(r.status).json(await r.json());
  }
  if (type === "evotalks") {
    try {
      const normalizedTarget = /^https?:\/\//i.test(target) ? target : `https://${target}`;
      const r = await fetch(normalizedTarget, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) { const t = await r.text(); return res.status(502).json({ error: `Resposta inválida (${r.status}): ${t.slice(0,200)}` }); }
      return res.status(r.status).json(await r.json());
    } catch (err) { return res.status(502).json({ error: `Erro: ${err.message}` }); }
  }
  return res.status(400).json({ error: "Tipo inválido" });
}

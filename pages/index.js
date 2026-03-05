import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import Head from "next/head";

// ─── API Fields ───────────────────────────────────────────────────────────────
const API_FIELDS = [
  { key:"id",              label:"ID do Contato",         req_edit:true,  type:"number", desc:"Identificador único do contato no sistema" },
  { key:"name",            label:"Nome",                  req_add:true,   type:"string", desc:"Nome completo do contato" },
  { key:"number",          label:"Número (WhatsApp)",     req_add:true,   type:"string", desc:"Número com DDI, ex: 5549999999999" },
  { key:"document",        label:"Documento",             type:"string",  desc:"CPF ou CNPJ" },
  { key:"email",           label:"E-mail",                type:"string",  desc:"Endereço de e-mail" },
  { key:"facebook",        label:"Facebook",              type:"string",  desc:"Perfil do Facebook" },
  { key:"instagram",       label:"Instagram",             type:"string",  desc:"Perfil do Instagram" },
  { key:"address",         label:"Endereço",              type:"string",  desc:"Rua/Logradouro" },
  { key:"houseNumber",     label:"Número da Casa",        type:"string",  desc:"Número do imóvel" },
  { key:"addressComp",     label:"Complemento",           type:"string",  desc:"Apto, bloco, etc." },
  { key:"neighborhood",    label:"Bairro",                type:"string",  desc:"Bairro" },
  { key:"city",            label:"Cidade",                type:"string",  desc:"Cidade" },
  { key:"state",           label:"Estado",                type:"string",  desc:"Estado/UF" },
  { key:"country",         label:"País",                  type:"string",  desc:"País" },
  { key:"postalCode",      label:"CEP",                   type:"string",  desc:"Código postal" },
  { key:"free1",           label:"Campo Livre 1",         type:"string",  desc:"Campo customizável 1" },
  { key:"free2",           label:"Campo Livre 2",         type:"string",  desc:"Campo customizável 2" },
  { key:"tags",            label:"Tags",                  type:"array",   desc:"IDs de tags, ex: [1,2,3]" },
  { key:"groups",          label:"Grupos",                type:"array",   desc:"IDs de grupos, ex: [30]" },
  { key:"donotdisturb",    label:"Não Perturbe",          type:"number",  desc:"0 = normal, 1 = não perturbe" },
  { key:"preferredAgents", label:"Agentes Preferenciais", type:"array",   desc:"IDs dos agentes" },
];
const ALL_KEYS = API_FIELDS.map(f => f.key);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseArrayField(val) {
  if (val === undefined || val === null || val === "") return undefined;
  const str = String(val).trim();
  const m = str.match(/\[([^\]]*)\]/);
  const src = m ? m[1] : str;
  const parts = src.split(",").map(s => s.trim()).filter(s => s !== "" && !isNaN(Number(s))).map(s => Number(s));
  return parts.length > 0 ? parts : undefined;
}

function rowToPayload(row, mapping, config) {
  const payload = { queueId: Number(config.queueId) || 0, apiKey: config.apiKey };
  for (const f of API_FIELDS) {
    const col = mapping[f.key];
    if (!col || row[col] === undefined || String(row[col]).trim() === "") continue;
    const raw = row[col];
    if (f.key === "id")      { payload.id = Number(raw); continue; }
    if (f.type === "array")  { const a = parseArrayField(raw); if (a) payload[f.key] = a; continue; }
    if (f.type === "number") { payload[f.key] = Number(raw) || 0; continue; }
    payload[f.key] = String(raw);
  }
  return payload;
}

// ─── VCF Parser ───────────────────────────────────────────────────────────────
function decodeQP(str) {
  const s = str.replace(/=\r?\n/g, "").replace(/=\n/g, "");
  const bytes = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "=" && i + 2 < s.length) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
    } else { bytes.push(s.charCodeAt(i)); i++; }
  }
  try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); }
  catch { return String.fromCharCode(...bytes); }
}

function parseVCF(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const contacts = [];
  const blocks = unfolded.split(/BEGIN:VCARD/i).slice(1);
  for (const block of blocks) {
    const endIdx = block.search(/END:VCARD/i);
    const body = endIdx >= 0 ? block.slice(0, endIdx) : block;
    const lines = body.split(/\r?\n/).filter(l => l.trim());
    const contact = {};
    const phones = [];
    for (const line of lines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx < 0) continue;
      const propFull = line.slice(0, colonIdx);
      let value = line.slice(colonIdx + 1);
      if (/ENCODING=QUOTED-PRINTABLE/i.test(propFull)) value = decodeQP(value);
      const propName = propFull.split(";")[0].toUpperCase();
      const params   = propFull.toUpperCase();
      if (propName === "FN") {
        contact.name = value.trim();
      } else if (propName === "N" && !contact.name) {
        const parts = value.split(";");
        const full = [parts[1], parts[0]].map(s => (s || "").trim()).filter(Boolean).join(" ");
        if (full) contact.name = full;
      } else if (propName === "TEL") {
        const digits = value.replace(/\D/g, "");
        if (digits) phones.push({ digits, isCell: /CELL|MOBILE/i.test(params) });
      } else if (propName === "EMAIL" && !contact.email) {
        contact.email = value.trim();
      } else if (propName === "ADR") {
        const p = value.split(";");
        if (p[2]?.trim()) contact.address    = p[2].trim();
        if (p[3]?.trim()) contact.city       = p[3].trim();
        if (p[4]?.trim()) contact.state      = p[4].trim();
        if (p[5]?.trim()) contact.postalCode = p[5].trim();
        if (p[6]?.trim()) contact.country    = p[6].trim();
      } else if (propName === "ORG" && !contact.free1) {
        contact.free1 = value.split(";")[0].trim();
      } else if (propName === "NOTE" && !contact.free2) {
        contact.free2 = value.trim();
      }
    }
    if (phones.length) {
      contact.number = (phones.find(p => p.isCell) || phones[0]).digits;
    }
    if (contact.name || contact.number || contact.email) contacts.push(contact);
  }
  return contacts;
}

// ─── AI Column Mapping ────────────────────────────────────────────────────────
async function aiMapColumns(headers, sampleRows, geminiApiKey) {
  const sample = sampleRows.slice(0, 3);
  const headerSample = headers.map(h => {
    const vals = sample.map(r => r[h]).filter(v => v !== "" && v !== undefined).slice(0, 2);
    return `"${h}": [${vals.map(v => JSON.stringify(String(v))).join(", ")}]`;
  }).join("\n");

  const fieldList = API_FIELDS.map(f => `${f.key}: ${f.label} — ${f.desc}`).join("\n");

  const prompt = `Você é especialista em integração de dados. Analise as colunas de uma planilha e mapeie para campos de uma API de contatos.

CAMPOS DA API:
${fieldList}

COLUNAS DA PLANILHA (com exemplos de valores):
${headerSample}

Retorne SOMENTE JSON válido sem markdown neste formato exato:
{
  "mapping": { "COLUNA_DA_PLANILHA": "campo_api_ou_null" },
  "unrecognized": ["colunas sem correspondência clara"]
}

Regras:
- null (não string) para colunas sem correspondência
- IDs numéricos de contato → "id"
- Telefones → "number"
- Arrays com colchetes → "tags", "groups" ou "preferredAgents" conforme contexto
- Em dúvida, prefira null`;

  const res = await fetch("/api/gemini-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, geminiKey: geminiApiKey }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Erro Gemini: ${res.status}`);
  if (!data.text || typeof data.text !== "string") throw new Error("Resposta inválida do Gemini: " + JSON.stringify(data));
  const raw = data.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Não foi possível extrair JSON da resposta: " + raw.slice(0, 200));
  return JSON.parse(jsonMatch[0]);
}

// ─── Call Evotalks via Vercel proxy ───────────────────────────────────────────
async function callEvotalks(payload, baseUrl, operation) {
  const endpoint = operation === "edit" ? "/int/editContact" : "/int/addContact";
  const target   = `${baseUrl.replace(/\/$/, "")}${endpoint}`;

  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "evotalks", target, payload }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

// ─── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg:"#07090f", surface:"#0d1117", card:"#0f1520", border:"#1c2840", borderHi:"#2a3f6e",
  accent:"#3b82f6", accentDim:"rgba(59,130,246,0.1)",
  green:"#22c55e", greenDim:"rgba(34,197,94,0.1)",
  red:"#ef4444", redDim:"rgba(239,68,68,0.1)",
  amber:"#f59e0b", amberDim:"rgba(245,158,11,0.1)",
  purple:"#a855f7", purpleDim:"rgba(168,85,247,0.1)",
  text:"#f1f5f9", muted:"#374151", sub:"#64748b",
};

const s = {
  root:{ minHeight:"100vh", background:C.bg, fontFamily:"'IBM Plex Mono',monospace", color:C.text },
  header:{ borderBottom:`1px solid ${C.border}`, padding:"16px 32px", display:"flex",
    alignItems:"center", justifyContent:"space-between", background:"rgba(7,9,15,0.97)",
    position:"sticky", top:0, zIndex:100, backdropFilter:"blur(12px)" },
  logoBadge:{ padding:"5px 10px", borderRadius:6, background:`linear-gradient(135deg,${C.accent},${C.purple})`,
    fontSize:11, fontWeight:700, letterSpacing:"0.1em", color:"#fff" },
  logoName:{ fontSize:14, fontWeight:600, color:C.text, letterSpacing:"0.05em", marginLeft:10 },
  logoSub:{ fontSize:10, color:C.sub, marginTop:1, marginLeft:10 },
  stepsRow:{ display:"flex", alignItems:"center", gap:4 },
  stepDot:{ width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center",
    justifyContent:"center", fontSize:10, fontWeight:700, transition:"all 0.25s" },
  stepLabel:{ fontSize:10, letterSpacing:"0.06em" },
  stepLine:{ width:16, height:1 },
  page:{ maxWidth:900, margin:"0 auto", padding:"32px 20px" },
  card:{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:28, marginBottom:18 },
  cardTitle:{ fontSize:16, fontWeight:700, color:C.text, fontFamily:"'IBM Plex Sans',sans-serif", marginBottom:6 },
  cardDesc:{ fontSize:12, color:C.sub, lineHeight:1.7, marginBottom:20 },
  row2:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" },
  fg:{ display:"flex", flexDirection:"column", gap:4, marginBottom:16 },
  lbl:{ fontSize:10, letterSpacing:"0.1em", color:C.sub, textTransform:"uppercase" },
  hint:{ fontSize:10, color:C.muted, marginTop:2 },
  inp:{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7,
    padding:"9px 12px", color:C.text, fontSize:12, width:"100%",
    fontFamily:"'IBM Plex Mono',monospace", transition:"border 0.15s" },
  sel:{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7,
    padding:"9px 12px", color:C.text, fontSize:12, width:"100%",
    fontFamily:"'IBM Plex Mono',monospace", cursor:"pointer" },
  drop:{ border:`2px dashed ${C.border}`, borderRadius:10, padding:"32px 20px",
    textAlign:"center", cursor:"pointer", transition:"all 0.2s", marginBottom:18 },
  opRow:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 },
  opCard:{ border:"1.5px solid", borderRadius:10, padding:"16px 18px", cursor:"pointer", transition:"all 0.2s" },
  btn:{ border:"none", borderRadius:8, padding:"10px 22px", fontSize:12, fontWeight:700,
    cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.05em", transition:"all 0.15s" },
  btnRow:{ display:"flex", gap:10, marginTop:22 },
  tag:{ display:"inline-block", padding:"2px 7px", borderRadius:4, fontSize:10, fontWeight:600 },
  mapGrid:{ display:"flex", flexDirection:"column", gap:6 },
  mapRow:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, alignItems:"center",
    padding:"8px 12px", background:C.surface, borderRadius:7, border:`1px solid ${C.border}` },
  warnBox:{ background:C.amberDim, border:`1px solid rgba(245,158,11,0.25)`,
    borderRadius:8, padding:"12px 15px", marginBottom:14, fontSize:11, color:C.amber, lineHeight:1.8 },
  table:{ width:"100%", borderCollapse:"collapse", fontSize:11 },
  th:{ padding:"8px 11px", textAlign:"left", background:C.surface, color:C.muted,
    borderBottom:`1px solid ${C.border}`, fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase" },
  td:{ padding:"8px 11px", borderBottom:`1px solid ${C.border}`, color:C.sub,
    maxWidth:150, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  pbar:{ height:4, borderRadius:2, background:C.border, overflow:"hidden", marginBottom:6 },
  pfill:{ height:"100%", borderRadius:2, background:`linear-gradient(90deg,${C.accent},${C.purple})`, transition:"width 0.3s" },
  stat:{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"14px 16px", flex:1, textAlign:"center" },
  statN:{ fontSize:24, fontWeight:700, fontFamily:"'IBM Plex Sans',sans-serif" },
  statL:{ fontSize:9, color:C.muted, letterSpacing:"0.1em", marginTop:2, textTransform:"uppercase" },
};

function F({ label, hint, children }) {
  return (
    <div style={s.fg}>
      <label style={s.lbl}>{label}</label>
      {children}
      {hint && <span style={s.hint}>{hint}</span>}
    </div>
  );
}

const STEPS = ["Configurar","Upload","Mapeamento IA","Revisar","Importar"];

export default function Home() {
  const [step, setStep]           = useState(0);
  const [config, setConfig]       = useState({ apiKey:"", queueId:"", baseUrl:"", geminiKey:"" });
  const [operation, setOperation] = useState("");
  const [rows, setRows]           = useState([]);
  const [headers, setHeaders]     = useState([]);
  const [fileName, setFileName]   = useState("");
  const [dragging, setDragging]   = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]     = useState("");
  const [mapping, setMapping]     = useState({});
  const [unrecognized, setUnrecognized] = useState([]);
  const [ignoredCols, setIgnoredCols]   = useState({});
  const [results, setResults]     = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [showAll, setShowAll]     = useState(false);
  const [fileType, setFileType]   = useState("");
  const fileRef  = useRef();
  const abortRef = useRef(false);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "vcf") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const contacts = parseVCF(e.target.result);
        if (!contacts.length) return;
        const usedKeys = ALL_KEYS.filter(k => contacts.some(c => c[k] !== undefined && c[k] !== ""));
        const m = {};
        usedKeys.forEach(k => { m[k] = k; });
        setHeaders(usedKeys);
        setRows(contacts);
        setFileType("vcf");
        setMapping(m);
        setUnrecognized([]);
        setIgnoredCols({});
      };
      reader.readAsText(file, "utf-8");
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb   = XLSX.read(e.target.result, { type:"array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval:"" });
        if (!data.length) return;
        setHeaders(Object.keys(data[0]));
        setRows(data);
        setFileType("spreadsheet");
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  const runAiMapping = async () => {
    setAiLoading(true); setAiError("");
    try {
      const result = await aiMapColumns(headers, rows, config.geminiKey);
      const newMapping = {};
      for (const [col, field] of Object.entries(result.mapping || {})) {
        if (field && field !== "null" && ALL_KEYS.includes(field)) newMapping[field] = col;
      }
      setMapping(newMapping);
      setUnrecognized(result.unrecognized || []);
      const init = {};
      (result.unrecognized || []).forEach(c => { init[c] = "ignore"; });
      setIgnoredCols(init);
      setStep(2);
    } catch (e) {
      setAiError("Erro no mapeamento: " + (e?.message || String(e)));
    } finally {
      setAiLoading(false);
    }
  };

  const buildFinalMapping = () => {
    const m = { ...mapping };
    for (const [col, dest] of Object.entries(ignoredCols)) {
      if (dest === "free1") m.free1 = col;
      else if (dest === "free2") m.free2 = col;
    }
    return m;
  };

  const startImport = async () => {
    abortRef.current = false;
    setImporting(true); setProgress(0);
    setResults(rows.map((_, i) => ({ i, status:"pending", msg:"" })));
    setStep(4);
    const finalMapping = buildFinalMapping();

    for (let i = 0; i < rows.length; i++) {
      if (abortRef.current) break;
      setResults(prev => prev.map(r => r.i === i ? { ...r, status:"sending" } : r));
      const payload = rowToPayload(rows[i], finalMapping, config);

      if (operation === "edit" && !payload.id) {
        setResults(prev => prev.map(r => r.i === i ? { ...r, status:"error", msg:"Campo 'id' ausente" } : r));
        setProgress(Math.round(((i+1)/rows.length)*100));
        await new Promise(r => setTimeout(r, 20));
        continue;
      }

      try {
        const res = await callEvotalks(payload, config.baseUrl, operation);
        const msg = res?.message || (operation === "edit" ? "Atualizado" : `Criado — ID: ${res?.contactId ?? ""}`);
        setResults(prev => prev.map(r => r.i === i ? { ...r, status:"success", msg } : r));
      } catch (err) {
        setResults(prev => prev.map(r => r.i === i ? { ...r, status:"error", msg: err.message } : r));
      }

      setProgress(Math.round(((i+1)/rows.length)*100));
      await new Promise(r => setTimeout(r, 150));
    }
    setImporting(false);
  };

  const successCount = results.filter(r => r.status === "success").length;
  const errorCount   = results.filter(r => r.status === "error").length;
  const pendingCount = results.filter(r => r.status === "pending" || r.status === "sending").length;
  const canConfig    = config.apiKey && config.queueId && config.baseUrl && config.geminiKey && operation;
  const mappedKeys   = Object.keys(mapping);
  const previewCols  = mappedKeys.slice(0, 10);

  return (
    <>
      <Head>
        <title>Evotalks Smart Importer</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap" rel="stylesheet" />
        <style>{`
          *{box-sizing:border-box;margin:0;padding:0}
          body{background:#07090f}
          input,select{outline:none}
          input:focus,select:focus{border-color:#3b82f6!important;box-shadow:0 0 0 2px rgba(59,130,246,0.15)!important}
          input::placeholder{color:#1e2d45}
          @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
          .anim{animation:fadeUp 0.28s ease forwards}
          .hovbtn:hover{opacity:0.82!important;transform:translateY(-1px)}
          .mrow:hover{border-color:#2a3f6e!important}
          tr:hover td{background:rgba(13,17,23,0.7)}
          ::-webkit-scrollbar{width:4px;height:4px}
          ::-webkit-scrollbar-track{background:#0d1117}
          ::-webkit-scrollbar-thumb{background:#1c2840;border-radius:2px}
        `}</style>
      </Head>

      <div style={s.root}>
        {/* HEADER */}
        <header style={s.header}>
          <div style={{ display:"flex", alignItems:"center" }}>
            <div style={s.logoBadge}>EVO</div>
            <div>
              <div style={s.logoName}>Evotalks Smart Importer</div>
              <div style={s.logoSub}>Mapeamento inteligente com IA</div>
            </div>
          </div>
          <div style={s.stepsRow}>
            {STEPS.map((name, i) => {
              const isActive = step === i;
              const isDone   = step > i;
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ ...s.stepDot,
                    background: isDone ? C.green : isActive ? C.accent : C.surface,
                    color: (isDone || isActive) ? "#fff" : C.muted,
                    boxShadow: isActive ? `0 0 10px rgba(59,130,246,0.5)` : "none",
                  }}>
                    {isDone ? "✓" : i+1}
                  </div>
                  <span style={{ ...s.stepLabel, color: isActive ? C.text : isDone ? C.green : C.muted }}>{name}</span>
                  {i < STEPS.length-1 && <div style={{ ...s.stepLine, background: isDone ? C.green : C.border }} />}
                </div>
              );
            })}
          </div>
        </header>

        <div style={s.page}>

          {/* STEP 0 */}
          {step === 0 && (
            <div className="anim">
              <div style={s.card}>
                <div style={s.cardTitle}>Configurações</div>
                <div style={s.cardDesc}>Escolha a operação e preencha as credenciais do Evotalks.</div>

                <div style={s.opRow}>
                  {[
                    { id:"add",  icon:"✦", title:"Criar Contatos",  desc:"Novos contatos via /addContact", color:C.green, dim:C.greenDim },
                    { id:"edit", icon:"✎", title:"Editar Contatos", desc:"Atualiza existentes via /editContact — exige campo id", color:C.accent, dim:C.accentDim },
                  ].map(op => (
                    <div key={op.id} className="hovbtn"
                      style={{ ...s.opCard, borderColor: operation===op.id ? op.color : C.border, background: operation===op.id ? op.dim : C.surface }}
                      onClick={() => setOperation(op.id)}>
                      <div style={{ fontSize:18, marginBottom:6 }}>{op.icon}</div>
                      <div style={{ fontSize:13, fontWeight:700, color: operation===op.id ? op.color : C.text, marginBottom:4 }}>{op.title}</div>
                      <div style={{ fontSize:11, color:C.sub, lineHeight:1.5 }}>{op.desc}</div>
                    </div>
                  ))}
                </div>

                <div style={s.row2}>
                  <F label="URL Base *" hint="Ex: https://app.evotalks.com">
                    <input style={s.inp} placeholder="https://sua-instancia.evotalks.com"
                      value={config.baseUrl} onChange={e => setConfig({ ...config, baseUrl:e.target.value })} />
                  </F>
                  <F label="Queue ID *" hint="ID numérico da fila">
                    <input style={s.inp} placeholder="0" type="number"
                      value={config.queueId} onChange={e => setConfig({ ...config, queueId:e.target.value })} />
                  </F>
                </div>
                <F label="API Key *" hint="Chave de autenticação">
                  <input style={s.inp} placeholder="••••••••••••••••••••" type="password"
                    value={config.apiKey} onChange={e => setConfig({ ...config, apiKey:e.target.value })} />
                </F>
                <F label="Gemini API Key *" hint="Chave do Google AI Studio (generativelanguage.googleapis.com)">
                  <input style={s.inp} placeholder="AIza••••••••••••••••••••••••••••••••••••" type="password"
                    value={config.geminiKey} onChange={e => setConfig({ ...config, geminiKey:e.target.value })} />
                </F>

                <button className="hovbtn" style={{ ...s.btn, background:C.accent, color:"#fff",
                  opacity:canConfig?1:0.35, cursor:canConfig?"pointer":"not-allowed" }}
                  disabled={!canConfig} onClick={() => setStep(1)}>
                  Continuar →
                </button>
              </div>
            </div>
          )}

          {/* STEP 1 */}
          {step === 1 && (
            <div className="anim">
              <div style={s.card}>
                <div style={s.cardTitle}>Upload de Contatos</div>
                <div style={s.cardDesc}>Planilhas (.xlsx/.csv) usam mapeamento por IA · Arquivos .vcf são importados diretamente.</div>

                <div style={{ ...s.drop,
                  borderColor: dragging ? C.accent : fileName ? C.green : C.border,
                  background:  dragging ? C.accentDim : fileName ? C.greenDim : "transparent",
                }}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileRef.current.click()}
                >
                  <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.vcf"
                    style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
                  <div style={{ fontSize:32, marginBottom:10 }}>{fileName ? "✅" : "📂"}</div>
                  {fileName ? (
                    <>
                      <div style={{ color:C.green, fontWeight:600, fontSize:13, marginBottom:4 }}>{fileName}</div>
                      {fileType === "vcf"
                        ? <div style={{ color:C.sub, fontSize:11 }}>{rows.length} contatos · mapeamento automático · clique para trocar</div>
                        : <div style={{ color:C.sub, fontSize:11 }}>{rows.length} linhas · {headers.length} colunas · clique para trocar</div>
                      }
                      <div style={{ marginTop:12, display:"flex", flexWrap:"wrap", gap:5, justifyContent:"center" }}>
                        {headers.map(h => {
                          const lbl = fileType === "vcf" ? (API_FIELDS.find(f => f.key === h)?.label || h) : h;
                          return <span key={h} style={{ ...s.tag, background: fileType==="vcf" ? C.greenDim : C.accentDim, color: fileType==="vcf" ? C.green : C.accent }}>{lbl}</span>;
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ color:C.sub, fontSize:13 }}>Arraste ou clique para selecionar</div>
                      <div style={{ color:C.muted, fontSize:11, marginTop:5 }}>.xlsx · .xls · .csv · .vcf</div>
                    </>
                  )}
                </div>

                {aiError && <div style={s.warnBox}>⚠ {aiError}</div>}

                <div style={s.btnRow}>
                  <button className="hovbtn" style={{ ...s.btn, background:C.surface, color:C.sub, border:`1px solid ${C.border}` }}
                    onClick={() => setStep(0)}>← Voltar</button>
                  {fileType === "vcf" ? (
                    <button className="hovbtn"
                      style={{ ...s.btn, minWidth:200, background:`linear-gradient(135deg,${C.green},#15803d)`, color:"#fff",
                        opacity: rows.length ? 1 : 0.35, cursor: rows.length ? "pointer" : "not-allowed" }}
                      disabled={!rows.length} onClick={() => setStep(3)}>
                      📇 Revisar {rows.length} Contatos →
                    </button>
                  ) : (
                    <button className="hovbtn"
                      style={{ ...s.btn, minWidth:200,
                        background: aiLoading ? C.purpleDim : `linear-gradient(135deg,${C.accent},${C.purple})`,
                        color: aiLoading ? C.purple : "#fff",
                        border: aiLoading ? `1px solid rgba(168,85,247,0.3)` : "none",
                        opacity: (!rows.length || aiLoading) ? 0.6 : 1,
                        cursor: (!rows.length || aiLoading) ? "not-allowed" : "pointer",
                      }}
                      disabled={!rows.length || aiLoading} onClick={runAiMapping}>
                      {aiLoading
                        ? <span style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"center" }}>
                            <span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>◌</span>
                            IA analisando...
                          </span>
                        : "✦ Mapear com IA →"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div className="anim">
              <div style={s.card}>
                <div style={s.cardTitle}>Mapeamento por IA</div>
                <div style={s.cardDesc}>
                  <span style={{ color:C.green }}>{mappedKeys.length} coluna{mappedKeys.length!==1?"s":""} mapeada{mappedKeys.length!==1?"s":""}</span>
                  {unrecognized.length > 0 && <span style={{ color:C.amber }}> · {unrecognized.length} não reconhecida{unrecognized.length!==1?"s":""}</span>}
                </div>

                {mappedKeys.length > 0 && (
                  <div style={{ ...s.mapGrid, marginBottom:20 }}>
                    {API_FIELDS.filter(f => mapping[f.key]).map(field => (
                      <div key={field.key} className="mrow" style={s.mapRow}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ ...s.tag, background:C.accentDim, color:C.accent }}>{field.key}</span>
                          <span style={{ fontSize:11, color:C.muted }}>{field.label}</span>
                        </div>
                        <select style={{ ...s.sel, borderColor:C.borderHi, color:C.text, fontSize:11 }}
                          value={mapping[field.key] || ""}
                          onChange={e => setMapping({ ...mapping, [field.key]: e.target.value || undefined })}>
                          <option value="">— remover —</option>
                          {headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {unrecognized.length > 0 && (
                  <>
                    <div style={s.warnBox}>⚠ Colunas não reconhecidas — escolha o que fazer:</div>
                    <div style={s.mapGrid}>
                      {unrecognized.map(col => (
                        <div key={col} className="mrow" style={{ ...s.mapRow, borderColor:"rgba(245,158,11,0.2)" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <span style={{ ...s.tag, background:C.amberDim, color:C.amber }}>?</span>
                            <span style={{ fontSize:11, color:C.amber }}>{col}</span>
                          </div>
                          <select style={{ ...s.sel, fontSize:11 }}
                            value={ignoredCols[col] || "ignore"}
                            onChange={e => setIgnoredCols({ ...ignoredCols, [col]: e.target.value })}>
                            <option value="ignore">Ignorar esta coluna</option>
                            <option value="free1">→ Campo Livre 1 (free1)</option>
                            <option value="free2">→ Campo Livre 2 (free2)</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div style={s.btnRow}>
                  <button className="hovbtn" style={{ ...s.btn, background:C.surface, color:C.sub, border:`1px solid ${C.border}` }}
                    onClick={() => setStep(1)}>← Voltar</button>
                  <button className="hovbtn" style={{ ...s.btn, background:C.accent, color:"#fff" }}
                    onClick={() => setStep(3)}>Revisar Dados →</button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div className="anim">
              <div style={s.card}>
                <div style={s.cardTitle}>Revisão Final</div>
                <div style={s.cardDesc}>
                  <strong style={{ color: operation==="edit" ? C.accent : C.green }}>
                    {operation === "edit" ? "✎ Editar" : "✦ Criar"}
                  </strong> · {rows.length} contatos · {mappedKeys.length} campos mapeados
                </div>

                {operation === "edit" && !mapping["id"] && (
                  <div style={s.warnBox}>⚠ Campo <strong>id</strong> não mapeado! Linhas sem ID serão puladas.</div>
                )}

                <div style={{ overflowX:"auto", borderRadius:8, border:`1px solid ${C.border}`, marginBottom:16, maxHeight:320, overflowY:"auto" }}>
                  <table style={s.table}>
                    <thead>
                      <tr>{previewCols.map(k => (
                        <th key={k} style={s.th}>{mapping[k]}<br/><span style={{ color:C.accent, fontWeight:400 }}>→ {k}</span></th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {(showAll ? rows : rows.slice(0,8)).map((row, ri) => (
                        <tr key={ri}>
                          {previewCols.map(k => (
                            <td key={k} style={s.td} title={String(row[mapping[k]] ?? "")}>
                              {row[mapping[k]] !== "" && row[mapping[k]] !== undefined
                                ? String(row[mapping[k]]) : <span style={{ color:C.muted }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {rows.length > 8 && (
                  <div style={{ textAlign:"center", marginBottom:14 }}>
                    <button className="hovbtn" style={{ ...s.btn, background:C.surface, color:C.sub, border:`1px solid ${C.border}`, fontSize:11, padding:"6px 14px" }}
                      onClick={() => setShowAll(v => !v)}>
                      {showAll ? "Mostrar menos ↑" : `Ver todas ${rows.length} linhas ↓`}
                    </button>
                  </div>
                )}

                <div style={s.btnRow}>
                  <button className="hovbtn" style={{ ...s.btn, background:C.surface, color:C.sub, border:`1px solid ${C.border}` }}
                    onClick={() => setStep(2)}>← Ajustar</button>
                  <button className="hovbtn" style={{ ...s.btn, color:"#fff",
                    background: operation==="edit" ? `linear-gradient(135deg,${C.accent},#1d4ed8)` : `linear-gradient(135deg,${C.green},#15803d)` }}
                    onClick={startImport}>
                    {operation === "edit" ? "✎ Iniciar Edição" : "✦ Iniciar Criação"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <div className="anim">
              <div style={{ display:"flex", gap:12, marginBottom:18 }}>
                {[[successCount,C.green,"Sucesso"],[errorCount,C.red,"Erro"],[pendingCount,C.amber,"Pendente"],[rows.length,C.sub,"Total"]].map(([n,c,l]) => (
                  <div key={l} style={s.stat}>
                    <div style={{ ...s.statN, color:c }}>{n}</div>
                    <div style={s.statL}>{l}</div>
                  </div>
                ))}
              </div>

              <div style={s.card}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                  <div style={s.cardTitle}>
                    {importing
                      ? <span style={{ animation:"pulse 1.5s infinite" }}>{operation==="edit"?"✎":"✦"} Importando...</span>
                      : progress === 100 ? "✅ Concluído" : "Log"}
                  </div>
                  {importing && (
                    <button className="hovbtn" style={{ ...s.btn, background:C.surface, color:C.sub, border:`1px solid ${C.border}`, fontSize:11, padding:"5px 12px" }}
                      onClick={() => { abortRef.current = true; }}>Cancelar</button>
                  )}
                </div>

                <div style={s.pbar}><div style={{ ...s.pfill, width:`${progress}%` }} /></div>
                <div style={{ fontSize:10, color:C.muted, marginBottom:16, textAlign:"right" }}>
                  {progress}% — {successCount+errorCount}/{rows.length}
                </div>

                <div style={{ overflowX:"auto", borderRadius:8, border:`1px solid ${C.border}`, maxHeight:400, overflowY:"auto" }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>#</th>
                        {operation==="edit" && <th style={s.th}>ID</th>}
                        <th style={s.th}>Nome</th>
                        <th style={s.th}>Número</th>
                        <th style={s.th}>Status</th>
                        <th style={s.th}>Resposta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map(r => {
                        const row = rows[r.i];
                        const sc  = { pending:[C.muted,"·"], sending:[C.amber,"⟳"], success:[C.green,"✓"], error:[C.red,"✗"] };
                        const [col, icon] = sc[r.status];
                        return (
                          <tr key={r.i}>
                            <td style={{ ...s.td, color:C.muted }}>{r.i+1}</td>
                            {operation==="edit" && <td style={{ ...s.td, color:C.accent, fontWeight:600 }}>{mapping["id"] ? row[mapping["id"]] : "—"}</td>}
                            <td style={s.td}>{mapping["name"] ? row[mapping["name"]] : "—"}</td>
                            <td style={{ ...s.td, color:C.sub }}>{mapping["number"] ? row[mapping["number"]] : "—"}</td>
                            <td style={s.td}>
                              <span style={{ color:col, fontSize:11, fontWeight:600, display:"inline-block",
                                animation: r.status==="sending" ? "spin 1.2s linear infinite" : "none" }}>
                                {icon} {r.status.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ ...s.td, color:r.status==="error"?C.red:C.muted, maxWidth:220 }} title={r.msg}>
                              {r.msg||"—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {!importing && progress === 100 && (
                  <div style={s.btnRow}>
                    <button className="hovbtn" style={{ ...s.btn, background:C.surface, color:C.sub, border:`1px solid ${C.border}` }}
                      onClick={() => { setStep(0); setRows([]); setHeaders([]); setMapping({}); setFileName(""); setResults([]); setProgress(0); setOperation(""); setUnrecognized([]); setIgnoredCols({}); setFileType(""); }}>
                      ← Nova Importação
                    </button>
                    {errorCount > 0 && (
                      <button className="hovbtn" style={{ ...s.btn, background:C.redDim, color:C.red, border:`1px solid rgba(239,68,68,0.3)` }}
                        onClick={() => {
                          const errs = results.filter(r => r.status === "error");
                          const data = errs.map(r => ({ linha:r.i+1, ...rows[r.i], erro:r.msg }));
                          const ws = XLSX.utils.json_to_sheet(data);
                          const wb = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb, ws, "Erros");
                          XLSX.writeFile(wb, "erros_importacao.xlsx");
                        }}>
                        ↓ Exportar {errorCount} Erro{errorCount!==1?"s":""} (.xlsx)
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

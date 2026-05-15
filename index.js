import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";
import express from "express";

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!HUBSPOT_TOKEN) {
  console.error("❌ HUBSPOT_TOKEN não definido nas variáveis de ambiente.");
  process.exit(1);
}

if (!SLACK_WEBHOOK_URL) {
  console.warn("⚠️  SLACK_WEBHOOK_URL não definido — tool notificar_crm ficará indisponível.");
}

const hs = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    "Content-Type": "application/json",
  },
});

// ─── Servidor MCP ────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "hubspot-email-mcp",
  version: "1.0.0",
});

// ── Tool 1: Criar rascunho de e-mail marketing ────────────────────────────────
server.tool(
  "criar_email_rascunho",
  "Cria um e-mail de marketing no HubSpot salvo como rascunho (isDraft: true). Retorna o ID e a URL de edição.",
  {
    nome: z.string().describe("Nome interno do e-mail (visível só para o time)"),
    assunto: z.string().describe("Assunto do e-mail que o destinatário vai ver"),
    html_body: z.string().describe("HTML completo do corpo do e-mail"),
    nome_remetente: z.string().optional().describe("Nome do remetente (ex: AmorSaúde)"),
    email_remetente: z.string().optional().describe("E-mail do remetente"),
  },
  async ({ nome, assunto, html_body, nome_remetente, email_remetente }) => {
    try {
      const payload = {
        name: nome,
        subject: assunto,
        content: {
          body: html_body,
        },
        fromName: nome_remetente || "AmorSaúde",
        replyTo: email_remetente || "",
        isDraft: true,
        type: "REGULAR_AB",
        businessUnitId: process.env.HUBSPOT_BUSINESS_UNIT_ID || "5338832",
      };

      const res = await hs.post("/marketing/v3/emails", payload);
      const { id, name, subject, state } = res.data;
      const editUrl = `https://app.hubspot.com/email/${id}/edit`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id, name, subject, state, editUrl }, null, 2),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return {
        content: [{ type: "text", text: `❌ Erro ao criar rascunho: ${detail}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 2: Listar e-mails (rascunhos e publicados) ───────────────────────────
server.tool(
  "listar_emails",
  "Lista os e-mails de marketing cadastrados no HubSpot. Pode filtrar por estado (DRAFT, PUBLISHED, etc.).",
  {
    estado: z
      .enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"])
      .optional()
      .describe("Filtrar por estado do e-mail"),
    limite: z.number().optional().default(10).describe("Quantidade máxima de e-mails retornados"),
  },
  async ({ estado, limite }) => {
    try {
      const params = { limit: limite };
      if (estado) params.state = estado;

      const res = await hs.get("/marketing/v3/emails", { params });
      const emails = res.data.results.map((e) => ({
        id: e.id,
        nome: e.name,
        assunto: e.subject,
        estado: e.state,
        atualizadoEm: e.updatedAt,
        editUrl: `https://app.hubspot.com/email/${e.id}/edit`,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ total: emails.length, emails }, null, 2),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return {
        content: [{ type: "text", text: `❌ Erro ao listar e-mails: ${detail}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 3: Atualizar rascunho existente ──────────────────────────────────────
server.tool(
  "atualizar_email_rascunho",
  "Atualiza assunto ou HTML de um rascunho já existente no HubSpot pelo ID.",
  {
    email_id: z.string().describe("ID do e-mail no HubSpot"),
    assunto: z.string().optional().describe("Novo assunto do e-mail"),
    html_body: z.string().optional().describe("Novo HTML do corpo do e-mail"),
    nome: z.string().optional().describe("Novo nome interno do e-mail"),
  },
  async ({ email_id, assunto, html_body, nome }) => {
    try {
      const payload = {};
      if (assunto) payload.subject = assunto;
      if (nome) payload.name = nome;
      if (html_body) payload.content = { body: html_body };

      const res = await hs.patch(`/marketing/v3/emails/${email_id}`, payload);
      const { id, name, subject, state } = res.data;
      const editUrl = `https://app.hubspot.com/email/${id}/edit`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id, name, subject, state, editUrl }, null, 2),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return {
        content: [{ type: "text", text: `❌ Erro ao atualizar rascunho: ${detail}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 4: Notificar CRM via Slack ──────────────────────────────────────────
server.tool(
  "notificar_crm",
  "Envia uma mensagem no Slack para o canal do time de CRM avisando que um rascunho de e-mail está pronto para disparo no HubSpot.",
  {
    nome_email: z.string().describe("Nome do e-mail criado (ex: Cross-Sell Odonto — Maio 2026)"),
    assunto: z.string().describe("Assunto do e-mail"),
    edit_url: z.string().describe("URL direta para editar/disparar o rascunho no HubSpot"),
    responsavel: z
      .string()
      .optional()
      .describe("Nome do responsável pelo disparo (ex: Alexy, Emily ou Victor)"),
    observacoes: z
      .string()
      .optional()
      .describe("Instruções adicionais para o time de CRM (ex: lista segmentada, horário sugerido)"),
  },
  async ({ nome_email, assunto, edit_url, responsavel, observacoes }) => {
    if (!SLACK_WEBHOOK_URL) {
      return {
        content: [{ type: "text", text: "❌ SLACK_WEBHOOK_URL não configurado no servidor." }],
        isError: true,
      };
    }

    try {
      const mencao = responsavel ? `*Responsável pelo disparo:* ${responsavel}\n` : "";
      const obs = observacoes ? `*Observações:* ${observacoes}\n` : "";

      const payload = {
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "📧 E-mail pronto para disparo!",
              emoji: true,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${nome_email}*\n*Assunto:* ${assunto}\n${mencao}${obs}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🚀 Abrir no HubSpot", emoji: true },
                url: edit_url,
                style: "primary",
              },
            ],
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Rascunho criado automaticamente pelo Claude • ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
              },
            ],
          },
        ],
      };

      await axios.post(SLACK_WEBHOOK_URL, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { sucesso: true, mensagem: "Notificação enviada ao canal do time de CRM no Slack." },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data || err.message;
      return {
        content: [{ type: "text", text: `❌ Erro ao notificar via Slack: ${JSON.stringify(detail)}` }],
        isError: true,
      };
    }
  }
);

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE_URL = (process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const MCP_SECRET = process.env.MCP_SECRET || "amorsaude-mcp-secret";
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "amorsaude-client-id";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "amorsaude-client-secret";

// Armazena codes em memória
const authCodes = new Map();

// ── Root ──────────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ name: "hubspot-email-mcp", version: "1.0.0", status: "ok" });
});

// ── OAuth 2.0 — Authorization Server Metadata ─────────────────────────────────
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
  });
});

// ── OAuth — Authorize ─────────────────────────────────────────────────────────
app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.query;

  console.log(`[authorize] client_id=${client_id} redirect_uri=${redirect_uri}`);

  if (!redirect_uri) {
    return res.status(400).json({ error: "redirect_uri obrigatório" });
  }

  const code = `code_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  authCodes.set(code, {
    redirect_uri,
    code_challenge,
    code_challenge_method,
    client_id,
    created_at: Date.now(),
  });

  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  console.log(`[authorize] redirecionando para ${callbackUrl.toString()}`);
  res.redirect(callbackUrl.toString());
});

// ── OAuth — Token exchange ─────────────────────────────────────────────────────
app.post("/oauth/token", express.text({ type: "*/*" }), (req, res) => {
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = Object.fromEntries(new URLSearchParams(body));
    }
  }

  // Suporta client_secret via Authorization header (Basic Auth)
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const [id, secret] = decoded.split(":");
    body.client_id = body.client_id || id;
    body.client_secret = body.client_secret || secret;
  }

  const { code, grant_type, client_id, client_secret } = body || {};
  console.log(`[token] grant_type=${grant_type} client_id=${client_id} code=${code}`);

  // Valida client_id e client_secret se fornecidos
  if (client_id && client_id !== OAUTH_CLIENT_ID) {
    console.warn(`[token] client_id inválido: ${client_id}`);
    return res.status(401).json({ error: "invalid_client" });
  }
  if (client_secret && client_secret !== OAUTH_CLIENT_SECRET) {
    console.warn(`[token] client_secret inválido`);
    return res.status(401).json({ error: "invalid_client" });
  }

  if (grant_type === "authorization_code") {
    if (!code || !authCodes.has(code)) {
      console.warn(`[token] code inválido: ${code}`);
      return res.status(400).json({ error: "invalid_grant" });
    }
    authCodes.delete(code);
  }

  res.json({
    access_token: MCP_SECRET,
    token_type: "bearer",
    expires_in: 31536000,
  });
});

// ── MCP endpoint ──────────────────────────────────────────────────────────────
app.post("/mcp", async (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^[Bb]earer\s+/, "").trim();

  if (token !== MCP_SECRET) {
    res.setHeader("WWW-Authenticate", `Bearer realm="${BASE_URL}"`);
    return res.status(401).json({ error: "Unauthorized" });
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// ── GET /mcp — retorna metadata para descoberta ───────────────────────────────
app.get("/mcp", (_req, res) => {
  res.json({
    name: "hubspot-email-mcp",
    version: "1.0.0",
    description: "MCP para criação de e-mails de marketing no HubSpot — AmorSaúde",
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "hubspot-email-mcp", version: "1.0.0" });
});

app.listen(PORT, () => {
  console.log(`✅ HubSpot MCP rodando na porta ${PORT}`);
  console.log(`   POST /mcp     → endpoint MCP`);
  console.log(`   GET  /health  → health check`);
  console.log(`   OAuth em ${BASE_URL}`);
});

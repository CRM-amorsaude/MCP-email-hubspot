import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import axios from "axios";
import express from "express";
import FormData from "form-data";

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

// ─── IDs fixos do template base ──────────────────────────────────────────────
// Esses módulos são header e footer — NUNCA devem ser tocados pelo fluxo híbrido.
const PROTECTED_WIDGET_KEYS = new Set([
  "module_16491575998179",   // banner/imagem header
  "module_16582585915422",   // imagem secundária/logo header
  "module_17435010851881",   // HTML auxiliar header
  "module_17750683168462",   // CTA botão 1
  "module_17750683168463",   // CTA botão 2
  "module_17750683168464",   // CTA botão 3
  "module_17750683168465",   // CTA botão 4
  "module_17437663382712",   // redes sociais header
  "module_17437663465645",   // redes sociais footer
  "module_164915764846218",  // footer legal
]);

// ─── Helpers internos ────────────────────────────────────────────────────────

/**
 * Clona o template base e retorna o objeto completo do clone (data do GET).
 */
async function clonarTemplate(nome) {
  const TEMPLATE_ID = process.env.HUBSPOT_TEMPLATE_ID || "212982428723";
  const cloneRes = await hs.post("/marketing/v3/emails/clone", {
    id: TEMPLATE_ID,
    cloneName: nome,
  });
  const clonedId = cloneRes.data.id;
  const getRes = await hs.get(`/marketing/v3/emails/${clonedId}`);
  return getRes.data;
}

/**
 * A partir do content.flexAreas.main.sections do clone, separa:
 * - secoes_protegidas: seções cujos widgets estão em PROTECTED_WIDGET_KEYS
 * - secoes_editaveis: seções do miolo que serão substituídas
 * Retorna também o mapa completo de widgets para reuso nas seções protegidas.
 */
function mapearSecoes(content) {
  const sections = content?.flexAreas?.main?.sections || [];
  const widgets = content?.widgets || {};

  const secoes_protegidas_inicio = [];
  const secoes_protegidas_fim = [];
  const secoes_editaveis = [];

  // Identifica se uma seção é protegida (contém ao menos um widget protegido)
  const ehProtegida = (section) =>
    section.columns?.some((col) =>
      col.widgets?.some((wKey) => PROTECTED_WIDGET_KEYS.has(wKey))
    );

  // Divide em header / miolo / footer preservando a ordem original
  let passou_miolo = false;
  for (const section of sections) {
    if (ehProtegida(section)) {
      if (!passou_miolo) {
        secoes_protegidas_inicio.push(section);
      } else {
        secoes_protegidas_fim.push(section);
      }
    } else {
      passou_miolo = true;
      secoes_editaveis.push(section);
    }
  }

  return { secoes_protegidas_inicio, secoes_protegidas_fim, secoes_editaveis, widgets };
}

/**
 * Gera um ID único para novas seções/colunas/widgets do miolo.
 */
function gerarId(prefixo = "section") {
  return `${prefixo}_claude_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Monta uma seção DnD a partir de um bloco descrito pelo Claude.
 * Cada bloco tem: { tipo, conteudo, widget_key? }
 * Tipos suportados: "imagem", "rich_text", "html", "cta", "preview_text"
 * Retorna { section, widgetEntry } onde widgetEntry é [key, widgetObj].
 */
function montarSecao(bloco) {
  const sectionId = gerarId("section");
  const columnId = gerarId("column");
  const widgetKey = bloco.widget_key || gerarId("module");

  let widgetBody = {};

  switch (bloco.tipo) {
    case "imagem":
      // Módulo de imagem nativo — usa src + alt + link opcional
      widgetBody = {
        img: {
          src: bloco.conteudo.src,
          alt: bloco.conteudo.alt || "",
          width: bloco.conteudo.width || 600,
        },
        link: bloco.conteudo.link || "",
        hs_enable_module_padding: false,
        hs_wrapper_css: {},
        path: "@hubspot/email_image",
        schema_version: 2,
      };
      break;

    case "rich_text":
      // Módulo de rich text nativo — aceita HTML simples com tokens HubSpot
      widgetBody = {
        html: bloco.conteudo.html,
        hs_enable_module_padding: false,
        hs_wrapper_css: {},
        path: "@hubspot/rich_text",
        schema_version: 2,
      };
      break;

    case "html":
      // Módulo HTML customizado — para blocos complexos (serviços, amorzito, badges etc.)
      widgetBody = {
        html: bloco.conteudo.html,
        hs_enable_module_padding: false,
        hs_wrapper_css: {},
        // sem "path" — identifica este como módulo HTML livre
      };
      break;

    case "cta":
      // Módulo de botão CTA nativo
      widgetBody = {
        text: bloco.conteudo.texto,
        destination: { type: "EXTERNAL_URL", href: bloco.conteudo.url || "#" },
        background_color: bloco.conteudo.cor_fundo || "#00a988",
        font_color: bloco.conteudo.cor_texto || "#ffffff",
        font_size: bloco.conteudo.tamanho_fonte || 16,
        corner_radius: bloco.conteudo.borda_arredondada || 12,
        make_full_width: false,
        border_enabled: false,
        inner_horizontal_padding: 24,
        inner_vertical_padding: 14,
        hs_enable_module_padding: false,
        hs_wrapper_css: {},
        path: "@hubspot/email_button",
        schema_version: 2,
      };
      break;

    default:
      console.warn(`[montarSecao] tipo desconhecido: ${bloco.tipo} — usando html genérico`);
      widgetBody = {
        html: bloco.conteudo?.html || "",
        hs_enable_module_padding: false,
        hs_wrapper_css: {},
      };
  }

  const section = {
    id: sectionId,
    columns: [
      {
        id: columnId,
        widgets: [widgetKey],
        width: 12,
      },
    ],
    style: {
      backgroundType: "CONTENT",
      backgroundColor: bloco.cor_fundo_secao || "",
      paddingTop: bloco.padding_top || "0px",
      paddingBottom: bloco.padding_bottom || "0px",
    },
  };

  const widgetEntry = [
    widgetKey,
    {
      body: widgetBody,
      child_css: {},
      css: {},
      id: widgetKey,
      name: widgetKey,
      styles: {},
      type: "module",
    },
  ];

  return { section, widgetEntry };
}

// ─── Servidor MCP ────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "hubspot-email-mcp",
  version: "3.0.0",
});

// ── Tool 1: montar_email_hibrido ──────────────────────────────────────────────
server.tool(
  "montar_email_hibrido",
  `Substitui criar_email_rascunho. Clona o template base, preserva header e footer intactos,
   e monta o miolo do e-mail com blocos independentes definidos pelo Claude a partir do Figma.
   Cada bloco pode ser: imagem nativa, rich_text nativo, html customizado ou cta nativo.
   O Claude deve analisar o design do Figma e compor o array de blocos antes de chamar esta tool.`,
  {
    nome: z.string().describe("Nome interno do e-mail (visível só para o time)"),
    assunto: z.string().describe("Assunto do e-mail que o destinatário vai ver"),
    preview_text: z.string().optional().describe("Texto de preview exibido na caixa de entrada antes de abrir o e-mail"),
    nome_remetente: z.string().optional().describe("Nome do remetente (ex: AmorSaúde)"),
    email_remetente: z.string().optional().describe("E-mail do remetente"),
    blocos: z
      .array(
        z.object({
          tipo: z
            .enum(["imagem", "rich_text", "html", "cta"])
            .describe(
              "Tipo do bloco: " +
              "'imagem' = módulo nativo para banner/foto (requer conteudo.src); " +
              "'rich_text' = módulo nativo para texto com suporte a tokens HubSpot como {{ contact.firstname }} (requer conteudo.html); " +
              "'html' = módulo HTML livre para blocos complexos como serviços, badges, layout 2 colunas (requer conteudo.html); " +
              "'cta' = módulo botão nativo com rastreamento (requer conteudo.texto + conteudo.url)"
            ),
          conteudo: z
            .object({
              // imagem
              src: z.string().optional().describe("URL pública da imagem (para tipo imagem)"),
              alt: z.string().optional().describe("Texto alternativo da imagem"),
              width: z.number().optional().describe("Largura da imagem em px (padrão 600)"),
              link: z.string().optional().describe("URL de destino ao clicar na imagem"),
              // rich_text e html
              html: z.string().optional().describe("Conteúdo HTML do bloco (para rich_text e html)"),
              // cta
              texto: z.string().optional().describe("Texto do botão CTA"),
              url: z.string().optional().describe("URL de destino do botão CTA"),
              cor_fundo: z.string().optional().describe("Cor de fundo do botão (hex, ex: #00a988)"),
              cor_texto: z.string().optional().describe("Cor do texto do botão (hex, ex: #ffffff)"),
              tamanho_fonte: z.number().optional().describe("Tamanho da fonte do botão em px"),
              borda_arredondada: z.number().optional().describe("Border radius do botão em px"),
            })
            .describe("Conteúdo específico do bloco conforme o tipo"),
          cor_fundo_secao: z
            .string()
            .optional()
            .describe("Cor de fundo da seção inteira (hex). Use para blocos com background colorido como o teal #56c5d0"),
          padding_top: z.string().optional().describe("Padding superior da seção (ex: '20px')"),
          padding_bottom: z.string().optional().describe("Padding inferior da seção (ex: '20px')"),
        })
      )
      .describe(
        "Array de blocos do miolo do e-mail em ordem de cima para baixo. " +
        "O Claude define esses blocos analisando o Figma. " +
        "Header e footer do template são preservados automaticamente e NÃO devem ser incluídos aqui. " +
        "Exemplos de decisão: banner principal → imagem; saudação + texto → rich_text com {{ contact.firstname }}; " +
        "lista de serviços com ícones → html; botão de agendamento → cta; " +
        "layout amorzito+mapa em 2 colunas → html; badges de especialidades → html."
      ),
  },
  async ({ nome, assunto, preview_text, nome_remetente, email_remetente, blocos }) => {
    try {
      const accountId = process.env.HUBSPOT_ACCOUNT_ID || "5338832";
      const businessUnitId = process.env.HUBSPOT_BUSINESS_UNIT_ID || "255144";

      // Passo 1 — Clonar template base
      console.log(`[montar_email_hibrido] clonando template para: ${nome}`);
      const emailData = await clonarTemplate(nome);
      const clonedId = emailData.id;
      console.log(`[montar_email_hibrido] clone criado: ${clonedId}`);

      // Passo 2 — Mapear seções protegidas (header/footer) e widgets existentes
      const { secoes_protegidas_inicio, secoes_protegidas_fim, widgets: widgetsOriginais } =
        mapearSecoes(emailData.content);

      console.log(`[montar_email_hibrido] seções header: ${secoes_protegidas_inicio.length}, footer: ${secoes_protegidas_fim.length}`);

      // Passo 3 — Montar novas seções a partir dos blocos definidos pelo Claude
      const novasSecoes = [];
      const novosWidgets = {};

      for (const bloco of blocos) {
        const { section, widgetEntry } = montarSecao(bloco);
        novasSecoes.push(section);
        const [wKey, wObj] = widgetEntry;
        novosWidgets[wKey] = wObj;
      }

      // Passo 4 — Compor estrutura final:
      // header protegido + novas seções do miolo + footer protegido
      const secoesFinal = [
        ...secoes_protegidas_inicio,
        ...novasSecoes,
        ...secoes_protegidas_fim,
      ];

      // Passo 5 — Widgets finais: protegidos originais + novos do miolo
      const widgetsFinal = { ...widgetsOriginais, ...novosWidgets };

      // Passo 6 — Atualizar preview_text se fornecido
      if (preview_text && widgetsFinal["preview_text"]) {
        widgetsFinal["preview_text"] = {
          ...widgetsFinal["preview_text"],
          body: { value: preview_text },
        };
      }

      // Passo 7 — PATCH com a estrutura completa
      await hs.patch(`/marketing/v3/emails/${clonedId}`, {
        name: nome,
        subject: assunto,
        from: {
          fromName: nome_remetente || "AmorSaúde",
          fromEmail: email_remetente || "naoresponda@amorsaude.com",
          replyTo: email_remetente || "naoresponda@amorsaude.com",
        },
        content: {
          ...emailData.content,
          flexAreas: {
            ...emailData.content?.flexAreas,
            main: {
              ...emailData.content?.flexAreas?.main,
              sections: secoesFinal,
            },
          },
          widgets: widgetsFinal,
        },
      });

      console.log(`[montar_email_hibrido] ✅ e-mail montado com ${novasSecoes.length} seções de miolo`);

      const editUrl = `https://app.hubspot.com/email/${accountId}/edit/${clonedId}/content?returnPath=%2Fmanage%2Fstate%2Fdraft%3FbusinessUnitId%3D${businessUnitId}`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: clonedId,
                name: nome,
                subject: assunto,
                state: "DRAFT",
                total_secoes_miolo: novasSecoes.length,
                secoes_header_preservadas: secoes_protegidas_inicio.length,
                secoes_footer_preservadas: secoes_protegidas_fim.length,
                blocos_por_tipo: blocos.reduce((acc, b) => {
                  acc[b.tipo] = (acc[b.tipo] || 0) + 1;
                  return acc;
                }, {}),
                editUrl,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data || err.message;
      console.error(`[montar_email_hibrido] ❌ erro:`, detail);
      return {
        content: [{ type: "text", text: `❌ Erro ao montar e-mail híbrido: ${JSON.stringify(detail)}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 2: inspecionar_secoes ────────────────────────────────────────────────
server.tool(
  "inspecionar_secoes",
  `Retorna a estrutura de flexAreas.main.sections de um e-mail HubSpot, identificando
   quais seções são header/footer protegidos e quais são o miolo editável.
   Use antes de montar_email_hibrido para entender a estrutura do template base,
   ou após para verificar se o e-mail foi montado corretamente.`,
  {
    email_id: z.string().describe("ID do e-mail no HubSpot"),
  },
  async ({ email_id }) => {
    try {
      const res = await hs.get(`/marketing/v3/emails/${email_id}`);
      const content = res.data?.content || {};
      const sections = content?.flexAreas?.main?.sections || [];
      const widgets = content?.widgets || {};

      const resultado = sections.map((section, idx) => {
        const widgetKeys = section.columns?.flatMap((col) => col.widgets || []) || [];
        const ehProtegida = widgetKeys.some((k) => PROTECTED_WIDGET_KEYS.has(k));

        const widgetsInfo = widgetKeys.map((key) => {
          const w = widgets[key];
          const bodyKeys = Object.keys(w?.body || {});
          const tipo = bodyKeys.includes("path")
            ? w.body.path?.split("/").pop() || "modulo_nativo"
            : bodyKeys.includes("html") && !bodyKeys.includes("path")
            ? "html_customizado"
            : bodyKeys.includes("img")
            ? "imagem"
            : bodyKeys.includes("value")
            ? "texto"
            : "desconhecido";

          return {
            key,
            tipo,
            protegido: PROTECTED_WIDGET_KEYS.has(key),
            preview: w?.body?.html?.substring(0, 100) ||
                     w?.body?.value?.substring(0, 100) ||
                     w?.body?.img?.src?.substring(0, 100) ||
                     null,
          };
        });

        return {
          indice: idx,
          section_id: section.id,
          protegida: ehProtegida,
          papel: ehProtegida ? (idx < sections.length / 2 ? "header" : "footer") : "miolo_editavel",
          widgets: widgetsInfo,
          style: section.style,
        };
      });

      const resumo = {
        total_secoes: sections.length,
        header: resultado.filter((s) => s.papel === "header").length,
        miolo_editavel: resultado.filter((s) => s.papel === "miolo_editavel").length,
        footer: resultado.filter((s) => s.papel === "footer").length,
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ resumo, secoes: resultado }, null, 2),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return {
        content: [{ type: "text", text: `❌ Erro ao inspecionar seções: ${detail}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 3: listar_emails ─────────────────────────────────────────────────────
server.tool(
  "listar_emails",
  "Lista os e-mails de marketing cadastrados no HubSpot. Pode filtrar por estado (DRAFT, PUBLISHED, etc.).",
  {
    estado: z.enum(["DRAFT", "PUBLISHED", "SCHEDULED", "ARCHIVED"]).optional(),
    limite: z.number().optional().default(10),
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
        content: [{ type: "text", text: JSON.stringify({ total: emails.length, emails }, null, 2) }],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return { content: [{ type: "text", text: `❌ Erro ao listar e-mails: ${detail}` }], isError: true };
    }
  }
);

// ── Tool 4: atualizar_email_rascunho ──────────────────────────────────────────
server.tool(
  "atualizar_email_rascunho",
  "Atualiza assunto, nome ou HTML de um rascunho já existente no HubSpot pelo ID. Use para correções pontuais pós-criação.",
  {
    email_id: z.string().describe("ID do e-mail no HubSpot"),
    assunto: z.string().optional().describe("Novo assunto do e-mail"),
    html_body: z.string().optional().describe("Novo HTML — substitui o widget HTML principal (uso legado)"),
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
      const accountId = process.env.HUBSPOT_ACCOUNT_ID || "5338832";
      const businessUnitId = process.env.HUBSPOT_BUSINESS_UNIT_ID || "255144";
      const editUrl = `https://app.hubspot.com/email/${accountId}/edit/${id}/content?returnPath=%2Fmanage%2Fstate%2Fdraft%3FbusinessUnitId%3D${businessUnitId}`;
      return {
        content: [{ type: "text", text: JSON.stringify({ id, name, subject, state, editUrl }, null, 2) }],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return { content: [{ type: "text", text: `❌ Erro ao atualizar rascunho: ${detail}` }], isError: true };
    }
  }
);

// ── Tool 5: inspecionar_widgets ───────────────────────────────────────────────
server.tool(
  "inspecionar_widgets",
  "Retorna a estrutura de widgets de um e-mail HubSpot. Use para diagnóstico ou para identificar keys específicas.",
  {
    email_id: z.string().describe("ID do e-mail no HubSpot"),
  },
  async ({ email_id }) => {
    try {
      const res = await hs.get(`/marketing/v3/emails/${email_id}`);
      const widgets = res.data?.content?.widgets || {};
      const resultado = Object.entries(widgets).map(([key, w]) => ({
        key,
        type: w?.type,
        protegido: PROTECTED_WIDGET_KEYS.has(key),
        bodyKeys: Object.keys(w?.body || {}),
        htmlPreview: w?.body?.html ? w.body.html.substring(0, 150) : null,
        valuePreview: w?.body?.value ? String(w.body.value).substring(0, 150) : null,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ totalWidgets: resultado.length, widgets: resultado }, null, 2) }],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      return { content: [{ type: "text", text: `❌ Erro: ${detail}` }], isError: true };
    }
  }
);

// ── Tool 6: upload_asset ──────────────────────────────────────────────────────
server.tool(
  "upload_asset",
  `Faz o download de uma URL de imagem (ex: URL de export do Figma) e sobe para o File Manager do HubSpot.
   Retorna a URL pública permanente para uso nos blocos de imagem e HTML do e-mail.
   Chame esta tool para cada asset antes de chamar montar_email_hibrido.`,
  {
    url_origem: z.string().describe("URL pública da imagem a ser baixada (ex: URL de render do Figma, CDN, etc.)"),
    nome_arquivo: z.string().describe("Nome do arquivo com extensão (ex: banner-dermatologista.png). Use kebab-case, sem espaços."),
    pasta: z.string().optional().default("crm-emails").describe("Pasta no File Manager do HubSpot (padrão: crm-emails)"),
  },
  async ({ url_origem, nome_arquivo, pasta }) => {
    try {
      console.log(`[upload_asset] baixando: ${url_origem}`);
      const downloadRes = await axios.get(url_origem, {
        responseType: "arraybuffer",
        timeout: 30000,
        headers: {
          ...(url_origem.includes("figma.com") && process.env.FIGMA_TOKEN
            ? { "X-Figma-Token": process.env.FIGMA_TOKEN }
            : {}),
        },
      });

      const fileBuffer = Buffer.from(downloadRes.data);
      const contentType = downloadRes.headers["content-type"] || "image/png";
      console.log(`[upload_asset] baixado ${fileBuffer.length} bytes | content-type: ${contentType}`);

      const form = new FormData();
      form.append("file", fileBuffer, { filename: nome_arquivo, contentType });
      form.append("folderPath", `/${pasta}`);
      form.append(
        "options",
        JSON.stringify({
          access: "PUBLIC_NOT_INDEXABLE",
          overwrite: true,
          duplicateValidationStrategy: "NONE",
          duplicateValidationScope: "ENTIRE_PORTAL",
        })
      );

      const uploadRes = await axios.post("https://api.hubapi.com/files/v3/files", form, {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, ...form.getHeaders() },
        maxBodyLength: Infinity,
        timeout: 60000,
      });

      const { id: fileId, url: fileUrl, name } = uploadRes.data;
      console.log(`[upload_asset] ✅ sucesso: fileId=${fileId} url=${fileUrl}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { sucesso: true, fileId, nome: name, url_publica: fileUrl, pasta: `/${pasta}` },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data || err.message;
      console.error(`[upload_asset] ❌ erro:`, detail);
      return {
        content: [{ type: "text", text: `❌ Erro ao fazer upload do asset: ${JSON.stringify(detail)}` }],
        isError: true,
      };
    }
  }
);

// ── Tool 7: notificar_crm ─────────────────────────────────────────────────────
server.tool(
  "notificar_crm",
  "Envia uma mensagem no Slack para o canal do time de CRM avisando que um rascunho de e-mail está pronto para disparo no HubSpot.",
  {
    nome_email: z.string().describe("Nome do e-mail criado"),
    assunto: z.string().describe("Assunto do e-mail"),
    edit_url: z.string().describe("URL direta para editar/disparar o rascunho no HubSpot"),
    responsavel: z.string().optional().describe("Nome do responsável pelo disparo"),
    observacoes: z.string().optional().describe("Instruções adicionais para o time de CRM"),
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
          { type: "header", text: { type: "plain_text", text: "📧 E-mail pronto para disparo!", emoji: true } },
          { type: "section", text: { type: "mrkdwn", text: `*${nome_email}*\n*Assunto:* ${assunto}\n${mencao}${obs}` } },
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
          { type: "text", text: JSON.stringify({ sucesso: true, mensagem: "Notificação enviada ao canal do time de CRM no Slack." }, null, 2) },
        ],
      };
    } catch (err) {
      const detail = err.response?.data || err.message;
      return { content: [{ type: "text", text: `❌ Erro ao notificar via Slack: ${JSON.stringify(detail)}` }], isError: true };
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
const authCodes = new Map();

app.get("/", (_req, res) => {
  res.json({ name: "hubspot-email-mcp", version: "3.0.0", status: "ok" });
});

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256", "plain"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
  });
});

const handleAuthorize = (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.query;
  console.log(`[authorize] client_id=${client_id} redirect_uri=${redirect_uri}`);
  if (!redirect_uri) return res.status(400).json({ error: "redirect_uri obrigatório" });
  const code = `code_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  authCodes.set(code, { redirect_uri, code_challenge, code_challenge_method, client_id, created_at: Date.now() });
  const callbackUrl = new URL(redirect_uri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);
  res.redirect(callbackUrl.toString());
};

app.get("/oauth/authorize", handleAuthorize);
app.get("/authorize", handleAuthorize);

const handleToken = (req, res) => {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = Object.fromEntries(new URLSearchParams(body)); }
  }
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
    const [id, secret] = decoded.split(":");
    body.client_id = body.client_id || id;
    body.client_secret = body.client_secret || secret;
  }
  const { code, grant_type, client_id, client_secret } = body || {};
  console.log(`[token] grant_type=${grant_type} client_id=${client_id} code=${code}`);
  if (client_id && client_id !== OAUTH_CLIENT_ID) return res.status(401).json({ error: "invalid_client" });
  if (client_secret && client_secret !== OAUTH_CLIENT_SECRET) return res.status(401).json({ error: "invalid_client" });
  if (grant_type === "authorization_code") {
    if (!code || !authCodes.has(code)) return res.status(400).json({ error: "invalid_grant" });
    authCodes.delete(code);
  }
  res.json({ access_token: MCP_SECRET, token_type: "bearer", expires_in: 31536000 });
};

app.post("/oauth/token", express.text({ type: "*/*" }), handleToken);
app.post("/token", express.text({ type: "*/*" }), handleToken);

app.post("/mcp", async (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^[Bb]earer\s+/, "").trim();
  if (token !== MCP_SECRET) {
    res.setHeader("WWW-Authenticate", `Bearer realm="${BASE_URL}"`);
    return res.status(401).json({ error: "Unauthorized" });
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) => {
  res.json({ name: "hubspot-email-mcp", version: "3.0.0", description: "MCP para e-mails de marketing no HubSpot — AmorSaúde" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "hubspot-email-mcp", version: "3.0.0" });
});

app.listen(PORT, () => {
  console.log(`✅ HubSpot MCP v3.0.0 rodando na porta ${PORT}`);
  console.log(`   Tools: montar_email_hibrido, inspecionar_secoes, listar_emails,`);
  console.log(`          atualizar_email_rascunho, inspecionar_widgets, upload_asset, notificar_crm`);
  console.log(`   POST /mcp     → endpoint MCP`);
  console.log(`   GET  /health  → health check`);
  console.log(`   OAuth em ${BASE_URL}`);
});

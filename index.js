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
  console.error("❌ HUBSPOT_TOKEN não definido.");
  process.exit(1);
}
if (!SLACK_WEBHOOK_URL) {
  console.warn("⚠️  SLACK_WEBHOOK_URL não definido — notificar_crm indisponível.");
}

const hs = axios.create({
  baseURL: "https://api.hubapi.com",
  headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
});

// ─── Widget keys do template base (ID: 213359251380) ─────────────────────────
const TEMPLATE_WIDGETS = {
  banner_hero:          { tipo: "image_email", funcao: "Banner ou imagem hero da campanha" },
  texto_intro:          { tipo: "rich_text",   funcao: "Saudação, olá, texto introdutório. Suporta {{ contact.firstname }}" },
  bloco_icone_1:        { tipo: "rich_text",   funcao: "Ícone circular + subtítulo destacado como imagem (1º bloco)" },
  texto_corpo:          { tipo: "rich_text",   funcao: "Parágrafos de corpo, texto explicativo" },
  bloco_icone_2:        { tipo: "rich_text",   funcao: "Ícone circular + subtítulo destacado como imagem (2º bloco)" },
  cta_principal:        { tipo: "rich_text",   funcao: "Botão de ação principal (ex: agendar consulta)" },
  texto_blog:           { tipo: "rich_text",   funcao: "Parágrafo secundário, chamada para blog ou conteúdo extra" },
  cta_secundario:       { tipo: "rich_text",   funcao: "Botão de ação secundário (ex: ler no blog)" },
  bloco_especial:       { tipo: "rich_text",   funcao: "Elemento especial da campanha: data comemorativa, ícone único, Amorzito+mapa, lista de serviços com checks" },
  bloco_especialidades: { tipo: "rich_text",   funcao: "Menu de especialidades (Medicina|Odonto|Exames|Cirurgias) + heart + tagline AmorSaúde" },
  footer_fixo:          { tipo: "rich_text",   funcao: "Footer completo: Amorzito+mapa, especialidades, redes sociais, CTAs, legal. Preenchido automaticamente pelo MCP com as UTMs da campanha." },
};

// ─── HTML base do footer_fixo — UTMs preenchidas pelo MCP no momento da criação
// Estrutura visual idêntica ao footer anterior (v3), agora como widget do miolo.
function gerarHtmlFooter(utm_campaign) {
  const utm = encodeURIComponent(utm_campaign || "");

  return `
<!-- Footer A — Amorzito + Mapa -->
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ebeff0;">
  <tr>
    <td style="background-color:#ebeff0;padding:28px 48px 0 48px;">
      <table class="esp-amorzito" width="504" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="esp-amorzito-td" width="244" valign="middle"
              style="width:244px;padding-right:50px;padding-bottom:12px;">
            <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/Frame%201321314360.png"
                 alt="Amorzito — Cuidando de você" width="244"
                 style="display:block;width:244px;max-width:100%;height:auto;border-radius:10px;" />
          </td>
          <td class="esp-amorzito-td" width="210" valign="middle"
              style="width:210px;text-align:center;">
            <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/especialidades-mapa-brasil.png"
                 alt="Mapa do Brasil" width="62"
                 style="display:block;margin:0 auto 8px auto;width:62px;height:auto;" />
            <p style="font-family:Arial,sans-serif;font-size:12px;color:#56c5d0;font-weight:600;text-align:center;margin:0;line-height:1.4;">
              Atendimento nas principais áreas<br>
              de atuações com o mais preparado<br>
              quadro médico do Brasil.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="background-color:#ebeff0;padding:16px 48px 24px 48px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="esp-btn-td" width="115" style="padding-right:15px;padding-bottom:8px;">
            <a href="https://amorsaude.com.br/medicina/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank" style="display:block;line-height:0;font-size:0;">
              <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/btn-medicina.png"
                   alt="Medicina" width="115" style="display:block;width:100%;max-width:130px;height:auto;border:0;" />
            </a>
          </td>
          <td class="esp-btn-td" width="115" style="padding-right:15px;padding-bottom:8px;">
            <a href="https://amorsaude.com.br/odontologia/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank" style="display:block;line-height:0;font-size:0;">
              <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/btn-odontologia.png"
                   alt="Odontologia" width="115" style="display:block;width:100%;max-width:130px;height:auto;border:0;" />
            </a>
          </td>
          <td class="esp-btn-td" width="115" style="padding-right:15px;padding-bottom:8px;">
            <a href="https://mkt.amorsaude.com.br/as-redirect?campanha=exame&unidade={{ contact.unidade_de_interesse___procedimento }}" target="_blank" style="display:block;line-height:0;font-size:0;">
              <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/btn-exames.png"
                   alt="Exames" width="115" style="display:block;width:100%;max-width:130px;height:auto;border:0;" />
            </a>
          </td>
          <td class="esp-btn-td" width="115" style="padding-bottom:8px;">
            <a href="https://api.whatsapp.com/send/?phone=16997303972&text=Ol%C3%A1,%20quero%20conversar%20sobre%20cirurgias" target="_blank" style="display:block;line-height:0;font-size:0;">
              <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/btn-cirurgias.png"
                   alt="Cirurgias" width="115" style="display:block;width:100%;max-width:130px;height:auto;border:0;" />
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<!-- Footer B — Redes sociais + Blog + Site -->
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#56c5d0;">
  <tr>
    <td style="background-color:#56c5d0;padding:18px 24px 10px 24px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" style="padding-right:8px;">
                  <p style="font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#1b5a64;margin:0;white-space:nowrap;">Acesse nossas redes sociais.</p>
                </td>
                <td valign="middle" style="padding-right:8px;">
                  <a href="https://www.facebook.com/amorsaudebrasil/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank" style="display:block;line-height:0;">
                    <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/social-icons/social-facebook.png" alt="Facebook" width="13" height="13" style="display:block;border:0;" />
                  </a>
                </td>
                <td valign="middle" style="padding-right:8px;">
                  <a href="https://www.youtube.com/channel/UCd9oI3h_8AjFyrz2ljDSEFg/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank" style="display:block;line-height:0;">
                    <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/social-icons/social-youtube.png" alt="YouTube" width="18" height="13" style="display:block;border:0;" />
                  </a>
                </td>
                <td valign="middle" style="padding-right:8px;">
                  <a href="https://www.linkedin.com/company/amorsaudebrasil/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank" style="display:block;line-height:0;">
                    <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/social-icons/social-linkedin.png" alt="LinkedIn" width="13" height="13" style="display:block;border:0;" />
                  </a>
                </td>
                <td valign="middle">
                  <a href="https://www.instagram.com/amorsaudebrasil/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank" style="display:block;line-height:0;">
                    <img src="https://5338832.fs1.hubspotusercontent-na1.net/hubfs/5338832/crm-emails/template-base/social-icons/social-instagram.png" alt="Instagram" width="13" height="13" style="display:block;border:0;" />
                  </a>
                </td>
              </tr>
            </table>
          </td>
          <td align="right" valign="middle">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding-right:8px;">
                  <a href="https://blog.amorsaude.com.br/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank"
                     style="display:inline-block;background-color:#ffffff;color:#56c5d0;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;padding:5px 14px;border-radius:5px;text-decoration:none;">Blog</a>
                </td>
                <td>
                  <a href="https://amorsaude.com.br/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank"
                     style="display:inline-block;background-color:#ffffff;color:#56c5d0;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;padding:5px 14px;border-radius:5px;text-decoration:none;">Site</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer C — CTAs de agendamento -->
  <tr>
    <td style="background-color:#56c5d0;padding:8px 24px 10px 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td class="cta-td" style="padding-right:6px;padding-bottom:4px;white-space:nowrap;">
            <a href="https://paciente.amorsaude.com.br/agendar_consulta?utm_medium=emailhs&utm_source=Amorsaude&utm_campaign=${utm}" target="_blank"
               style="display:inline-block;background-color:#da473f;color:#ffffff;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;padding:5px 14px;border-radius:4px;text-decoration:none;">Consulta presencial</a>
          </td>
          <td class="cta-td" style="padding-right:6px;padding-bottom:4px;white-space:nowrap;">
            <a href="https://telemedicinaamorsaude.agendar.cc/?utm_medium=emailhs&utm_source=Amorsaude&utm_campaign=${utm}" target="_blank"
               style="display:inline-block;background-color:#da473f;color:#ffffff;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;padding:5px 14px;border-radius:4px;text-decoration:none;">Consulta por chamada de vídeo</a>
          </td>
          <td class="cta-td" style="padding-bottom:4px;white-space:nowrap;">
            <a href="https://amorsaude.com.br/unidades/?utm_source=Amorsaude&utm_medium=emailhs&utm_campaign=${utm}" target="_blank"
               style="display:inline-block;background-color:#da473f;color:#ffffff;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;padding:5px 14px;border-radius:4px;text-decoration:none;">Mapa de clínicas</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer D — Legal + descadastro -->
  <tr>
    <td style="background-color:#56c5d0;padding:8px 24px 24px 24px;">
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">
        Caso não queira mais receber nossos e-mails <a href="{{ unsubscribe_link }}" style="color:#1b5a64;font-weight:bold;text-decoration:underline;">Clique aqui</a>. Aguarde até 3 dias úteis para que seu contato seja retirado de nossa base de clientes. Para maiores informações, leia nosso <a href="https://www.amorsaude.com.br/politica-de-privacidade/" style="color:#1b5a64;font-weight:bold;text-decoration:underline;">Termo de Uso</a> e <a href="https://www.amorsaude.com.br/politica-de-privacidade/" style="color:#1b5a64;font-weight:bold;text-decoration:underline;">Política de Dados</a>.
      </p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">&nbsp;</p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">
        *AmorSaúde não comercializa <strong>CONVÊNIOS</strong> nem <strong>CARTÕES DE DESCONTO</strong>, sendo sua atuação exclusivamente em medicina, odontologia e exames.
      </p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">&nbsp;</p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">
        <strong>AmorSaúde</strong><br>
        Rua Magid Antônio Calil, 176 - Jardim Botânico, Ribeirão Preto, São Paulo 14021-644, Brasil.
      </p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">&nbsp;</p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">
        Responsáveis Técnicos:<br>
        Alexandre Pimenta CRM 51971 MG | Wanderson Lage CRO: 24186 MG
      </p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0 0 4px 0;">&nbsp;</p>
      <p style="font-family:Arial,sans-serif;font-size:9px;color:#1b5a64;line-height:1.4;margin:0;">
        {{ site_settings.company_name }}, {{ site_settings.company_street_address_1 }}, {{ site_settings.company_city }}, {{ site_settings.company_state }} {{ site_settings.company_zip }}<br>
        <a href="{{ unsubscribe_link_all }}" style="color:#1b5a64;text-decoration:underline;">Descadastrar de todos os e-mails</a> | <a href="{{ unsubscribe_link }}" style="color:#1b5a64;text-decoration:underline;">Gerenciar preferências</a>
      </p>
    </td>
  </tr>
</table>
`.trim();
}

// ─── Helper: clonar template e retornar dados completos ──────────────────────
async function clonarTemplate(nome) {
  const TEMPLATE_ID = process.env.HUBSPOT_TEMPLATE_ID || "213359251380";
  const cloneRes = await hs.post("/marketing/v3/emails/clone", { id: TEMPLATE_ID, cloneName: nome });
  const getRes = await hs.get(`/marketing/v3/emails/${cloneRes.data.id}`);
  return getRes.data;
}

// ─── Helper: aplicar utm_campaign em widgets do miolo (segurança extra) ───────
function aplicarUtm(widgets, utm_campaign) {
  if (!utm_campaign) return widgets;

  const utmValue = encodeURIComponent(utm_campaign);
  const substituir = (texto) => {
    if (!texto || typeof texto !== "string") return texto;
    return texto.replace(/utm_campaign=(?=[&"'\s]|$)/g, `utm_campaign=${utmValue}`);
  };

  const resultado = {};
  for (const [key, widget] of Object.entries(widgets)) {
    const body = widget?.body || {};
    const novoBody = { ...body };
    if (typeof body.html  === "string") novoBody.html  = substituir(body.html);
    if (typeof body.value === "string") novoBody.value = substituir(body.value);
    if (typeof body.link  === "string") novoBody.link  = substituir(body.link);
    if (body.img?.src && typeof body.img.src === "string") {
      novoBody.img = { ...body.img, src: substituir(body.img.src) };
    }
    resultado[key] = { ...widget, body: novoBody };
  }
  return resultado;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new McpServer({ name: "hubspot-email-mcp", version: "4.0.0" });

// ── Tool 1: montar_email_hibrido ──────────────────────────────────────────────
server.tool(
  "montar_email_hibrido",
  `Clona o template base AmorSaúde e monta o e-mail preenchendo os widgets existentes
   com o conteúdo de cada bloco identificado no Figma.

   ARQUITETURA v4:
   O footer é agora um widget do miolo (footer_fixo). O MCP o gera automaticamente
   com todas as UTMs já preenchidas — não é necessário chamar preencher_utms_footer.

   FLUXO QUE O CLAUDE DEVE SEGUIR:
   1. Analisar o design do Figma (get_design_context)
   2. Fazer upload de todos os assets via upload_asset
   3. Para cada elemento visual do Figma, escolher o widget_key mais adequado
   4. Montar o array de blocos na ORDEM do design (de cima para baixo)
   5. NÃO incluir footer_fixo nos blocos — ele é adicionado automaticamente
   6. Chamar esta tool com o array montado

   WIDGETS DISPONÍVEIS NO TEMPLATE (usar widget_key exato):
   • "banner_hero"          → image_email  — Banner/imagem hero. Usar conteudo.src + conteudo.alt
   • "texto_intro"          → rich_text    — Saudação, "Olá,", parágrafos iniciais. Suporta {{ contact.firstname }}
   • "bloco_icone_1"        → rich_text    — 1º ícone redondo + subtítulo destacado (imagem exportada do Figma)
   • "texto_corpo"          → rich_text    — Parágrafos explicativos do corpo
   • "bloco_icone_2"        → rich_text    — 2º ícone redondo + subtítulo destacado
   • "cta_principal"        → rich_text    — Botão CTA principal (tabela HTML com <a> estilizado)
   • "texto_blog"           → rich_text    — Parágrafo secundário ou chamada para blog
   • "cta_secundario"       → rich_text    — Botão CTA secundário
   • "bloco_especial"       → rich_text    — Elemento único da campanha: data comemorativa, Amorzito+mapa,
                                             lista de serviços com checks, layout 2 colunas, bloco colorido
   • "bloco_especialidades" → rich_text    — Menu Medicina|Odonto|Exames|Cirurgias + heart + tagline
   • "footer_fixo"          → rich_text    — AUTOMÁTICO. Não incluir nos blocos. Gerado pelo MCP com UTMs.

   REGRAS DE DECISÃO:
   • Nem todos os widgets precisam ser usados — inclua apenas os que têm correspondência no Figma
   • A ORDEM dos blocos define a ordem visual no e-mail — respeite o layout do Figma
   • Um mesmo widget_key não pode aparecer duas vezes
   • CTAs são sempre tabelas HTML com <a> estilizado — NÃO usar @hubspot/email_button
   • Imagens dentro de rich_text: usar <img src="URL_HUBSPOT"> com URL do File Manager
   • O footer_fixo é sempre o último bloco e é adicionado automaticamente

   EXEMPLO DE MAPEAMENTO FIGMA → WIDGETS:
   Figma tem: banner + olá + texto + botão vermelho + data + especialidades
   Blocos:    banner_hero, texto_intro, texto_corpo, cta_principal, bloco_especial, bloco_especialidades
   (footer_fixo é adicionado automaticamente ao final)`,
  {
    nome: z.string().describe("Nome interno do e-mail"),
    assunto: z.string().describe("Assunto do e-mail"),
    preview_text: z.string().optional().describe("Texto de preview na caixa de entrada"),
    nome_remetente: z.string().optional(),
    email_remetente: z.string().optional(),
    utm_campaign: z.string().optional().describe(
      "Valor da UTM campaign. Aplicado automaticamente em TODOS os links: miolo + footer completo. " +
      "Use kebab-case sem espaços (ex: 'dia-do-dermatologista-fev26', 'onboarding-cdt-mai26'). " +
      "URLs que já têm utm_campaign preenchido não são alteradas."
    ),
    blocos: z.array(
      z.object({
        widget_key: z.enum([
          "banner_hero",
          "texto_intro",
          "bloco_icone_1",
          "texto_corpo",
          "bloco_icone_2",
          "cta_principal",
          "texto_blog",
          "cta_secundario",
          "bloco_especial",
          "bloco_especialidades",
        ]).describe("Widget key do template. Não incluir footer_fixo — é adicionado automaticamente."),
        conteudo: z.object({
          src:   z.string().optional().describe("URL pública da imagem no HubSpot File Manager"),
          alt:   z.string().optional().describe("Texto alternativo da imagem"),
          width: z.number().optional().describe("Largura da imagem em px (padrão 600)"),
          link:  z.string().optional().describe("URL de destino ao clicar na imagem"),
          html:  z.string().optional().describe(
            "HTML do bloco para widgets rich_text. " +
            "HTML de e-mail válido (tabelas, inline styles, sem CSS externo). " +
            "Para CTAs: tabela com <a> estilizado como botão. " +
            "Para blocos complexos: HTML completo do layout."
          ),
        }),
        cor_fundo_secao: z.string().optional().describe("Cor de fundo da seção (hex). Ex: #ffffff, #56c5d0"),
      })
    ),
  },
  async ({ nome, assunto, preview_text, nome_remetente, email_remetente, utm_campaign, blocos }) => {
    try {
      const accountId = process.env.HUBSPOT_ACCOUNT_ID || "5338832";
      const businessUnitId = process.env.HUBSPOT_BUSINESS_UNIT_ID || "255144";

      console.log(`[montar_email_hibrido] clonando template para: ${nome}`);
      const emailData = await clonarTemplate(nome);
      const clonedId = emailData.id;
      console.log(`[montar_email_hibrido] clone: ${clonedId}`);

      const sections = emailData.content?.flexAreas?.main?.sections || [];
      const widgetsOriginais = emailData.content?.widgets || {};

      // Mapa de seção por widget_key
      const secaoPorKey = {};
      for (const section of sections) {
        for (const col of section.columns || []) {
          for (const wKey of col.widgets || []) {
            secaoPorKey[wKey] = section;
          }
        }
      }

      const novasSecoes = [];
      const widgetsAtualizados = { ...widgetsOriginais };

      // Montar blocos do miolo na ordem definida pelo Claude
      for (const bloco of blocos) {
        const { widget_key, conteudo, cor_fundo_secao } = bloco;
        const secaoOriginal = secaoPorKey[widget_key];

        if (!secaoOriginal) {
          console.warn(`[montar_email_hibrido] widget_key não encontrado no clone: ${widget_key}`);
          continue;
        }

        novasSecoes.push({
          ...secaoOriginal,
          style: {
            ...secaoOriginal.style,
            backgroundColor: cor_fundo_secao || secaoOriginal.style?.backgroundColor || "#ffffff",
          },
        });

        const tipoWidget = TEMPLATE_WIDGETS[widget_key]?.tipo;
        const widgetAtual = widgetsAtualizados[widget_key] || {};

        if (tipoWidget === "image_email") {
          widgetsAtualizados[widget_key] = {
            ...widgetAtual,
            body: {
              ...widgetAtual.body,
              img: {
                ...(widgetAtual.body?.img || {}),
                src: conteudo.src || widgetAtual.body?.img?.src,
                alt: conteudo.alt || "",
                width: conteudo.width || 600,
              },
              link: conteudo.link || "",
            },
          };
        } else {
          widgetsAtualizados[widget_key] = {
            ...widgetAtual,
            body: {
              ...widgetAtual.body,
              html: conteudo.html || widgetAtual.body?.html || "",
            },
          };
        }

        console.log(`[montar_email_hibrido] ✓ ${widget_key} (${tipoWidget}) atualizado`);
      }

      // Preview text
      if (preview_text && widgetsAtualizados["preview_text"]) {
        widgetsAtualizados["preview_text"] = {
          ...widgetsAtualizados["preview_text"],
          body: { value: preview_text },
        };
      }

      // Adicionar footer_fixo automaticamente ao final com UTMs já preenchidas
      const secaoFooter = secaoPorKey["footer_fixo"];
      if (secaoFooter) {
        novasSecoes.push({
          ...secaoFooter,
          style: { ...secaoFooter.style, backgroundColor: "#ebeff0" },
        });
        widgetsAtualizados["footer_fixo"] = {
          ...(widgetsAtualizados["footer_fixo"] || {}),
          body: {
            ...(widgetsAtualizados["footer_fixo"]?.body || {}),
            html: gerarHtmlFooter(utm_campaign),
          },
        };
        console.log(`[montar_email_hibrido] ✓ footer_fixo gerado com utm_campaign="${utm_campaign || ""}"`);
      } else {
        console.warn(`[montar_email_hibrido] ⚠️ widget footer_fixo não encontrado no template — verifique se o template foi atualizado para v4`);
      }

      // Aplicar utm_campaign como segurança extra nos demais widgets do miolo
      const widgetsComUtm = aplicarUtm(widgetsAtualizados, utm_campaign);

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
              sections: novasSecoes,
            },
          },
          widgets: widgetsComUtm,
        },
      });

      console.log(`[montar_email_hibrido] ✅ ${novasSecoes.length} seções montadas`);

      const editUrl = `https://app.hubspot.com/email/${accountId}/edit/${clonedId}/content?returnPath=%2Fmanage%2Fstate%2Fdraft%3FbusinessUnitId%3D${businessUnitId}`;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: clonedId,
            name: nome,
            subject: assunto,
            state: "DRAFT",
            utm_campaign: utm_campaign || null,
            widgets_usados: [...blocos.map(b => b.widget_key), "footer_fixo"],
            total_secoes: novasSecoes.length,
            editUrl,
          }, null, 2),
        }],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data || err.message;
      console.error(`[montar_email_hibrido] ❌`, detail);
      return { content: [{ type: "text", text: `❌ Erro: ${JSON.stringify(detail)}` }], isError: true };
    }
  }
);

// ── Tool 2: inspecionar_secoes ────────────────────────────────────────────────
server.tool(
  "inspecionar_secoes",
  "Mapeia as seções flexAreas de um e-mail HubSpot. Use para verificar widget keys e estrutura após clonar.",
  { email_id: z.string() },
  async ({ email_id }) => {
    try {
      const res = await hs.get(`/marketing/v3/emails/${email_id}`);
      const sections = res.data?.content?.flexAreas?.main?.sections || [];
      const widgets = res.data?.content?.widgets || {};

      const resultado = sections.map((section, idx) => {
        const widgetKeys = section.columns?.flatMap(col => col.widgets || []) || [];
        return {
          indice: idx,
          section_id: section.id,
          widget_keys: widgetKeys,
          widgets_info: widgetKeys.map(key => {
            const w = widgets[key];
            const bodyKeys = Object.keys(w?.body || {});
            return {
              key,
              tipo: bodyKeys.includes("img")   ? "image_email"
                  : bodyKeys.includes("html")  ? "rich_text"
                  : bodyKeys.includes("value") ? "value"
                  : "outro",
              preview: w?.body?.html?.substring(0, 80)
                    || w?.body?.img?.src?.substring(0, 80)
                    || w?.body?.value?.substring(0, 80)
                    || null,
            };
          }),
          background: section.style?.backgroundColor,
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_secoes: sections.length,
            secoes: resultado,
            widgets_disponiveis: Object.keys(TEMPLATE_WIDGETS),
          }, null, 2),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Erro: ${err.response?.data?.message || err.message}` }], isError: true };
    }
  }
);

// ── Tool 3: listar_emails ─────────────────────────────────────────────────────
server.tool(
  "listar_emails",
  "Lista e-mails de marketing no HubSpot.",
  { estado: z.enum(["DRAFT","PUBLISHED","SCHEDULED","ARCHIVED"]).optional(), limite: z.number().optional().default(10) },
  async ({ estado, limite }) => {
    try {
      const params = { limit: limite };
      if (estado) params.state = estado;
      const res = await hs.get("/marketing/v3/emails", { params });
      const emails = res.data.results.map(e => ({
        id: e.id, nome: e.name, assunto: e.subject, estado: e.state, atualizadoEm: e.updatedAt,
        editUrl: `https://app.hubspot.com/email/${e.id}/edit`,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ total: emails.length, emails }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Erro: ${err.response?.data?.message || err.message}` }], isError: true };
    }
  }
);

// ── Tool 4: atualizar_email_rascunho ──────────────────────────────────────────
server.tool(
  "atualizar_email_rascunho",
  "Atualiza assunto, nome de um rascunho existente pelo ID.",
  { email_id: z.string(), assunto: z.string().optional(), nome: z.string().optional() },
  async ({ email_id, assunto, nome }) => {
    try {
      const payload = {};
      if (assunto) payload.subject = assunto;
      if (nome) payload.name = nome;
      const res = await hs.patch(`/marketing/v3/emails/${email_id}`, payload);
      const accountId = process.env.HUBSPOT_ACCOUNT_ID || "5338832";
      const businessUnitId = process.env.HUBSPOT_BUSINESS_UNIT_ID || "255144";
      const editUrl = `https://app.hubspot.com/email/${accountId}/edit/${res.data.id}/content?returnPath=%2Fmanage%2Fstate%2Fdraft%3FbusinessUnitId%3D${businessUnitId}`;
      return { content: [{ type: "text", text: JSON.stringify({ id: res.data.id, name: res.data.name, subject: res.data.subject, state: res.data.state, editUrl }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Erro: ${err.response?.data?.message || err.message}` }], isError: true };
    }
  }
);

// ── Tool 5: inspecionar_widgets ───────────────────────────────────────────────
server.tool(
  "inspecionar_widgets",
  "Retorna estrutura de widgets de um e-mail para diagnóstico.",
  { email_id: z.string() },
  async ({ email_id }) => {
    try {
      const res = await hs.get(`/marketing/v3/emails/${email_id}`);
      const widgets = res.data?.content?.widgets || {};
      const resultado = Object.entries(widgets).map(([key, w]) => ({
        key,
        bodyKeys: Object.keys(w?.body || {}),
        htmlPreview:  w?.body?.html?.substring(0, 120)  || null,
        valuePreview: w?.body?.value?.substring(0, 120) || null,
        imgSrc:       w?.body?.img?.src || null,
        link:         w?.body?.link || null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ total: resultado.length, widgets: resultado }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Erro: ${err.response?.data?.message || err.message}` }], isError: true };
    }
  }
);

// ── Tool 6: upload_asset ──────────────────────────────────────────────────────
server.tool(
  "upload_asset",
  "Baixa imagem de uma URL (ex: Figma) e sobe para o HubSpot File Manager. Retorna URL pública permanente.",
  { url_origem: z.string(), nome_arquivo: z.string(), pasta: z.string().optional().default("crm-emails") },
  async ({ url_origem, nome_arquivo, pasta }) => {
    try {
      console.log(`[upload_asset] baixando: ${url_origem}`);
      const downloadRes = await axios.get(url_origem, {
        responseType: "arraybuffer", timeout: 30000,
        headers: url_origem.includes("figma.com") && process.env.FIGMA_TOKEN
          ? { "X-Figma-Token": process.env.FIGMA_TOKEN } : {},
      });
      const fileBuffer = Buffer.from(downloadRes.data);
      const contentType = downloadRes.headers["content-type"] || "image/png";
      const form = new FormData();
      form.append("file", fileBuffer, { filename: nome_arquivo, contentType });
      form.append("folderPath", `/${pasta}`);
      form.append("options", JSON.stringify({
        access: "PUBLIC_NOT_INDEXABLE", overwrite: true,
        duplicateValidationStrategy: "NONE", duplicateValidationScope: "ENTIRE_PORTAL",
      }));
      const uploadRes = await axios.post("https://api.hubapi.com/files/v3/files", form, {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, ...form.getHeaders() },
        maxBodyLength: Infinity, timeout: 60000,
      });
      const { id: fileId, url: fileUrl, name } = uploadRes.data;
      console.log(`[upload_asset] ✅ ${fileUrl}`);
      return { content: [{ type: "text", text: JSON.stringify({ sucesso: true, fileId, nome: name, url_publica: fileUrl }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Erro upload: ${err.response?.data?.message || err.message}` }], isError: true };
    }
  }
);

// ── Tool 7: debug_email_raw ───────────────────────────────────────────────────
server.tool(
  "debug_email_raw",
  "Retorna as chaves top-level e de content de um e-mail para diagnóstico.",
  { email_id: z.string() },
  async ({ email_id }) => {
    try {
      const res = await hs.get(`/marketing/v3/emails/${email_id}`);
      const data = res.data;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            top_level_keys: Object.keys(data),
            content_keys: Object.keys(data.content || {}),
            widget_keys: Object.keys(data.content?.widgets || {}),
            content_string_fields: Object.fromEntries(
              Object.entries(data.content || {})
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v.substring(0, 300)])
            ),
            widget_sample: Object.entries(data.content?.widgets || {})
              .slice(0, 3)
              .map(([k, v]) => ({
                key: k,
                bodyKeys: Object.keys(v?.body || {}),
                preview: JSON.stringify(v?.body)?.substring(0, 200),
              })),
          }, null, 2),
        }],
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data || err.message;
      return { content: [{ type: "text", text: `❌ Erro: ${JSON.stringify(detail)}` }], isError: true };
    }
  }
);

// ── Tool 8: notificar_crm ─────────────────────────────────────────────────────
server.tool(
  "notificar_crm",
  "Envia mensagem no Slack avisando que um rascunho está pronto para disparo.",
  { nome_email: z.string(), assunto: z.string(), edit_url: z.string(), responsavel: z.string().optional(), observacoes: z.string().optional() },
  async ({ nome_email, assunto, edit_url, responsavel, observacoes }) => {
    if (!SLACK_WEBHOOK_URL) return { content: [{ type: "text", text: "❌ SLACK_WEBHOOK_URL não configurado." }], isError: true };
    try {
      const mencao = responsavel ? `*Responsável:* ${responsavel}\n` : "";
      const obs = observacoes ? `*Observações:* ${observacoes}\n` : "";
      await axios.post(SLACK_WEBHOOK_URL, {
        blocks: [
          { type: "header", text: { type: "plain_text", text: "📧 E-mail pronto para disparo!", emoji: true } },
          { type: "section", text: { type: "mrkdwn", text: `*${nome_email}*\n*Assunto:* ${assunto}\n${mencao}${obs}` } },
          { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "🚀 Abrir no HubSpot", emoji: true }, url: edit_url, style: "primary" }] },
          { type: "context", elements: [{ type: "mrkdwn", text: `Criado pelo Claude • ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` }] },
        ],
      });
      return { content: [{ type: "text", text: JSON.stringify({ sucesso: true }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Erro Slack: ${err.message}` }], isError: true };
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

app.get("/", (_req, res) => res.json({ name: "hubspot-email-mcp", version: "4.0.0", status: "ok" }));

app.get("/.well-known/oauth-authorization-server", (_req, res) => res.json({
  issuer: BASE_URL,
  authorization_endpoint: `${BASE_URL}/authorize`,
  token_endpoint: `${BASE_URL}/token`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256", "plain"],
  token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
}));

const handleAuthorize = (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method, client_id } = req.query;
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
    const [id, secret] = Buffer.from(authHeader.slice(6), "base64").toString().split(":");
    body.client_id = body.client_id || id;
    body.client_secret = body.client_secret || secret;
  }
  const { code, grant_type, client_id, client_secret } = body || {};
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
  const token = (req.headers["authorization"] || "").replace(/^[Bb]earer\s+/, "").trim();
  if (token !== MCP_SECRET) {
    res.setHeader("WWW-Authenticate", `Bearer realm="${BASE_URL}"`);
    return res.status(401).json({ error: "Unauthorized" });
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) => res.json({ name: "hubspot-email-mcp", version: "4.0.0" }));
app.get("/health", (_req, res) => res.json({ status: "ok", version: "4.0.0" }));

app.listen(PORT, () => {
  console.log(`✅ HubSpot MCP v4.0.0 rodando na porta ${PORT}`);
  console.log(`   Template base: ${process.env.HUBSPOT_TEMPLATE_ID || "213359251380"}`);
  console.log(`   Tools: montar_email_hibrido, inspecionar_secoes, inspecionar_widgets, listar_emails, atualizar_email_rascunho, upload_asset, debug_email_raw, notificar_crm`);
  console.log(`   Widgets: ${Object.keys(TEMPLATE_WIDGETS).join(", ")}`);
});

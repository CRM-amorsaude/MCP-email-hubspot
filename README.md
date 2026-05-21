# HubSpot Email MCP — AmorSaúde v3.0.0

Servidor MCP para criação de e-mails de marketing no HubSpot usando **HTML Híbrido**:
clona o template base preservando header e footer, e monta o miolo com blocos independentes
definidos dinamicamente pelo Claude a partir do Figma.

---

## 🛠 Tools disponíveis

| Tool | O que faz |
|---|---|
| `montar_email_hibrido` | **[PRINCIPAL]** Clona o template, preserva header/footer e monta o miolo com blocos independentes (imagem, rich_text, html, cta) |
| `inspecionar_secoes` | **[NOVO]** Mapeia as seções flexAreas do e-mail, identificando header, miolo editável e footer |
| `listar_emails` | Lista e-mails cadastrados, com filtro por estado |
| `atualizar_email_rascunho` | Atualiza assunto ou nome de um rascunho pelo ID |
| `inspecionar_widgets` | Retorna estrutura de widgets para diagnóstico |
| `upload_asset` | Baixa imagem de uma URL (ex: Figma) e sobe para o File Manager do HubSpot |
| `notificar_crm` | Envia mensagem no Slack com botão direto para o rascunho |

---

## 🔄 Fluxo completo no Claude (Figma → HubSpot)

```
1. Claude lê o template no Figma via MCP Figma (get_design_context)
2. Claude identifica os blocos do miolo: banner, texto, serviços, CTA, etc.
3. Para cada asset (imagens, ícones, GIFs): Claude chama upload_asset → recebe URL permanente
4. Claude monta o array de blocos com o tipo correto para cada elemento:
   - Banner principal        → tipo: "imagem"      (módulo nativo)
   - Saudação + texto        → tipo: "rich_text"   (suporta {{ contact.firstname }})
   - Lista de serviços/ícones → tipo: "html"        (módulo HTML livre)
   - Botão de agendamento    → tipo: "cta"         (módulo nativo com rastreamento)
   - Layout 2 colunas        → tipo: "html"        (tabela HTML)
   - Badges de especialidades → tipo: "html"        (HTML com bordas)
5. Claude chama montar_email_hibrido → header/footer preservados, miolo montado
6. Claude chama notificar_crm → time notificado no Slack
```

---

## 🔒 Módulos protegidos (header e footer)

Esses widgets nunca são modificados pelo fluxo híbrido:

```
module_16491575998179   — banner/imagem header
module_16582585915422   — imagem secundária/logo header
module_17435010851881   — HTML auxiliar header
module_17750683168462   — CTA botão 1
module_17750683168463   — CTA botão 2
module_17750683168464   — CTA botão 3
module_17750683168465   — CTA botão 4
module_17437663382712   — redes sociais header
module_17437663465645   — redes sociais footer
module_164915764846218  — footer legal
```

---

## 📦 Tipos de bloco suportados por montar_email_hibrido

| Tipo | Módulo HubSpot | Quando usar |
|---|---|---|
| `imagem` | Nativo `@hubspot/email_image` | Banner principal, fotos, qualquer imagem full-width |
| `rich_text` | Nativo `@hubspot/rich_text` | Texto corrido, saudação com `{{ contact.firstname }}`, parágrafos |
| `html` | HTML livre (sem path) | Blocos complexos: serviços+checks, 2 colunas, badges, layouts customizados |
| `cta` | Nativo `@hubspot/email_button` | Botões de ação com rastreamento automático de cliques |

---

## ⚙️ Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `HUBSPOT_TOKEN` | ✅ Sim | Token do Private App (scopes: `content`, `files`) |
| `SLACK_WEBHOOK_URL` | ✅ Sim | Webhook URL do canal Slack do time de CRM |
| `FIGMA_TOKEN` | ⚠️ Recomendado | Personal Access Token do Figma |
| `HUBSPOT_TEMPLATE_ID` | ❌ Não | ID do template base (padrão: 212982428723) |
| `HUBSPOT_ACCOUNT_ID` | ❌ Não | ID da conta HubSpot (padrão: 5338832) |
| `HUBSPOT_BUSINESS_UNIT_ID` | ❌ Não | ID da business unit (padrão: 255144) |
| `PORT` | ❌ Não | Porta do servidor (padrão: 3000) |

---

## 🚀 Deploy

```bash
git add .
git commit -m "feat: v3.0.0 — montar_email_hibrido substitui criar_email_rascunho"
git push
```
O Render faz o redeploy automaticamente.

---

## 🧪 Teste local

```bash
npm install
export HUBSPOT_TOKEN=seu_token
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
npm start

# Health check
curl http://localhost:3000/health
# → {"status":"ok","server":"hubspot-email-mcp","version":"3.0.0"}

# Inspecionar seções do template base
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer amorsaude-mcp-secret" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"inspecionar_secoes","arguments":{"email_id":"212982428723"}}}'
```

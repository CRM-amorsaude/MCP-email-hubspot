# HubSpot Email MCP — AmorSaúde

Servidor MCP para criação e gestão de e-mails de marketing no HubSpot, com notificação ao time de CRM via Slack.

---

## 🛠 Tools disponíveis

| Tool | O que faz |
|---|---|
| `criar_email_rascunho` | Cria um e-mail de marketing no HubSpot como rascunho (isDraft: true) |
| `listar_emails` | Lista e-mails cadastrados, com filtro por estado (DRAFT, PUBLISHED...) |
| `atualizar_email_rascunho` | Atualiza assunto ou HTML de um rascunho pelo ID |
| `notificar_crm` | Envia mensagem no Slack com botão direto para o rascunho no HubSpot |

---

## 🚀 Deploy no Render (gratuito)

### 1. Crie o Private App no HubSpot
1. HubSpot → **Settings → Integrations → Private Apps → Create a private app**
2. Nome: `Claude MCP`
3. Scopes necessários:
   - `content` — criar/editar Marketing Emails
4. Clique em **Create app** e copie o token gerado

### 2. Crie o Incoming Webhook no Slack
1. Acesse https://api.slack.com/apps → **Create New App → From scratch**
2. Nome: `Claude CRM Bot` | Workspace: AmorSaúde
3. Vá em **Incoming Webhooks → Ativar → Add New Webhook to Workspace**
4. Escolha o canal do time de CRM (ex: `#crm-disparos`)
5. Copie a Webhook URL gerada (formato: `https://hooks.slack.com/services/...`)

### 3. Suba o código no GitHub
```bash
git init
git add .
git commit -m "feat: hubspot email mcp com notificação slack"
git remote add origin https://github.com/SEU_USER/hubspot-email-mcp.git
git push -u origin main
```

### 4. Deploy no Render
1. Acesse https://render.com → **New → Web Service**
2. Conecte o repositório GitHub
3. O `render.yaml` já configura tudo automaticamente
4. Em **Environment Variables**, adicione:
   - `HUBSPOT_TOKEN` → token do Private App (Passo 1)
   - `SLACK_WEBHOOK_URL` → webhook do Slack (Passo 2)
5. Clique em **Deploy** — URL ficará tipo `https://hubspot-email-mcp.onrender.com`

### 5. Conectar ao Claude.ai
1. **Settings → Integrations → Add MCP Server**
2. Cole: `https://hubspot-email-mcp.onrender.com/mcp`
3. Salve — o Claude reconhece as 4 tools automaticamente

---

## 🔄 Workflow completo no Claude

```
1. Claude gera o HTML do template de e-mail
2. Time de MKT valida no chat → diz "aprovado"
3. Claude chama criar_email_rascunho → rascunho salvo no HubSpot
4. Claude chama notificar_crm → mensagem no Slack com botão "Abrir no HubSpot"
5. Alexy / Emily / Victor clicam no botão, revisam e disparam
```

---

## ⚙️ Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `HUBSPOT_TOKEN` | ✅ Sim | Token do Private App do HubSpot |
| `SLACK_WEBHOOK_URL` | ✅ Sim | Webhook URL do canal Slack do time de CRM |
| `PORT` | ❌ Não | Porta do servidor (padrão: 3000) |

---

## 🧪 Teste local

```bash
npm install
export HUBSPOT_TOKEN=seu_token
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
npm start

# Health check
curl http://localhost:3000/health
```

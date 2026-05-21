# HubSpot Email MCP — AmorSaúde

Servidor MCP para criação e gestão de e-mails de marketing no HubSpot, com upload de assets do Figma e notificação ao time de CRM via Slack.

---

## 🛠 Tools disponíveis

| Tool | O que faz |
|---|---|
| `criar_email_rascunho` | Cria um e-mail de marketing no HubSpot como rascunho (isDraft: true) |
| `listar_emails` | Lista e-mails cadastrados, com filtro por estado (DRAFT, PUBLISHED...) |
| `atualizar_email_rascunho` | Atualiza assunto ou HTML de um rascunho pelo ID |
| `inspecionar_widgets` | Diagnóstico: retorna a estrutura de módulos de um e-mail |
| `upload_asset` | **[NOVO]** Baixa imagem de uma URL (ex: Figma) e sobe para o File Manager do HubSpot. Retorna URL pública permanente |
| `notificar_crm` | Envia mensagem no Slack com botão direto para o rascunho no HubSpot |

---

## 🔄 Workflow completo no Claude (com Figma)

```
1. Claude lê o template no Figma via MCP Figma
2. Claude identifica todos os assets (fotos, ícones, logo)
3. Claude chama upload_asset para cada imagem → recebe URLs permanentes HubSpot
4. Claude gera o HTML do e-mail com as URLs reais no src das imagens
5. Time de MKT valida no chat → diz "aprovado"
6. Claude chama criar_email_rascunho com o HTML pronto
7. Claude chama notificar_crm → mensagem no Slack com botão "Abrir no HubSpot"
8. Alexy / Emily / Victor clicam no botão, revisam e disparam
```

---

## 🚀 Deploy no Render

### 1. Atualize as permissões do Private App no HubSpot
1. HubSpot → **Settings → Integrations → Private Apps → Claude MCP**
2. Adicione o scope: `files` — ler e fazer upload de arquivos no File Manager
3. Salve e copie o novo token gerado (ou use o existente se os scopes foram adicionados sem revogar)

### 2. Adicione a variável de ambiente no Render
No dashboard do Render, adicione:
- `FIGMA_TOKEN` → Personal Access Token do Figma (Settings > Account > Personal Access Tokens)
  - Necessário apenas para URLs autenticadas do Figma. Opcional se o arquivo for público.

As demais variáveis (`HUBSPOT_TOKEN`, `SLACK_WEBHOOK_URL`) já estão configuradas.

### 3. Atualize o código
```bash
git add .
git commit -m "feat: adiciona tool upload_asset para HubSpot File Manager"
git push
```
O Render faz o redeploy automaticamente.

---

## ⚙️ Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `HUBSPOT_TOKEN` | ✅ Sim | Token do Private App do HubSpot (precisa do scope `files`) |
| `SLACK_WEBHOOK_URL` | ✅ Sim | Webhook URL do canal Slack do time de CRM |
| `FIGMA_TOKEN` | ⚠️ Recomendado | Personal Access Token do Figma (para download de assets) |
| `HUBSPOT_TEMPLATE_ID` | ❌ Não | ID do template base (padrão: 212982428723) |
| `HUBSPOT_ACCOUNT_ID` | ❌ Não | ID da conta HubSpot (padrão: 5338832) |
| `HUBSPOT_BUSINESS_UNIT_ID` | ❌ Não | ID da business unit (padrão: 255144) |
| `HUBSPOT_HTML_WIDGET_KEY` | ❌ Não | Chave do módulo HTML no template (autodetectado se omitido) |
| `PORT` | ❌ Não | Porta do servidor (padrão: 3000) |

---

## 📁 Organização dos assets no HubSpot File Manager

Os arquivos são salvos por padrão na pasta `/crm-emails`. Você pode passar um parâmetro `pasta` diferente em cada chamada:

```
/crm-emails/banner-dermatologista.png
/crm-emails/icone-consulta.png
/crm-emails/logo-amorsaude.png
```

Os arquivos são configurados como `PUBLIC_NOT_INDEXABLE`: acessíveis por URL mas não indexados por buscadores — ideal para e-mails.

---

## 🧪 Teste local

```bash
npm install
export HUBSPOT_TOKEN=seu_token
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
export FIGMA_TOKEN=seu_figma_token
npm start

# Health check
curl http://localhost:3000/health

# Teste de upload (substitua pela URL real de um asset)
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer amorsaude-mcp-secret" \
  -H "Content-Type: application/json" \
  -d '{"method":"tools/call","params":{"name":"upload_asset","arguments":{"url_origem":"https://sua-url-de-imagem.png","nome_arquivo":"teste.png"}}}'
```

---

## ⚠️ Atenção: scope `files` no HubSpot

A tool `upload_asset` usa o endpoint `POST /files/v3/files` que requer o scope `files` no Private App.
Se o token atual não tiver esse scope, o HubSpot retornará erro 403. Nesse caso, edite o Private App e adicione o scope — o token existente será atualizado automaticamente sem necessidade de recriar o app.

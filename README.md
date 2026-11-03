# Bot de acesso VIP no Telegram

Bot de assinatura com geração de cobranças Pix. O pagamento é confirmado por webhook e a entrega do acesso VIP é feita manualmente pelo suporte. O acesso exige autodeclaração de 18 anos ou mais; isso não substitui verificação legal de idade quando exigida.

## Visualizar sem cobrar (recomendado)

1. Instale Node.js 20 ou superior.
2. Instale as dependências:

   ```bash
   npm install
   ```

3. Copie `.env.example` para `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

4. No `.env`, mantenha `BOT_MODE=preview`, preencha `BOT_TOKEN` com o token criado pelo BotFather e `PUBLIC_BASE_URL` com o domínio HTTPS do serviço.
5. Compile e inicie:

   ```bash
   npm run build
   npm start
   ```

O bot recebe atualizações do Telegram por webhook e inicia um servidor HTTP na porta `PORT` (ou `3000` localmente). O endpoint `/healthz` pode ser usado como health check. No modo preview, pagamentos continuam desativados.

## Gerar Pix real, confirmar pagamento e entregar acesso manualmente

Para gerar cobranças reais, configure:

- `CHASEPAY_API_KEY`: token privado puro da API; o bot adiciona `Bearer` automaticamente.
- `CHASEPAY_WEBHOOK_SECRET`: segredo compartilhado com o webhook configurado na ChasePay.
- `PUBLIC_BASE_URL`: domínio HTTPS público do servidor.

Defina `BOT_MODE=live`. Ao escolher um plano, o bot cria a cobrança e envia o QR Code Pix e o código copia e cola. Configure a ChasePay para enviar eventos de pagamento para `POST https://SEU_DOMINIO/webhooks/chasepay`, com assinatura HMAC-SHA256 no cabeçalho `x-chase-signature`. Quando receber uma confirmação válida, o bot atualiza o histórico e envia uma mensagem; a liberação do acesso continua manual. Cobranças live podem movimentar dinheiro de verdade.

Para hospedar na Render, crie um **Web Service** com Build Command `npm ci && npm run build` e Start Command `npm start`. Defina `PUBLIC_BASE_URL` como a URL HTTPS pública do serviço, inclusive no modo preview.

## Testes

```bash
npm test
```

Os testes usam banco temporário e respostas simuladas. Não criam cobranças, não acessam o Telegram e não exigem credenciais reais.

## Segurança e pagamentos

- Mantenha `.env` fora do Git e nunca envie tokens ou segredos em mensagens.
- A integração de cobrança usa o token privado Bearer no servidor. A chave pública fornecida não é necessária neste fluxo da API.
- A documentação da ChasePay informa que não há sandbox separado; cobranças enviadas à API podem ser reais.
- Um código Pix exibido não significa que o pagamento foi confirmado. A confirmação recebida pelo webhook valida o pedido, mas a entrega do acesso continua manual.
- Não prometa anonimato total ou que dados nunca aparecerão em redes: isso não pode ser garantido.
- Guarde `DATABASE_PATH` em armazenamento persistente. Se o arquivo SQLite for perdido, pedidos e acessos locais também serão perdidos.
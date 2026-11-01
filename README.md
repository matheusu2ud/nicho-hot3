# Bot de acesso VIP no Telegram

Bot de assinatura com planos Pix, confirmação de pagamento por webhook e liberação de convite individual para um canal privado. O acesso exige autodeclaração de 18 anos ou mais; isso não substitui verificação legal de idade quando exigida.

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

4. No `.env`, mantenha `BOT_MODE=preview` e preencha somente `BOT_TOKEN` com um token novo criado pelo BotFather. O modo preview mostra os menus e planos, mas não cria cobranças, não gera Pix e não libera acesso.
5. Compile e inicie:

   ```bash
   npm run build
   npm start
   ```

O bot usa long polling do Telegram. No modo preview, não inicia o servidor de webhook nem conecta à API de pagamento. Use `/start` no Telegram para ver a experiência.

## Ativar pagamentos reais

Só altere para `BOT_MODE=live` depois de configurar:

- `CHASEPAY_API_KEY`: token privado puro da API; o bot adiciona `Bearer` automaticamente.
- `CHASEPAY_WEBHOOK_SECRET`: segredo de assinatura do webhook.
- `VIP_CHANNEL_ID`: ID do canal privado; adicione o bot como administrador com permissão para convidar e remover membros.
- `PUBLIC_BASE_URL`: domínio HTTPS público do servidor.

Configure no painel do gateway o webhook `POST https://SEU_DOMINIO/webhooks/chasepay`. A implementação espera a assinatura HMAC-SHA256 no cabeçalho `x-chase-signature`.

## Testes

```bash
npm test
```

Os testes usam banco temporário e respostas simuladas. Não criam cobranças, não acessam o Telegram e não exigem credenciais reais.

## Segurança e pagamentos

- Mantenha `.env` fora do Git e nunca envie tokens ou segredos em mensagens.
- A integração de cobrança usa o token privado Bearer no servidor. A chave pública fornecida não é necessária neste fluxo da API.
- A documentação da ChasePay informa que não há sandbox separado; cobranças enviadas à API podem ser reais. Não teste com uma chave live sem intenção de cobrar.
- O bot só libera acesso após confirmação recebida e validada pelo webhook; um código Pix exibido não significa que o pagamento foi confirmado.
- Guarde `DATABASE_PATH` em armazenamento persistente. Se o arquivo SQLite for perdido, pedidos e acessos locais também serão perdidos.
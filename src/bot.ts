import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Telegraf, Markup, Input, type Context } from "telegraf";
import QRCode from "qrcode";
import type { Config } from "./config.js";
import { VipDatabase } from "./database.js";
import {
  ChasePayError,
  createPixCharge
} from "./chasepay.js";
import { formatBRL, isPlanId, PLANS } from "./plans.js";

export function createBot(config: Config, db: VipDatabase): Telegraf {
  const bot = new Telegraf(config.botToken);

  bot.start(async (ctx) => {
    if (!db.isAgeVerified(ctx.from.id)) {
      await ctx.replyWithPhoto(welcomePhoto(), {
        caption:
          "😈 Seja bem-vindo à Pecatto!\n\n" +
          "👉  Somos o único grupo do telegram com mais de 5 mil vazados de famosinhas da interne.\n\n" +
          "🙋‍♂️Não gostou do grupo? reembolsamos seu dinheiro na hora! .\n\n" +
          "🔞 Vazados da mel maia, julia petroni, larrissa manoela, alencar e muito mais! garanta seu plano na pecatto e tenha acesso a +de 10 mil arquivos exclusivos .\n\n" +
          "Toque em Continuar para conhecer os planos.",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("Continuar", "age:yes")],
          [Markup.button.callback("Sair", "age:no")]
        ]).reply_markup
      });
      return;
    }
    await showHome(ctx);
  });

  bot.action("age:yes", async (ctx) => {
    await ctx.answerCbQuery();
    db.verifyAge(ctx.from.id);
    await ctx.replyWithPhoto(afterAgePhoto(), {
      caption:
      "😈 Seja bem-vindo à Pecatto!\n\n" +
      "👉 Conheça nosso grupo VIP com conteúdo exclusivo de criadores adultos.\n\n" +
      "🙋‍♂️ Confira as condições de reembolso antes de assinar.\n\n" +
      "🔞 Acesso exclusivo para maiores de 18 anos. Conteúdos publicados com autorização de seus criadores.\n\n" +
      "💎 Escolha seu plano e confira os detalhes do acesso.\n\n" +
      (config.botMode === "preview"
          ? "⚠️ Modo de visualização: pagamentos e acesso ao canal estão desativados."
          : "⚡ Escolha seu plano e aproveite o acesso pelo período contratado."),
      reply_markup: homeKeyboard().reply_markup
    });
  });

  bot.action("age:no", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("Acesso indisponível. Este bot é exclusivo para maiores de 18 anos.");
  });

  bot.action("home", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await requireAgeVerification(ctx, db))) return;
    await ctx.reply("Área VIP", homeKeyboard());
  });

  bot.action("plans", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await requireAgeVerification(ctx, db))) return;
    await ctx.reply(
      "💎 Escolha seu plano:\n\n" +
        "• R$ 11,90 — acesso por 15 dias\n" +
        "• R$ 14,90 — acesso por 30 dias\n" +
        "• R$ 24,90 — acesso permanente\n\n" +
        "Os planos não renovam cobrança automaticamente: pague novamente para estender o acesso.",
      Markup.inlineKeyboard([
        [Markup.button.callback("VIP 15 dias — R$ 11,90", "buy:monthly_10")],
        [Markup.button.callback("VIP 30 dias — R$ 14,90", "buy:monthly_1499")],
        [Markup.button.callback("VIP permanente — R$ 24,90", "buy:lifetime")],
        [Markup.button.callback("Voltar", "home")]
      ])
    );
  });

  bot.action(/^buy:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await requireAgeVerification(ctx, db))) return;
    const selected = ctx.match[1];
    if (!isPlanId(selected)) {
      await ctx.reply("Plano inválido. Abra novamente a lista de planos.");
      return;
    }

    const plan = PLANS[selected];
    if (config.botMode === "preview") {
      await ctx.reply(
        `Prévia do plano: ${plan.title} (${formatBRL(plan.amountCents)}).\n\n` +
          "Nenhuma cobrança foi criada. O modo de visualização não processa pagamentos."
      );
      return;
    }

    const existing = db.getRecentPendingOrder(ctx.from.id, plan.id);
    if (existing) {
      if (existing.pixCode) {
        await sendPixInstructions(ctx, existing.pixCode, existing.amountCents);
      } else {
        await ctx.reply(
          "Já existe um pedido aguardando confirmação ou verificação. Para evitar uma cobrança duplicada, fale com o suporte antes de tentar novamente."
        );
      }
      return;
    }

    const order = {
      externalId: randomUUID().replaceAll("-", ""),
      telegramUserId: ctx.from.id,
      planId: plan.id,
      amountCents: plan.amountCents,
      status: "creating" as const,
      createdAt: Date.now(),
      pixCode: null,
      notificationSent: false,
      paidAt: null
    };

    try {
      db.createOrder(order);
      if (!config.chasepayApiKey) {
        throw new Error("CHASEPAY_API_KEY is required in live mode");
      }
      const charge = await createPixCharge(
        config.chasepayApiKey,
        order
      );
      if (charge.status === "paid") {
        const confirmed = db.confirmPaymentWithoutGrantingAccess(
          order.externalId,
          order.amountCents
        );
        if (!confirmed) {
          db.setOrderStatus(order.externalId, "unknown");
          await ctx.reply(
            "A gateway informou que esta cobrança está paga, mas não consegui validar o pedido. Fale com o suporte antes de fazer outro pagamento."
          );
          return;
        }
        try {
          await bot.telegram.sendMessage(
            confirmed.telegramUserId,
            "✅ Pagamento confirmado. Sua compra foi registrada. A liberação do acesso é feita manualmente."
          );
          db.markOrderNotificationSent(confirmed.externalId);
        } catch (error) {
          console.error("Payment was confirmed but Telegram notification failed:", error);
          await ctx.reply(
            "Pagamento confirmado. A confirmação da compra será enviada em breve; a liberação do acesso continua manual."
          );
        }
        return;
      }
      if (charge.status !== "pending" || !charge.pixCode) {
        db.setOrderStatus(order.externalId, "unknown");
        await ctx.reply(
          "Não foi possível confirmar os dados da cobrança. Ela pode ter sido criada; não tente pagar de novo ainda. Fale com o suporte para conferirmos."
        );
        return;
      }

      db.setOrderPayment(order.externalId, charge.pixCode);
      await sendPixInstructions(ctx, charge.pixCode, order.amountCents);
    } catch (error) {
      const outcomeUnknown =
        error instanceof ChasePayError && error.outcomeUnknown;
      db.setOrderStatus(order.externalId, outcomeUnknown ? "unknown" : "failed");
      console.error("Could not create ChasePay charge:", error);
      await ctx.reply(
        outcomeUnknown
          ? "A resposta do pagamento ficou incerta. Por segurança, não tente pagar novamente até falar com o suporte."
          : "Não foi possível criar o pagamento. Tente novamente mais tarde ou fale com o suporte."
      );
    }
  });

  bot.action("subscription", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await requireAgeVerification(ctx, db))) return;
    if (config.botMode === "preview") {
      await ctx.reply(
        "Modo de visualização: nenhuma assinatura nem acesso real ao canal está ativo.",
        homeKeyboard()
      );
      return;
    }
    const orders = db.getOrderHistory(ctx.from.id);
    if (orders.length === 0) {
      await ctx.reply("Você ainda não tem pedidos Pix no histórico.", homeKeyboard());
      return;
    }

    const history = orders.map((order) => {
      const plan = PLANS[order.planId];
      const date = new Date(order.createdAt).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo"
      });
      return (
        `• ${plan?.title ?? "Plano"} — ${formatBRL(order.amountCents)}\n` +
        `  ${date} · ${orderStatusLabel(order.status)}`
      );
    });
    await ctx.reply(
      `📋 Histórico de pedidos Pix:\n\n${history.join("\n\n")}`,
      homeKeyboard()
    );
  });

  bot.action("support", async (ctx) => {
    await ctx.answerCbQuery();
    if (!(await requireAgeVerification(ctx, db))) return;
    await ctx.reply(`💬 Suporte: https://t.me/${config.supportUsername}`);
  });

  bot.catch((error) => {
    console.error("Telegram bot update failed:", error);
  });

  return bot;
}

async function sendPixInstructions(
  ctx: Context,
  pixCode: string,
  amountCents: number
): Promise<void> {
  const qr = await QRCode.toBuffer(pixCode, { type: "png", width: 360 });
  await ctx.replyWithPhoto(Input.fromBuffer(qr, "pix.png"), {
    caption:
      `PIX de ${formatBRL(amountCents)}.\n` +
      "🔥 Prepare-se para momentos intensos e conteúdo exclusivo para maiores de 18 anos. 💋"
  });
  await ctx.reply(`<code>${escapeHtml(pixCode)}</code>`, {
    parse_mode: "HTML"
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return character;
    }
  });
}

function homeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💎 Conhecer planos VIP", "plans")],
    [Markup.button.callback("👤 Minha assinatura", "subscription")],
    [Markup.button.callback("💬 Suporte", "support")]
  ]);
}

function orderStatusLabel(status: string): string {
  switch (status) {
    case "creating": return "Pix sendo gerado";
    case "pending": return "Aguardando pagamento";
    case "paid": return "Pagamento confirmado";
    case "failed": return "Falha ao gerar Pix";
    case "unknown": return "Status incerto; consulte o suporte";
    case "refunded": return "Reembolsado";
    default: return "Status desconhecido";
  }
}

async function showHome(ctx: Context): Promise<void> {
  await ctx.replyWithPhoto(welcomePhoto(), {
    caption:
      "🔥 Bem-vindo à nossa área exclusiva 🔥\n\n" +
      "🔞 Plataforma destinada exclusivamente a maiores de 18 anos.\n\n" +
      "💎 Acesse nossa área VIP.\n" +
      "⚡ Escolha seu plano.",
    reply_markup: homeKeyboard().reply_markup
  });
}

function welcomePhoto() {
  const image = readFileSync(resolve(process.cwd(), "assets", "welcome.jpg"));
  return Input.fromBuffer(image, "welcome.jpg");
}

function afterAgePhoto() {
  const image = readFileSync(
    resolve(process.cwd(), "assets", "welcome-after-age.jpg")
  );
  return Input.fromBuffer(image, "welcome-after-age.jpg");
}

async function requireAgeVerification(
  ctx: Context,
  db: VipDatabase
): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("Não consegui identificar sua conta do Telegram. Tente novamente pelo chat privado.");
    return false;
  }
  if (db.isAgeVerified(userId)) return true;
  await ctx.reply(
    "Confirme que tem 18 anos ou mais para continuar.",
    Markup.inlineKeyboard([
      [Markup.button.callback("Continuar", "age:yes")],
      [Markup.button.callback("Sair", "age:no")]
    ])
  );
  return false;
}

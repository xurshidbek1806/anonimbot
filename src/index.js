import { loadEnv, configFromEnv } from './config.js';
import { openDatabase, createStore } from './db.js';
import { openPostgres, createPostgresStore } from './postgres.js';
import { createTelegramApi } from './telegram.js';
import { createBot } from './bot.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

loadEnv();
const config = configFromEnv();
const db = config.databaseUrl
  ? await openPostgres(config.databaseUrl)
  : openDatabase(config.databasePath);
const store = config.databaseUrl ? createPostgresStore(db) : createStore(db);
const api = createTelegramApi(config.token);
const me = await api.call('getMe');
if (!me.is_bot || !me.username) throw new Error('BOT_TOKEN botga tegishli emas.');
const webhook = await api.call('getWebhookInfo');
if (webhook.url) throw new Error('Bu botda webhook faol. Long polling uchun avval webhookni o‘chiring.');
try {
  await api.call('setMyCommands', {
    scope: { type: 'all_private_chats' },
    commands: [
      { command: 'start', description: 'Botni ishga tushirish' },
      { command: 'premium', description: 'Bot obunasidan foydalanish' },
      { command: 'login', description: 'Loginni o‘zgartirish' },
      { command: 'autoreply', description: 'Avto javob sozlash' },
      { command: 'profile', description: 'Profil statistikasi' },
      { command: 'unban', description: 'Blokdan ochish' },
      { command: 'help', description: 'Yordam' },
    ],
  });
} catch (error) {
  console.error(`Bot buyruqlarini o‘rnatib bo‘lmadi: ${error.message}`);
}

let broadcasting = false;
async function runBroadcasts() {
  if (broadcasting) return;
  broadcasting = true;
  try {
    let job;
    while ((job = (await store.pendingJobs())[0])) {
      await store.markJobRunning(job.id);
      let user;
      while ((user = await store.nextBroadcastUser(job.id, job.kind))) {
        try {
          await api.copyMessage(user.id, job.source_admin_id, job.source_message_id, {
            ...(job.button_url ? {
              reply_markup: { inline_keyboard: [[{ text: job.button_label, url: job.button_url }]] },
            } : {}),
          });
          await store.markDelivery(job.id, user.id, 'sent');
        } catch (error) {
          await store.markDelivery(job.id, user.id, 'failed');
          if (error.code === 403) await store.markBlocked(user.id);
          console.error(`E’lon #${job.id}, foydalanuvchi ${user.id}: ${error.message}`);
        }
        // Telegram's normal free broadcast limit is 30 messages per second.
        await pause(70);
      }
      await store.finishJob(job.id);
      const counts = Object.fromEntries((await store.jobStats(job.id)).map(({ status, n }) => [status, n]));
      try {
        await api.sendMessage(job.source_admin_id,
          `E’lon #${job.id} yakunlandi. Yetkazildi: ${counts.sent || 0}. Xato: ${counts.failed || 0}.`);
      } catch (error) {
        console.error(`E’lon #${job.id} natijasini yuborib bo‘lmadi: ${error.message}`);
      }
    }
  } finally {
    broadcasting = false;
  }
}

function wakeBroadcasts() {
  void runBroadcasts().catch((error) => console.error(`E’lon jarayoni: ${error.message}`));
}

const bot = createBot({
  api, store, username: me.username, adminIds: config.adminIds, wakeBroadcasts,
});
wakeBroadcasts();
console.log(`@${me.username} ishga tushdi`);

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

while (!stopping) {
  try {
    const updates = await api.call('getUpdates', {
      offset: await store.getOffset(),
      limit: 100,
      timeout: 25,
      allowed_updates: ['message', 'callback_query'],
    });
    for (const update of updates) {
      try {
        await bot.handleUpdate(update);
      } catch (error) {
        // Do not log message bodies or the bot token.
        console.error(`Update ${update.update_id}: ${error.message}`);
        const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
        if (chatId) {
          try { await api.sendMessage(chatId, 'Xabarni yuborishda xato bo‘ldi. Qayta urinib ko‘ring.'); }
          catch { /* Bot may have been blocked. */ }
        }
      }
      await store.setOffset(update.update_id + 1);
    }
  } catch (error) {
    console.error(`Telegram ulanishi: ${error.message}`);
    await pause(3000);
  }
}
if (config.databaseUrl) await db.end();
else db.close();

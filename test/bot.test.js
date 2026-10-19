import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, createStore } from '../src/db.js';
import { createBot } from '../src/bot.js';

function fixture(adminIds = new Set()) {
  const db = openDatabase(':memory:');
  const store = createStore(db);
  const calls = [];
  let nextMessageId = 100;
  const api = {
    async sendMessage(chatId, text, extra = {}) {
      calls.push({ method: 'sendMessage', chatId: String(chatId), text, extra });
      return { message_id: nextMessageId++ };
    },
    async copyMessage(chatId, fromChatId, messageId, extra = {}) {
      calls.push({ method: 'copyMessage', chatId: String(chatId), fromChatId: String(fromChatId), messageId, extra });
      return { message_id: nextMessageId++ };
    },
    async editMessageText(chatId, messageId, text, extra = {}) {
      calls.push({ method: 'editMessageText', chatId: String(chatId), messageId, text, extra });
      return { message_id: messageId };
    },
    async answerCallback(id) { calls.push({ method: 'answerCallback', id }); },
  };
  let broadcastsWoken = 0;
  const bot = createBot({
    api, store, username: 'testbot', adminIds,
    wakeBroadcasts: () => { broadcastsWoken++; },
  });
  const users = {
    owner: { id: 101, first_name: 'Owner', username: 'owner_username' },
    visitor: { id: 202, first_name: 'Visitor', username: 'visitor_username' },
    another: { id: 303, first_name: 'Another' },
  };
  let messageId = 1;
  const message = async (who, data) => bot.handleUpdate({
    message: { message_id: messageId++, chat: { id: who.id, type: 'private' }, from: who, ...data },
  });
  const callback = async (who, data) => bot.handleUpdate({
    callback_query: {
      id: `callback-${messageId++}`, from: who, data,
      message: { message_id: 99, chat: { id: who.id, type: 'private' } },
    },
  });
  return { db, store, calls, bot, users, message, callback, get broadcastsWoken() { return broadcastsWoken; } };
}

test('every text message has sender and reply actions without exposing sender until requested', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor, another } = f.users;
  await f.message(owner, { text: '/start' });
  const startMessages = f.calls.filter((c) => c.chatId === '101' && c.method === 'sendMessage');
  assert.equal(startMessages.length, 2);
  assert.ok(startMessages[0].text.startsWith('<b>Shaxsiy havolangiz:</b>'));
  assert.equal(startMessages[0].extra.reply_markup.inline_keyboard[0][0].text, 'Ulashish');
  assert.equal(startMessages[0].extra.reply_markup.inline_keyboard.length, 1);
  assert.equal(startMessages[1].text, 'Xabar botiga xush kelibsiz. Shaxsiy havolangiz tayyor.');
  assert.deepEqual(startMessages[1].extra.reply_markup.keyboard.map((row) => row.map((item) => item.text)), [
    ['🔗 Mening havolalarim'],
    ['📊 Profil', '❔ Yordam'],
  ]);
  assert.equal(startMessages[1].extra.reply_markup.is_persistent, true);
  assert.equal(startMessages[1].extra.reply_markup.inline_keyboard, undefined);
  const link = f.store.listLinks(owner.id)[0];
  await f.message(visitor, { text: `/start ${link.token}` });
  await f.message(another, { text: `/start ${link.token}` });
  await f.message(visitor, { text: 'Salom', forward_origin: { type: 'user', sender_user: visitor } });
  await f.message(another, { text: 'Assalomu alaykum' });
  const ownerMessages = f.calls.filter((c) => c.method === 'sendMessage' && c.chatId === '101');
  assert.equal(ownerMessages.filter((c) => c.text.startsWith('✉️ Sizda yangi xabar bor!')).length, 2);
  assert.ok(ownerMessages.some((c) => c.text.includes('Salom')));
  assert.ok(!ownerMessages.some((c) => c.text.includes('visitor_username') || c.text.includes('202')));
  const incomingActions = ownerMessages.find((c) => c.text.includes('Salom')).extra.reply_markup.inline_keyboard;
  assert.equal(incomingActions[0][0].text, '👤 Yuboruvchini ko‘rish');
  assert.equal(incomingActions[1][0].text, '🔁 Javob berish');
  await f.callback(another, incomingActions[0][0].callback_data);
  assert.ok(!f.calls.some((c) => c.chatId === '303' && c.text?.includes('Telegram ID: 202')));
  await f.callback(owner, incomingActions[0][0].callback_data);
  const senderDetails = f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('👤 Yuboruvchi'));
  assert.match(senderDetails.text, /Visitor/);
  assert.match(senderDetails.text, /@visitor_username/);
  assert.match(senderDetails.text, /Telegram ID: 202/);
  assert.equal(senderDetails.extra.reply_markup.inline_keyboard[0][0].url, 'tg://user?id=202');
  const replyData = incomingActions[1][0].callback_data;
  await f.callback(owner, replyData);
  await f.message(owner, { text: 'Javob' });
  const visitorMessages = f.calls.filter((c) => c.method === 'sendMessage' && c.chatId === '202');
  assert.ok(visitorMessages.some((c) => c.text === 'Javob'));
  assert.ok(!visitorMessages.some((c) => c.text.includes('owner_username') || c.text.includes('101')));
});

test('old one-way links deliver media with the same actions and hide identity until requested', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/start' });
  const link = f.store.createLink(owner.id, 'open_sender');
  assert.equal(link.mode, 'open_sender');
  await f.message(visitor, { text: `/start ${link.token}` });
  const entry = f.calls.find((c) => c.chatId === '202' && c.text === '<b>Murojaatingizni shuyerga yozing!</b>');
  assert.ok(entry);
  assert.equal(entry.extra.parse_mode, 'HTML');
  assert.equal(entry.extra.reply_markup.inline_keyboard[0][0].text, '✖️ Bekor qilish');
  assert.ok(!entry.text.includes('bir tomonlama'));
  await f.message(visitor, {
    photo: [{ file_id: 'file' }], caption: 'Rasm',
    caption_entities: [{ type: 'text_mention', offset: 0, length: 4, user: visitor }],
  });
  const ownerInfo = f.calls.findLast((c) => c.chatId === '101' && c.text === '✉️ Sizda yangi xabar bor!');
  assert.ok(ownerInfo);
  assert.ok(!f.calls.some((c) => c.chatId === '101' && c.text?.includes('visitor_username')));
  const copied = f.calls.find((c) => c.method === 'copyMessage' && c.chatId === '101');
  assert.deepEqual(copied.extra.caption_entities, []);
  assert.equal(copied.extra.protect_content, true);
  assert.deepEqual(copied.extra.reply_markup.inline_keyboard.map((row) => row[0].text),
    ['👤 Yuboruvchini ko‘rish', '🔁 Javob berish']);
  await f.callback(owner, copied.extra.reply_markup.inline_keyboard[0][0].callback_data);
  assert.ok(f.calls.some((c) => c.chatId === '101' && c.text?.includes('@visitor_username')));
  await f.callback(owner, copied.extra.reply_markup.inline_keyboard[1][0].callback_data);
  await f.message(owner, { text: 'Rasmga javob' });
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text === 'Rasmga javob'));
  assert.ok(!f.calls.some((c) => c.chatId === '202' && c.text?.includes('owner_username')));
  const confirmationIndex = f.calls.findIndex((c) => c.chatId === '202' && c.text === 'Xabaringiz yuborildi!');
  const ownLinkIndex = f.calls.findIndex((c, i) => i > confirmationIndex && c.chatId === '202' && c.text?.startsWith('<b>Shaxsiy havolangiz:</b>'));
  assert.ok(ownLinkIndex > confirmationIndex);
  assert.equal(f.calls[ownLinkIndex].extra.reply_markup.inline_keyboard.length, 1);
});

test('long text keeps both actions on the delivered text message', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/start' });
  const link = f.store.getOrCreatePersonalLink(owner.id);
  await f.message(visitor, { text: `/start ${link.token}` });
  const longText = 'A'.repeat(4000);
  await f.message(visitor, { text: longText });
  const delivered = f.calls.find((c) => c.chatId === '101' && c.text === longText);
  assert.ok(delivered);
  assert.deepEqual(delivered.extra.reply_markup.inline_keyboard.map((row) => row[0].text),
    ['👤 Yuboruvchini ko‘rish', '🔁 Javob berish']);
});

test('admin campaign needs admin identity and explicit confirmation', async (t) => {
  const f = fixture(new Set(['101']));
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(visitor, { text: '/admin' });
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text === 'Bu bo‘lim faqat admin uchun.'));
  await f.message(owner, { text: '/admin' });
  await f.callback(owner, 'admin:compose');
  await f.message(owner, { text: 'Homiy e’loni' });
  assert.equal(f.store.pendingJobs().length, 0);
  await f.callback(owner, 'admin:addbutton');
  await f.message(owner, { text: 'Batafsil | https://example.com' });
  await f.callback(owner, 'admin:confirm');
  const jobs = f.store.pendingJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].button_url, 'https://example.com/');
  assert.equal(f.broadcastsWoken, 1);
});

test('personal login, auto reply and profile statistics are free', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/start' });
  const personal = f.store.getOrCreatePersonalLink(owner.id);
  const personalMessage = f.calls.find((c) => c.chatId === '101' && c.text?.includes(personal.token));
  assert.ok(personalMessage);
  assert.match(personalMessage.extra.reply_markup.inline_keyboard[0][0].url, /^https:\/\/t\.me\/share\/url\?/);
  assert.match(decodeURIComponent(personalMessage.extra.reply_markup.inline_keyboard[0][0].url), /Menga xabar yuboring:/);
  await f.message(owner, { text: '/login' });
  const loginPrompt = f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('<b>Yangi login kiriting</b>'));
  assert.equal(loginPrompt.extra.reply_markup.inline_keyboard[0][0].text, '✖️ Bekor qilish');
  await f.message(owner, { text: 'Xurshidbek' });
  assert.equal(f.store.getSettings(owner.id).login, 'Xurshidbek');
  const loginSuccess = f.calls.findLast((c) => c.chatId === '101' && c.text === '<b>Login muvaffaqiyatli saqlandi.</b>');
  assert.match(decodeURIComponent(loginSuccess.extra.reply_markup.inline_keyboard[0][0].url), /start=Xurshidbek/);
  await f.message(owner, { text: '/autoreply' });
  await f.callback(owner, 'auto:set');
  await f.message(owner, { text: 'Salom, xabaringizni kutaman.' });
  await f.message(visitor, { text: '/start Xurshidbek' });
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text?.includes('Salom, xabaringizni kutaman.')));
  await f.message(visitor, { text: 'Anonim xabar' });
  const confirmation = f.calls.findLast((c) => c.chatId === '202' && c.text === 'Xabaringiz yuborildi!');
  assert.equal(confirmation.extra.reply_markup.inline_keyboard[0][0].text, 'Yana xabar yuborish');
  const autoReplyCount = f.calls.filter((c) => c.chatId === '202' && c.text?.startsWith('💬 Avtojavob:')).length;
  await f.callback(visitor, confirmation.extra.reply_markup.inline_keyboard[0][0].callback_data);
  assert.equal(f.calls.filter((c) => c.chatId === '202' && c.text?.startsWith('💬 Avtojavob:')).length, autoReplyCount);
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text === '<b>Murojaatingizni shuyerga yozing!</b>'));
  await f.message(owner, { text: '/profile' });
  const profile = f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('📊 Profil statistikasi'));
  assert.match(profile.text, /24 soat: 1 ta yozuvchi kirdi, 1 ta xabar keldi/);
  await f.message(owner, { text: '/premium' });
  assert.ok(f.calls.some((c) => c.chatId === '101' && c.text?.includes('Obuna va to‘lov talab qilinmaydi')));
});

test('block and unban work without revealing the visitor in incoming message', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/start' });
  const personal = f.store.getOrCreatePersonalLink(owner.id);
  await f.message(visitor, { text: `/start ${personal.token}` });
  await f.message(visitor, { text: 'Birinchi xabar' });
  const ownerMessage = f.calls.find((c) => c.chatId === '101' && c.text?.includes('Birinchi xabar'));
  await f.callback(owner, ownerMessage.extra.reply_markup.inline_keyboard[1][0].callback_data);
  const replyPrompt = f.calls.findLast((c) => c.chatId === '101' && c.text === 'Javobingizni yozing!');
  const blockData = replyPrompt.extra.reply_markup.inline_keyboard[1][0].callback_data;
  await f.callback(owner, blockData);
  assert.equal(f.store.getContext(owner.id), undefined);
  await f.callback(visitor, `again:${personal.token}`);
  await f.message(visitor, { text: 'Ikkinchi xabar' });
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text?.includes('xabar yubora olmaysiz')));
  assert.ok(!f.calls.some((c) => c.chatId === '101' && c.text?.includes('Ikkinchi xabar')));
  await f.message(owner, { text: '/unban' });
  const unbanHelp = f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('⚠️ Foydalanuvchi ID kiriting.'));
  assert.ok(unbanHelp.text.includes('/unban all'));
  assert.ok(!unbanHelp.text.includes('Visitor'));
  assert.ok(!unbanHelp.text.includes('visitor_username'));
  const conversationId = blockData.slice(6);
  await f.message(owner, { text: `/unban ${conversationId}` });
  await f.callback(visitor, `again:${personal.token}`);
  await f.message(visitor, { text: 'Uchinchi xabar' });
  assert.ok(f.calls.some((c) => c.chatId === '101' && c.text?.includes('Uchinchi xabar')));
});

test('sponsored broadcasts only target users who opted in', async (t) => {
  const f = fixture(new Set(['101']));
  t.after(() => f.db.close());
  const { owner, visitor, another } = f.users;
  await f.message(owner, { text: '/start' });
  await f.message(visitor, { text: '/start' });
  await f.message(another, { text: '/start' });
  await f.callback(visitor, 'offers:on');
  await f.message(owner, { text: '/admin' });
  await f.callback(owner, 'admin:compose:sponsored');
  await f.message(owner, { text: 'Homiy xabari' });
  await f.callback(owner, 'admin:confirm');
  const job = f.store.pendingJobs()[0];
  assert.equal(job.kind, 'sponsored');
  assert.equal(f.store.nextBroadcastUser(job.id, job.kind).id, '202');
  f.store.markDelivery(job.id, visitor.id, 'sent');
  assert.equal(f.store.nextBroadcastUser(job.id, job.kind), undefined);
});

test('one personal URL has no mode controls and cancel ends the visitor flow', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/start' });
  const first = f.store.getOrCreatePersonalLink(owner.id);
  await f.callback(owner, 'mode:open_sender'); // A stale button must not change the link.
  assert.equal(f.store.getOrCreatePersonalLink(owner.id).token, first.token);
  assert.equal(f.store.getLink(first.token).mode, 'anonymous');
  assert.equal(f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('Xabar botiga'))
    .extra.reply_markup.keyboard.length, 2);
  await f.message(visitor, { text: `/start ${first.token}` });
  const prompt = f.calls.findLast((c) => c.chatId === '202' && c.text === '<b>Murojaatingizni shuyerga yozing!</b>');
  assert.equal(prompt.extra.reply_markup.inline_keyboard[0][0].callback_data, 'cancel');
  await f.callback(visitor, 'cancel');
  assert.equal(f.store.getContext(visitor.id), undefined);
  assert.ok(f.calls.findLast((c) => c.chatId === '202').text.startsWith('<b>Shaxsiy havolangiz:</b>'));
  await f.message(visitor, { text: 'Yetkazilmasin' });
  assert.ok(!f.calls.some((c) => c.chatId === '101' && c.text?.includes('Yetkazilmasin')));
});

test('an existing reply still works after the old link is closed', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/start' });
  const link = f.store.getOrCreatePersonalLink(owner.id);
  await f.message(visitor, { text: `/start ${link.token}` });
  await f.message(visitor, { text: 'Savol' });
  const incoming = f.calls.find((c) => c.chatId === '101' && c.text?.includes('Savol'));
  const replyAction = incoming.extra.reply_markup.inline_keyboard[1][0].callback_data;
  f.store.deactivateLink(link.token, owner.id);
  await f.callback(owner, replyAction);
  await f.message(owner, { text: 'Javob' });
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text === 'Javob'));
});

test('login uses letters only and cannot duplicate another user case-insensitively', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor } = f.users;
  await f.message(owner, { text: '/login' });
  await f.message(owner, { text: 'Name_1' });
  assert.equal(f.store.getSettings(owner.id), null);
  assert.ok(f.calls.some((c) => c.chatId === '101' && c.text === 'Login faqat lotin harflaridan iborat bo‘lishi kerak.'));
  await f.message(owner, { text: 'Xurshidbek' });
  await f.message(visitor, { text: '/login' });
  await f.message(visitor, { text: 'xurshidbek' });
  assert.equal(f.store.getSettings(visitor.id)?.login, undefined);
  assert.ok(f.calls.some((c) => c.chatId === '202' && c.text === 'Bu login band. Boshqasini yuboring.'));
});

test('help matches the reference and unban all clears only the owner’s blocks', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner, visitor, another } = f.users;
  await f.message(owner, { text: '/help' });
  const help = f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('<b>Botimiz orqali'));
  assert.ok(help.text.includes('• Document fayllar'));
  assert.equal(help.extra.reply_markup.inline_keyboard[0][0].text, 'Ulashish');
  await f.message(visitor, { text: '/start' });
  await f.message(another, { text: `/start ${f.store.getOrCreatePersonalLink(visitor.id).token}` });
  await f.message(another, { text: 'Salom' });
  const otherConversation = f.store.getOrCreateConversation(f.store.getOrCreatePersonalLink(visitor.id).token, another.id).conversation;
  f.store.blockConversation(otherConversation.id, visitor.id);
  await f.message(another, { text: `/start ${f.store.getOrCreatePersonalLink(owner.id).token}` });
  await f.message(another, { text: 'Savol' });
  const ownConversation = f.store.getOrCreateConversation(f.store.getOrCreatePersonalLink(owner.id).token, another.id).conversation;
  f.store.blockConversation(ownConversation.id, owner.id);
  await f.message(owner, { text: '/unban all' });
  assert.equal(f.store.isConversationBlocked(ownConversation.id), false);
  assert.equal(f.store.isConversationBlocked(otherConversation.id), true);
});

test('the simplified menu is persistent below the composer and opens working sections', async (t) => {
  const f = fixture();
  t.after(() => f.db.close());
  const { owner } = f.users;
  await f.message(owner, { text: '/start' });
  const menu = f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('Xabar botiga xush'));
  assert.deepEqual(menu.extra.reply_markup.keyboard.map((row) => row.map((item) => item.text)), [
    ['🔗 Mening havolalarim'], ['📊 Profil', '❔ Yordam'],
  ]);
  await f.message(owner, { text: '/premium' });
  const premium = f.calls.findLast((c) => c.chatId === '101' && c.text?.includes('Obuna va to‘lov talab qilinmaydi'));
  assert.ok(premium.extra.reply_markup.inline_keyboard);
  assert.ok(!premium.extra.reply_markup.keyboard);
  await f.message(owner, { text: '📊 Profil' });
  assert.ok(f.calls.some((c) => c.chatId === '101' && c.text?.startsWith('📊 Profil statistikasi')));
  await f.message(owner, { text: '❔ Yordam' });
  assert.ok(f.calls.some((c) => c.chatId === '101' && c.text?.startsWith('<b>Botimiz orqali')));
  await f.message(owner, { text: '🔗 Mening havolalarim' });
  assert.ok(f.calls.findLast((c) => c.chatId === '101').text.startsWith('<b>Shaxsiy havolangiz:</b>'));
  await f.message(owner, { text: '📩 Bir tomonlama xabar' }); // Old persistent keyboard text refreshes it.
  assert.equal(f.store.getOrCreatePersonalLink(owner.id).mode, 'anonymous');
  assert.equal(f.calls.findLast((c) => c.chatId === '101' && c.text?.startsWith('Xabar botiga'))
    .extra.reply_markup.keyboard.length, 2);
});

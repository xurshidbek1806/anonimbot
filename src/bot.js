const keyboard = (...rows) => ({ inline_keyboard: rows });
const button = (text, callback_data) => ({ text, callback_data });
const menuLabels = {
  anonymous: '🔒 Ikki tomonlama anonim',
  openSender: '📩 Bir tomonlama xabar',
  links: '🔗 Mening havolalarim',
  profile: '📊 Profil',
  help: '❔ Yordam',
};
const mainMenu = () => ({
  keyboard: [
    [{ text: menuLabels.anonymous }],
    [{ text: menuLabels.openSender }],
    [{ text: menuLabels.links }],
    [{ text: menuLabels.profile }, { text: menuLabels.help }],
  ],
  resize_keyboard: true,
  is_persistent: true,
});
const canRelay = (m) => Boolean(m.text || m.photo || m.video || m.voice || m.audio ||
  m.document || m.animation || m.sticker || m.video_note);
const entryPrompt = '<b>Murojaatingizni shuyerga yozing!</b>';

export function createBot({ api, store, username, adminIds, wakeBroadcasts = () => {} }) {
  const isAdmin = (id) => adminIds.has(String(id));
  const linkUrl = (token) => `https://t.me/${username}?start=${token}`;
  const shareButton = (url) => ({
    text: 'Ulashish',
    url: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent('Menga anonim xabar yuboring:')}`,
  });

  async function personalLinkView(userId) {
    const link = await store.getOrCreatePersonalLink(userId);
    const login = (await store.getSettings(userId))?.login;
    const url = linkUrl(login || link.token);
    return {
      text: `<b>Shaxsiy havolangiz:</b>\n\n${url}\n\nHavolani ulashib, anonim suhbatni boshlashingiz mumkin.`,
      extra: { parse_mode: 'HTML', reply_markup: keyboard([shareButton(url)]) },
    };
  }

  async function showPersonalLink(userId) {
    const view = await personalLinkView(userId);
    await api.sendMessage(userId, view.text, view.extra);
  }

  async function refreshPersonalLink(userId, messageId) {
    const view = await personalLinkView(userId);
    if (messageId && api.editMessageText) {
      try {
        await api.editMessageText(userId, messageId, view.text, view.extra);
        return;
      } catch { /* An old/deleted message can be replaced with a fresh link. */ }
    }
    await api.sendMessage(userId, view.text, view.extra);
  }

  async function sendHome(userId) {
    await store.clearContext(userId);
    await showPersonalLink(userId);
    await api.sendMessage(userId, 'Anonim botga xush kelibsiz. Qanday havola yaratasiz?', {
      reply_markup: mainMenu(),
    });
  }

  async function showLinks(userId, page = 0) {
    const links = await store.listLinks(userId, page * 10, 11);
    if (!links.length) {
      await api.sendMessage(userId, 'Hali havolangiz yo‘q. /menu orqali yarating.');
      return;
    }
    for (const link of links.slice(0, 10)) {
      const mode = link.mode === 'anonymous' ? 'Ikki tomonlama anonim' : 'Bir tomonlama xabar';
      await api.sendMessage(userId, `${mode} · ${link.active ? 'Faol' : 'Yopilgan'}\n${linkUrl(link.token)}`, {
        reply_markup: link.active
          ? keyboard([shareButton(linkUrl(link.token))], [button('Havolani yopish', `close:${link.token}`)]) : undefined,
      });
    }
    if (page > 0 || links.length > 10) {
      await api.sendMessage(userId, 'Havolalar ro‘yxati:', {
        reply_markup: keyboard([
          ...(page > 0 ? [button('⬅️ Oldingi', `linkspage:${page - 1}`)] : []),
          ...(links.length > 10 ? [button('Keyingi ➡️', `linkspage:${page + 1}`)] : []),
        ]),
      });
    }
  }

  async function showProfile(userId) {
    const rows = await store.profileStats(userId);
    await api.sendMessage(userId,
      `📊 Profil statistikasi\n\n${rows.map((row) =>
        `${row.label}: ${row.visitors} ta yozuvchi kirdi, ${row.messages} ta xabar keldi`).join('\n')}\n\nBarcha imkoniyatlar bepul.`,
      { reply_markup: keyboard([button('🔗 Shaxsiy havola', 'personal')]) });
  }

  async function showAutoReply(userId) {
    const current = (await store.getSettings(userId))?.auto_reply;
    await api.sendMessage(userId,
      `Avtojavob: ${current ? `\n\n${current}` : 'o‘chirilgan'}\n\nHavolangizni ochganlarga bu matn avtomatik ko‘rsatiladi.`,
      { reply_markup: keyboard(
        [button('✏️ O‘rnatish / o‘zgartirish', 'auto:set')],
        [button('🗑 O‘chirish', 'auto:clear')],
      ) });
  }

  async function showBlocked(userId, page = 0) {
    const blocked = await store.listBlockedConversations(userId, page * 10, 11);
    if (!blocked.length) {
      await api.sendMessage(userId, 'Bloklangan yozuvchilar yo‘q.');
      return;
    }
    for (const item of blocked.slice(0, 10)) {
      await api.sendMessage(userId, `Bloklangan: suhbat #${item.id}`, {
        reply_markup: keyboard([button('Blokdan chiqarish', `unblock:${item.id}`)]),
      });
    }
    if (page > 0 || blocked.length > 10) {
      await api.sendMessage(userId, 'Bloklanganlar ro‘yxati:', {
        reply_markup: keyboard([
          ...(page > 0 ? [button('⬅️ Oldingi', `unbanpage:${page - 1}`)] : []),
          ...(blocked.length > 10 ? [button('Keyingi ➡️', `unbanpage:${page + 1}`)] : []),
        ]),
      });
    }
  }

  async function showHelp(userId) {
    const link = await store.getOrCreatePersonalLink(userId);
    const login = (await store.getSettings(userId))?.login;
    await api.sendMessage(userId,
      '<b>Botimiz orqali quyidagi xabarlarni yuborishingiz mumkin:</b>\n\n' +
      '• Ovozli xabar\n' +
      '• Video xabar\n' +
      '• Rasm\n' +
      '• Video va GIF\n' +
      '• Audio\n' +
      '• Document fayllar', {
        parse_mode: 'HTML',
        reply_markup: keyboard([shareButton(linkUrl(login || link.token))]),
      });
  }

  async function showUnbanInstructions(userId) {
    await api.sendMessage(userId,
      '⚠️ Foydalanuvchi ID kiriting.\n\n' +
      'Blokdan chiqarmoqchi bo‘lgan Foydalanuvchi ID’ni quyidagicha yuboring:\n' +
      '<code>/unban ID</code>\n\n' +
      'Barchasini ochish uchun:\n' +
      '<code>/unban all</code>', { parse_mode: 'HTML' });
  }

  async function showPremium(userId) {
    await api.sendMessage(userId,
      '💎 <b>Barcha qo‘shimcha imkoniyatlar siz uchun bepul:</b>\n\n' +
      '• <b>Xabar yuboruvchini ko‘rish</b> — bir tomonlama havolaga kelgan xabar muallifining profilini ko‘rish.\n\n' +
      '• <b>Profil statistikasi</b> — kirgan foydalanuvchilar va kelgan xabarlarni kunlik, haftalik va oylik ko‘rish.\n\n' +
      '• <b>Reklamalarsiz foydalanish</b> — oddiy foydalanishda reklama ko‘rsatilmaydi.\n\n' +
      '• <b>Avto javob</b> — havola orqali kirgan foydalanuvchiga belgilangan xabar avtomatik ko‘rsatiladi.\n\n' +
      'Obuna va to‘lov talab qilinmaydi.',
      { parse_mode: 'HTML', reply_markup: keyboard([button('Bepul foydalanish', 'personal')]) });
  }

  async function showOffers(userId) {
    const enabled = Boolean((await store.getSettings(userId))?.ads_opt_in);
    await api.sendMessage(userId,
      `Homiy xabarlari: ${enabled ? 'yoqilgan' : 'o‘chirilgan'}. Asosiy botdan foydalanish bepul va reklamasiz.`,
      { reply_markup: keyboard([button(enabled ? 'O‘chirish' : 'Yoqish', `offers:${enabled ? 'off' : 'on'}`)]) });
  }

  async function showAdmin(userId) {
    const s = await store.stats();
    await api.sendMessage(userId,
      `Admin panel\nFoydalanuvchilar: ${s.users}\nFaol foydalanuvchilar: ${s.activeUsers}\nFaol havolalar: ${s.links}\nSuhbatlar: ${s.conversations}`,
      { reply_markup: keyboard(
        [button('📣 Barchaga e’lon', 'admin:compose:announcement')],
        [button('🤝 Homiy xabari (rozilik berganlarga)', 'admin:compose:sponsored')],
      ) });
  }

  async function showDraft(userId) {
    const draft = await store.getDraft(userId);
    if (!draft?.source_message_id) {
      await api.sendMessage(userId, 'E’lon matni yoki mediasini yuboring.');
      return;
    }
    const extra = draft.button_url ? {
      reply_markup: keyboard([{ text: draft.button_label, url: draft.button_url }]),
    } : {};
    await api.sendMessage(userId, 'E’lon ko‘rinishi:');
    await api.copyMessage(userId, userId, draft.source_message_id, extra);
    const kind = (await store.getContext(userId))?.target || 'announcement';
    await api.sendMessage(userId, kind === 'sponsored'
      ? 'Faqat homiy xabarlariga rozilik berganlarga yuborilsinmi?'
      : 'Barcha foydalanuvchilarga e’lon yuborilsinmi?', {
      reply_markup: keyboard(
        [button('🔗 Reklama tugmasi qo‘shish', 'admin:addbutton')],
        [button('✅ Tasdiqlash va yuborish', 'admin:confirm')],
        [button('❌ Bekor qilish', 'admin:cancel')],
      ),
    });
  }

  async function handleStart(userId, token) {
    if (!token) return sendHome(userId);
    await store.clearContext(userId);
    const link = await store.resolveStartParameter(token);
    if (link?.active && link.owner_id === String(userId)) return sendHome(userId);
    if (!link?.active) {
      await api.sendMessage(userId, 'Bu havola ishlamayapti. /start ni bosing.');
      return;
    }
    await store.setContext(userId, 'visitor', link.token);
    await store.recordVisit(link.owner_id, link.token, userId);
    await api.sendMessage(userId, entryPrompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard([button('✖️ Bekor qilish', 'cancel')]),
    });
    const autoReply = (await store.getSettings(link.owner_id))?.auto_reply;
    if (autoReply) await api.sendMessage(userId, `💬 Avtojavob:\n${autoReply}`);
  }

  async function handleAgain(userId, token) {
    const link = await store.getLink(token);
    if (!link?.active || link.owner_id === String(userId)) {
      await store.clearContext(userId);
      await api.sendMessage(userId, 'Bu havola ishlamayapti.');
      return;
    }
    await store.setContext(userId, 'visitor', link.token);
    await api.sendMessage(userId, entryPrompt, {
      parse_mode: 'HTML',
      reply_markup: keyboard([button('✖️ Bekor qilish', 'cancel')]),
    });
  }

  async function relayMessage(message, targetId, extra = {}) {
    // Plain text and captions are rebuilt without source formatting or mention entities.
    if (message.text) {
      return api.sendMessage(targetId, message.text, {
        ...extra, link_preview_options: { is_disabled: true }, protect_content: true,
      });
    }
    return api.copyMessage(targetId, message.chat.id, message.message_id, {
      ...extra, protect_content: true,
      ...(message.caption ? { caption: message.caption, caption_entities: [] } : {}),
    });
  }

  async function relayVisitor(message, link) {
    const visitorId = String(message.from.id);
    if (link.owner_id === visitorId) {
      await api.sendMessage(visitorId, 'O‘z havolangizga xabar yubora olmaysiz.');
      return;
    }
    const { conversation } = await store.getOrCreateConversation(link.token, visitorId);
    if (await store.isConversationBlocked(conversation.id)) {
      await api.sendMessage(visitorId, 'Bu havola orqali hozir xabar yubora olmaysiz.');
      return;
    }
    if (link.mode === 'anonymous') {
      const actions = keyboard([button('🔁 Javob berish', `reply:${conversation.id}`)]);
      if (message.text) {
        await api.sendMessage(link.owner_id,
          `✉️ Sizda yangi anonim xabar bor!\n\n${message.text}`,
          { reply_markup: actions, link_preview_options: { is_disabled: true }, protect_content: true });
      } else {
        await api.sendMessage(link.owner_id, '✉️ Sizda yangi anonim xabar bor!');
        await relayMessage(message, link.owner_id, { reply_markup: actions });
      }
    } else {
      const person = await store.getUser(visitorId);
      const name = person?.first_name || 'Foydalanuvchi';
      const handle = person?.username ? ` (@${person.username})` : '';
      await api.sendMessage(link.owner_id, `Yangi xabar: ${name}${handle}\nProfil: tg://user?id=${visitorId}`, {
        reply_markup: keyboard(
          [{ text: '👤 Profilga o‘tish', url: `tg://user?id=${visitorId}` }],
          [button('🚫 Bloklash', `block:${conversation.id}`)],
        ),
        link_preview_options: { is_disabled: true },
      });
      await relayMessage(message, link.owner_id);
    }
    await store.recordIncomingMessage(link.owner_id, link.token, visitorId);
    await store.clearContext(visitorId);
    await api.sendMessage(visitorId, 'Xabaringiz yuborildi!', {
      reply_markup: keyboard([button('Yana xabar yuborish', `again:${link.token}`)]),
    });
    await showPersonalLink(visitorId);
  }

  async function relayOwner(message, conversation) {
    await relayMessage(message, conversation.visitor_id);
    await store.clearContext(message.from.id);
    await api.sendMessage(message.chat.id, 'Javobingiz yuborildi!');
  }

  async function handleAdminMessage(message, context) {
    const userId = String(message.from.id);
    if (context.kind === 'admin_compose') {
      if (!canRelay(message)) {
        await api.sendMessage(userId, 'Matn, rasm, video yoki boshqa oddiy media yuboring.');
        return;
      }
      // Preview first: an unsupported Telegram message cannot become a campaign.
      const preview = await api.copyMessage(userId, userId, message.message_id);
      await store.saveDraft(userId, preview.message_id);
      await store.setContext(userId, 'admin_review', context.target || 'announcement');
      await showDraft(userId);
      return;
    }
    if (context.kind === 'admin_button') {
      const match = message.text?.match(/^(.{1,40})\s*\|\s*(https:\/\/\S+)$/u);
      if (!match) {
        await api.sendMessage(userId, 'Tugmani shu formatda yuboring: Nomi | https://example.com');
        return;
      }
      let url;
      try { url = new URL(match[2]); } catch { /* handled below */ }
      if (!url || url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost') {
        await api.sendMessage(userId, 'To‘g‘ri HTTPS manzil yuboring.');
        return;
      }
      await store.setDraftButton(userId, match[1].trim(), url.toString());
      await store.setContext(userId, 'admin_review', context.target || 'announcement');
      await showDraft(userId);
      return;
    }
    await api.sendMessage(userId, 'E’lonni yuborish uchun pastdagi tasdiqlash tugmasini bosing.');
  }

  async function handleMessage(message) {
    if (message.chat?.type !== 'private' || !message.from || message.from.is_bot) return;
    const userId = String(message.from.id);
    await store.upsertUser(message.from);
    const text = message.text || '';
    const start = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/);
    if (start) return handleStart(userId, start[1]);
    if (/^\/(menu|stop)(?:@\w+)?\s*$/.test(text)) return sendHome(userId);
    if (/^\/id(?:@\w+)?\s*$/.test(text)) {
      await api.sendMessage(userId, `Sizning Telegram ID: ${userId}`);
      return;
    }
    if (/^\/admin(?:@\w+)?\s*$/.test(text)) {
      if (isAdmin(userId)) return showAdmin(userId);
      await api.sendMessage(userId, 'Bu bo‘lim faqat admin uchun.');
      return;
    }
    if (/^\/premium(?:@\w+)?\s*$/.test(text)) return showPremium(userId);
    if (/^\/profile(?:@\w+)?\s*$/.test(text)) return showProfile(userId);
    if (/^\/autoreply(?:@\w+)?\s*$/.test(text)) return showAutoReply(userId);
    const unban = text.match(/^\/unban(?:@\w+)?(?:\s+(all|\d+))?\s*$/i);
    if (unban) {
      if (!unban[1]) return showUnbanInstructions(userId);
      if (unban[1].toLowerCase() === 'all') {
        const count = await store.unblockAllConversations(userId);
        await api.sendMessage(userId, count ? `${count} ta foydalanuvchi blokdan chiqarildi.` : 'Bloklangan foydalanuvchilar yo‘q.');
        return;
      }
      const unblocked = await store.unblockConversation(unban[1], userId);
      await api.sendMessage(userId, unblocked ? 'Foydalanuvchi blokdan chiqarildi.' : 'Bu ID bo‘yicha blok topilmadi.');
      return;
    }
    if (/^\/help(?:@\w+)?\s*$/.test(text)) return showHelp(userId);
    if (/^\/offers(?:@\w+)?\s*$/.test(text)) return showOffers(userId);
    if (/^\/login(?:@\w+)?\s*$/.test(text)) {
      await store.getOrCreatePersonalLink(userId);
      await store.setContext(userId, 'login_input');
      await api.sendMessage(userId,
        '<b>Yangi login kiriting</b>\n\n' +
        'Login faqat lotin harflarida bo‘lishi kerak.\n' +
        'Boshqa alifbo, emoji va bo‘sh joy ishlatmang.', {
          parse_mode: 'HTML',
          reply_markup: keyboard([button('✖️ Bekor qilish', 'cancel')]),
        });
      return;
    }
    if (text === menuLabels.anonymous || text === menuLabels.openSender) {
      await store.clearContext(userId);
      await store.setPersonalLinkMode(userId,
        text === menuLabels.anonymous ? 'anonymous' : 'open_sender');
      return showPersonalLink(userId);
    }
    if (text === menuLabels.links) {
      await store.clearContext(userId);
      return showPersonalLink(userId);
    }
    if (text === menuLabels.profile) {
      await store.clearContext(userId);
      return showProfile(userId);
    }
    if (text === menuLabels.help) {
      await store.clearContext(userId);
      return showHelp(userId);
    }
    if (text.startsWith('/')) {
      await api.sendMessage(userId, 'Buyruq topilmadi. /start ni bosing.');
      return;
    }
    const context = await store.getContext(userId);
    if (!context) return sendHome(userId);
    if (context.kind === 'login_input') {
      const login = text.trim();
      if (!/^[A-Za-z]{1,32}$/.test(login)) {
        await api.sendMessage(userId, 'Login faqat lotin harflaridan iborat bo‘lishi kerak.');
        return;
      }
      try {
        await store.setLogin(userId, login);
      } catch (error) {
        if (error.code === 'LOGIN_TAKEN' || error.code === '23505' ||
          error.code?.startsWith('SQLITE_CONSTRAINT')) {
          await api.sendMessage(userId, 'Bu login band. Boshqasini yuboring.');
          return;
        }
        throw error;
      }
      await store.clearContext(userId);
      await api.sendMessage(userId, '<b>Login muvaffaqiyatli saqlandi.</b>', {
        parse_mode: 'HTML',
        reply_markup: keyboard([shareButton(linkUrl(login))]),
      });
      return;
    }
    if (context.kind === 'autoreply_input') {
      const reply = text.trim();
      if (!reply || reply.length > 1000) {
        await api.sendMessage(userId, 'Avtojavob uchun 1–1000 belgili matn yuboring.');
        return;
      }
      await store.setAutoReply(userId, reply);
      await store.clearContext(userId);
      await api.sendMessage(userId, 'Avtojavob saqlandi.');
      return;
    }
    if (context.kind.startsWith('admin_')) {
      if (!isAdmin(userId)) return sendHome(userId);
      return handleAdminMessage(message, context);
    }
    if (!canRelay(message)) {
      await api.sendMessage(userId, 'Bu turdagi xabar qo‘llanmaydi. Matn, rasm, video, audio yoki fayl yuboring.');
      return;
    }
    if (context.kind === 'visitor') {
      const link = await store.getLink(context.target);
      if (!link?.active) {
        await store.clearContext(userId);
        await api.sendMessage(userId, 'Havola yopilgan.');
        return;
      }
      return relayVisitor(message, link);
    }
    if (context.kind === 'owner_reply') {
      const conversation = await store.getConversation(context.target);
      if (!conversation?.active || conversation.owner_id !== userId) {
        await store.clearContext(userId);
        await api.sendMessage(userId, 'Suhbat endi mavjud emas.');
        return;
      }
      return relayOwner(message, conversation);
    }
    return sendHome(userId);
  }

  async function handleCallback(callback) {
    const userId = String(callback.from.id);
    if (callback.message?.chat?.type !== 'private') return;
    await store.upsertUser(callback.from);
    await api.answerCallback(callback.id);
    const data = callback.data || '';
    if (data === 'home') return sendHome(userId);
    if (data === 'cancel') {
      await store.clearContext(userId);
      return showPersonalLink(userId);
    }
    if (data === 'personal') return showPersonalLink(userId);
    if (data === 'profile') return showProfile(userId);
    if (data === 'help') return showHelp(userId);
    if (data === 'links') return showLinks(userId);
    if (data.startsWith('linkspage:')) {
      const page = Number(data.slice(11));
      if (Number.isInteger(page) && page >= 0 && page < 10000) return showLinks(userId, page);
      return;
    }
    if (data.startsWith('again:')) return handleAgain(userId, data.slice(6));
    if (data === 'auto:set') {
      await store.setContext(userId, 'autoreply_input');
      await api.sendMessage(userId, 'Avtojavob matnini yuboring (1000 belgigacha).', {
        reply_markup: keyboard([button('✖️ Bekor qilish', 'cancel')]),
      });
      return;
    }
    if (data === 'auto:clear') {
      await store.setAutoReply(userId, null);
      await api.sendMessage(userId, 'Avtojavob o‘chirildi.');
      return;
    }
    if (data.startsWith('offers:')) {
      await store.setAdsOptIn(userId, data === 'offers:on');
      return showOffers(userId);
    }
    if (data.startsWith('mode:') || data.startsWith('make:')) {
      const mode = data.slice(data.indexOf(':') + 1);
      if (!['anonymous', 'open_sender'].includes(mode)) return;
      await store.clearContext(userId);
      const current = await store.getOrCreatePersonalLink(userId);
      if (current.mode !== mode) await store.setPersonalLinkMode(userId, mode);
      return refreshPersonalLink(userId, callback.message?.message_id);
    }
    if (data.startsWith('close:')) {
      const closed = await store.deactivateLink(data.slice(6), userId);
      await api.sendMessage(userId, closed ? 'Havola yopildi.' : 'Havola topilmadi yoki allaqachon yopilgan.');
      return;
    }
    if (data.startsWith('reply:')) {
      const conversation = await store.getConversation(data.slice(6));
      if (!conversation?.active || conversation.owner_id !== userId) return;
      await store.setContext(userId, 'owner_reply', conversation.id);
      await api.sendMessage(userId, 'Javobingizni yozing!', {
        reply_markup: keyboard(
          [button('✖️ Bekor qilish', 'cancel')],
          [button('🚫 Bloklash', `block:${conversation.id}`)],
        ),
      });
      return;
    }
    if (data.startsWith('block:')) {
      const conversationId = data.slice(6);
      const blocked = await store.blockConversation(conversationId, userId);
      const context = await store.getContext(userId);
      if (blocked && context?.kind === 'owner_reply' && context.target === conversationId) {
        await store.clearContext(userId);
      }
      await api.sendMessage(userId, blocked
        ? `Yozuvchi bloklandi. Suhbat ID: ${conversationId}. Blokdan chiqarish: /unban ${conversationId}`
        : 'Suhbat topilmadi.');
      return;
    }
    if (data.startsWith('unblock:')) {
      const unblocked = await store.unblockConversation(data.slice(8), userId);
      await api.sendMessage(userId, unblocked ? 'Yozuvchi blokdan chiqarildi.' : 'Blok topilmadi.');
      return;
    }
    if (data.startsWith('unbanpage:')) {
      const page = Number(data.slice(10));
      if (Number.isInteger(page) && page >= 0 && page < 10000) return showBlocked(userId, page);
      return;
    }
    if (!isAdmin(userId) || !data.startsWith('admin:')) return;
    if (data === 'admin:compose' || data.startsWith('admin:compose:')) {
      const kind = data === 'admin:compose:sponsored' ? 'sponsored' : 'announcement';
      await store.clearDraft(userId);
      await store.setContext(userId, 'admin_compose', kind);
      await api.sendMessage(userId, 'E’lon yoki reklama matnini/mediasini yuboring.');
    } else if (data === 'admin:addbutton') {
      if (!(await store.getDraft(userId))?.source_message_id) return;
      const kind = (await store.getContext(userId))?.target || 'announcement';
      await store.setContext(userId, 'admin_button', kind);
      await api.sendMessage(userId, 'Tugmani yuboring: Nomi | https://example.com');
    } else if (data === 'admin:cancel') {
      await store.clearDraft(userId);
      await store.clearContext(userId);
      await api.sendMessage(userId, 'E’lon bekor qilindi.');
    } else if (data === 'admin:confirm') {
      const context = await store.getContext(userId);
      if (context?.kind !== 'admin_review') return;
      const jobId = await store.createBroadcast(userId, context.target || 'announcement');
      if (!jobId) return;
      await store.clearContext(userId);
      await api.sendMessage(userId, `E’lon navbatga qo‘shildi (#${jobId}). Yakunda natija yuboriladi.`);
      wakeBroadcasts();
    }
  }

  return {
    async handleUpdate(update) {
      if (update.message) return handleMessage(update.message);
      if (update.callback_query) return handleCallback(update.callback_query);
    },
  };
}

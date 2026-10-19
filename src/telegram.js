const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramApiError extends Error {
  constructor(method, response) {
    super(`${method}: ${response.description || 'Telegram API error'}`);
    this.code = response.error_code;
    this.retryAfter = response.parameters?.retry_after;
  }
}

export function createTelegramApi(token) {
  const base = `https://api.telegram.org/bot${token}/`;
  return {
    async call(method, data = {}, retry = true) {
      const response = await fetch(base + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 20000),
      });
      const body = await response.json();
      if (body.ok) return body.result;
      if (retry && body.error_code === 429 && body.parameters?.retry_after) {
        await pause((body.parameters.retry_after + 1) * 1000);
        return this.call(method, data, false);
      }
      throw new TelegramApiError(method, body);
    },
    sendMessage(chatId, text, extra = {}) {
      return this.call('sendMessage', { chat_id: chatId, text, ...extra });
    },
    copyMessage(chatId, fromChatId, messageId, extra = {}) {
      return this.call('copyMessage', {
        chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...extra,
      });
    },
    editMessageText(chatId, messageId, text, extra = {}) {
      return this.call('editMessageText', {
        chat_id: chatId, message_id: messageId, text, ...extra,
      });
    },
    answerCallback(id, text = '') {
      return this.call('answerCallbackQuery', { callback_query_id: id, text });
    },
  };
}

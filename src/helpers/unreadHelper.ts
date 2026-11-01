import NodeCache from 'node-cache';
const memory = new NodeCache({ stdTTL: 0, checkperiod: 120, useClones: false });
type UnreadMap = Record<string, number>;

const CHAT_UNREAD_PREFIX = 'chat:unread_count:'; // chat:unread_count:<chatId>

const chatKey = (chatId: string) => `${CHAT_UNREAD_PREFIX}${String(chatId)}`;

export const getUnreadCountCached = async (
  chatId: string,
  userId: string
): Promise<number | null> => {
  const key = chatKey(chatId);
  const map = memory.get<UnreadMap>(key);
  if (!map) return null;
  const v = map[String(userId)];
  if (v === undefined) return null;
  return Number.isFinite(v) ? v : 0;
};

export const setUnreadCount = async (
  chatId: string,
  userId: string,
  count: number
): Promise<void> => {
  const key = chatKey(chatId);
  const map = memory.get<UnreadMap>(key) || {};
  map[String(userId)] = count;
  memory.set(key, map);
};

export const incrementUnreadCount = async (
  chatId: string,
  userId: string,
  delta: number
): Promise<number> => {
  const key = chatKey(chatId);
  const map = memory.get<UnreadMap>(key) || {};
  const current = map[String(userId)] || 0;
  const next = current + delta;
  map[String(userId)] = next;
  memory.set(key, map);
  return next;
};

export const clearUnreadCount = async (
  chatId: string,
  userId: string
): Promise<void> => {
  const key = chatKey(chatId);
  const map = memory.get<UnreadMap>(key) || {};
  delete map[String(userId)];
  memory.set(key, map);
};

export const UnreadHelper = {
  getUnreadCountCached,
  setUnreadCount,
  incrementUnreadCount,
  clearUnreadCount,
};

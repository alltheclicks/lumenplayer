import { getAppStorage } from '@/services/storage';
import { loadStoredCredentials } from '@/services/storage';

const PUSH_SUBSCRIPTIONS_KEY = 'push_subscriptions_v1';
const PUSH_DEVICE_ID_KEY = 'push_device_id';

export interface PushSubscriptionRecord {
  userId: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  subscribedAt: string;
  updatedAt: string;
}

interface PushSubscriptionStore {
  users: Record<string, Record<string, PushSubscriptionRecord>>;
}

export interface SubscribePushPayload {
  userId: string;
  deviceId: string;
  subscription: PushSubscriptionJSON;
  userAgent: string;
}

export interface UnsubscribePushPayload {
  userId: string;
  deviceId: string;
}

const getDefaultStore = (): PushSubscriptionStore => ({
  users: {},
});

const readStore = async (): Promise<PushSubscriptionStore> => {
  const storage = getAppStorage();
  if (!storage) {
    return getDefaultStore();
  }

  const value = await storage.get<PushSubscriptionStore>(PUSH_SUBSCRIPTIONS_KEY);
  if (!value || typeof value !== 'object' || !value.users || typeof value.users !== 'object') {
    return getDefaultStore();
  }

  return value;
};

const writeStore = async (store: PushSubscriptionStore): Promise<void> => {
  const storage = getAppStorage();
  if (!storage) {
    return;
  }

  await storage.set(PUSH_SUBSCRIPTIONS_KEY, store);
};

const toRecord = (payload: SubscribePushPayload, nowIso: string): PushSubscriptionRecord => {
  const keys = payload.subscription.keys;
  return {
    userId: payload.userId,
    deviceId: payload.deviceId,
    endpoint: payload.subscription.endpoint ?? '',
    p256dh: keys?.p256dh ?? '',
    auth: keys?.auth ?? '',
    userAgent: payload.userAgent,
    subscribedAt: nowIso,
    updatedAt: nowIso,
  };
};

const getDeviceIdFromLocalStorage = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(PUSH_DEVICE_ID_KEY);
};

const createDeviceId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getOrCreatePushDeviceId = (): string => {
  const existing = getDeviceIdFromLocalStorage();
  if (existing) {
    return existing;
  }

  const created = createDeviceId();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(PUSH_DEVICE_ID_KEY, created);
  }

  return created;
};

export const resolvePushUserId = async (): Promise<string> => {
  const credentials = await loadStoredCredentials();
  if (credentials?.username?.trim()) {
    return credentials.username.trim();
  }

  return 'local-user';
};

export const subscribePushEndpoint = async (payload: SubscribePushPayload): Promise<PushSubscriptionRecord> => {
  const store = await readStore();
  const userStore = store.users[payload.userId] ?? {};
  const nowIso = new Date().toISOString();
  const next = toRecord(payload, nowIso);

  const previous = userStore[payload.deviceId];
  if (previous) {
    next.subscribedAt = previous.subscribedAt;
    next.updatedAt = nowIso;
  }

  store.users[payload.userId] = {
    ...userStore,
    [payload.deviceId]: next,
  };

  await writeStore(store);
  return next;
};

export const unsubscribePushEndpoint = async (payload: UnsubscribePushPayload): Promise<boolean> => {
  const store = await readStore();
  const userStore = store.users[payload.userId];

  if (!userStore || !userStore[payload.deviceId]) {
    return false;
  }

  const { [payload.deviceId]: _removed, ...rest } = userStore;
  if (Object.keys(rest).length === 0) {
    const { [payload.userId]: _removedUser, ...remainingUsers } = store.users;
    store.users = remainingUsers;
  } else {
    store.users[payload.userId] = rest;
  }

  await writeStore(store);
  return true;
};

export const listPushSubscriptionsForUser = async (userId: string): Promise<PushSubscriptionRecord[]> => {
  const store = await readStore();
  return Object.values(store.users[userId] ?? {});
};

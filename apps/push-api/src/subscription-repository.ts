import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PushStore, StoredPushSubscription } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const STORE_PATH = path.join(DATA_DIR, 'push-subscriptions.json');

const emptyStore = (): PushStore => ({ users: {} });

const ensureDataDir = async (): Promise<void> => {
  await fs.mkdir(DATA_DIR, { recursive: true });
};

const readStore = async (): Promise<PushStore> => {
  await ensureDataDir();

  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as PushStore;
    if (!parsed.users || typeof parsed.users !== 'object') {
      return emptyStore();
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStore();
    }
    throw error;
  }
};

const writeStore = async (store: PushStore): Promise<void> => {
  await ensureDataDir();
  await fs.writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
};

export const upsertSubscription = async (
  record: Omit<StoredPushSubscription, 'createdAt' | 'updatedAt'>,
): Promise<StoredPushSubscription> => {
  const store = await readStore();
  const userBucket = store.users[record.userId] ?? {};
  const now = new Date().toISOString();
  const previous = userBucket[record.deviceId];

  const next: StoredPushSubscription = {
    ...record,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  store.users[record.userId] = {
    ...userBucket,
    [record.deviceId]: next,
  };

  await writeStore(store);
  return next;
};

export const removeSubscription = async (userId: string, deviceId: string): Promise<boolean> => {
  const store = await readStore();
  const userBucket = store.users[userId];
  if (!userBucket || !userBucket[deviceId]) {
    return false;
  }

  const { [deviceId]: _removed, ...rest } = userBucket;
  if (Object.keys(rest).length === 0) {
    const { [userId]: _removedUser, ...nextUsers } = store.users;
    store.users = nextUsers;
  } else {
    store.users[userId] = rest;
  }

  await writeStore(store);
  return true;
};

export const listUserSubscriptions = async (userId: string): Promise<StoredPushSubscription[]> => {
  const store = await readStore();
  return Object.values(store.users[userId] ?? {});
};

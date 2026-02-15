import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import { listUserSubscriptions, removeSubscription } from './subscription-repository.js';
import type { DeliveryLogEntry, SendPushCommand, StoredPushSubscription } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data');
const DELIVERY_LOG_PATH = path.join(DATA_DIR, 'push-delivery.log');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [800, 1600, 3200];

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value.trim();
};

export const configureWebPush = (): void => {
  webpush.setVapidDetails(
    process.env.PUSH_VAPID_SUBJECT?.trim() || 'mailto:ops@lumenplayer.local',
    getEnv('PUSH_VAPID_PUBLIC_KEY'),
    getEnv('PUSH_VAPID_PRIVATE_KEY'),
  );
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const toPushPayload = (command: SendPushCommand): string => JSON.stringify({
  title: command.title,
  body: command.body,
  url: command.url ?? '/player',
  sentAt: new Date().toISOString(),
});

const toSubscriptionObject = (subscription: StoredPushSubscription): webpush.PushSubscription => ({
  endpoint: subscription.endpoint,
  keys: {
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  },
});

const appendDeliveryLog = async (entry: DeliveryLogEntry): Promise<void> => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(DELIVERY_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
};

const shouldRetry = (statusCode: number | undefined): boolean => {
  if (statusCode === undefined) {
    return true;
  }

  return statusCode === 429 || statusCode >= 500;
};

const sendWithRetry = async (
  subscription: StoredPushSubscription,
  command: SendPushCommand,
): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    try {
      const response = await webpush.sendNotification(
        toSubscriptionObject(subscription),
        toPushPayload(command),
        {
          TTL: command.ttlSeconds ?? 60,
          urgency: 'normal',
        },
      );

      await appendDeliveryLog({
        id,
        queuedAt: new Date().toISOString(),
        deliveredAt: new Date().toISOString(),
        userId: subscription.userId,
        deviceId: subscription.deviceId,
        endpoint: subscription.endpoint,
        attempt,
        success: true,
        statusCode: response.statusCode,
      });

      return;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      const message = error instanceof Error ? error.message : 'Unknown push delivery error';

      await appendDeliveryLog({
        id,
        queuedAt: new Date().toISOString(),
        userId: subscription.userId,
        deviceId: subscription.deviceId,
        endpoint: subscription.endpoint,
        attempt,
        success: false,
        statusCode,
        error: message,
      });

      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(subscription.userId, subscription.deviceId);
        return;
      }

      if (!shouldRetry(statusCode) || attempt === MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]);
    }
  }
};

export const sendPushToUser = async (command: SendPushCommand): Promise<{ delivered: number; failed: number }> => {
  const subscriptions = await listUserSubscriptions(command.userId);
  const targets = command.deviceId
    ? subscriptions.filter((subscription) => subscription.deviceId === command.deviceId)
    : subscriptions;

  let delivered = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      await sendWithRetry(target, command);
      delivered += 1;
    } catch {
      failed += 1;
    }
  }

  return { delivered, failed };
};

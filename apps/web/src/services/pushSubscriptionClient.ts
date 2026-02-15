import {
  getOrCreatePushDeviceId,
  resolvePushUserId,
  subscribePushEndpoint,
  unsubscribePushEndpoint,
  type PushSubscriptionRecord,
} from '@/services/pushSubscriptionBackend';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_PUSH_VAPID_PUBLIC_KEY as string | undefined;

const base64UrlToUint8Array = (value: string): Uint8Array => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
};

const canUsePushApis = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return 'serviceWorker' in navigator && 'PushManager' in window;
};

export interface PushSyncResult {
  ok: boolean;
  reason?: string;
  record?: PushSubscriptionRecord;
}

export const syncPushSubscriptionWithBackend = async (): Promise<PushSyncResult> => {
  if (!canUsePushApis()) {
    return { ok: false, reason: 'Push APIs are not available on this browser/device.' };
  }

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { ok: false, reason: 'Notification permission is not granted.' };
  }

  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, reason: 'Missing VAPID public key configuration (VITE_PUSH_VAPID_PUBLIC_KEY).' };
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const userId = await resolvePushUserId();
  const deviceId = getOrCreatePushDeviceId();

  const record = await subscribePushEndpoint({
    userId,
    deviceId,
    subscription: subscription.toJSON(),
    userAgent: navigator.userAgent,
  });

  return {
    ok: true,
    record,
  };
};

export const unsubscribePushSubscriptionFromBackend = async (): Promise<PushSyncResult> => {
  if (!canUsePushApis()) {
    return { ok: false, reason: 'Push APIs are not available on this browser/device.' };
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    await subscription.unsubscribe();
  }

  const userId = await resolvePushUserId();
  const deviceId = getOrCreatePushDeviceId();
  await unsubscribePushEndpoint({ userId, deviceId });

  return {
    ok: true,
  };
};

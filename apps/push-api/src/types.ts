export interface StoredPushSubscription {
  userId: string;
  deviceId: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string;
  createdAt: string;
  updatedAt: string;
}

export interface PushStore {
  users: Record<string, Record<string, StoredPushSubscription>>;
}

export interface DeliveryLogEntry {
  id: string;
  queuedAt: string;
  deliveredAt?: string;
  userId: string;
  deviceId: string;
  endpoint: string;
  attempt: number;
  success: boolean;
  statusCode?: number;
  error?: string;
}

export interface SendPushCommand {
  userId: string;
  title: string;
  body: string;
  url?: string;
  deviceId?: string;
  ttlSeconds?: number;
}

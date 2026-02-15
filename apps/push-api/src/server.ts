import http from 'node:http';
import { configureWebPush, sendPushToUser } from './push-sender-service.js';
import { removeSubscription, upsertSubscription } from './subscription-repository.js';
import type { SendPushCommand } from './types.js';

const port = Number(process.env.PORT ?? 8787);

const parseJsonBody = async (request: http.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as unknown) : {};
};

const sendJson = (response: http.ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
};

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const server = http.createServer(async (request, response) => {
  try {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (method === 'POST' && url.pathname === '/api/push/subscribe') {
      const body = await parseJsonBody(request) as {
        userId?: string;
        deviceId?: string;
        userAgent?: string;
        subscription?: PushSubscriptionJSON;
      };

      if (!isString(body.userId) || !isString(body.deviceId) || !body.subscription?.endpoint) {
        sendJson(response, 400, { error: 'Invalid subscribe payload.' });
        return;
      }

      const next = await upsertSubscription({
        userId: body.userId.trim(),
        deviceId: body.deviceId.trim(),
        endpoint: body.subscription.endpoint,
        keys: {
          p256dh: body.subscription.keys?.p256dh ?? '',
          auth: body.subscription.keys?.auth ?? '',
        },
        userAgent: body.userAgent?.trim() ?? 'unknown',
      });

      sendJson(response, 200, { ok: true, record: next });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/push/unsubscribe') {
      const body = await parseJsonBody(request) as {
        userId?: string;
        deviceId?: string;
      };

      if (!isString(body.userId) || !isString(body.deviceId)) {
        sendJson(response, 400, { error: 'Invalid unsubscribe payload.' });
        return;
      }

      const removed = await removeSubscription(body.userId.trim(), body.deviceId.trim());
      sendJson(response, 200, { ok: true, removed });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/push/send') {
      const body = await parseJsonBody(request) as SendPushCommand;
      if (!isString(body.userId) || !isString(body.title) || !isString(body.body)) {
        sendJson(response, 400, { error: 'Invalid send payload.' });
        return;
      }

      const result = await sendPushToUser({
        userId: body.userId.trim(),
        title: body.title.trim(),
        body: body.body.trim(),
        url: isString(body.url) ? body.url.trim() : '/player',
        deviceId: isString(body.deviceId) ? body.deviceId.trim() : undefined,
        ttlSeconds: typeof body.ttlSeconds === 'number' ? Math.max(10, Math.round(body.ttlSeconds)) : 60,
      });

      sendJson(response, 200, { ok: true, ...result });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    sendJson(response, 500, { error: message });
  }
});

try {
  configureWebPush();
} catch (error) {
  console.warn('[push-api] VAPID config warning:', error instanceof Error ? error.message : error);
}

server.listen(port, () => {
  console.log(`[push-api] listening on http://localhost:${port}`);
});

import webPush from "web-push";
import { config } from "../config.js";
import { httpJson } from "../lib/http.js";
import { asBoolean, asRecord, asString, JsonRecord, redactJsonRecord, truncate } from "../lib/json.js";
import { resolveInternalToken, vaultValue } from "../lib/vault.js";
import { DeliveryRequest, DeliveryResult } from "./types.js";

type BrowserPushSubscriptionRecord = {
  id: string;
  endpoint?: string | null;
  expiration_time?: string | null;
  p256dh?: string | null;
  auth?: string | null;
  status?: string | null;
  permission?: string | null;
  endpoint_hash?: string | null;
};

type BrowserPushSubscriptionResponse = {
  ok?: boolean;
  browser_subscription?: BrowserPushSubscriptionRecord;
};

type BrowserPushConfig = {
  subject: string;
  publicKey: string;
  privateKey: string;
};

let browserPushConfigCache: BrowserPushConfig | null = null;

async function resolveConfiguredOrVault(configured: string, key: string): Promise<string> {
  if (configured.trim()) {
    return configured.trim();
  }
  if (!config.browserPushVapidVaultPath) {
    return "";
  }
  return vaultValue(config.browserPushVapidVaultPath, key);
}

export async function resolveBrowserPushConfig(): Promise<BrowserPushConfig> {
  if (browserPushConfigCache) {
    return browserPushConfigCache;
  }

  const [subject, publicKey, privateKey] = await Promise.all([
    resolveConfiguredOrVault(config.browserPushVapidSubject, config.browserPushVapidSubjectVaultKey),
    resolveConfiguredOrVault(config.browserPushVapidPublicKey, config.browserPushVapidPublicKeyVaultKey),
    resolveConfiguredOrVault(config.browserPushVapidPrivateKey, config.browserPushVapidPrivateKeyVaultKey)
  ]);

  if (!subject || !publicKey || !privateKey) {
    throw new Error("Browser push VAPID subject, public key, and private key must be configured.");
  }

  browserPushConfigCache = { subject, publicKey, privateKey };
  return browserPushConfigCache;
}

function valueFromRecords(records: Array<JsonRecord | null | undefined>, keys: string[]): string {
  for (const record of records) {
    if (!record) {
      continue;
    }
    for (const key of keys) {
      const value = asString(record[key]);
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function browserSubscriptionId(input: DeliveryRequest): string {
  const recipientData = asRecord(input.recipient.data);
  return valueFromRecords([input.recipient, recipientData, input.metadata], [
    "browser_subscription_id",
    "browser_push_subscription_id",
    "subscription_id",
    "id"
  ]);
}

async function getBrowserPushSubscription(subscriptionId: string): Promise<BrowserPushSubscriptionRecord> {
  const token = await resolveInternalToken();
  if (!token) {
    throw new Error("Internal auth token is not configured.");
  }

  const result = await httpJson<BrowserPushSubscriptionResponse>(
    `${config.platformNotificationServiceUrl}/internal/browser-subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      headers: { authorization: `Bearer ${token}` },
      timeoutMs: config.requestTimeoutMs
    }
  );
  if (result.statusCode >= 400 || !result.payload?.browser_subscription?.id) {
    throw new Error(`Browser push subscription lookup failed: ${result.statusCode} ${truncate(result.text, 500)}`);
  }
  return result.payload.browser_subscription;
}

function validateSubscription(subscription: BrowserPushSubscriptionRecord): void {
  if (subscription.status && subscription.status !== "active") {
    throw new Error(`Browser push subscription ${subscription.id} is not active.`);
  }
  if (subscription.permission && subscription.permission !== "granted") {
    throw new Error(`Browser push subscription ${subscription.id} permission is ${subscription.permission}.`);
  }
  if (!subscription.endpoint || !subscription.p256dh || !subscription.auth) {
    throw new Error(`Browser push subscription ${subscription.id} is missing endpoint or encryption keys.`);
  }
}

function notificationTitle(input: DeliveryRequest): string {
  return asString(input.message.title) || asString(input.message.subject) || "Platform update";
}

function notificationBody(input: DeliveryRequest): string {
  return asString(input.message.body) || asString(input.message.text) || asString(input.message.html);
}

function notificationOptions(notificationRequestId: string, input: DeliveryRequest): JsonRecord {
  return {
    tag: asString(input.options.tag, `platform-notification-${notificationRequestId}`),
    icon: asString(input.options.icon) || undefined,
    badge: asString(input.options.badge) || undefined,
    image: asString(input.options.image) || undefined,
    requireInteraction: asBoolean(input.options.requireInteraction, false),
    renotify: asBoolean(input.options.renotify, true),
    silent: asBoolean(input.options.silent, false)
  };
}

export async function executeBrowserPushDelivery(
  notificationRequestId: string,
  providerKey: string,
  input: DeliveryRequest
): Promise<DeliveryResult> {
  const subscriptionId = browserSubscriptionId(input);
  if (!subscriptionId) {
    throw new Error("browser_push delivery requires a browser subscription recipient id.");
  }

  const [browserConfig, subscription] = await Promise.all([
    resolveBrowserPushConfig(),
    getBrowserPushSubscription(subscriptionId)
  ]);
  validateSubscription(subscription);

  webPush.setVapidDetails(browserConfig.subject, browserConfig.publicKey, browserConfig.privateKey);

  const payload = {
    type: "platform_notification",
    notification_request_id: notificationRequestId,
    title: notificationTitle(input),
    body: notificationBody(input),
    data: {
      ...(asRecord(input.message.data) ?? {}),
      notification_request_id: notificationRequestId,
      channel: input.channel,
      provider_key: providerKey,
      correlation_id: asString(input.metadata.correlation_id) || undefined
    },
    options: notificationOptions(notificationRequestId, input),
    metadata: redactJsonRecord(input.metadata)
  };

  try {
    const response = await webPush.sendNotification(
      {
        endpoint: subscription.endpoint || "",
        expirationTime: subscription.expiration_time ? Date.parse(subscription.expiration_time) : null,
        keys: {
          p256dh: subscription.p256dh || "",
          auth: subscription.auth || ""
        }
      },
      JSON.stringify(payload),
      {
        TTL: Math.max(60, Number(input.options.ttl_seconds) || 3600),
        urgency: asString(input.options.urgency, "normal") as webPush.Urgency
      }
    );

    return {
      ok: true,
      status: "sent",
      channel: input.channel,
      provider_key: providerKey,
      provider_message_id: `${subscription.id}:${response.statusCode}`,
      response_json: {
        provider: "web_push",
        subscription_id: subscription.id,
        endpoint_hash: subscription.endpoint_hash || null,
        status_code: response.statusCode,
        headers: redactJsonRecord({ ...response.headers })
      }
    };
  } catch (error) {
    const maybeWebPushError = error as { statusCode?: number; body?: string; headers?: JsonRecord };
    return {
      ok: false,
      status: "failed",
      channel: input.channel,
      provider_key: providerKey,
      response_json: {
        provider: "web_push",
        subscription_id: subscription.id,
        endpoint_hash: subscription.endpoint_hash || null,
        status_code: maybeWebPushError.statusCode || null,
        headers: redactJsonRecord(asRecord(maybeWebPushError.headers) ?? {}),
        body: maybeWebPushError.body ? truncate(maybeWebPushError.body, 1000) : undefined,
        subscription_should_disable: maybeWebPushError.statusCode === 404 || maybeWebPushError.statusCode === 410
      },
      error_message: error instanceof Error ? truncate(error.message, 1000) : "Browser push delivery failed."
    };
  }
}

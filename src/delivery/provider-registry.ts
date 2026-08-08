import { executeBrowserPushDelivery } from "./browser-push.js";
import { executeEmailDelivery } from "./email.js";
import type { DeliveryProvider } from "./provider.js";
import { DeliveryRequest, DeliveryResult, NotificationChannel } from "./types.js";

const BUILT_IN_PROVIDERS: DeliveryProvider[] = [
  {
    manifest: {
      providerKey: "web-push:browser_push",
      displayName: "Browser Web Push",
      channels: ["browser_push"]
    },
    execute: executeBrowserPushDelivery
  },
  {
    manifest: {
      providerKey: "smtp:default",
      displayName: "SMTP Email",
      channels: ["email"]
    },
    execute: executeEmailDelivery
  }
];

const DEFAULT_PROVIDER_KEYS: Partial<Record<NotificationChannel, string>> = {
  browser_push: "web-push:browser_push",
  email: "smtp:default"
};

export function deliveryProviderKey(input: DeliveryRequest): string {
  return input.provider_key || DEFAULT_PROVIDER_KEYS[input.channel] || `${input.channel}:default`;
}

function builtInProvider(providerKey: string, channel: NotificationChannel): DeliveryProvider | null {
  return BUILT_IN_PROVIDERS.find((provider) =>
    provider.manifest.providerKey === providerKey && provider.manifest.channels.includes(channel)
  ) ?? null;
}

export async function executeRegisteredProviderDelivery(
  notificationRequestId: string,
  input: DeliveryRequest
): Promise<DeliveryResult> {
  const providerKey = deliveryProviderKey(input);
  const provider = builtInProvider(providerKey, input.channel);
  if (provider) {
    return provider.execute(notificationRequestId, providerKey, input);
  }

  return {
    ok: false,
    status: "failed",
    channel: input.channel,
    provider_key: providerKey,
    response_json: {
      notification_request_id: notificationRequestId
    },
    error_message: `No delivery provider is registered for channel ${input.channel} and provider key ${providerKey}.`
  };
}

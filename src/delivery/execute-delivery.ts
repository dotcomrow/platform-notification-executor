import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { redactJsonRecord } from "../lib/json.js";
import { deliveryProviderKey, executeRegisteredProviderDelivery } from "./provider-registry.js";
import { DeliveryRequest, DeliveryResult } from "./types.js";

export async function executeDelivery(notificationRequestId: string, input: DeliveryRequest): Promise<DeliveryResult> {
  const providerKey = deliveryProviderKey(input);

  if (config.executorMode !== "dry_run") {
    return executeRegisteredProviderDelivery(notificationRequestId, input);
  }

  return {
    ok: true,
    status: "sent",
    channel: input.channel,
    provider_key: providerKey,
    provider_message_id: `dry-run-${randomUUID()}`,
    response_json: {
      mode: "dry_run",
      notification_request_id: notificationRequestId,
      recipient: redactJsonRecord(input.recipient),
      message: redactJsonRecord(input.message),
      options: redactJsonRecord(input.options),
      metadata: redactJsonRecord(input.metadata)
    }
  };
}

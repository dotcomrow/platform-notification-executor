import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { redactJsonRecord } from "../lib/json.js";
import { executeBrowserPushDelivery } from "./browser-push.js";
import { DeliveryRequest, DeliveryResult } from "./types.js";

export async function executeDelivery(notificationRequestId: string, input: DeliveryRequest): Promise<DeliveryResult> {
  const providerKey = input.provider_key || `${input.channel}:default`;

  if (config.executorMode !== "dry_run") {
    if (input.channel === "browser_push") {
      return executeBrowserPushDelivery(notificationRequestId, providerKey, input);
    }

    return {
      ok: false,
      status: "failed",
      channel: input.channel,
      provider_key: providerKey,
      response_json: {
        mode: config.executorMode,
        notification_request_id: notificationRequestId
      },
      error_message: `Provider execution mode is not implemented for channel ${input.channel}.`
    };
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

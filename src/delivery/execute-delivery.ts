import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { asBoolean, asRecord, redactJsonRecord } from "../lib/json.js";
import { deliveryProviderKey, executeRegisteredProviderDelivery } from "./provider-registry.js";
import { DeliveryRequest, DeliveryResult } from "./types.js";

function deliveryDryRunRequested(input: DeliveryRequest): boolean {
  const options = asRecord(input.options) ?? {};
  const metadata = asRecord(input.metadata) ?? {};
  const runtimeCanary = asRecord(metadata.runtime_canary) ?? asRecord(metadata.canary);
  return asBoolean(options.dry_run)
    || asBoolean(options.dryRun)
    || asBoolean(metadata.dry_run)
    || asBoolean(metadata.dryRun)
    || asBoolean(runtimeCanary?.dry_run)
    || asBoolean(runtimeCanary?.dryRun);
}

export async function executeDelivery(notificationRequestId: string, input: DeliveryRequest): Promise<DeliveryResult> {
  const providerKey = deliveryProviderKey(input);

  if (config.executorMode !== "dry_run" && !deliveryDryRunRequested(input)) {
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

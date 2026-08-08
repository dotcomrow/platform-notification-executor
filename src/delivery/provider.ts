import { JsonRecord } from "../lib/json.js";
import { DeliveryRequest, DeliveryResult, NotificationChannel } from "./types.js";

export type DeliveryProviderManifest = {
  providerKey: string;
  displayName: string;
  channels: NotificationChannel[];
  configSchema?: JsonRecord;
  secretSchema?: JsonRecord;
  metadata?: JsonRecord;
};

export type DeliveryProvider = {
  manifest: DeliveryProviderManifest;
  execute: (notificationRequestId: string, providerKey: string, input: DeliveryRequest) => Promise<DeliveryResult>;
};

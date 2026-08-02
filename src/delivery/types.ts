import { JsonRecord } from "../lib/json.js";

export type NotificationChannel = "in_app" | "browser_push" | "mobile_push" | "email" | "sms" | "voice" | "webhook";

export type DeliveryRequest = {
  channel: NotificationChannel;
  provider_key?: string;
  recipient: JsonRecord;
  message: {
    subject?: string;
    title?: string;
    text?: string;
    html?: string;
    body?: string;
    data?: JsonRecord;
  };
  options: JsonRecord;
  metadata: JsonRecord;
};

export type DeliveryResult = {
  ok: boolean;
  status: "sent" | "failed" | "skipped";
  channel: NotificationChannel;
  provider_key: string;
  provider_message_id?: string;
  response_json: JsonRecord;
  error_message?: string;
};

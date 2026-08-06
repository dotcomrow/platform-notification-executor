import { z } from "zod";
import { asRecord, JsonRecord } from "../lib/json.js";
import { DeliveryRequest } from "./types.js";

const channelSchema = z.enum(["in_app", "browser_push", "mobile_push", "email", "sms", "voice", "webhook"]);
const jsonRecordSchema = z.record(z.unknown()).default({});
const optionalTextSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional()
);

const messageSchema = z.object({
  subject: optionalTextSchema,
  title: optionalTextSchema,
  text: optionalTextSchema,
  html: optionalTextSchema,
  body: optionalTextSchema,
  data: jsonRecordSchema.optional()
}).superRefine((value, ctx) => {
  if (!value.subject && !value.title && !value.text && !value.html && !value.body && !value.data) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "message must include subject, title, text, html, body, or data"
    });
  }
});

const deliveryRequestSchema = z.object({
  channel: channelSchema,
  provider_key: z.string().trim().min(1).optional(),
  recipient: jsonRecordSchema,
  message: messageSchema,
  options: jsonRecordSchema,
  metadata: jsonRecordSchema
});

function unwrapInput(body: unknown): JsonRecord {
  const root = asRecord(body) ?? {};
  return asRecord(root.input) ?? asRecord(root.body) ?? root;
}

export function parseDeliveryRequest(body: unknown): DeliveryRequest {
  return deliveryRequestSchema.parse(unwrapInput(body)) as DeliveryRequest;
}

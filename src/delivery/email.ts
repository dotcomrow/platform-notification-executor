import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "../config.js";
import { asBoolean, asRecord, asString, JsonRecord, redactJsonRecord, truncate } from "../lib/json.js";
import { vaultValue } from "../lib/vault.js";
import { DeliveryRequest, DeliveryResult } from "./types.js";

type EmailSmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  replyTo: string;
};

let emailSmtpConfigCache: EmailSmtpConfig | null = null;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function emailDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) {
    return null;
  }
  return address.slice(at + 1).toLowerCase();
}

async function optionalVaultValue(path: string, key: string): Promise<string> {
  try {
    return await vaultValue(path, key);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(`did not return key ${key}`) || message.includes(" failed: 404 ")) {
      return "";
    }
    throw error;
  }
}

async function resolveConfiguredOrVault(configured: string, key: string): Promise<string> {
  if (configured.trim()) {
    return configured.trim();
  }
  if (!config.emailSmtpVaultPath) {
    return "";
  }
  return optionalVaultValue(config.emailSmtpVaultPath, key);
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number(value);
  return Math.max(1, Math.min(65535, Number.isFinite(parsed) ? parsed : fallback));
}

export async function resolveEmailSmtpConfig(): Promise<EmailSmtpConfig> {
  if (emailSmtpConfigCache) {
    return emailSmtpConfigCache;
  }

  const [
    host,
    portValue,
    secureValue,
    username,
    password,
    from,
    replyTo
  ] = await Promise.all([
    resolveConfiguredOrVault(config.emailSmtpHost, config.emailSmtpHostVaultKey),
    resolveConfiguredOrVault(config.emailSmtpPortRaw, config.emailSmtpPortVaultKey),
    resolveConfiguredOrVault(config.emailSmtpSecureRaw, config.emailSmtpSecureVaultKey),
    resolveConfiguredOrVault(config.emailSmtpUsername, config.emailSmtpUsernameVaultKey),
    resolveConfiguredOrVault(config.emailSmtpPassword, config.emailSmtpPasswordVaultKey),
    resolveConfiguredOrVault(config.emailFrom, config.emailFromVaultKey),
    resolveConfiguredOrVault(config.emailReplyTo, config.emailReplyToVaultKey)
  ]);

  if (!host || !from) {
    throw new Error("Email SMTP host and from address must be configured.");
  }

  emailSmtpConfigCache = {
    host,
    port: parsePort(portValue, config.emailSmtpPort),
    secure: asBoolean(secureValue, config.emailSmtpSecure),
    username,
    password,
    from,
    replyTo
  };
  return emailSmtpConfigCache;
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

function emailRecipientAddress(input: DeliveryRequest): string {
  const recipientData = asRecord(input.recipient.data);
  return valueFromRecords([input.recipient, recipientData, input.metadata], [
    "address",
    "email",
    "user_email",
    "mail",
    "to",
    "recipient_email",
    "id"
  ]);
}

function messageSubject(input: DeliveryRequest): string {
  return asString(input.message.subject) || asString(input.message.title) || "Platform notification";
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function messageText(input: DeliveryRequest): string {
  return asString(input.message.text)
    || asString(input.message.body)
    || stripHtml(asString(input.message.html));
}

function messageHtml(input: DeliveryRequest): string {
  return asString(input.message.html);
}

function optionEmailList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => asString(entry)).filter(Boolean);
    return entries.length ? entries : undefined;
  }
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }
  const entries = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.length ? entries : undefined;
}

export async function executeEmailDelivery(
  notificationRequestId: string,
  providerKey: string,
  input: DeliveryRequest
): Promise<DeliveryResult> {
  const to = emailRecipientAddress(input);
  if (!to) {
    throw new Error("email delivery requires an email recipient address.");
  }

  const smtpConfig = await resolveEmailSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.username && smtpConfig.password ? {
      user: smtpConfig.username,
      pass: smtpConfig.password
    } : undefined,
    connectionTimeout: config.requestTimeoutMs,
    greetingTimeout: config.requestTimeoutMs,
    socketTimeout: config.requestTimeoutMs
  });

  const text = messageText(input);
  const html = messageHtml(input);

  try {
    const response = await transporter.sendMail({
      from: smtpConfig.from,
      to,
      cc: optionEmailList(input.options.cc),
      bcc: optionEmailList(input.options.bcc),
      replyTo: asString(input.options.reply_to) || smtpConfig.replyTo || undefined,
      subject: messageSubject(input),
      text: text || undefined,
      html: html || undefined,
      headers: {
        "X-Platform-Notification-Request-Id": notificationRequestId,
        "X-Platform-Notification-Channel": input.channel,
        "X-Platform-Notification-Provider": providerKey,
        ...(asString(input.metadata.correlation_id) ? {
          "X-Platform-Notification-Correlation-Id": asString(input.metadata.correlation_id)
        } : {})
      }
    });

    const accepted = Array.isArray(response.accepted) ? response.accepted.length : 0;
    const rejected = Array.isArray(response.rejected) ? response.rejected.length : 0;
    const pending = Array.isArray(response.pending) ? response.pending.length : 0;

    return {
      ok: rejected === 0,
      status: rejected === 0 ? "sent" : "failed",
      channel: input.channel,
      provider_key: providerKey,
      provider_message_id: asString(response.messageId),
      response_json: {
        provider: "smtp",
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        to_hash: sha256(to.toLowerCase()),
        to_domain: emailDomain(to),
        accepted_count: accepted,
        rejected_count: rejected,
        pending_count: pending,
        response: truncate(asString(response.response), 1000),
        envelope: redactJsonRecord(asRecord(response.envelope) ?? {})
      },
      error_message: rejected > 0 ? "SMTP provider rejected at least one recipient." : undefined
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      channel: input.channel,
      provider_key: providerKey,
      response_json: {
        provider: "smtp",
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        to_hash: sha256(to.toLowerCase()),
        to_domain: emailDomain(to)
      },
      error_message: error instanceof Error ? truncate(error.message, 1000) : "Email delivery failed."
    };
  }
}

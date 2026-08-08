# platform-notification-executor

Internal executor for notification channel delivery attempts.

NiFi owns orchestration, rule decisions, template selection, retries, and audit
callbacks. This service owns provider-specific send behavior behind a stable
HTTP contract.

The executor supports `dry_run` mode for validating the end-to-end pipeline
without provider credentials. Provider mode currently supports browser push and
SMTP email delivery.

## API

- `GET /healthz`
- `GET /readyz`
- `GET /openapi.json`
- `POST /internal/notifications/:id/deliveries`

Example delivery request:

```json
{
  "channel": "email",
  "provider_key": "smtp:default",
  "recipient": {
    "type": "email",
    "address": "person@example.com"
  },
  "message": {
    "subject": "Deployment failed",
    "text": "The production deployment failed during prod-deploy."
  },
  "options": {},
  "metadata": {
    "notification_request_id": "00000000-0000-0000-0000-000000000000"
  }
}
```

Dry-run response:

```json
{
  "ok": true,
  "status": "sent",
  "channel": "email",
  "provider_key": "smtp:default",
  "provider_message_id": "dry-run-00000000-0000-0000-0000-000000000000",
  "response_json": {
    "mode": "dry_run"
  }
}
```

## Provider Boundary

Provider implementations plug into the `DeliveryProvider` contract exported from
`src/delivery/provider.ts`. A provider declares a manifest and an `execute`
function:

```ts
export type DeliveryProvider = {
  manifest: {
    providerKey: string;
    displayName: string;
    channels: NotificationChannel[];
    configSchema?: JsonRecord;
    secretSchema?: JsonRecord;
    metadata?: JsonRecord;
  };
  execute: (
    notificationRequestId: string,
    providerKey: string,
    input: DeliveryRequest
  ) => Promise<DeliveryResult>;
};
```

The core executor registry maps a `provider_key` to a provider. Built-in
providers currently include:

- `web-push:browser_push`
- `smtp:default`

Community providers should use stable provider keys such as
`slack:default`, `discord:default`, `twilio:sms`, or `ses:default`. A packaged
provider should accept the stable delivery request and return:

- `ok`
- `status`
- `channel`
- `provider_key`
- `provider_message_id`
- `response_json`
- `error_message`

Provider credentials must be resolved from Vault at runtime. Do not commit
provider tokens, SMTP passwords, SMS credentials, push keys, or webhook secrets.

Separately deployed provider sidecars are a good future extension point, but
they need an explicit allowlist, auth model, and payload-redaction rules before
the core executor should forward delivery payloads to arbitrary URLs.

## Email Provider

Email delivery uses `nodemailer` with the `smtp:default` provider key. Direct
email recipients should use:

```json
{
  "type": "email",
  "address": "person@example.com",
  "channels": ["email"]
}
```

SMTP configuration can be provided directly with environment variables or from
Vault. The deployment manifest grants access to:

```text
secret/data/cloudflare-smtp-secret
```

Expected Vault keys:

- `host`
- `port`
- `secure`
- `username`
- `password`
- `from`
- `reply_to`

## Configuration

Important environment variables:

- `EXECUTOR_MODE`: `dry_run` or `provider`
- `INTERNAL_TOKEN_VAULT_PATH`
- `VAULT_ADDR`
- `VAULT_TOKEN_FILE`
- `REQUEST_TIMEOUT_MS`
- `EMAIL_SMTP_VAULT_PATH`
- `EMAIL_SMTP_HOST`
- `EMAIL_SMTP_PORT`
- `EMAIL_SMTP_SECURE`
- `EMAIL_SMTP_USERNAME`
- `EMAIL_SMTP_PASSWORD`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO`

## Local Build

```bash
npm install
npm run build
```

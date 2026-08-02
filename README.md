# platform-notification-executor

Internal executor for notification channel delivery attempts.

NiFi owns orchestration, rule decisions, template selection, retries, and audit
callbacks. This service owns provider-specific send behavior behind a stable
HTTP contract.

The first implementation is `dry_run` mode so the platform can validate the
end-to-end communication pipeline before provider credentials are added.

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

Future provider implementations should plug into the same delivery request and
return:

- `ok`
- `status`
- `channel`
- `provider_key`
- `provider_message_id`
- `response_json`
- `error_message`

Provider credentials must be resolved from Vault at runtime. Do not commit
provider tokens, SMTP passwords, SMS credentials, push keys, or webhook secrets.

## Configuration

Important environment variables:

- `EXECUTOR_MODE`: `dry_run` or `provider`
- `INTERNAL_TOKEN_VAULT_PATH`
- `VAULT_ADDR`
- `VAULT_TOKEN_FILE`
- `REQUEST_TIMEOUT_MS`

## Local Build

```bash
npm install
npm run build
```

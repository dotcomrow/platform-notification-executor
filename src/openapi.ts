import { config } from "./config.js";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Platform Notification Executor API",
    version: "1.0.0",
    description: "Internal channel delivery executor for notification flows."
  },
  servers: [{ url: config.openApiServerUrl }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer"
      }
    },
    schemas: {
      DeliveryRequest: {
        type: "object",
        required: ["channel", "recipient", "message"],
        additionalProperties: true,
        properties: {
          channel: { type: "string", enum: ["in_app", "browser_push", "mobile_push", "email", "sms", "voice", "webhook"] },
          provider_key: { type: "string" },
          recipient: { type: "object", additionalProperties: true },
          message: {
            type: "object",
            additionalProperties: true,
            properties: {
              subject: { type: "string" },
              title: { type: "string" },
              text: { type: "string" },
              html: { type: "string" },
              body: { type: "string" },
              data: { type: "object", additionalProperties: true }
            }
          },
          options: { type: "object", additionalProperties: true },
          metadata: { type: "object", additionalProperties: true }
        }
      },
      DeliveryResult: {
        type: "object",
        required: ["ok", "status", "channel", "provider_key", "response_json"],
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          status: { type: "string", enum: ["sent", "failed", "skipped"] },
          channel: { type: "string" },
          provider_key: { type: "string" },
          provider_message_id: { type: "string" },
          response_json: { type: "object", additionalProperties: true },
          error_message: { type: "string" }
        }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/healthz": {
      get: {
        security: [],
        responses: {
          "200": { description: "Service is alive." }
        }
      }
    },
    "/readyz": {
      get: {
        security: [],
        responses: {
          "200": { description: "Service is ready." },
          "503": { description: "Service dependency is unavailable." }
        }
      }
    },
    "/internal/notifications/{id}/deliveries": {
      post: {
        summary: "Execute one channel delivery attempt.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "Delivery attempt result.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DeliveryResult" }
              }
            }
          }
        }
      }
    }
  }
};

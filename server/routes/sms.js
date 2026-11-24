import express from "express";
import { createLogger } from "../utils/logger.js";
import { setSetting } from "../database/init.js";
import { requirePermission } from "../services/permissions.js";
import { isMaskedSecret, sanitizeError } from "../utils/sanitize.js";
import { writeUiSecretFile } from "../utils/uiSecretFile.js";
import {
  SMS_CONFIG_KEY,
  SMS_EVENTS_KEY,
  SMS_RECIPIENTS_KEY,
  SMS_SECRET_NAME,
  SMS_EVENT_DEFS,
  MAX_SENT_MESSAGE_LENGTH,
  loadConfig,
  loadEvents,
  loadRecipients,
  readSecret,
  renderSmsTemplate,
  normalizePhone,
  sendSms,
  validateConfig,
  validateEvents,
  validateRecipients,
} from "../services/smsNotifier.js";

const log = createLogger("API:SMS");

const router = express.Router();

// Configuring an SMS gateway means holding the credentials that can message
// arbitrary phone numbers, so it is the same tier as every other external
// integration (Discord, panel bridge). The Discord router uses the identical
// router-level gate.
router.use(requirePermission("integrations.manage"));

function publicConfig(config, secret) {
  return { ...config, secretConfigured: Boolean(secret) };
}

function eventDefsPayload() {
  return Object.fromEntries(
    Object.entries(SMS_EVENT_DEFS).map(([key, def]) => [
      key,
      {
        label: def.label,
        description: def.description,
        variables: def.variables,
        defaultTemplate: def.defaultTemplate,
      },
    ]),
  );
}

async function loadAll() {
  const [config, recipients, events] = await Promise.all([
    loadConfig(),
    loadRecipients(),
    loadEvents(),
  ]);
  return { config, recipients, events, secret: readSecret() };
}

// Everything the Messages page needs in one round trip: provider config
// (secret masked to a boolean), the phone list, and per-event templates.
router.get("/config", async (req, res) => {
  try {
    const { config, recipients, events, secret } = await loadAll();
    res.json({
      config: publicConfig(config, secret),
      recipients,
      events,
      eventDefs: eventDefsPayload(),
    });
  } catch (error) {
    log.error(`Failed to read SMS config: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.get("/events", async (req, res) => {
  try {
    res.json({ events: await loadEvents(), eventDefs: eventDefsPayload() });
  } catch (error) {
    log.error(`Failed to read SMS events: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Save the provider settings. `secret` is write-only: GET only reports
// whether one is stored, and the masked sentinel the UI echoes back is
// ignored instead of overwriting the real value.
router.put("/config", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incomingSecret =
      typeof body.secret === "string" ? body.secret.trim() : "";
    const secretProvided =
      incomingSecret.length > 0 && !isMaskedSecret(incomingSecret);
    const secretConfigured = secretProvided || Boolean(readSecret());

    const validation = validateConfig(body.config, { secretConfigured });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    await setSetting(SMS_CONFIG_KEY, validation.config);
    if (secretProvided) {
      writeUiSecretFile(SMS_SECRET_NAME, incomingSecret);
    } else if (body.clearSecret === true) {
      writeUiSecretFile(SMS_SECRET_NAME, "");
    }

    log.info(
      `SMS config saved (provider=${validation.config.provider}, enabled=${validation.config.enabled})`,
    );
    res.json({
      success: true,
      config: publicConfig(validation.config, readSecret()),
    });
  } catch (error) {
    log.error(`Failed to save SMS config: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.put("/recipients", async (req, res) => {
  try {
    const validation = validateRecipients(req.body?.recipients);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    await setSetting(SMS_RECIPIENTS_KEY, validation.recipients);
    log.info(`SMS recipients saved (${validation.recipients.length})`);
    res.json({ success: true, recipients: validation.recipients });
  } catch (error) {
    log.error(`Failed to save SMS recipients: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

router.put("/events", async (req, res) => {
  try {
    const validation = validateEvents(req.body?.events);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    await setSetting(SMS_EVENTS_KEY, validation.events);
    log.info("SMS event notification settings saved");
    res.json({ success: true, events: validation.events });
  } catch (error) {
    log.error(`Failed to save SMS events: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Resolve the delivery target(s) for a test. An explicit `to` lets the
// operator check a number before adding it to the list; otherwise the test
// goes to every enabled recipient.
async function resolveTargets(to) {
  if (to !== undefined && to !== null && String(to).trim() !== "") {
    const normalized = normalizePhone(to);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    return { ok: true, targets: [normalized.phone] };
  }
  const recipients = (await loadRecipients()).filter((r) => r.enabled);
  if (!recipients.length) {
    return {
      ok: false,
      error: "Add at least one enabled phone number first.",
    };
  }
  return { ok: true, targets: recipients.map((r) => r.phone) };
}

// A test send must be possible even while notifications are switched off
// (that is when you test), but it must still have complete credentials.
async function assertSendable(config) {
  const secret = readSecret();
  const validation = validateConfig(
    { ...config, enabled: true },
    { secretConfigured: Boolean(secret) },
  );
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, config: validation.config, secret };
}

function clip(text) {
  const value = String(text ?? "").trim();
  return value.length > MAX_SENT_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_SENT_MESSAGE_LENGTH - 1)}…`
    : value;
}

// Send (or preview) the free-form test message. The message itself is stored
// as part of the provider config so the field is pre-filled next visit.
router.post("/test", async (req, res) => {
  try {
    const config = await loadConfig();
    const rawMessage = req.body?.message;
    const message = clip(
      typeof rawMessage === "string" && rawMessage.trim()
        ? rawMessage
        : config.testMessage,
    );
    if (!message) {
      return res.status(400).json({ error: "Test message is empty." });
    }

    if (req.body?.dryRun === true) {
      return res.json({ success: true, rendered: message });
    }

    const targets = await resolveTargets(req.body?.to);
    if (!targets.ok) return res.status(400).json({ error: targets.error });

    const sendable = await assertSendable(config);
    if (!sendable.ok) return res.status(400).json({ error: sendable.error });

    let delivered = 0;
    const failures = [];
    for (const to of targets.targets) {
      try {
        await sendSms({
          to,
          body: message,
          config: sendable.config,
          secret: sendable.secret,
        });
        delivered += 1;
      } catch (error) {
        failures.push(`${to.slice(0, 5)}***: ${error.message}`);
      }
    }

    if (delivered === 0) {
      return res.status(502).json({
        error: `SMS provider rejected the test: ${failures.join("; ")}`,
      });
    }

    res.json({
      success: true,
      delivered,
      failed: failures.length,
      rendered: message,
      message: `Test SMS sent to ${delivered} number(s).`,
    });
  } catch (error) {
    log.error(`Failed to send SMS test: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

// Preview/send one event exactly the way the live path renders it, so an
// operator can check a template before enabling it.
router.post("/test-event", async (req, res) => {
  try {
    const eventType = req.body?.eventType;
    const def = SMS_EVENT_DEFS[eventType];
    if (!def) {
      return res.status(400).json({ error: "Unknown event type." });
    }

    const events = await loadEvents();
    const template =
      typeof req.body?.template === "string" && req.body.template.trim()
        ? req.body.template
        : events[eventType].template;
    const variables =
      req.body?.variables && typeof req.body.variables === "object"
        ? req.body.variables
        : {};
    const rendered = clip(renderSmsTemplate(template, variables));
    if (!rendered) {
      return res.status(400).json({
        error: "This template renders an empty message.",
      });
    }

    if (req.body?.dryRun === true) {
      return res.json({ success: true, rendered });
    }

    const targets = await resolveTargets(req.body?.to);
    if (!targets.ok) return res.status(400).json({ error: targets.error });

    const config = await loadConfig();
    const sendable = await assertSendable(config);
    if (!sendable.ok) return res.status(400).json({ error: sendable.error });

    let delivered = 0;
    const failures = [];
    for (const to of targets.targets) {
      try {
        await sendSms({
          to,
          body: rendered,
          config: sendable.config,
          secret: sendable.secret,
        });
        delivered += 1;
      } catch (error) {
        failures.push(`${to.slice(0, 5)}***: ${error.message}`);
      }
    }

    if (delivered === 0) {
      return res.status(502).json({
        error: `SMS provider rejected the event test: ${failures.join("; ")}`,
      });
    }

    res.json({
      success: true,
      delivered,
      failed: failures.length,
      rendered,
      message: `Test SMS sent to ${delivered} number(s).`,
    });
  } catch (error) {
    log.error(`Failed to send SMS event test: ${error.message}`);
    res.status(500).json({ error: sanitizeError(error.message) });
  }
});

export default router;

/**
 * SMS event notifications.
 *
 * Mirrors the Discord bot's "Event Notifications" card: the same eight server
 * lifecycle events, each with its own enable flag and editable plain-text
 * template. Instead of posting to a Discord channel, every enabled event is
 * delivered as an SMS to the operator's phone number list.
 *
 * Providers:
 *   - twilio : POST to Twilio's Messages API (Basic auth, form encoded).
 *   - http   : a generic gateway URL template -- supports the common Egyptian
 *              SMS gateways whose API is a GET/POST URL with query params.
 *
 * Credentials live in the same UI-secret file store the Discord token uses
 * (utils/uiSecretFile.js), never in db.json, so both backup paths skip them.
 */

import { request } from "undici";
import { createLogger } from "../utils/logger.js";
import { getSetting } from "../database/init.js";
import { readUiSecretFile } from "../utils/uiSecretFile.js";

const log = createLogger("SMS");

export const SMS_SECRET_NAME = "smsProviderSecret";
export const SMS_CONFIG_KEY = "smsConfig";
export const SMS_RECIPIENTS_KEY = "smsRecipients";
export const SMS_EVENTS_KEY = "smsEvents";

export const DEFAULT_SENDER_NAME = "Project Zomboid Server";
export const DEFAULT_TEST_MESSAGE =
  "This is a test message from Project Zomboid Server.";
export const MAX_SENDER_NAME_LENGTH = 60;
export const MAX_TEST_MESSAGE_LENGTH = 320;
export const MAX_TEMPLATE_LENGTH = 320;
export const MAX_SENT_MESSAGE_LENGTH = 600;
export const MAX_RECIPIENTS = 20;

// The event set deliberately matches the Discord panel's card, so an operator
// can reason about both integrations the same way. Templates are plain text
// (SMS has no markdown) and short (each 160 characters is one billable
// segment); the brand name is in the default copy, which is what recipients
// actually see as the "sender" on carriers that don't support alphanumeric
// sender IDs.
export const SMS_EVENT_DEFS = {
  serverStart: {
    label: "Server Starting",
    description: "When the server process begins to start",
    variables: [],
    defaultTemplate:
      "Project Zomboid Server is starting. Please wait a few minutes before joining.",
  },
  serverStop: {
    label: "Server Stop",
    description: "When the server stops",
    variables: [],
    defaultTemplate: "Project Zomboid Server has stopped.",
  },
  playerJoin: {
    label: "Player Join",
    description: "When a player connects",
    variables: ["player"],
    defaultTemplate: "Project Zomboid Server: {player} joined the server.",
  },
  playerLeave: {
    label: "Player Leave",
    description: "When a player disconnects",
    variables: ["player"],
    defaultTemplate: "Project Zomboid Server: {player} left the server.",
  },
  scheduledRestart: {
    label: "Scheduled Restart",
    description: "Before a scheduled restart",
    variables: ["minutes"],
    defaultTemplate:
      "Project Zomboid Server restart in {minutes} minute(s).",
  },
  backupComplete: {
    label: "Backup Complete",
    description: "After a backup finishes",
    variables: [],
    defaultTemplate: "Project Zomboid Server: backup completed.",
  },
  playerDeath: {
    label: "Player Death",
    description: "When a player dies",
    variables: ["player", "location", "x", "y", "z", "pvp"],
    defaultTemplate: "Project Zomboid Server: {player} died at {location}.",
  },
  serverJoinable: {
    label: "Server Joinable",
    description:
      'When the server console prints "*** SERVER STARTED ***" and the server becomes joinable',
    variables: [],
    defaultTemplate:
      "Project Zomboid Server is online and joinable. Have fun!",
  },
};

const EVENT_KEYS = Object.keys(SMS_EVENT_DEFS);

// --- Phone number handling ------------------------------------------------

// Egyptian mobile numbers are 11 digits starting 01 (010/011/012/015), or the
// same number in E.164 without the leading zero: +20 1xxxxxxxxx.
const EGYPT_MOBILE_E164_RE = /^\+201[0125]\d{8}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;

function digitsOnly(value) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

/**
 * Normalise anything an operator might type into E.164.
 *
 * Accepts, for the common Egyptian case:
 *   01xxxxxxxxx   (local, 11 digits)
 *   1xxxxxxxxx    (local without trunk zero)
 *   201xxxxxxxxx  (country code, no plus)
 *   +201xxxxxxxxx (E.164)
 * and, for other countries, any +<8..15 digits> number.
 *
 * Returns { ok: true, phone, egyptian } or { ok: false, error }.
 */
export function normalizePhone(raw) {
  let value = digitsOnly(raw).trim();
  if (!value) return { ok: false, error: "Enter a phone number." };

  // 00<country> is the international dialling prefix many people still type.
  if (value.startsWith("00")) value = `+${value.slice(2)}`;

  // Bare Egyptian local forms (no +, no country code).
  if (!value.startsWith("+")) {
    const bare = value.replace(/\D/g, "");
    if (/^01[0125]\d{8}$/.test(bare)) {
      value = `+20${bare.slice(1)}`;
    } else if (/^1[0125]\d{8}$/.test(bare)) {
      value = `+20${bare}`;
    } else if (/^201[0125]\d{8}$/.test(bare)) {
      value = `+${bare}`;
    } else {
      // Unknown local form -- refuse rather than guessing a country code.
      return {
        ok: false,
        error:
          "Enter an Egyptian mobile (01xxxxxxxxx) or an international number starting with +.",
      };
    }
  }

  if (!E164_RE.test(value)) {
    return {
      ok: false,
      error: "Enter a valid phone number in international format.",
    };
  }

  return {
    ok: true,
    phone: value,
    egyptian: EGYPT_MOBILE_E164_RE.test(value),
  };
}

function normalizeRecipient(raw, index) {
  const phone = normalizePhone(raw?.phone ?? raw?.number ?? "");
  if (!phone.ok) {
    return { ok: false, error: `Number ${index + 1}: ${phone.error}` };
  }
  const label =
    typeof raw?.label === "string" ? raw.label.trim().slice(0, 80) : "";
  return {
    ok: true,
    recipient: {
      id:
        typeof raw?.id === "string" && raw.id
          ? raw.id.slice(0, 80)
          : `rcpt_${index}_${Date.now().toString(36)}`,
      label,
      phone: phone.phone,
      egyptian: phone.egyptian,
      // Enabled by default: adding a number should be enough to start
      // receiving notifications for events that are already switched on.
      enabled: raw?.enabled === undefined ? true : raw.enabled === true,
    },
  };
}

export function validateRecipients(list) {
  if (!Array.isArray(list)) {
    return { ok: false, error: "Recipients must be a list." };
  }
  if (list.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      error: `At most ${MAX_RECIPIENTS} phone numbers are allowed.`,
    };
  }
  const recipients = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const normalized = normalizeRecipient(list[i], i);
    if (!normalized.ok) return normalized;
    if (seen.has(normalized.recipient.phone)) continue; // silently de-dupe
    seen.add(normalized.recipient.phone);
    recipients.push(normalized.recipient);
  }
  return { ok: true, recipients };
}

// --- Template rendering ---------------------------------------------------

/**
 * Replace {variable} placeholders with the supplied values. Unlike the
 * Discord renderer this escapes nothing (SMS is plain text) and drops
 * placeholders the event doesn't supply instead of printing braces at a
 * customer. Values are collapsed to one line -- an embedded newline would
 * split the message and cost extra segments.
 */
export function renderSmsTemplate(template, variables = {}) {
  const source = typeof template === "string" ? template : "";
  const rendered = source.replace(/\{(\w+)\}/g, (_match, name) => {
    const value = variables[name];
    if (value === undefined || value === null) return "";
    return String(value).replace(/\s+/g, " ").trim();
  });
  return rendered.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// --- Persistence ----------------------------------------------------------

function stringSetting(value, fallback = "", max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : fallback;
}

export function normalizeConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  const provider = config.provider === "http" ? "http" : "twilio";
  return {
    enabled: config.enabled === true,
    provider,
    senderName:
      stringSetting(config.senderName, DEFAULT_SENDER_NAME, MAX_SENDER_NAME_LENGTH) ||
      DEFAULT_SENDER_NAME,
    accountSid: stringSetting(config.accountSid, "", 64),
    from: stringSetting(config.from, "", 64),
    httpUrl: stringSetting(config.httpUrl, "", 1000),
    httpMethod: config.httpMethod === "GET" ? "GET" : "POST",
    testMessage:
      stringSetting(
        config.testMessage,
        DEFAULT_TEST_MESSAGE,
        MAX_TEST_MESSAGE_LENGTH,
      ) || DEFAULT_TEST_MESSAGE,
  };
}

export async function loadConfig() {
  return normalizeConfig(await getSetting(SMS_CONFIG_KEY));
}

export function readSecret() {
  return readUiSecretFile(SMS_SECRET_NAME, log);
}

export async function loadRecipients() {
  const raw = await getSetting(SMS_RECIPIENTS_KEY);
  if (!Array.isArray(raw)) return [];
  const normalized = validateRecipients(
    // Trust only the fields we own; anything else in the stored row is
    // ignored so a hand-edited db.json can't smuggle unexpected keys.
    raw.map((r) => ({
      id: r?.id,
      label: r?.label,
      phone: r?.phone,
      enabled: r?.enabled,
    })),
  );
  return normalized.ok ? normalized.recipients : [];
}

export async function loadEvents() {
  const raw = await getSetting(SMS_EVENTS_KEY);
  const saved = raw && typeof raw === "object" ? raw : {};
  const events = {};
  for (const key of EVENT_KEYS) {
    const entry = saved[key] && typeof saved[key] === "object" ? saved[key] : {};
    events[key] = {
      enabled: entry.enabled === true,
      template:
        stringSetting(entry.template, "", MAX_TEMPLATE_LENGTH) ||
        SMS_EVENT_DEFS[key].defaultTemplate,
    };
  }
  return events;
}

export function validateConfig(input, { secretConfigured } = {}) {
  const config = normalizeConfig(input);
  if (!config.enabled) return { ok: true, config };

  if (config.provider === "twilio") {
    if (!/^AC[0-9a-fA-F]{32}$/.test(config.accountSid)) {
      return {
        ok: false,
        error:
          "Twilio Account SID must look like AC followed by 32 hex characters.",
      };
    }
    if (!config.from) {
      return {
        ok: false,
        error: "Enter the Twilio From number or sender ID.",
      };
    }
    if (!secretConfigured) {
      return {
        ok: false,
        error: "Enter the Twilio auth token (or gateway API key).",
      };
    }
    return { ok: true, config };
  }

  let parsed;
  try {
    parsed = new URL(
      config.httpUrl
        .replace(/\{to\}/g, "000")
        .replace(/\{message\}/g, "test")
        .replace(/\{sender\}/g, "test")
        .replace(/\{key\}/g, "test"),
    );
  } catch {
    return { ok: false, error: "Gateway URL must be a valid http(s) URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Gateway URL must use http:// or https://." };
  }
  if (!/\{to\}/.test(config.httpUrl) || !/\{message\}/.test(config.httpUrl)) {
    return {
      ok: false,
      error: "Gateway URL must contain {to} and {message} placeholders.",
    };
  }
  return { ok: true, config };
}

export function validateEvents(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Events must be an object." };
  }
  const events = {};
  for (const key of EVENT_KEYS) {
    const entry = input[key] && typeof input[key] === "object" ? input[key] : {};
    const template = stringSetting(entry.template, "", MAX_TEMPLATE_LENGTH);
    if (entry.enabled === true && !template) {
      return {
        ok: false,
        error: `Template for "${SMS_EVENT_DEFS[key].label}" cannot be empty.`,
      };
    }
    events[key] = {
      enabled: entry.enabled === true,
      template: template || SMS_EVENT_DEFS[key].defaultTemplate,
    };
  }
  return { ok: true, events };
}

// --- Delivery -------------------------------------------------------------

function clipMessage(text) {
  const value = String(text ?? "").trim();
  return value.length > MAX_SENT_MESSAGE_LENGTH
    ? `${value.slice(0, MAX_SENT_MESSAGE_LENGTH - 1)}…`
    : value;
}

async function sendTwilio({ to, body, config, secret }) {
  const auth = Buffer.from(`${config.accountSid}:${secret}`).toString("base64");
  const form = new URLSearchParams({ To: to, Body: body });

  // Use the brand name as an alphanumeric sender ID only when the operator
  // left From empty and the name fits Twilio's 11-character limit; otherwise
  // From is the purchased number / registered sender ID.
  const senderId = config.senderName.trim();
  if (config.from) form.set("From", config.from);
  else if (/^[A-Za-z0-9 ]{1,11}$/.test(senderId)) form.set("From", senderId);
  else {
    throw new Error(
      "Twilio needs a From number or an alphanumeric sender ID of 11 characters or fewer.",
    );
  }

  const response = await request(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      config.accountSid,
    )}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      headersTimeout: 15000,
      bodyTimeout: 15000,
    },
  );

  if (response.statusCode >= 200 && response.statusCode < 300) {
    await response.body.dump();
    return;
  }

  let detail = "";
  try {
    const payload = await response.body.json();
    detail = payload?.message ? `: ${payload.message}` : "";
  } catch {
    /* non-JSON error body */
  }
  throw new Error(`Twilio rejected the message (${response.statusCode})${detail}`);
}

async function sendHttpGateway({ to, body, config, secret }) {
  const url = config.httpUrl
    .replace(/\{to\}/g, encodeURIComponent(to))
    .replace(/\{message\}/g, encodeURIComponent(body))
    .replace(/\{sender\}/g, encodeURIComponent(config.senderName))
    .replace(/\{key\}/g, encodeURIComponent(secret || ""));

  const response = await request(url, {
    method: config.httpMethod,
    headersTimeout: 15000,
    bodyTimeout: 15000,
  });

  // Gateways vary wildly (some return 200 for a rejected send, some return
  // 4xx with the real reason in the body). Treat a non-2xx as a failure and
  // include a bounded body excerpt so the operator can fix their URL.
  if (response.statusCode >= 200 && response.statusCode < 300) {
    await response.body.dump();
    return;
  }
  let detail = "";
  try {
    detail = (await response.body.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  throw new Error(
    `Gateway rejected the message (${response.statusCode})${detail ? `: ${detail}` : ""}`,
  );
}

export async function sendSms({ to, body, config, secret }) {
  const target = normalizePhone(to);
  if (!target.ok) throw new Error(target.error);

  const message = clipMessage(body);
  if (!message) throw new Error("Message body is empty.");

  const resolvedConfig = config || (await loadConfig());
  const resolvedSecret = secret ?? readSecret();
  if (resolvedConfig.provider === "twilio") {
    return sendTwilio({
      to: target.phone,
      body: message,
      config: resolvedConfig,
      secret: resolvedSecret,
    });
  }
  return sendHttpGateway({
    to: target.phone,
    body: message,
    config: resolvedConfig,
    secret: resolvedSecret,
  });
}

/**
 * Singleton dispatcher.
 *
 * discordBot.sendEventNotification() is the single funnel every lifecycle /
 * player event already goes through (server launch, stop, join, leave,
 * death, scheduled restart, backup, joinable). index.js attaches
 * `discordBot.eventObserver = (type, vars) => smsNotifier.notify(type, vars)`
 * so SMS rides the same stream without touching a dozen call sites.
 */
class SmsNotifier {
  constructor() {
    this._chain = Promise.resolve();
    this._lastEventAt = new Map();
    this._consecutiveFailures = 0;
    this._circuitOpenUntil = 0;
  }

  // Stay below carrier/provider rate limits and, more importantly, avoid a
  // burst of 20 recipients x N events turning one restart into billable spam.
  _dedupeWindow(eventType) {
    if (eventType === "serverStart" || eventType === "serverStop") return 60_000;
    if (eventType === "serverJoinable") return 60_000;
    if (eventType === "scheduledRestart") return 30_000;
    return 10_000;
  }

  async notify(eventType, variables = {}) {
    try {
      if (!EVENT_KEYS.includes(eventType)) return false;

      const config = await loadConfig();
      if (!config.enabled) return false;

      const events = await loadEvents();
      const event = events[eventType];
      if (!event?.enabled) return false;

      const recipients = (await loadRecipients()).filter((r) => r.enabled);
      if (!recipients.length) return false;

      const body = clipMessage(renderSmsTemplate(event.template, variables));
      if (!body) return false;

      const now = Date.now();
      if (now < this._circuitOpenUntil) {
        log.debug(
          `SMS ${eventType} skipped: provider circuit open for another ${Math.ceil(
            (this._circuitOpenUntil - now) / 1000,
          )}s`,
        );
        return false;
      }

      const dedupeKey = `${eventType}:${variables.player ?? ""}`;
      const last = this._lastEventAt.get(dedupeKey) ?? 0;
      if (now - last < this._dedupeWindow(eventType)) return false;
      this._lastEventAt.set(dedupeKey, now);

      const secret = readSecret();
      this._chain = this._chain
        .then(() => this._deliver({ recipients, body, config, secret, eventType }))
        .catch(() => undefined);
      return true;
    } catch (err) {
      log.warn(`SMS ${eventType} notification failed: ${err.message}`);
      return false;
    }
  }

  async _deliver({ recipients, body, config, secret, eventType }) {
    let delivered = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await sendSms({ to: recipient.phone, body, config, secret });
        delivered += 1;
      } catch (err) {
        failed += 1;
        log.warn(
          `SMS ${eventType} to ${recipient.phone.slice(0, 5)}*** failed: ${err.message}`,
        );
      }
      // Small gap between recipients keeps providers happy and gives a
      // flapping provider time to fail before we hammer it.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (failed > 0 && delivered === 0) {
      this._consecutiveFailures += 1;
      if (this._consecutiveFailures >= 3) {
        this._circuitOpenUntil = Date.now() + 60_000;
        this._consecutiveFailures = 0;
        log.warn("SMS provider failed 3 times in a row; pausing sends for 60s");
      }
    } else {
      this._consecutiveFailures = 0;
    }

    if (delivered > 0) {
      log.info(`SMS ${eventType} delivered to ${delivered} recipient(s)`);
    }
  }
}

export const smsNotifier = new SmsNotifier();

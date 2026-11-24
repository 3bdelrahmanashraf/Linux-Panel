import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  renderSmsTemplate,
  validateConfig,
  validateRecipients,
} from "../services/smsNotifier.js";

describe("SMS phone normalisation", () => {
  it("converts every Egyptian mobile form to E.164", () => {
    for (const input of [
      "01012345678",
      "1012345678",
      "201012345678",
      "+201012345678",
      "0101 234 5678",
    ]) {
      const result = normalizePhone(input);
      expect(result.ok, input).toBe(true);
      expect(result.phone, input).toBe("+201012345678");
      expect(result.egyptian, input).toBe(true);
    }
  });

  it("accepts other countries only in explicit international form", () => {
    expect(normalizePhone("+14155552671")).toMatchObject({
      ok: true,
      phone: "+14155552671",
      egyptian: false,
    });
    expect(normalizePhone("4155552671").ok).toBe(false);
    expect(normalizePhone("0223456789").ok).toBe(false);
  });

  it("rejects empty and too-short values", () => {
    expect(normalizePhone("").ok).toBe(false);
    expect(normalizePhone("123").ok).toBe(false);
  });
});

describe("SMS template rendering", () => {
  it("substitutes variables and drops unknown placeholders", () => {
    expect(
      renderSmsTemplate("Hi {player}, died at {location} {missing}", {
        player: "Bob",
      }),
    ).toBe("Hi Bob, died at");
  });

  it("collapses whitespace so a value cannot break the message into extra segments", () => {
    expect(renderSmsTemplate("A {value} B", { value: "one\ntwo" })).toBe(
      "A one two B",
    );
  });
});

describe("SMS recipient validation", () => {
  it("normalises, dedupes and keeps labels", () => {
    const result = validateRecipients([
      { phone: "01012345678", label: "Owner" },
      { phone: "+201012345678", label: "Duplicate" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.recipients).toHaveLength(1);
    expect(result.recipients[0]).toMatchObject({
      phone: "+201012345678",
      label: "Owner",
      enabled: true,
    });
  });

  it("names the offending row", () => {
    const result = validateRecipients([{ phone: "01012345678" }, { phone: "bad" }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Number 2");
  });
});

describe("SMS provider validation", () => {
  it("requires complete Twilio credentials when enabled", () => {
    expect(
      validateConfig(
        { enabled: true, provider: "twilio", accountSid: "bad", from: "" },
        { secretConfigured: false },
      ).ok,
    ).toBe(false);

    expect(
      validateConfig(
        {
          enabled: true,
          provider: "twilio",
          accountSid: `AC${"a".repeat(32)}`,
          from: "+1234567890",
        },
        { secretConfigured: true },
      ).ok,
    ).toBe(true);
  });

  it("allows an incomplete config while notifications are disabled", () => {
    expect(validateConfig({ enabled: false, provider: "twilio" }).ok).toBe(true);
  });

  it("requires {to} and {message} in a custom gateway URL", () => {
    expect(
      validateConfig(
        {
          enabled: true,
          provider: "http",
          httpUrl: "https://gateway.example/send?to={to}",
        },
        { secretConfigured: true },
      ).ok,
    ).toBe(false);

    expect(
      validateConfig(
        {
          enabled: true,
          provider: "http",
          httpUrl: "https://gateway.example/send?to={to}&message={message}",
        },
        { secretConfigured: true },
      ).ok,
    ).toBe(true);
  });
});

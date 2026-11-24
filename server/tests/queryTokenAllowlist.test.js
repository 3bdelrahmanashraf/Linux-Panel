import { describe, expect, it, vi } from "vitest";

// security audit M2: ?token= used to be accepted on every /api route, so any
// request that put it in a URL (the client does for the SSE conflicts stream)
// leaked a 15-minute access token into proxy access logs and browser history.
// The rewrite restricts it to the two endpoints that genuinely cannot set an
// Authorization header: the SSE conflicts stream, and the mods-export ZIP
// download the "Export mods" button navigates to directly.
const { getRoleByNameMock } = vi.hoisted(() => ({ getRoleByNameMock: vi.fn() }));

vi.mock("../database/init.js", () => ({
  getRoleByName: getRoleByNameMock,
  getDb: vi.fn(async () => ({ data: {} })),
  peekServerDisplayName: vi.fn(() => null),
}));

const { acceptsQueryToken, QUERY_TOKEN_PATHS } = await import("../index.js");

const req = (originalUrl) => ({ originalUrl, url: originalUrl, path: originalUrl.split("?")[0] });

describe("acceptsQueryToken() — ?token= only on header-less download endpoints", () => {
  it("accepts the known SSE stream path, query string and case included", () => {
    expect(acceptsQueryToken(req("/api/mods/conflicts/stream?token=abc"))).toBe(true);
    expect(acceptsQueryToken(req("/API/mods/conflicts/stream?token=abc"))).toBe(true);
  });

  it("accepts the mods-export ZIP download the client links to directly", () => {
    expect(acceptsQueryToken(req("/api/mods/export-download?token=abc"))).toBe(true);
    expect(acceptsQueryToken(req("/API/MODS/EXPORT-DOWNLOAD?token=abc"))).toBe(true);
  });

  it("refuses every other API path", () => {
    for (const url of [
      "/api/config/app-settings?token=abc",
      "/api/servers?token=abc",
      "/api/auth/users?token=abc",
      "/api/mods/conflicts/stream/extra?token=abc",
      "/api/mods/export-download/extra?token=abc",
    ]) {
      expect(acceptsQueryToken(req(url))).toBe(false);
    }
  });

  it("has exactly the two header-less endpoints in the allowlist", () => {
    expect([...QUERY_TOKEN_PATHS]).toEqual([
      "/api/mods/conflicts/stream",
      "/api/mods/export-download",
    ]);
  });
});

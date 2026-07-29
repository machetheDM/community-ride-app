import { describe, it, expect } from "@jest/globals";

describe("Auth API", () => {
  const BASE = `${process.env.API_BASE_URL ?? "http://localhost:3000"}/api`;

  it("POST /api/auth/request-otp - should send OTP for valid phone", async () => {
    const res = await fetch(`${BASE}/auth/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+27820000001" }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.message).toBe("OTP sent");
  });

  it("POST /api/auth/request-otp - should reject missing phone", async () => {
    const res = await fetch(`${BASE}/auth/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/auth/verify-otp - should reject invalid OTP", async () => {
    const res = await fetch(`${BASE}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+27820000001", code: "000000" }),
    });
    expect(res.status).toBe(401);
  });
});

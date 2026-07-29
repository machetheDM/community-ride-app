import { describe, it, expect } from "@jest/globals";

describe("Stores API", () => {
  const BASE = `${process.env.API_BASE_URL ?? "http://localhost:3000"}/api`;

  it("GET /api/stores - should return stores", async () => {
    const res = await fetch(`${BASE}/stores`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("GET /api/stores?search=mama - should filter by search", async () => {
    const res = await fetch(`${BASE}/stores?search=mama`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.every((s: { name: string }) => s.name.toLowerCase().includes("mama"))).toBe(true);
  });

  it("GET /api/stores?isOpen=true - should return only open stores", async () => {
    const res = await fetch(`${BASE}/stores?isOpen=true`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.every((s: { isOpen: boolean }) => s.isOpen === true)).toBe(true);
  });
});

import { describe, it, expect } from "@jest/globals";
import { ok, created, noContent, badRequest, unauthorized, forbidden, notFound, conflict, tooManyRequests, serverError } from "@/lib/response";
import { AppError, ValidationError, NotFoundError, RateLimitError } from "@/lib/errors";

describe("success envelopes", () => {
  it("ok returns 200 with a success envelope", async () => {
    const res = ok({ id: "store-1" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: { id: "store-1" } });
  });

  it("ok includes meta only when supplied", async () => {
    await expect(ok([], { page: 1, pageSize: 20, total: 0, totalPages: 0 }).json()).resolves.toHaveProperty("meta.page", 1);
    await expect(ok([]).json()).resolves.not.toHaveProperty("meta");
  });

  it("created returns 201", () => {
    expect(created({ id: "ride-1" }).status).toBe(201);
  });

  it("noContent returns 204 with an empty body", () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });
});

describe("error envelopes", () => {
  it("maps helpers to their status codes", () => {
    expect(badRequest("bad").status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict("dupe").status).toBe(409);
    expect(tooManyRequests().status).toBe(429);
    expect(serverError().status).toBe(500);
  });

  it("badRequest carries field errors when supplied", async () => {
    const res = badRequest("Validation failed", { phone: ["Phone number is required"] });
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Validation failed",
      errors: { phone: ["Phone number is required"] },
    });
  });

  it("marks every error envelope as unsuccessful", async () => {
    await expect(unauthorized().json()).resolves.toMatchObject({ success: false });
  });
});

describe("error classes", () => {
  it("carries status code and machine-readable code", () => {
    expect(new ValidationError("nope")).toMatchObject({ statusCode: 400, code: "VALIDATION_ERROR" });
    expect(new NotFoundError("Ride")).toMatchObject({ statusCode: 404, message: "Ride not found" });
    expect(new RateLimitError()).toMatchObject({ statusCode: 429, code: "RATE_LIMITED" });
  });

  it("remains instanceof Error and AppError", () => {
    const err = new ValidationError("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("retains field details on ValidationError", () => {
    expect(new ValidationError("nope", { phone: ["required"] }).fields).toEqual({ phone: ["required"] });
  });
});

import { describe, it, expect } from "@jest/globals";
import { isSaMobile, maskPhone, normaliseSaMobile } from "@/lib/phone";
import { otpRequestSchema, otpVerifySchema } from "@/lib/auth-schemas";

describe("normaliseSaMobile", () => {
  it.each([
    ["0821234567", "+27821234567"],
    ["082 123 4567", "+27821234567"],
    ["+27 82 123 4567", "+27821234567"],
    ["+27821234567", "+27821234567"],
    ["27821234567", "+27821234567"],
    ["0027821234567", "+27821234567"],
    ["(082) 123-4567", "+27821234567"],
    ["0612345678", "+27612345678"],
    ["0712345678", "+27712345678"],
  ])("normalises %p to %p", (input, expected) => {
    expect(normaliseSaMobile(input)).toBe(expected);
  });

  it.each([
    ["+447700900123", "a UK number"],
    ["+12025550123", "a US number"],
    ["0112345678", "a Johannesburg landline"],
    ["0921234567", "a number starting 9"],
    ["082123456", "too few digits"],
    ["08212345678", "too many digits"],
    ["+27 82 123 456a", "a letter"],
    ["", "nothing"],
  ])("refuses %p (%s)", (input) => {
    expect(normaliseSaMobile(input)).toBeNull();
  });
});

describe("isSaMobile", () => {
  it("accepts only the normalised form", () => {
    expect(isSaMobile("+27821234567")).toBe(true);
    expect(isSaMobile("0821234567")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("keeps the country code and the last two digits only", () => {
    expect(maskPhone("+27821234567")).toBe("+27*******67");
  });
});

describe("the sign-in request schemas", () => {
  it("normalise the phone so every spelling shares one send cap and one lockout", () => {
    expect(otpRequestSchema.parse({ phone: "082 123 4567" })).toEqual({ phone: "+27821234567" });
  });

  it("refuse a foreign number, which is how SMS toll fraud starts", () => {
    expect(() => otpRequestSchema.parse({ phone: "+447700900123" })).toThrow(/South African mobile/);
  });

  it("require a six-digit code", () => {
    expect(() => otpVerifySchema.parse({ phone: "0821234567", code: "12345" })).toThrow();
    expect(() => otpVerifySchema.parse({ phone: "0821234567", code: "12345a" })).toThrow();
    expect(otpVerifySchema.parse({ phone: "0821234567", code: "012345" })).toEqual({
      phone: "+27821234567",
      code: "012345",
    });
  });
});

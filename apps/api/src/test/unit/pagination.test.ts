import { describe, it, expect } from "@jest/globals";
import { NextRequest } from "next/server";
import { getPagination, paginatedResponse } from "@/lib/pagination";

const reqFor = (query: string) => new NextRequest(`http://localhost/api/stores${query}`);

describe("getPagination", () => {
  it("applies defaults when no params are supplied", () => {
    expect(getPagination(reqFor(""))).toEqual({ page: 1, pageSize: 20, skip: 0 });
  });

  it("computes skip from page and pageSize", () => {
    expect(getPagination(reqFor("?page=3&pageSize=10"))).toEqual({ page: 3, pageSize: 10, skip: 20 });
  });

  it("falls back to defaults for non-numeric params instead of producing NaN", () => {
    const result = getPagination(reqFor("?page=abc&pageSize=xyz"));
    expect(result).toEqual({ page: 1, pageSize: 20, skip: 0 });
    expect(Number.isNaN(result.skip)).toBe(false);
  });

  it("clamps page to a minimum of 1", () => {
    expect(getPagination(reqFor("?page=-5")).page).toBe(1);
    expect(getPagination(reqFor("?page=0")).skip).toBe(0);
  });

  it("clamps pageSize to the maximum", () => {
    expect(getPagination(reqFor("?pageSize=9999")).pageSize).toBe(100);
  });

  it("floors fractional input", () => {
    expect(getPagination(reqFor("?page=2.9")).page).toBe(2);
  });

  it("treats an empty param as absent", () => {
    expect(getPagination(reqFor("?page=&pageSize=")).pageSize).toBe(20);
  });
});

describe("paginatedResponse", () => {
  it("computes totalPages by rounding up", () => {
    const result = paginatedResponse({ items: [], total: 25, page: 1, pageSize: 10 });
    expect(result.totalPages).toBe(3);
  });

  it("reports zero pages for an empty result set", () => {
    const result = paginatedResponse({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(result.totalPages).toBe(0);
  });
});

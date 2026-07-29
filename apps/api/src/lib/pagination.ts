import { NextRequest } from "next/server";

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Coerce a query param to a bounded integer, falling back when it is absent or
 * not a number. Guards against `?page=abc` producing NaN, which would otherwise
 * reach Prisma as `skip: NaN` and throw at the database layer.
 */
function toBoundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function getPagination(req: NextRequest, defaultPageSize = 20, maxPageSize = 100): PaginationParams {
  const { searchParams } = new URL(req.url);
  const page = toBoundedInt(searchParams.get("page"), 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = toBoundedInt(searchParams.get("pageSize"), defaultPageSize, 1, maxPageSize);
  return { page, pageSize, skip: (page - 1) * pageSize };
}

/**
 * Callers supply the raw page of results; totalPages is derived here, so it is
 * omitted from the input type. Requiring it previously made every call site a
 * type error.
 */
export function paginatedResponse<T>({ items, total, page, pageSize }: Omit<PaginatedResult<T>, "totalPages">) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

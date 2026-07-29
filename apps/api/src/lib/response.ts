import { NextResponse } from "next/server";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string[]>;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
}

export function ok<T>(data: T, meta?: ApiResponse["meta"], status = 200) {
  return NextResponse.json({ success: true, data, ...(meta ? { meta } : {}) } satisfies ApiResponse<T>, { status });
}

export function created<T>(data: T) {
  return NextResponse.json({ success: true, data } satisfies ApiResponse<T>, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(error: string, errors?: Record<string, string[]>) {
  return NextResponse.json({ success: false, error, ...(errors ? { errors } : {}) } satisfies ApiResponse, { status: 400 });
}

export function unauthorized(error = "Authentication required") {
  return NextResponse.json({ success: false, error } satisfies ApiResponse, { status: 401 });
}

export function forbidden(error = "Insufficient permissions") {
  return NextResponse.json({ success: false, error } satisfies ApiResponse, { status: 403 });
}

export function notFound(error = "Resource not found") {
  return NextResponse.json({ success: false, error } satisfies ApiResponse, { status: 404 });
}

export function conflict(error: string) {
  return NextResponse.json({ success: false, error } satisfies ApiResponse, { status: 409 });
}

export function tooManyRequests(error = "Too many requests. Please try again later.") {
  return NextResponse.json({ success: false, error } satisfies ApiResponse, { status: 429 });
}

export function serverError(error = "Internal server error") {
  return NextResponse.json({ success: false, error } satisfies ApiResponse, { status: 500 });
}

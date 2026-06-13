import { cookies } from "next/headers";

const COOKIE = "merchant_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface MerchantSession {
  userId: string;
  merchantId: string;
  name: string;
}

export async function getSession(): Promise<MerchantSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MerchantSession;
  } catch {
    return null;
  }
}

export async function setSession(session: MerchantSession) {
  const store = await cookies();
  store.set(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

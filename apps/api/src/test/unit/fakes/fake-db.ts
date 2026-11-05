/**
 * An in-memory stand-in for the Prisma client: the OTP table, users and the
 * audit log, and nothing else.
 *
 * It understands only the filters the code under test uses and throws on any
 * other, so a query that changes shape fails a test loudly instead of matching
 * everything. It also understands the filters the pre-fix routes used (a lookup
 * by `codeHash`, `update` by id), so the same tests can run against the old code
 * and show what it let through.
 */

export interface FakeOtpRow {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface FakeUser {
  id: string;
  phone: string;
  name: string;
  avatar: string | null;
  role: "CUSTOMER" | "DRIVER" | "RIDER" | "MERCHANT" | "ADMIN";
  isActive: boolean;
  isVerified: boolean;
  tokenVersion: number;
  merchantProfile: { id: string } | null;
}

type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = row[key];
    if (condition === null || typeof condition !== "object" || condition instanceof Date) {
      if (value !== condition) return false;
      continue;
    }
    for (const [op, operand] of Object.entries(condition as Record<string, unknown>)) {
      const left = value instanceof Date ? value.getTime() : (value as number);
      const right = operand instanceof Date ? operand.getTime() : (operand as number);
      if (op === "gt" && !(left > right)) return false;
      else if (op === "gte" && !(left >= right)) return false;
      else if (op === "lt" && !(left < right)) return false;
      else if (!["gt", "gte", "lt"].includes(op)) throw new Error(`fake db: unsupported operator ${key}.${op}`);
    }
  }
  return true;
}

function apply<T extends Record<string, unknown>>(row: T, data: Data): void {
  for (const [key, change] of Object.entries(data)) {
    if (change !== null && typeof change === "object" && !(change instanceof Date)) {
      const op = change as { increment?: number; decrement?: number };
      if (op.increment !== undefined) (row as Record<string, unknown>)[key] = (row[key] as number) + op.increment;
      else if (op.decrement !== undefined) (row as Record<string, unknown>)[key] = (row[key] as number) - op.decrement;
      else throw new Error(`fake db: unsupported update on ${key}`);
    } else {
      (row as Record<string, unknown>)[key] = change;
    }
  }
}

function pick<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>): Partial<T> | T {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) as Partial<T>;
}

const OTP_FILTERS = new Set(["id", "phone", "codeHash", "used", "attempts", "expiresAt", "createdAt"]);

function checkOtpWhere(where: Where): void {
  for (const key of Object.keys(where)) {
    if (!OTP_FILTERS.has(key)) throw new Error(`fake db: unsupported OtpCode filter ${key}`);
  }
}

function sortBy(rows: FakeOtpRow[], orderBy?: { createdAt?: "asc" | "desc" }): FakeOtpRow[] {
  const direction = orderBy?.createdAt === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime()));
}

export function createFakeDb() {
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${++sequence}`;

  const state = {
    otps: [] as FakeOtpRow[],
    users: [] as FakeUser[],
    audits: [] as Array<Record<string, unknown>>,
    /** Every `where` passed to `otpCode.findFirst`, for asserting what a lookup was keyed on. */
    otpLookups: [] as Where[],
  };

  const db = {
    state,

    reset() {
      state.otps.length = 0;
      state.users.length = 0;
      state.audits.length = 0;
      state.otpLookups.length = 0;
    },

    addUser(user: Partial<FakeUser> & { phone: string }): FakeUser {
      const row: FakeUser = {
        id: nextId("user"),
        name: "Test User",
        avatar: null,
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
        tokenVersion: 0,
        merchantProfile: null,
        ...user,
      };
      state.users.push(row);
      return row;
    },

    otpCode: {
      async findMany(args: { where: Where; select?: Record<string, boolean>; orderBy?: { createdAt?: "asc" | "desc" } }) {
        checkOtpWhere(args.where);
        const rows = sortBy(
          state.otps.filter((row) => matches(row as unknown as Record<string, unknown>, args.where)),
          args.orderBy
        );
        return rows.map((row) => pick(row as unknown as Record<string, unknown>, args.select)) as never;
      },
      async findFirst(args: { where: Where; select?: Record<string, boolean>; orderBy?: { createdAt?: "asc" | "desc" } }) {
        checkOtpWhere(args.where);
        state.otpLookups.push(args.where);
        const [first] = sortBy(
          state.otps.filter((row) => matches(row as unknown as Record<string, unknown>, args.where)),
          args.orderBy
        );
        return (first ? pick(first as unknown as Record<string, unknown>, args.select) : null) as never;
      },
      async create(args: { data: Partial<FakeOtpRow> & { phone: string; codeHash: string; expiresAt: Date }; select?: Record<string, boolean> }) {
        const row: FakeOtpRow = {
          id: nextId("otp"),
          attempts: 0,
          used: false,
          createdAt: new Date(),
          ...args.data,
        };
        state.otps.push(row);
        return pick(row as unknown as Record<string, unknown>, args.select) as never;
      },
      async updateMany(args: { where: Where; data: Data }) {
        checkOtpWhere(args.where);
        let count = 0;
        for (const row of state.otps) {
          if (matches(row as unknown as Record<string, unknown>, args.where)) {
            apply(row as unknown as Record<string, unknown>, args.data);
            count++;
          }
        }
        return { count };
      },
      // Used only by the pre-fix routes.
      async update(args: { where: { id: string }; data: Data }) {
        const row = state.otps.find((r) => r.id === args.where.id);
        if (!row) throw new Error("fake db: record to update not found");
        apply(row as unknown as Record<string, unknown>, args.data);
        return { ...row };
      },
    },

    user: {
      async findUnique(args: { where: { id?: string; phone?: string }; select?: Record<string, unknown> }) {
        const row = state.users.find((u) =>
          args.where.id !== undefined ? u.id === args.where.id : u.phone === args.where.phone
        );
        return (row ? { ...row } : null) as never;
      },
      async create(args: { data: Partial<FakeUser> & { phone: string } }) {
        return { ...db.addUser(args.data) } as never;
      },
      async update(args: { where: { id: string }; data: Data; select?: Record<string, boolean> }) {
        const row = state.users.find((u) => u.id === args.where.id);
        if (!row) throw new Error("fake db: user to update not found");
        apply(row as unknown as Record<string, unknown>, args.data);
        return pick(row as unknown as Record<string, unknown>, args.select) as never;
      },
    },

    auditLog: {
      async create(args: { data: Record<string, unknown> }) {
        state.audits.push(args.data);
        return args.data;
      },
    },
  };

  return db;
}

export type FakeDb = ReturnType<typeof createFakeDb>;

/** One instance for `jest.mock` factories, which cannot close over test-scope variables. */
export const sharedFakeDb = createFakeDb();

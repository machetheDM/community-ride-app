import { afterAll, describe, expect, it } from "@jest/globals";
import { GET as listEvents } from "@/app/api/events/route";
import { GET as getEvent } from "@/app/api/events/[slug]/route";
import { GET as getPoster } from "@/app/api/events/[slug]/poster/route";
import { countVisit } from "@/lib/events";
import { call, createEvent, createPickupPoint, data, prisma, request } from "./helpers";

/**
 * Public event data (docs/PLAN.md Phase 3.2, 3.3). Public on purpose, so these
 * call without a token, as someone opening a Facebook link would.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

describe("public events", () => {
  it("lists published upcoming events and leaves drafts, cancelled and past events out", async () => {
    const published = await createEvent();
    const draft = await createEvent({ status: "DRAFT" });
    const cancelled = await createEvent({ status: "CANCELLED" });
    const past = await createEvent({ daysAhead: -2 });

    const res = await call(listEvents, request("GET", "/api/events"));

    expect(res.status).toBe(200);
    const slugs = (res.body.data as { slug: string }[]).map((e) => e.slug);
    expect(slugs).toContain(published.slug);
    expect(slugs).not.toContain(draft.slug);
    expect(slugs).not.toContain(cancelled.slug);
    expect(slugs).not.toContain(past.slug);
  });

  it("never carries the venue's contact or the poster bytes", async () => {
    const event = await createEvent();

    const res = await call(getEvent, request("GET", `/api/events/${event.slug}`), { slug: event.slug });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(event.venue.contactPhone as string);
    expect(res.text).not.toContain("contactName");
    expect(res.text).not.toContain("posterBytes");
    expect(res.text).not.toContain("createdById");
    expect(data(res).hasPoster).toBe(true);
  });

  it("answers a draft's slug with 404, as if it did not exist", async () => {
    const draft = await createEvent({ status: "DRAFT" });

    const res = await call(getEvent, request("GET", `/api/events/${draft.slug}`), { slug: draft.slug });
    const poster = await getPoster(request("GET", `/api/events/${draft.slug}/poster`), { params: Promise.resolve({ slug: draft.slug }) });

    expect(res.status).toBe(404);
    expect(poster.status).toBe(404);
  });

  it("offers nearby pickup points nearest first, each with a floor, and leaves far ones out", async () => {
    const event = await createEvent();
    const near = await createPickupPoint({ lat: -26.25 });
    const nearer = await createPickupPoint({ lat: -26.22 });
    const far = await createPickupPoint({ lat: -27.5 });

    const res = await call(getEvent, request("GET", `/api/events/${event.slug}`), { slug: event.slug });

    const points = data(res).pickupPoints as { id: string; price: { floor: number } }[];
    const ids = points.map((p) => p.id);
    expect(ids.indexOf(nearer.id)).toBeLessThan(ids.indexOf(near.id));
    expect(ids).not.toContain(far.id);
    expect(points.find((p) => p.id === near.id)?.price.floor).toBeGreaterThanOrEqual(20);
  });

  it("serves the poster with its type, a day's caching and nosniff", async () => {
    const event = await createEvent();

    const res = await getPoster(request("GET", `/api/events/${event.slug}/poster`), { params: Promise.resolve({ slug: event.slug }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("etag")).toBe(`"${event.posterSha256}"`);
  });
});

describe("PLAN.md 3.3: tracked visits", () => {
  it("counts a person's visit under its channel and an unknown channel as direct", async () => {
    const event = await createEvent();
    const phone = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";

    expect(await countVisit(event.id, phone, "fb")).toBe(true);
    expect(await countVisit(event.id, phone, "FB")).toBe(true);
    expect(await countVisit(event.id, phone, "<script>")).toBe(true);

    const visits = await prisma.eventVisit.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" } });
    expect(visits.map((v) => v.channel)).toEqual(["fb", "fb", "direct"]);
  });

  it("does not count Facebook's or WhatsApp's link-preview fetch, or a request with no user agent", async () => {
    const event = await createEvent();

    expect(await countVisit(event.id, "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "fb")).toBe(false);
    expect(await countVisit(event.id, "WhatsApp/2.23.20.0", "wa")).toBe(false);
    expect(await countVisit(event.id, null, "fb")).toBe(false);

    expect(await prisma.eventVisit.count({ where: { eventId: event.id } })).toBe(0);
  });
});

import { describe, it, expect } from "@jest/globals";
import {
  eventSlug,
  parseEventForm,
  parsePickupPointForm,
  parseSastDateTime,
  parseSpendForm,
  parseVenueForm,
} from "../../../../merchant-portal/src/lib/event-forms";
import { visitChannel } from "@ride/db/trips";

/** The admin's Phase 3 forms, tested here because the portal has no test runner. */

const now = new Date("2026-11-19T08:00:00Z");

describe("times typed in South Africa", () => {
  it("are read as UTC+2, all year", () => {
    expect(parseSastDateTime("2026-12-05T18:00")?.toISOString()).toBe("2026-12-05T16:00:00.000Z");
    expect(parseSastDateTime("2026-06-05T18:00")?.toISOString()).toBe("2026-06-05T16:00:00.000Z");
    expect(parseSastDateTime("5 Dec 6pm")).toBeNull();
  });
});

describe("an event", () => {
  const valid = { venueId: "v1", title: "Summer Jam", startsAt: "2026-12-05T18:00", endsAt: "2026-12-06T02:00" };

  it("is accepted with a slug that carries its date", () => {
    const result = parseEventForm(valid, now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("summer-jam-2026-12-05");
  });

  it("is refused when it starts in the past, ends before it starts, or runs past three days", () => {
    const past = parseEventForm({ ...valid, startsAt: "2026-11-01T18:00", endsAt: "" }, now);
    expect(past.ok === false && past.errors.startsAt).toMatch(/past/);
    const backwards = parseEventForm({ ...valid, endsAt: "2026-12-05T17:00" }, now);
    expect(backwards.ok === false && backwards.errors.endsAt).toMatch(/after it starts/);
    const long = parseEventForm({ ...valid, endsAt: "2026-12-10T18:00" }, now);
    expect(long.ok === false && long.errors.endsAt).toMatch(/three days/);
  });

  it("gives the same title on two dates two different pages", () => {
    expect(eventSlug("Summer Jam", new Date("2026-12-05T16:00:00Z"))).not.toBe(
      eventSlug("Summer Jam", new Date("2027-01-09T16:00:00Z"))
    );
  });

  it("dates its slug in South Africa, so a 01:00 start is that day, not the day before", () => {
    expect(eventSlug("Late Show", new Date("2026-12-05T23:30:00Z"))).toBe("late-show-2026-12-06");
  });
});

describe("a venue", () => {
  const valid = { name: "Riverside Resort", kind: "RESORT", address: "1 River Road, Testville", lat: "-24.6", lng: "29.9" };

  it("becomes a partner only with a note of what was agreed", () => {
    const missing = parseVenueForm({ ...valid, agreed: "on" }, now);
    expect(missing.ok === false && missing.errors.agreementNote).toMatch(/what was agreed/);
    const agreed = parseVenueForm({ ...valid, agreed: "on", agreementNote: "Owner agreed by phone" }, now);
    expect(agreed.ok && agreed.value.agreementAt?.toISOString()).toBe(now.toISOString());
    const notYet = parseVenueForm(valid, now);
    expect(notYet.ok && notYet.value.agreementAt).toBeNull();
  });

  it("refuses an unknown kind, a phone that is not one, or a place outside South Africa", () => {
    const result = parseVenueForm({ ...valid, kind: "CASINO", contactPhone: "call me", lat: "24.6" }, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["contactPhone", "kind", "lat"]);
  });
});

describe("a pickup point and a spend", () => {
  it("needs a name, an address and a place", () => {
    expect(parsePickupPointForm({ name: "Plaza rank", address: "Main Rd, Testville", lat: "-24.6", lng: "29.9" }).ok).toBe(true);
    expect(parsePickupPointForm({ name: "", address: "", lat: "", lng: "" }).ok).toBe(false);
  });

  it("takes money as a string to the cent, not in the future", () => {
    const spend = parseSpendForm({ channel: "META", amount: "150.50", spentOn: "2026-11-18" }, now);
    expect(spend.ok && spend.value.amount).toBe("150.50");
    expect(parseSpendForm({ channel: "META", amount: "1e3", spentOn: "2026-11-18" }, now).ok).toBe(false);
    expect(parseSpendForm({ channel: "META", amount: "10", spentOn: "2026-12-30" }, now).ok).toBe(false);
    expect(parseSpendForm({ channel: "TIKTOK", amount: "10", spentOn: "2026-11-18" }, now).ok).toBe(false);
  });
});

describe("a tracked link's channel", () => {
  it("is one of a small known set, and anything else counts as direct", () => {
    expect(visitChannel("FB")).toBe("fb");
    expect(visitChannel("wa")).toBe("wa");
    expect(visitChannel("<script>")).toBe("direct");
    expect(visitChannel(undefined)).toBe("direct");
  });
});

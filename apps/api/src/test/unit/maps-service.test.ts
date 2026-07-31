import { describe, it, expect, jest } from "@jest/globals";
import {
  geocodeAddress,
  getRoute,
  getETA,
  placesAutocomplete,
  getPlaceCoordinates,
  decodePolyline,
  boundsOf,
  NoResultError,
  QuotaError,
  MapsError,
  type MapsConfig,
} from "@ride/maps-service";

/**
 * Every call is against a mocked fetch.
 *
 * Nothing here touches Google: the suite must run in CI with no API key and must
 * never consume billable quota. That also makes the failure paths — quota
 * exhaustion, malformed responses, timeouts — testable, which they would not be
 * against the live service.
 */

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const configWith = (impl: unknown): MapsConfig => ({
  apiKey: "test-key",
  fetchImpl: impl as typeof fetch,
});

describe("geocodeAddress", () => {
  it("returns coordinates and the formatted address", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        status: "OK",
        results: [
          {
            formatted_address: "Vilakazi St, Orlando West, Soweto, 1804",
            geometry: { location: { lat: -26.2382, lng: 27.9089 } },
          },
        ],
      })
    );

    const result = await geocodeAddress(configWith(fetchMock), "Vilakazi Street Soweto");

    expect(result).toEqual({
      lat: -26.2382,
      lng: 27.9089,
      formatted: "Vilakazi St, Orlando West, Soweto, 1804",
    });
  });

  it("biases results to South Africa by default", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ status: "OK", results: [{ geometry: { location: { lat: -26, lng: 28 } } }] })
    );

    await geocodeAddress(configWith(fetchMock), "Main Road");

    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("region=ZA");
  });

  it("raises NoResultError on ZERO_RESULTS rather than returning 0,0", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ status: "ZERO_RESULTS", results: [] }));

    await expect(
      geocodeAddress(configWith(fetchMock), "nowhere at all")
    ).rejects.toBeInstanceOf(NoResultError);
  });

  it("raises QuotaError on OVER_QUERY_LIMIT", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ status: "OVER_QUERY_LIMIT" }));

    await expect(geocodeAddress(configWith(fetchMock), "Soweto")).rejects.toBeInstanceOf(
      QuotaError
    );
  });

  it("raises QuotaError on an HTTP 403, which is how a rejected key surfaces", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({}, 403));

    await expect(geocodeAddress(configWith(fetchMock), "Soweto")).rejects.toBeInstanceOf(
      QuotaError
    );
  });

  it("rejects an empty address without spending a call", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({}));

    await expect(geocodeAddress(configWith(fetchMock), "   ")).rejects.toBeInstanceOf(MapsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getRoute", () => {
  it("converts metres to km and the duration string to minutes", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        routes: [
          {
            distanceMeters: 8450,
            duration: "1080s",
            polyline: { encodedPolyline: "abcd" },
          },
        ],
      })
    );

    const result = await getRoute(
      configWith(fetchMock),
      { lat: -26.2, lng: 28.0 },
      { lat: -26.3, lng: 28.1 }
    );

    expect(result.distanceKm).toBe(8.45);
    expect(result.durationMinutes).toBe(18);
    expect(result.polyline).toBe("abcd");
  });

  it("sends the field mask the Routes API requires", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ routes: [{ distanceMeters: 100, duration: "60s" }] })
    );

    await getRoute(configWith(fetchMock), { lat: -26, lng: 28 }, { lat: -26.1, lng: 28.1 });

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toContain("routes.duration");
    expect(headers["X-Goog-Api-Key"]).toBe("test-key");
  });

  it("never reports a zero-minute trip", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ routes: [{ distanceMeters: 40, duration: "12s" }] })
    );

    const result = await getRoute(
      configWith(fetchMock),
      { lat: -26, lng: 28 },
      { lat: -26.001, lng: 28.001 }
    );

    expect(result.durationMinutes).toBe(1);
  });

  it("raises NoResultError when no route exists", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ routes: [] }));

    await expect(
      getRoute(configWith(fetchMock), { lat: -26, lng: 28 }, { lat: -26.1, lng: 28.1 })
    ).rejects.toBeInstanceOf(NoResultError);
  });

  it("surfaces a malformed response as a MapsError, not a crash", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    }));

    await expect(
      getRoute(configWith(fetchMock), { lat: -26, lng: 28 }, { lat: -26.1, lng: 28.1 })
    ).rejects.toBeInstanceOf(MapsError);
  });
});

describe("getETA", () => {
  it("reads the first routable cell of the matrix", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse([
        { originIndex: 0, destinationIndex: 0, distanceMeters: 5200, duration: "600s" },
      ])
    );

    const result = await getETA(
      configWith(fetchMock),
      { lat: -26.2, lng: 28.0 },
      { lat: -26.25, lng: 28.05 }
    );

    expect(result).toEqual({ distanceKm: 5.2, durationMinutes: 10 });
  });

  it("treats ROUTE_NOT_FOUND as unroutable", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse([
        { originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
      ])
    );

    await expect(
      getETA(configWith(fetchMock), { lat: -26, lng: 28 }, { lat: -26.1, lng: 28.1 })
    ).rejects.toBeInstanceOf(NoResultError);
  });
});

describe("placesAutocomplete", () => {
  it("always sends the session token, which is what keeps it on the free SKU", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ suggestions: [] }));

    await placesAutocomplete(configWith(fetchMock), "Vilakazi", {
      sessionToken: "session-abc-123",
    });

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ sessionToken: "session-abc-123" });
  });

  it("flattens suggestions into main and secondary text", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        suggestions: [
          {
            placePrediction: {
              placeId: "place-1",
              text: { text: "Vilakazi St, Soweto" },
              structuredFormat: {
                mainText: { text: "Vilakazi St" },
                secondaryText: { text: "Orlando West, Soweto" },
              },
            },
          },
        ],
      })
    );

    const results = await placesAutocomplete(configWith(fetchMock), "Vilakazi", {
      sessionToken: "session-abc-123",
    });

    expect(results).toEqual([
      {
        placeId: "place-1",
        text: "Vilakazi St, Soweto",
        mainText: "Vilakazi St",
        secondaryText: "Orlando West, Soweto",
      },
    ]);
  });

  it("returns an empty list for blank input without calling upstream", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({}));

    expect(
      await placesAutocomplete(configWith(fetchMock), "  ", { sessionToken: "s-1234567890" })
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops suggestions with no placeId instead of emitting a broken row", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ suggestions: [{ placePrediction: { text: { text: "no id" } } }] })
    );

    expect(
      await placesAutocomplete(configWith(fetchMock), "abc", { sessionToken: "s-1234567890" })
    ).toEqual([]);
  });
});

describe("getPlaceCoordinates", () => {
  it("passes the same session token so the billing session closes", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ location: { latitude: -26.2, longitude: 28.04 }, formattedAddress: "X" })
    );

    const result = await getPlaceCoordinates(configWith(fetchMock), "place-1", "session-abc-123");

    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      "sessionToken=session-abc-123"
    );
    expect(result).toEqual({ lat: -26.2, lng: 28.04, formatted: "X" });
  });
});

describe("decodePolyline", () => {
  it("decodes Google's documented example", () => {
    // From the Encoded Polyline Algorithm Format reference.
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lng).toBeCloseTo(-120.2, 5);
    expect(points[2].lat).toBeCloseTo(43.252, 5);
    expect(points[2].lng).toBeCloseTo(-126.453, 5);
  });

  it("returns an empty array for an empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("boundsOf", () => {
  it("returns the corners of the bounding box", () => {
    const bounds = boundsOf([
      { lat: -26.1, lng: 28.0 },
      { lat: -26.3, lng: 28.2 },
      { lat: -26.2, lng: 27.9 },
    ]);

    expect(bounds).toEqual({
      northEast: { lat: -26.1, lng: 28.2 },
      southWest: { lat: -26.3, lng: 27.9 },
    });
  });

  it("returns null for no points", () => {
    expect(boundsOf([])).toBeNull();
  });
});

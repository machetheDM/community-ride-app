/**
 * Layers environment-dependent values over the static app.json.
 *
 * Expo reads app.json first and passes it in as `config`, so everything static
 * stays where it was and only the parts that must not be committed live here.
 *
 * The Maps SDK key is a *render* key and is genuinely public — it ships inside the
 * app binary by design, and the Maps SDK for Android/iOS SKU is free at unlimited
 * volume, so an extracted copy costs nothing. It is still read from the environment
 * rather than committed, because a key hardcoded in a public repo gets scraped and
 * cannot be rotated without a source change.
 *
 * It must be restricted in the Google Cloud console to the Maps SDK APIs only, and
 * to this app's package name / bundle ID. The billable APIs (Geocoding, Routes,
 * Places) use a separate server-side key that never leaves the API — see
 * apps/api/src/lib/maps.ts.
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ?? "" },
    },
  },
  ios: {
    ...config.ios,
    config: {
      ...config.ios?.config,
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ?? "",
    },
  },
  extra: {
    ...config.extra,
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? undefined,
  },
});

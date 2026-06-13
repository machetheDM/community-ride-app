import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;

export const API_URL = extra?.apiUrl ?? "http://10.0.2.2:3002";

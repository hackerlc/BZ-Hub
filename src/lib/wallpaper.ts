import type { DevicePreferences, WeatherSnapshot } from "../types";

export const wallpaperWeatherOptions = [
  { value: "clear", label: "晴天", code: 100, precipitation: "0" },
  { value: "cloudy", label: "多云", code: 101, precipitation: "0" },
  { value: "fog", label: "雾", code: 501, precipitation: "0" },
  { value: "light-rain", label: "小雨", code: 305, precipitation: "0.5" },
  { value: "moderate-rain", label: "中雨", code: 306, precipitation: "3" },
  { value: "heavy-rain", label: "大雨", code: 307, precipitation: "8" },
  { value: "storm", label: "暴雨", code: 310, precipitation: "20" },
  { value: "thunderstorm", label: "雷阵雨", code: 302, precipitation: "12" },
  { value: "light-snow", label: "小雪", code: 400, precipitation: "0.3" },
  { value: "heavy-snow", label: "大雪", code: 402, precipitation: "3" },
  { value: "blizzard", label: "暴雪", code: 403, precipitation: "6" },
] as const;

// A separate outgoing snapshot: never mutate the weather cache or Hub's clock.
export function createWallpaperSnapshot(
  preferences: DevicePreferences,
  weather: WeatherSnapshot | null,
  error = "",
  now = new Date(),
) {
  const enabled = preferences.wallpaperEnabled;
  const simulated = enabled && preferences.wallpaperSimulationEnabled;
  const preset = wallpaperWeatherOptions.find((option) => option.value === preferences.wallpaperSimulationWeather)
    ?? wallpaperWeatherOptions[0];
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.wallpaperSimulationTime)
    ? preferences.wallpaperSimulationTime : "12:00";
  const windSpeed = Number.isFinite(preferences.wallpaperSimulationWindSpeed)
    ? Math.max(0, Math.min(120, preferences.wallpaperSimulationWindSpeed)) : 12;
  const outgoing: WeatherSnapshot | null = !enabled ? null : simulated ? {
    city: "壁纸模拟",
    temperature: preset.code >= 400 && preset.code < 500 ? -3 : 22,
    apparentTemperature: preset.code >= 400 && preset.code < 500 ? -5 : 22,
    weatherCode: preset.code,
    label: preset.label,
    icon: "◌",
    windSpeed: String(windSpeed),
    windDirection: "西风",
    precipitation: preset.precipitation,
    fetchedAt: now.toISOString(),
  } : weather;
  return {
    version: 1,
    enabled,
    available: Boolean(outgoing),
    weather: outgoing,
    simulation: { enabled: simulated, time: simulated ? time : null },
    error: enabled && !simulated ? error || undefined : undefined,
    updatedAt: now.toISOString(),
  };
}

import type { WeatherSnapshot } from "../types";
import { isTauriRuntime } from "./platform";

const WEATHER_CACHE_KEY = "bz-hub-qweather-cache-v2";
const CACHE_DURATION = 20 * 60 * 1000;

export interface QWeatherConfig {
  apiHost: string;
  apiKey: string;
}

interface NativeWeatherResponse {
  city: string;
  temperature: number;
  apparentTemperature: number;
  weatherCode: string;
  label: string;
  observedAt?: string;
  windDirection?: string;
  windScale?: string;
  windSpeed?: string;
  humidity?: string;
  precipitation?: string;
  pressure?: string;
  visibility?: string;
  cloudCover?: string;
  dewPoint?: string;
}

interface WeatherCache {
  query: string;
  apiHost: string;
  snapshot: WeatherSnapshot;
}

function normalizeApiHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function weatherIcon(code: string): string {
  const numeric = Number(code);
  if ([100, 150].includes(numeric)) return "☀";
  if ([101, 102, 103, 151, 152, 153].includes(numeric)) return "🌤";
  if ([104, 154].includes(numeric)) return "☁";
  if (numeric >= 300 && numeric < 400) return numeric >= 302 && numeric <= 304 ? "⛈" : "🌧";
  if (numeric >= 400 && numeric < 500) return "🌨";
  if (numeric >= 500 && numeric < 516) return "🌫";
  if (numeric === 900) return "☀";
  if (numeric === 901) return "❄";
  return "◌";
}

function readCache(query: string, apiHost: string): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as WeatherCache;
    const fresh = Date.now() - new Date(cache.snapshot.fetchedAt).getTime() < CACHE_DURATION;
    return cache.query === query && cache.apiHost === apiHost && fresh ? cache.snapshot : null;
  } catch {
    return null;
  }
}

async function fetchFromBrowser(city: string, config: QWeatherConfig): Promise<NativeWeatherResponse> {
  const headers = { "X-QW-Api-Key": config.apiKey.trim() };
  const host = normalizeApiHost(config.apiHost);
  const geoUrl = new URL("/geo/v2/city/lookup", host);
  geoUrl.search = new URLSearchParams({ location: city, number: "1", lang: "zh" }).toString();

  const geoResponse = await fetch(geoUrl, { headers });
  if (!geoResponse.ok) throw new Error(`城市查询失败（${geoResponse.status}）`);
  const geo = await geoResponse.json() as {
    code: string;
    location?: Array<{ id: string; name: string; adm1?: string }>;
  };
  if (geo.code !== "200") throw new Error(`和风天气返回错误代码 ${geo.code}`);
  const location = geo.location?.[0];
  if (!location) throw new Error(`没有找到城市“${city}”`);

  const currentUrl = new URL("/v7/weather/now", host);
  currentUrl.search = new URLSearchParams({ location: location.id, lang: "zh" }).toString();
  const currentResponse = await fetch(currentUrl, { headers });
  if (!currentResponse.ok) throw new Error(`天气查询失败（${currentResponse.status}）`);
  const current = await currentResponse.json() as {
    code: string;
    now?: {
      text: string;
      icon: string;
      temp: string;
      feelsLike: string;
      obsTime?: string;
      windDir?: string;
      windScale?: string;
      windSpeed?: string;
      humidity?: string;
      precip?: string;
      pressure?: string;
      vis?: string;
      cloud?: string;
      dew?: string;
    };
  };
  if (current.code !== "200") throw new Error(`和风天气返回错误代码 ${current.code}`);
  if (!current.now) throw new Error("实时天气数据缺少 now 字段");

  return {
    city: location.adm1 && location.adm1 !== location.name ? `${location.name} · ${location.adm1}` : location.name,
    temperature: Number(current.now.temp),
    apparentTemperature: Number(current.now.feelsLike),
    weatherCode: current.now.icon,
    label: current.now.text,
    observedAt: current.now.obsTime,
    windDirection: current.now.windDir,
    windScale: current.now.windScale,
    windSpeed: current.now.windSpeed,
    humidity: current.now.humidity,
    precipitation: current.now.precip,
    pressure: current.now.pressure,
    visibility: current.now.vis,
    cloudCover: current.now.cloud,
    dewPoint: current.now.dew,
  };
}

export async function fetchWeather(
  city: string,
  config: QWeatherConfig,
  force = false,
): Promise<WeatherSnapshot> {
  const normalizedCity = city.trim();
  const normalizedHost = normalizeApiHost(config.apiHost);
  if (!normalizedCity) throw new Error("请先设置天气城市");
  if (!config.apiHost.trim() || !config.apiKey.trim()) throw new Error("请在设置中配置和风天气");

  if (!force) {
    const cached = readCache(normalizedCity, normalizedHost);
    if (cached) return cached;
  }

  let result: NativeWeatherResponse;
  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    result = await invoke<NativeWeatherResponse>("fetch_qweather_weather", {
      apiHost: config.apiHost.trim(),
      apiKey: config.apiKey.trim(),
      city: normalizedCity,
    });
  } else {
    result = await fetchFromBrowser(normalizedCity, config);
  }

  const snapshot: WeatherSnapshot = {
    city: result.city,
    temperature: Math.round(result.temperature),
    apparentTemperature: Math.round(result.apparentTemperature),
    weatherCode: Number(result.weatherCode),
    label: result.label,
    icon: weatherIcon(result.weatherCode),
    observedAt: result.observedAt,
    windDirection: result.windDirection,
    windScale: result.windScale,
    windSpeed: result.windSpeed,
    humidity: result.humidity,
    precipitation: result.precipitation,
    pressure: result.pressure,
    visibility: result.visibility,
    cloudCover: result.cloudCover,
    dewPoint: result.dewPoint,
    fetchedAt: new Date().toISOString(),
  };

  const cache: WeatherCache = { query: normalizedCity, apiHost: normalizedHost, snapshot };
  localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
  return snapshot;
}

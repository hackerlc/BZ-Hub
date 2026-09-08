/* Pure scene rules, shared by the renderer and the offline regression checks. */
(function (root) {
    "use strict";
    var names = ["dawn", "day", "dusk", "night", "fog", "rain", "snow"];
    var timePresets = {
        dawn: "06:30",
        day: "12:00",
        dusk: "18:30",
        night: "23:00"
    };
    var weatherPresets = {
        clear: { weatherCode: 100, label: "晴" },
        fog: { weatherCode: 501, label: "雾" },
        rain_light: { weatherCode: 305, label: "小雨", precipitation: "1" },
        rain_medium: { weatherCode: 306, label: "中雨", precipitation: "7" },
        rain_heavy: { weatherCode: 310, label: "暴雨", precipitation: "20" },
        thunderstorm: { weatherCode: 303, label: "强雷阵雨", precipitation: "16" },
        snow_light: { weatherCode: 400, label: "小雪" },
        snow_medium: { weatherCode: 401, label: "中雪" },
        snow_heavy: { weatherCode: 403, label: "暴雪" }
    };
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function number(value) { var n = Number(value); return Number.isFinite(n) ? n : 0; }
    function timeWeights(date) {
        var hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
        var result = { dawn: 0, day: 0, dusk: 0, night: 0, fog: 0, rain: 0, snow: 0 };
        var current = hour < 5 || hour >= 20 ? "night" : hour < 8 ? "dawn" : hour < 17 ? "day" : "dusk";
        result[current] = 1;
        return result;
    }
    function weatherProfile(weather) {
        weather = weather || {};
        var code = number(weather.weatherCode), label = String(weather.label || "");
        var kind = code >= 400 && code < 500 || /雪/.test(label) ? "snow"
            : code >= 300 && code < 400 || /雨|雷/.test(label) ? "rain"
                : code >= 500 && code < 600 || /雾|霾|沙|尘/.test(label) ? "fog" : "none";
        var intensity = 0;
        if (kind === "rain") {
            intensity = [308, 310, 311, 312, 316, 317, 318].includes(code) || /暴雨/.test(label) ? 1
                : [301, 303, 304, 307, 315, 351].includes(code) || /大雨/.test(label) ? 0.75
                    : [302, 306, 314].includes(code) || /中雨/.test(label) ? 0.48 : 0.22;
            intensity = Math.max(intensity, clamp(number(weather.precipitation) / 20, 0, 1));
        }
        else if (kind === "snow") {
            intensity = [403, 410].includes(code) || /暴雪/.test(label) ? 1
                : [402, 409].includes(code) || /大雪/.test(label) ? 0.75
                    : [401, 408].includes(code) || /中雪/.test(label) ? 0.48 : 0.25;
        }
        return {
            kind: kind, intensity: intensity,
            thunder: [302, 303, 304].includes(code) || /雷/.test(label),
            cloudy: [101, 102, 103, 104, 151, 152, 153, 154].includes(code) || /阴|多云/.test(label),
        };
    }
    function scene(date, weather) {
        var weights = timeWeights(date), night = weights.night;
        var profile = weatherProfile(weather);
        var name = profile.kind === "none" ? names.find(function (key) { return weights[key] === 1; }) : profile.kind;
        names.forEach(function (key) { weights[key] = key === name ? 1 : 0; });
        return { name: name, weights: weights, profile: profile, night: night };
    }
    function effectiveDate(now, simulation) {
        var date = new Date(now.getTime());
        if (simulation && simulation.enabled && /^([01]\d|2[0-3]):[0-5]\d$/.test(simulation.time)) {
            var parts = simulation.time.split(":");
            date.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
        }
        return date;
    }
    function resolveDate(now, simulation, source) {
        var preset = timePresets[source];
        return effectiveDate(now, preset ? { enabled: true, time: preset } : source === "auto" ? simulation : null);
    }
    function resolveWeather(weather, source) {
        if (!source || source === "auto")
            return weather;
        var preset = weatherPresets[source];
        if (!preset)
            return weather;
        return {
            weatherCode: preset.weatherCode,
            label: preset.label,
            precipitation: preset.precipitation || "0"
        };
    }
    function cover(viewWidth, viewHeight, imageWidth, imageHeight) {
        var scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
        return { x: (viewWidth - imageWidth * scale) / 2, y: (viewHeight - imageHeight * scale) / 2,
            width: imageWidth * scale, height: imageHeight * scale };
    }
    root.BZSceneModel = { names: names, timePresets: timePresets, weatherPresets: weatherPresets,
        clamp: clamp, timeWeights: timeWeights, weatherProfile: weatherProfile, scene: scene,
        effectiveDate: effectiveDate, resolveDate: resolveDate, resolveWeather: resolveWeather,
        cover: cover };
})(typeof window !== "undefined" ? window : globalThis);

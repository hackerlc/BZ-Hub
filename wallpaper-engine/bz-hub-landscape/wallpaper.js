/* BZ Hub provides a separate wallpaper snapshot. Animation stays local. */
(function () {
    "use strict";
    var model = window.BZSceneModel, root = document.documentElement;
    var canvas = document.querySelector('.scene__particles'), ctx = canvas.getContext('2d');
    var gpu = window.createLandscapeRenderer(document.querySelector('.scene__water'));
    var ambience = window.createLandscapeAudio();
    var images = {}, background = document.querySelector('.scene__image'), sourceWindows = window.BZ_HUB_SOURCE_WINDOWS || {};
    var weather = null, simulation = null, timeSource = 'auto', weatherSource = 'auto';
    var endpoint = window.BZ_HUB_WEATHER_ENDPOINT || 'http://127.0.0.1:43821/v1/weather';
    var endpointOverride = '', receivedAt = 0, polling = false, pollCount = 0;
    var particles = [], streaks = [], ripples = [], particleKey = '';
    var target = model.scene(new Date(), null), displayedScene = '';
    var previousFrame = 0, animationTime = 0, lastSceneUpdate = -1000, fps = 30, paused = false, frameId = 0;
    var flash = 0, nextLightning = 12, width = 1, height = 1;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    function random(min, max) { return min + Math.random() * (max - min); }
    model.names.forEach(function (name) {
        var img = new Image();
        img.onload = function () { images[name] = img; };
        img.onerror = function () { console.warn('Wallpaper image failed: ' + name); };
        img.src = 'assets/' + name + '.png';
    });
    function updateScene() {
        if (receivedAt && Date.now() - receivedAt > 30000)
            simulation = null;
        target = model.scene(
            model.resolveDate(new Date(), simulation, timeSource),
            model.resolveWeather(weather, weatherSource)
        );
        var p = target.profile, key = [p.kind, p.intensity, width, height].join('/');
        ambience.updateProfile(p);
        if (key !== particleKey) {
            particleKey = key;
            rebuildParticles();
        }
        root.dataset.weather = p.kind;
        root.dataset.simulated = String(Boolean(
            timeSource !== 'auto' || weatherSource !== 'auto' || simulation && simulation.enabled
        ));
        root.dataset.intensity = String(p.intensity);
        root.style.setProperty('--fog-opacity', String(p.kind === 'fog' ? .48 : p.kind === 'rain' ? p.intensity * .18 : 0));
    }
    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        var ratio = Math.min(1, 2560 / width, 1440 / height);
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        rebuildParticles();
    }
    function rebuildParticles() {
        var p = target.profile, area = model.clamp(width * height / (1920 * 1080), .5, 2.4);
        particles = [];
        streaks = [];
        ripples = [];
        var count = p.kind === 'rain' ? Math.round((55 + p.intensity * 400) * area) : p.kind === 'snow' ? Math.round((45 + p.intensity * 190) * area) : 0;
        for (var i = 0; i < count; i++)
            particles.push({ x: random(-100, width + 100), y: random(-height, height), depth: random(.3, 1), phase: random(0, Math.PI * 2), alpha: random(.22, .65) });
        if (p.kind === 'none' || p.kind === 'fog')
            for (var j = 0; j < Math.round(24 * area); j++)
                streaks.push({ x: random(0, width), y: random(0, height), phase: random(0, 6.28), size: random(.8, 2.2) });
    }
    function drawParticles(delta) {
        ctx.clearRect(0, 0, width, height);
        if (reducedMotion.matches)
            return;
        var p = target.profile;
        particles.forEach(function (v) {
            var rain = p.kind === 'rain', speed = rain ? (650 + p.intensity * 1050) * v.depth : (22 + p.intensity * 48) * v.depth;
            v.y += speed * delta;
            v.x += (rain ? 0 : Math.sin(animationTime * .5 + v.phase) * 9) * delta;
            if (v.y > height + 40) {
                v.y = -40;
                v.x = random(-100, width + 100);
            }
            if (v.x > width + 120)
                v.x = -100;
            if (v.x < -120)
                v.x = width + 100;
            if (rain) {
                var length = (12 + p.intensity * 26) * v.depth;
                ctx.strokeStyle = 'rgba(210,230,246,' + v.alpha * (.6 + p.intensity * .35) + ')';
                ctx.lineWidth = .6 + v.depth * 1.1;
                ctx.beginPath();
                ctx.moveTo(v.x, v.y);
                ctx.lineTo(v.x, v.y + length);
                ctx.stroke();
            }
            else {
                ctx.fillStyle = 'rgba(243,249,255,' + v.alpha + ')';
                ctx.beginPath();
                ctx.arc(v.x, v.y, 1 + v.depth * 3.5, 0, Math.PI * 2);
                ctx.fill();
            }
        });
        streaks.forEach(function (v) {
            v.x += Math.sin(animationTime * .25 + v.phase) * 6 * delta;
            v.y += (4 + Math.sin(animationTime * .4 + v.phase) * 2) * delta;
            if (v.x > width + 50)
                v.x = -50;
            if (v.x < -50)
                v.x = width + 50;
            if (v.y > height + 10)
                v.y = -10;
            ctx.fillStyle = 'rgba(235,239,216,.35)';
            ctx.beginPath();
            ctx.ellipse(v.x, v.y, v.size, v.size * .65, Math.sin(animationTime * .3 + v.phase), 0, Math.PI * 2);
            ctx.fill();
        });
        drawRipples(delta);
        if (p.thunder && animationTime >= nextLightning) {
            flash = random(.08, .16);
            nextLightning = animationTime + random(9, 22);
        }
        flash *= Math.exp(-delta * 7);
        if (p.thunder && flash > .002) {
            ctx.fillStyle = 'rgba(213,228,255,' + flash + ')';
            ctx.fillRect(0, 0, width, height);
        }
    }
    function drawRipples(delta) {
        var p = target.profile, img = images.rain;
        if (p.kind !== 'rain' || !img)
            return;
        var crop = sourceWindows.rain || [0, 0, 1, 1], rect = model.cover(width, height, img.naturalWidth, img.naturalHeight);
        if (Math.random() < delta * (8 + p.intensity * 60)) {
            for (var attempt = 0; attempt < 8; attempt++) {
                var y = random(.5, .99), x = random(.08, .78), depth = (y - .45) / .55;
                if (window.BZWaterRegions.contains('rain', x, y)) {
                    ripples.push({ x: rect.x + (x - crop[0]) / crop[2] * rect.width, y: rect.y + (y - crop[1]) / crop[3] * rect.height, age: 0, size: random(7, 20) * depth });
                    break;
                }
            }
        }
        ripples = ripples.filter(function (r) { return r.age < .8; });
        ripples.forEach(function (r) { r.age += delta; ctx.strokeStyle = 'rgba(211,234,248,' + Math.max(0, (1 - r.age / .8) * .26) + ')'; ctx.lineWidth = .8; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.size * (.2 + r.age), r.size * (.2 + r.age) * .2, 0, 0, Math.PI * 2); ctx.stroke(); });
    }
    function selectBackground() {
        // Wait for decoding before switching, then replace the single visible image.
        if (images[target.name] && displayedScene !== target.name) {
            displayedScene = target.name;
            background.style.backgroundImage = 'url("assets/' + displayedScene + '.png")';
            root.dataset.scene = displayedScene;
        }
    }
    function animate(timestamp) {
        frameId = 0;
        if (paused || document.hidden)
            return;
        var elapsed = previousFrame ? timestamp - previousFrame : 1000 / fps;
        if (elapsed >= 1000 / fps - .5) {
            previousFrame = timestamp;
            var delta = model.clamp(elapsed / 1000, 0, 1);
            if (!reducedMotion.matches)
                animationTime += delta;
            if (timestamp - lastSceneUpdate >= 1000) {
                updateScene();
                lastSceneUpdate = timestamp;
            }
            selectBackground();
            if (gpu)
                gpu.draw(images[displayedScene], displayedScene, animationTime, !reducedMotion.matches, sourceWindows);
            drawParticles(delta);
        }
        frameId = requestAnimationFrame(animate);
    }
    function resume() {
        if (!frameId && !paused && !document.hidden) {
            previousFrame = 0;
            frameId = requestAnimationFrame(animate);
        }
    }
    function usableEndpoint(value) {
        try {
            var url = new URL(value);
            return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
        }
        catch (_) {
            return false;
        }
    }
    async function fetchJson(url) {
        var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 1500);
        try {
            var response = await fetch(url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now(), { cache: 'no-store', signal: controller.signal });
            if (!response.ok)
                throw new Error('HTTP ' + response.status);
            return await response.json();
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async function poll() {
        if (polling || paused || document.hidden)
            return;
        polling = true;
        try {
            if (!endpointOverride && pollCount++ % 10 === 0) {
                try {
                    var config = await fetchJson('bridge.json');
                    if (usableEndpoint(config.endpoint))
                        endpoint = config.endpoint;
                }
                catch (_) { }
            }
            var payload = await fetchJson(endpointOverride || endpoint);
            if (!payload || typeof payload.available !== 'boolean')
                return;
            receivedAt = Date.now();
            weather = payload.enabled !== false && payload.available && payload.weather ? payload.weather : null;
            simulation = payload.enabled !== false && payload.simulation && payload.simulation.enabled ? payload.simulation : null;
            updateScene();
        }
        catch (_) { /* Last weather survives a short restart. Simulation expires after 30 seconds. */ }
        finally {
            polling = false;
        }
    }
    window.wallpaperPropertyListener = {
        applyUserProperties: function (properties) {
            ambience.configure(properties);
            if (properties.timesource)
                timeSource = String(properties.timesource.value || 'auto');
            if (properties.weathersource)
                weatherSource = String(properties.weathersource.value || 'auto');
            if (properties.weatherendpoint && usableEndpoint(properties.weatherendpoint.value)) {
                endpointOverride = properties.weatherendpoint.value;
                poll();
            }
            updateScene();
        },
        applyGeneralProperties: function (properties) {
            if (Number.isFinite(properties.fps) && properties.fps > 0)
                fps = model.clamp(properties.fps, 1, 120);
        },
        setPaused: function (value) {
            paused = value;
            ambience.setPaused(paused || document.hidden);
            document.body.classList.toggle('is-paused', Boolean(value));
            if (paused && frameId) {
                cancelAnimationFrame(frameId);
                frameId = 0;
            }
            if (!paused) {
                poll();
                resume();
            }
        }
    };
    document.addEventListener('visibilitychange', function () {
        ambience.setPaused(paused || document.hidden);
        if (!document.hidden) {
            poll();
            resume();
        }
    });
    window.addEventListener('resize', resize);
    window.addEventListener('pagehide', function () { ambience.dispose(); });
    resize();
    updateScene();
    ambience.setPaused(paused || document.hidden);
    poll();
    setInterval(poll, 2000);
    resume();
})();

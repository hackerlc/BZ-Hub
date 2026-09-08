/* Local procedural ambience: no downloads, microphone, or audio service. */
(function (root) {
    'use strict';
    root.createLandscapeAudio = function () {
        var Context = root.AudioContext || root.webkitAudioContext;
        var context = null, master, wind, stream, rain, rainBody, drops;
        var enabled = true, volume = 25, paused = document.hidden, disposed = false;
        var profile = { kind: 'none', intensity: 0 }, timer = 0, suspendTimer = 0;
        function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
        function random(low, high) { return low + Math.random() * (high - low); }
        function audible() { return enabled && volume > 0 && !paused && !disposed; }
        function smooth(parameter, value, seconds) {
            var now = context.currentTime;
            if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
            else {
                var current = parameter.value;
                parameter.cancelScheduledValues(now);
                parameter.setValueAtTime(current, now);
            }
            parameter.setTargetAtTime(value, now, seconds);
        }
        function noiseBuffer(kind, seconds) {
            // Independent stereo noise, generated once. A short seam fade avoids loop clicks.
            var rate = 32000, length = Math.floor(rate * seconds);
            var buffer = context.createBuffer(2, length, rate);
            for (var channel = 0; channel < 2; channel++) {
                var data = buffer.getChannelData(channel);
                var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
                for (var i = -2048; i < length; i++) {
                    var white = Math.random() * 2 - 1, value = white;
                    if (kind === 'pink') {
                        b0 = .99886 * b0 + white * .0555179;
                        b1 = .99332 * b1 + white * .0750759;
                        b2 = .969 * b2 + white * .153852;
                        b3 = .8665 * b3 + white * .3104856;
                        b4 = .55 * b4 + white * .5329522;
                        b5 = -.7616 * b5 - white * .016898;
                        value = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362) * .11;
                        b6 = white * .115926;
                    } else if (kind === 'brown') {
                        brown = (brown + white * .02) / 1.02;
                        value = brown * 3.5;
                    }
                    if (i >= 0) data[i] = value * Math.min(1, i / 128, (length - 1 - i) / 128);
                }
            }
            return buffer;
        }
        function layer(buffer, high, low, speed) {
            var source = context.createBufferSource(), highpass = context.createBiquadFilter();
            var lowpass = context.createBiquadFilter(), movement = context.createGain(), gain = context.createGain();
            source.buffer = buffer;
            source.loop = true;
            source.playbackRate.value = speed;
            highpass.type = 'highpass'; highpass.frequency.value = high; highpass.Q.value = .5;
            lowpass.type = 'lowpass'; lowpass.frequency.value = low; lowpass.Q.value = .5;
            movement.gain.value = .85;
            gain.gain.value = 0;
            source.connect(highpass); highpass.connect(lowpass); lowpass.connect(movement);
            movement.connect(gain); gain.connect(master);
            // Slow overlapping cycles gently vary flow without frame-by-frame audio work.
            [.073 * speed, .193 * speed].forEach(function (frequency) {
                var oscillator = context.createOscillator(), depth = context.createGain();
                oscillator.frequency.value = frequency; depth.gain.value = .065;
                oscillator.connect(depth); depth.connect(movement.gain); oscillator.start();
            });
            source.start(0, random(0, buffer.duration));
            return { gain: gain.gain, low: lowpass.frequency };
        }
        function initialize() {
            if (context || !Context || disposed) return;
            try {
                context = new Context({ latencyHint: 'playback' });
                master = context.createGain(); master.gain.value = 0;
                var limiter = context.createDynamicsCompressor();
                limiter.threshold.value = -12; limiter.knee.value = 12;
                limiter.ratio.value = 8; limiter.attack.value = .01; limiter.release.value = .3;
                master.connect(limiter); limiter.connect(context.destination);
                var brown = noiseBuffer('brown', 11.3), pink = noiseBuffer('pink', 13.7);
                var white = noiseBuffer('white', 9.1);
                wind = layer(brown, 65, 700, .83);
                stream = layer(pink, 180, 2400, 1);
                rain = layer(white, 700, 2400, .97);
                rainBody = layer(pink, 80, 700, .71);
                drops = context.createGain(); drops.gain.value = .6; drops.connect(master);
                applyProfile();
            } catch (error) {
                // Keep the visual wallpaper usable if this host has no audio output.
                disposed = true;
                if (context) context.close().catch(function () {});
                console.warn('Wallpaper ambience unavailable:', error);
            }
        }
        function applyProfile() {
            if (!context || disposed) return;
            var wet = profile.kind === 'rain', snow = profile.kind === 'snow';
            var intensity = wet ? profile.intensity : 0;
            smooth(wind.gain, wet ? .06 : snow ? .09 : .14, 1.2);
            smooth(stream.gain, wet ? .34 - intensity * .16 : snow ? .26 : .52, 1.2);
            smooth(rain.gain, wet ? .035 + .40 * Math.pow(intensity, 1.35) : 0, 1.2);
            smooth(rain.low, 2200 + 4600 * intensity, 1.2);
            smooth(rainBody.gain, wet ? .04 + .48 * intensity * intensity : 0, 1.2);
            smooth(rainBody.low, 500 + 850 * intensity, 1.2);
        }
        function droplet(isRain) {
            var oscillator = context.createOscillator(), envelope = context.createGain();
            var pan = context.createStereoPanner ? context.createStereoPanner() : context.createGain();
            var now = context.currentTime, length = isRain ? random(.018, .055) : random(.07, .16);
            var frequency = isRain ? random(1300, 3600) : random(420, 1100);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, now);
            oscillator.frequency.exponentialRampToValueAtTime(frequency * (isRain ? .55 : .72), now + length);
            envelope.gain.setValueAtTime(0, now);
            envelope.gain.linearRampToValueAtTime(isRain ? random(.008, .022) : random(.01, .03), now + .004);
            envelope.gain.exponentialRampToValueAtTime(.0001, now + length);
            if (pan.pan) pan.pan.value = random(-.8, .8);
            oscillator.connect(envelope); envelope.connect(pan); pan.connect(drops);
            oscillator.onended = function () { oscillator.disconnect(); envelope.disconnect(); pan.disconnect(); };
            oscillator.start(now); oscillator.stop(now + length + .01);
        }
        function scheduleDrops() {
            if (!audible() || context.state !== 'running') return;
            var wet = profile.kind === 'rain', intensity = wet ? profile.intensity : 0;
            // Irregular, quiet bubbles and near-field droplets over the continuous water bed.
            if (Math.random() < (wet ? .14 : profile.kind === 'snow' ? .16 : .36)) droplet(false);
            if (wet) for (var i = 0; i < 2; i++)
                if (Math.random() < .10 + intensity * .65) droplet(true);
        }
        function syncPlayback() {
            clearTimeout(suspendTimer);
            if (audible()) initialize();
            if (!context || disposed) return;
            smooth(master.gain, audible() ? volume / 100 * .7 : 0, .045);
            if (audible()) {
                // Retry on a user gesture too, for browsers that restrict autoplay.
                context.resume().then(function () {
                    if (audible() && context.state === 'running' && !timer)
                        timer = setInterval(scheduleDrops, 120);
                    else if (!audible() && !disposed) syncPlayback();
                }).catch(function () { /* A later click/key press can unlock playback. */ });
            } else {
                clearInterval(timer); timer = 0;
                suspendTimer = setTimeout(function () {
                    if (!audible() && !disposed) context.suspend().catch(function () {});
                }, 240);
            }
        }
        function unlock() { if (audible()) syncPlayback(); }
        root.addEventListener('pointerdown', unlock);
        root.addEventListener('keydown', unlock);
        return {
            updateProfile: function (next) {
                var intensity = Number.isFinite(next.intensity) ? clamp(next.intensity, 0, 1) : 0;
                if (profile.kind === next.kind && profile.intensity === intensity) return;
                profile = { kind: next.kind, intensity: intensity };
                applyProfile();
            },
            configure: function (properties) {
                if (properties.ambientsound) enabled = properties.ambientsound.value === true;
                if (properties.ambientvolume && Number.isFinite(properties.ambientvolume.value))
                    volume = clamp(properties.ambientvolume.value, 0, 100);
                syncPlayback();
            },
            setPaused: function (value) { paused = Boolean(value); syncPlayback(); },
            dispose: function () {
                disposed = true;
                clearInterval(timer); clearTimeout(suspendTimer);
                root.removeEventListener('pointerdown', unlock);
                root.removeEventListener('keydown', unlock);
                if (context && context.state !== 'closed') context.close().catch(function () {});
            }
        };
    };
})(window);

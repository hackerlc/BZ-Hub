/* One background texture. River refraction follows the banks and excludes rocks. */
(function () {
    "use strict";
    window.createLandscapeRenderer = function (canvas) {
        var gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, powerPreference: "low-power" });
        if (!gl)
            return null;
        var vertex = "attribute vec2 position; varying vec2 uv; void main(){ uv=vec2((position.x+1.)*.5,(1.-position.y)*.5); gl_Position=vec4(position,0.,1.); }";
        var fragment = [
            "precision highp float; varying vec2 uv; uniform sampler2D picture;",
            "uniform vec2 viewport; uniform vec2 imageSize; uniform vec4 sourceWindow;",
            "uniform float time; uniform float motion; uniform vec2 banks[16]; uniform vec4 rocks[8];",
            "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
            "float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}",
            "float surface(vec2 p){return noise(p)*.55+noise(p*2.03+vec2(time*.12,0.))*.3+noise(p*4.01)*.15;}",
            "float riverMask(vec2 p){float edge=10.;bool inside=false;vec2 a=banks[15];",
            "for(int i=0;i<16;i++){vec2 b=banks[i],v=b-a;float t=clamp(dot(p-a,v)/max(dot(v,v),.000001),0.,1.);edge=min(edge,length(p-a-v*t));",
            "float dy=b.y-a.y;if(abs(dy)>.000001){if((a.y>p.y)!=(b.y>p.y)){if(p.x<(b.x-a.x)*(p.y-a.y)/dy+a.x)inside=!inside;}}a=b;}",
            "float mask=(inside?1.:0.)*smoothstep(0.,.012,edge);",
            "for(int j=0;j<8;j++){vec4 r=rocks[j];mask*=smoothstep(.94,1.12,length((p-r.xy)/r.zw));}return mask;}",
            "void main(){",
            "float scale=max(viewport.x/imageSize.x,viewport.y/imageSize.y);",
            "vec2 p=(uv*viewport-(viewport-imageSize*scale)*.5)/(imageSize*scale);",
            // Original-image coordinates keep masks aligned after an ultrawide crop.
            "vec2 original=sourceWindow.xy+p*sourceWindow.zw;",
            "if(motion<.5||original.y<.40||original.x<.04||original.x>.86){gl_FragColor=texture2D(picture,p);return;}",
            "float depth=smoothstep(.43,1.,original.y);float river=riverMask(original);",
            "if(river<.001){gl_FragColor=texture2D(picture,p);return;}",
            // Perspective compresses distant wavelets. Two flowing noise fields
            // refract the existing reflection without shifting whole image strips.
            "vec2 flow=vec2(original.x*65.,log(max(.055,original.y-.39))*46.-time*.9);",
            "float h=surface(flow);vec2 slope=vec2(surface(flow+vec2(.16,0.))-h,surface(flow+vec2(0.,.16))-h);",
            "vec2 offset=slope*vec2(.009,.0035)*(.12+depth*.88)*river;",
            "vec3 color=texture2D(picture,clamp(p+offset*motion/sourceWindow.zw,vec2(.001),vec2(.999))).rgb;",
            "float reflection=smoothstep(.28,.8,dot(color,vec3(.2126,.7152,.0722)));",
            "color*=1.+(h-.5)*.075*reflection*river*depth*motion;",
            "gl_FragColor=vec4(color,1.);}",
        ].join("\n");
        var resources = {}, textures = {}, lost = false, regionName = '';
        function shader(type, source) {
            var s = gl.createShader(type);
            gl.shaderSource(s, source);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(s));
            return s;
        }
        function initialize() {
            var program = gl.createProgram();
            var vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment);
            gl.attachShader(program, vs);
            gl.attachShader(program, fs);
            gl.linkProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS))
                throw new Error(gl.getProgramInfoLog(program));
            gl.useProgram(program);
            var buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
            var position = gl.getAttribLocation(program, "position");
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            ["viewport", "imageSize", "sourceWindow", "time", "motion", "banks[0]", "rocks[0]"].forEach(function (name) {
                resources[name] = gl.getUniformLocation(program, name);
            });
            gl.uniform1i(gl.getUniformLocation(program, "picture"), 0);
            gl.disable(gl.BLEND);
            textures = {};
            regionName = '';
        }
        try {
            initialize();
        }
        catch (error) {
            console.warn("Landscape GPU fallback", error);
            return null;
        }
        canvas.addEventListener("webglcontextlost", function (event) { event.preventDefault(); lost = true; canvas.style.opacity = "0"; });
        canvas.addEventListener("webglcontextrestored", function () {
            try {
                initialize();
                lost = false;
            }
            catch (error) {
                console.warn(error);
            }
        });
        return {
            draw: function (img, name, seconds, motion, sourceWindows) {
                if (lost || !img)
                    return;
                var ratio = Math.min(window.devicePixelRatio || 1, 3440 / window.innerWidth, 1440 / window.innerHeight);
                var width = Math.max(1, Math.round(window.innerWidth * ratio)), height = Math.max(1, Math.round(window.innerHeight * ratio));
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                gl.viewport(0, 0, width, height);
                gl.clearColor(0, 0, 0, 1);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.uniform2f(resources.viewport, width, height);
                gl.uniform1f(resources.time, seconds);
                gl.uniform1f(resources.motion, motion ? 1 : 0);
                if (!textures[name]) {
                    textures[name] = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, textures[name]);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                }
                else
                    gl.bindTexture(gl.TEXTURE_2D, textures[name]);
                var crop = sourceWindows[name] || [0, 0, 1, 1];
                gl.uniform4f(resources.sourceWindow, crop[0], crop[1], crop[2], crop[3]);
                gl.uniform2f(resources.imageSize, img.naturalWidth, img.naturalHeight);
                if (regionName !== name) {
                    var region = window.BZWaterRegions.scenes[name];
                    gl.uniform2fv(resources["banks[0]"], new Float32Array(region.banks.flat()));
                    gl.uniform4fv(resources["rocks[0]"], new Float32Array(region.rocks.flat()));
                    regionName = name;
                }
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                canvas.style.opacity = "1";
            },
        };
    };
})();

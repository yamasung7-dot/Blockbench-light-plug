/*
 * Blockbench Light Plug
 * Native Blockbench lighting / rendering studio with PBR parallax mapping.
 */

const BB_LIGHT_PLUG_ID = 'blockbench_light_plug';
const BB_LIGHT_PLUG_VERSION = '0.4.0';
const BB_LIGHT_GROUP = 'blockbench_light_plug';
const BB_LIGHT_PLUG_ICON = 'wb_sunny';

let lightStudioPanel;
let openStudioAction;
let renderAction;
let refreshPBRAction;
let previewChangeListener;

const DEFAULT_SETTINGS = {
    key: true,
    fill: true,
    rim: true,
    ambient: 0.45,
    exposure: 0,
    contrast: 0,
    saturation: 1,
    fog: false,
    fogDensity: 0.008,
    transparent: false,
    bloom: true,
    bloomStrength: 0.65,
    dof: false,
    dofStrength: 0.25,
    shadows: true,
    fov: 45,
    resolution: 2,
    parallax: true,
    parallaxDepth: 0.045,
    parallaxSteps: 24
};

const studio = {
    lights: [],
    original: null,
    preview: null,
    running: false,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    parallaxMaterials: new Map()
};

function hasProject() {
    return typeof Project !== 'undefined' && !!Project && !!Project.selected;
}

function getPreview() {
    try {
        return (typeof Preview !== 'undefined' && Preview.selected) || null;
    } catch (e) {
        return null;
    }
}

function refreshNativeMaterials() {
    if (!hasProject()) {
        Blockbench.showQuickMessage('Open a Blockbench model first');
        return 0;
    }
    let refreshed = 0;
    if (typeof Texture !== 'undefined' && Texture.all) {
        Texture.all.forEach(texture => {
            try {
                texture.updateMaterial();
                if (texture.getMaterial()) refreshed++;
            } catch (error) {
                console.warn('[Blockbench Light Plug] Material refresh failed', texture?.name, error);
            }
        });
    }
    try {
        Canvas.updateAll();
        Canvas.updateView({
            elements: [],
            element_aspects: { geometry: true, faces: true, shading: true }
        });
    } catch (error) {
        console.warn('[Blockbench Light Plug] Canvas refresh failed', error);
    }
    return refreshed;
}

function rememberRenderer(renderer) {
    if (!renderer || studio.original) return;
    studio.original = {
        toneMapping: renderer.toneMapping,
        toneMappingExposure: renderer.toneMappingExposure,
        outputColorSpace: renderer.outputColorSpace,
        outputEncoding: renderer.outputEncoding,
        shadowMapEnabled: renderer.shadowMap ? renderer.shadowMap.enabled : undefined,
        shadowMapType: renderer.shadowMap ? renderer.shadowMap.type : undefined,
        pixelRatio: renderer.getPixelRatio ? renderer.getPixelRatio() : 1,
        clearColor: renderer.getClearColor ? renderer.getClearColor(new THREE.Color()).getHex() : 0,
        clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1
    };
}

function restoreRenderer(renderer) {
    if (!renderer || !studio.original) return;
    try {
        renderer.toneMapping = studio.original.toneMapping;
        renderer.toneMappingExposure = studio.original.toneMappingExposure;
        if ('outputColorSpace' in renderer && studio.original.outputColorSpace !== undefined) {
            renderer.outputColorSpace = studio.original.outputColorSpace;
        }
        if ('outputEncoding' in renderer && studio.original.outputEncoding !== undefined) {
            renderer.outputEncoding = studio.original.outputEncoding;
        }
        if (renderer.shadowMap && studio.original.shadowMapEnabled !== undefined) {
            renderer.shadowMap.enabled = studio.original.shadowMapEnabled;
            renderer.shadowMap.type = studio.original.shadowMapType;
        }
        if (renderer.setPixelRatio) renderer.setPixelRatio(studio.original.pixelRatio || 1);
        if (renderer.setClearColor) renderer.setClearColor(studio.original.clearColor, studio.original.clearAlpha);
    } catch (error) {
        console.warn('[Blockbench Light Plug] Renderer restore failed', error);
    }
    studio.original = null;
}

function removeStudioLights() {
    const scene = typeof Canvas !== 'undefined' ? Canvas.scene : null;
    if (!scene) return;
    studio.lights.forEach(light => {
        try {
            scene.remove(light);
            if (light.target) scene.remove(light.target);
        } catch (e) {}
    });
    studio.lights.length = 0;
}

function addLight(light) {
    const scene = Canvas.scene;
    light.userData = light.userData || {};
    light.userData.bbLightPlug = BB_LIGHT_GROUP;
    scene.add(light);
    studio.lights.push(light);
    if (light.target) scene.add(light.target);
}

function getModelBounds() {
    if (typeof THREE === 'undefined' || !Canvas?.scene) return null;
    const box = new THREE.Box3();
    let found = false;
    Canvas.scene.traverse(object => {
        if (object.isMesh && object.visible) {
            box.expandByObject(object);
            found = true;
        }
    });
    if (!found || box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { box, center, size, radius: Math.max(size.length() * 0.5, 1) };
}

function buildStudioLights() {
    if (!hasProject() || typeof THREE === 'undefined' || !Canvas.scene) return;

    removeStudioLights();
    const s = studio.settings;
    const bounds = getModelBounds();
    const center = bounds ? bounds.center : new THREE.Vector3(0, 0, 0);
    const radius = bounds ? bounds.radius : 16;
    const distance = Math.max(radius * 2.5, 12);

    if (s.ambient > 0) {
        const ambient = new THREE.HemisphereLight(0xffffff, 0x30343b, Number(s.ambient));
        ambient.position.copy(center).add(new THREE.Vector3(0, radius, 0));
        addLight(ambient);
    }

    if (s.key) {
        const key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.copy(center).add(new THREE.Vector3(distance, distance * 1.25, distance * 0.85));
        key.target.position.copy(center);
        key.castShadow = !!s.shadows;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = Math.max(0.1, radius * 0.02);
        key.shadow.camera.far = distance * 5;
        key.shadow.camera.left = -radius * 2;
        key.shadow.camera.right = radius * 2;
        key.shadow.camera.top = radius * 2;
        key.shadow.camera.bottom = -radius * 2;
        key.shadow.bias = -0.00025;
        key.shadow.normalBias = 0.02;
        addLight(key);
    }

    if (s.fill) {
        const fill = new THREE.PointLight(0x9fc7ff, 1.1, distance * 8, 1.6);
        fill.position.copy(center).add(new THREE.Vector3(-distance * 1.1, radius * 0.35, distance * 0.9));
        addLight(fill);
    }

    if (s.rim) {
        const rim = new THREE.SpotLight(0xffd7a1, 2.6, distance * 9, Math.PI / 5, 0.5, 1.4);
        rim.position.copy(center).add(new THREE.Vector3(-distance * 0.7, distance * 1.35, -distance * 1.25));
        rim.target.position.copy(center);
        rim.castShadow = !!s.shadows;
        rim.shadow.mapSize.set(1024, 1024);
        rim.shadow.camera.near = Math.max(0.1, radius * 0.02);
        rim.shadow.camera.far = distance * 5;
        rim.shadow.bias = -0.00025;
        rim.shadow.normalBias = 0.02;
        addLight(rim);
    }

    try {
        Canvas.scene.traverse(object => {
            if (object.isMesh) {
                object.castShadow = !!s.shadows;
                object.receiveShadow = !!s.shadows;
            }
        });
    } catch (e) {}
}

function applyRendererSettings() {
    const preview = studio.preview || getPreview();
    if (!preview || !preview.renderer || typeof THREE === 'undefined') return;

    const renderer = preview.renderer;
    rememberRenderer(renderer);
    const s = studio.settings;

    try {
        if (renderer.shadowMap) {
            renderer.shadowMap.enabled = !!s.shadows;
            if (THREE.PCFSoftShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }

        if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = Math.pow(2, Number(s.exposure));

        if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        const scene = Canvas.scene;
        if (scene) {
            scene.fog = s.fog ? new THREE.FogExp2(0x9fb1c4, Number(s.fogDensity)) : null;
        }

        if (s.transparent) renderer.setClearColor(0x000000, 0);
        else renderer.setClearColor(0x101216, 1);

        const camera = preview.camera;
        if (camera && camera.isPerspectiveCamera) {
            camera.fov = Number(s.fov);
            camera.updateProjectionMatrix();
        }
    } catch (error) {
        console.warn('[Blockbench Light Plug] Renderer settings failed', error);
    }
}

/*
 * Blockbench's native PBR material already converts a height channel into
 * material.bumpMap. We use that exact native map as the parallax source,
 * so the model, UVs and texture remain owned by Blockbench.
 */
function restoreParallaxMaterials() {
    studio.parallaxMaterials.forEach((record, material) => {
        try {
            material.onBeforeCompile = record.onBeforeCompile;
            if (record.customProgramCacheKey !== undefined) {
                material.customProgramCacheKey = record.customProgramCacheKey;
            }
            material.needsUpdate = true;
        } catch (e) {}
    });
    studio.parallaxMaterials.clear();
}

function parallaxProgramKey(material) {
    const s = studio.settings;
    const mapId = material.bumpMap?.uuid || 'none';
    return `bb_light_plug_parallax_${s.parallax ? 1 : 0}_${mapId}_${Number(s.parallaxSteps) | 0}`;
}

function applyParallaxToMaterial(material) {
    if (!material || !material.isMeshStandardMaterial || typeof material.onBeforeCompile === 'undefined') return false;
    if (!material.bumpMap) return false;

    const existing = studio.parallaxMaterials.get(material);
    if (!existing) {
        studio.parallaxMaterials.set(material, {
            onBeforeCompile: material.onBeforeCompile,
            customProgramCacheKey: material.customProgramCacheKey
        });
    }

    const originalOnBeforeCompile = studio.parallaxMaterials.get(material).onBeforeCompile;
    material.onBeforeCompile = function(shader, renderer) {
        if (typeof originalOnBeforeCompile === 'function') {
            originalOnBeforeCompile.call(this, shader, renderer);
        }

        shader.uniforms.bbParallaxHeightMap = { value: this.bumpMap };
        shader.uniforms.bbParallaxDepthScale = { value: Number(studio.settings.parallaxDepth) || 0.045 };
        shader.uniforms.bbParallaxStepCount = { value: Math.max(4, Math.min(48, Number(studio.settings.parallaxSteps) || 24)) };

        const mapChunk = '#include <map_fragment>';
        if (!shader.fragmentShader.includes(mapChunk)) return;

        const parallax = `
            vec2 bbParallaxUv = vMapUv;
            float bbDepthScale = bbParallaxDepthScale;
            int bbStepCount = bbParallaxStepCount;

            // Derivative-built TBN keeps this compatible with Blockbench's cube UV geometry
            // without changing or requiring tangent attributes.
            vec3 bbQ1 = dFdx(-vViewPosition);
            vec3 bbQ2 = dFdy(-vViewPosition);
            vec2 bbSt1 = dFdx(vMapUv);
            vec2 bbSt2 = dFdy(vMapUv);
            vec3 bbT = normalize(bbQ1 * bbSt2.y - bbQ2 * bbSt1.y);
            vec3 bbB = normalize(-bbQ1 * bbSt2.x + bbQ2 * bbSt1.x);
            vec3 bbN = normalize(cross(bbT, bbB));
            if (!gl_FrontFacing) bbN = -bbN;
            vec3 bbViewTS = normalize(vec3(
                dot(normalize(-vViewPosition), bbT),
                dot(normalize(-vViewPosition), bbB),
                dot(normalize(-vViewPosition), bbN)
            ));

            float bbLayers = mix(float(bbStepCount), 8.0, abs(bbViewTS.z));
            float bbLayerDepth = 1.0 / bbLayers;
            float bbCurrentLayerDepth = 0.0;
            vec2 bbP = bbViewTS.xy / max(abs(bbViewTS.z), 0.12) * (bbDepthScale / bbLayers);
            vec2 bbCurrentUv = bbParallaxUv;
            float bbCurrentDepth = texture2D(bbParallaxHeightMap, bbCurrentUv).r;

            for (int bbStep = 0; bbStep < 48; bbStep++) {
                if (bbStep >= bbStepCount) break;
                if (bbCurrentDepth < bbCurrentLayerDepth) break;
                bbCurrentUv -= bbP;
                bbCurrentDepth = texture2D(bbParallaxHeightMap, bbCurrentUv).r;
                bbCurrentLayerDepth += bbLayerDepth;
            }

            vec2 bbPrevUv = bbCurrentUv + bbP;
            float bbAfterDepth = bbCurrentDepth - bbCurrentLayerDepth;
            float bbBeforeDepth = texture2D(bbParallaxHeightMap, bbPrevUv).r - (bbCurrentLayerDepth - bbLayerDepth);
            float bbWeight = bbAfterDepth / max(bbAfterDepth - bbBeforeDepth, 0.0001);
            bbParallaxUv = mix(bbCurrentUv, bbPrevUv, clamp(bbWeight, 0.0, 1.0));

            // Redirect the native StandardMaterial UV consumers to the parallax UV.
            #define vMapUv bbParallaxUv
            #ifdef USE_NORMALMAP
                #define vNormalMapUv bbParallaxUv
            #endif
            #ifdef USE_ROUGHNESSMAP
                #define vRoughnessMapUv bbParallaxUv
            #endif
            #ifdef USE_METALNESSMAP
                #define vMetalnessMapUv bbParallaxUv
            #endif
            #ifdef USE_EMISSIVEMAP
                #define vEmissiveMapUv bbParallaxUv
            #endif
            #ifdef USE_AOMAP
                #define vAoMapUv bbParallaxUv
            #endif
        `;

        shader.fragmentShader = shader.fragmentShader.replace(mapChunk, parallax + '\n' + mapChunk);
    };

    material.customProgramCacheKey = function() {
        return parallaxProgramKey(material);
    };
    material.needsUpdate = true;
    return true;
}

function applyParallax() {
    if (typeof THREE === 'undefined' || !Canvas?.scene) return 0;

    if (!studio.settings.parallax) {
        restoreParallaxMaterials();
        return 0;
    }

    let applied = 0;
    const seen = new Set();

    // Native PBR materials are attached to material groups in Material Preview.
    if (typeof TextureGroup !== 'undefined' && TextureGroup.all) {
        TextureGroup.all.forEach(group => {
            try {
                if (!group.is_material) return;
                const material = group.getMaterial();
                if (material && !seen.has(material)) {
                    seen.add(material);
                    if (applyParallaxToMaterial(material)) applied++;
                }
            } catch (e) {}
        });
    }

    // Also catch materials currently assigned directly to preview meshes.
    Canvas.scene.traverse(object => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
            if (material && !seen.has(material)) {
                seen.add(material);
                if (applyParallaxToMaterial(material)) applied++;
            }
        });
    });

    return applied;
}

function applyStudio() {
    if (!hasProject()) {
        Blockbench.showQuickMessage('Open a Blockbench model first');
        return false;
    }
    studio.preview = getPreview();
    if (!studio.preview) {
        Blockbench.showQuickMessage('No 3D preview is available');
        return false;
    }

    refreshNativeMaterials();
    buildStudioLights();
    applyRendererSettings();
    applyParallax();

    try {
        studio.preview.render();
    } catch (e) {
        try { Canvas.updateView(); } catch (ignored) {}
    }
    return true;
}

function setStudioValue(key, value) {
    studio.settings[key] = value;
    applyStudio();
}

function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function clampByte(value) {
    return Math.max(0, Math.min(255, value));
}

function gradeImage(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const contrast = Number(studio.settings.contrast) || 0;
    const saturation = Number(studio.settings.saturation) || 1;
    const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));

    for (let i = 0; i < data.length; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        if (contrast !== 0) {
            r = factor * (r - 128) + 128;
            g = factor * (g - 128) + 128;
            b = factor * (b - 128) + 128;
        }

        if (saturation !== 1) {
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = luma + (r - luma) * saturation;
            g = luma + (g - luma) * saturation;
            b = luma + (b - luma) * saturation;
        }

        data[i] = clampByte(r);
        data[i + 1] = clampByte(g);
        data[i + 2] = clampByte(b);
    }

    ctx.putImageData(image, 0, 0);
}

function applyBloomToCanvas(canvas) {
    if (!studio.settings.bloom) return;

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const sourceCtx = source.getContext('2d');
    sourceCtx.drawImage(canvas, 0, 0);

    const bright = document.createElement('canvas');
    bright.width = width;
    bright.height = height;
    const brightCtx = bright.getContext('2d');
    brightCtx.drawImage(source, 0, 0);

    const pixels = brightCtx.getImageData(0, 0, width, height);
    const p = pixels.data;
    for (let i = 0; i < p.length; i += 4) {
        const luma = Math.max(p[i], p[i + 1], p[i + 2]);
        if (luma < 185) {
            p[i] = p[i + 1] = p[i + 2] = 0;
        } else {
            const amount = (luma - 185) / 70;
            p[i] = clampByte(p[i] * amount);
            p[i + 1] = clampByte(p[i + 1] * amount);
            p[i + 2] = clampByte(p[i + 2] * amount);
        }
    }
    brightCtx.putImageData(pixels, 0, 0);

    const blur = document.createElement('canvas');
    blur.width = width;
    blur.height = height;
    const blurCtx = blur.getContext('2d');
    blurCtx.filter = `blur(${Math.max(2, Math.min(32, Math.min(width, height) * 0.018))}px)`;
    blurCtx.drawImage(bright, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.max(0, Math.min(1.5, Number(studio.settings.bloomStrength) || 0.65));
    ctx.drawImage(blur, 0, 0);
    ctx.restore();
}

function applyDOFToCanvas(canvas) {
    if (!studio.settings.dof) return;

    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const copy = document.createElement('canvas');
    copy.width = width;
    copy.height = height;
    const copyCtx = copy.getContext('2d');
    copyCtx.filter = `blur(${Math.max(1, Math.min(10, Number(studio.settings.dofStrength) * 10))}px)`;
    copyCtx.drawImage(canvas, 0, 0);

    const focus = document.createElement('canvas');
    focus.width = width;
    focus.height = height;
    const focusCtx = focus.getContext('2d');
    const gradient = focusCtx.createRadialGradient(width * 0.5, height * 0.5, Math.min(width, height) * 0.18, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.18)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
    focusCtx.fillStyle = gradient;
    focusCtx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(focus, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(copy, 0, 0);
    ctx.restore();
}

function renderPNG() {
    if (!applyStudio()) return;

    const preview = studio.preview;
    const renderer = preview.renderer;
    if (!renderer || !renderer.domElement || typeof THREE === 'undefined') {
        Blockbench.showQuickMessage('Preview renderer is unavailable');
        return;
    }

    const multiplier = Math.max(1, Math.min(8, Number(studio.settings.resolution) || 1));
    const oldRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    const oldSize = renderer.getSize ? renderer.getSize(new THREE.Vector2()) : new THREE.Vector2(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    const width = Math.max(1, Math.round(oldSize.x * multiplier));
    const height = Math.max(1, Math.round(oldSize.y * multiplier));

    try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        preview.render();

        const output = document.createElement('canvas');
        output.width = width;
        output.height = height;
        output.getContext('2d').drawImage(renderer.domElement, 0, 0, width, height);

        gradeImage(output);
        applyBloomToCanvas(output);
        applyDOFToCanvas(output);

        downloadDataUrl(output.toDataURL('image/png'), `blockbench-light-plug-${Date.now()}.png`);
        Blockbench.showQuickMessage(`Rendered ${width}×${height} PNG`);
    } catch (error) {
        console.error('[Blockbench Light Plug] PNG render failed', error);
        Blockbench.showQuickMessage('PNG render failed — see the developer console');
    } finally {
        try {
            renderer.setPixelRatio(oldRatio);
            renderer.setSize(oldSize.x, oldSize.y, false);
            preview.render();
        } catch (e) {}
    }
}

function resetStudio() {
    restoreParallaxMaterials();
    studio.settings = Object.assign({}, DEFAULT_SETTINGS);
    applyStudio();
}

function openLightStudio() {
    if (!hasProject()) {
        Blockbench.showQuickMessage('Open a Blockbench model first');
        return;
    }
    lightStudioPanel?.show();
    applyStudio();
}

function addEventListeners() {
    previewChangeListener = () => {
        if (studio.running && hasProject()) setTimeout(applyStudio, 0);
    };
    if (typeof Blockbench !== 'undefined' && Blockbench.on) {
        Blockbench.on('update_view', previewChangeListener);
        Blockbench.on('select_project', previewChangeListener);
    }
}

function removeEventListeners() {
    if (typeof Blockbench !== 'undefined' && Blockbench.removeListener && previewChangeListener) {
        Blockbench.removeListener('update_view', previewChangeListener);
        Blockbench.removeListener('select_project', previewChangeListener);
    }
    previewChangeListener = null;
}

Plugin.register(BB_LIGHT_PLUG_ID, {
    title: 'Blockbench Light Plug',
    author: 'Yama Sung',
    description: 'Native Blockbench lighting and cinematic PNG rendering with native textures, UVs, PBR materials and parallax depth.',
    icon: BB_LIGHT_PLUG_ICON,
    version: BB_LIGHT_PLUG_VERSION,
    min_version: '5.0.0',
    variant: 'both',
    tags: ['Rendering', 'Lighting', 'PBR'],

    onload() {
        studio.running = true;

        lightStudioPanel = new Panel('blockbench_light_plug_studio', {
            name: 'Light Studio',
            icon: BB_LIGHT_PLUG_ICON,
            condition: () => hasProject(),
            default_position: { slot: 'right_bar', height: 650 },
            component: {
                template: `<div class="bb-light-plug-panel" style="padding:10px;overflow:auto;max-height:calc(100vh - 100px)">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                        <div><h3 style="margin:0">Light Studio</h3><div style="font-size:11px;opacity:.65">Native scene + native PBR + parallax</div></div>
                        <button class="tool_button" @click="reset"><i class="material-icons">restart_alt</i></button>
                    </div>

                    <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                        <b>Lighting</b>
                        <label style="display:block;margin-top:7px"><input type="checkbox" v-model="key" @change="changed('key',key)"> Key / directional</label>
                        <label style="display:block"><input type="checkbox" v-model="fill" @change="changed('fill',fill)"> Fill / point</label>
                        <label style="display:block"><input type="checkbox" v-model="rim" @change="changed('rim',rim)"> Rim / spot</label>
                        <label style="display:block">Ambient <input type="range" min="0" max="2" step="0.05" v-model.number="ambient" @input="changed('ambient',ambient)"> {{ambient.toFixed(2)}}</label>
                        <label style="display:block"><input type="checkbox" v-model="shadows" @change="changed('shadows',shadows)"> Soft real-time shadows</label>
                    </div>

                    <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                        <b>Camera / color grading</b>
                        <label style="display:block;margin-top:7px">FOV <input type="range" min="20" max="90" step="1" v-model.number="fov" @input="changed('fov',fov)"> {{fov}}°</label>
                        <label style="display:block">Exposure <input type="range" min="-4" max="4" step="0.05" v-model.number="exposure" @input="changed('exposure',exposure)"> {{exposure.toFixed(2)}}</label>
                        <label style="display:block">Contrast <input type="range" min="-1" max="1" step="0.05" v-model.number="contrast" @input="changed('contrast',contrast)"> {{contrast.toFixed(2)}} <span style="font-size:10px;opacity:.55">(PNG)</span></label>
                        <label style="display:block">Saturation <input type="range" min="0" max="2" step="0.05" v-model.number="saturation" @input="changed('saturation',saturation)"> {{saturation.toFixed(2)}} <span style="font-size:10px;opacity:.55">(PNG)</span></label>
                    </div>

                    <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                        <b>Cinematic effects</b>
                        <label style="display:block;margin-top:7px"><input type="checkbox" v-model="fog" @change="changed('fog',fog)"> Fog</label>
                        <label style="display:block">Fog density <input type="range" min="0.001" max="0.05" step="0.001" v-model.number="fogDensity" @input="changed('fogDensity',fogDensity)"> {{fogDensity.toFixed(3)}}</label>
                        <label style="display:block"><input type="checkbox" v-model="transparent" @change="changed('transparent',transparent)"> Transparent background</label>
                        <label style="display:block"><input type="checkbox" v-model="bloom" @change="changed('bloom',bloom)"> Bloom / glow <span style="font-size:10px;opacity:.55">(PNG)</span></label>
                        <label style="display:block">Bloom strength <input type="range" min="0" max="1.5" step="0.05" v-model.number="bloomStrength" @input="changed('bloomStrength',bloomStrength)"> {{bloomStrength.toFixed(2)}}</label>
                        <label style="display:block"><input type="checkbox" v-model="dof" @change="changed('dof',dof)"> Depth of field <span style="font-size:10px;opacity:.55">(PNG)</span></label>
                        <label style="display:block">DOF strength <input type="range" min="0" max="1" step="0.05" v-model.number="dofStrength" @input="changed('dofStrength',dofStrength)"> {{dofStrength.toFixed(2)}}</label>
                    </div>

                    <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                        <b>PBR Parallax</b>
                        <div style="font-size:11px;opacity:.7;margin:5px 0 8px">Uses Blockbench's native height channel for view-dependent surface depth. No material or texture data is replaced.</div>
                        <label style="display:block"><input type="checkbox" v-model="parallax" @change="changed('parallax',parallax)"> Parallax depth</label>
                        <label style="display:block">Depth <input type="range" min="0" max="0.12" step="0.005" v-model.number="parallaxDepth" @input="changed('parallaxDepth',parallaxDepth)"> {{parallaxDepth.toFixed(3)}}</label>
                        <label style="display:block">Quality
                            <select v-model.number="parallaxSteps" @change="changed('parallaxSteps',parallaxSteps)">
                                <option :value="8">8 steps</option>
                                <option :value="16">16 steps</option>
                                <option :value="24">24 steps</option>
                                <option :value="32">32 steps</option>
                                <option :value="48">48 steps</option>
                            </select>
                        </label>
                        <div style="font-size:10px;opacity:.55;margin-top:5px">Best results require a PBR material with a height map.</div>
                    </div>

                    <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                        <b>Native PBR pipeline</b>
                        <div style="font-size:11px;opacity:.7;margin:5px 0 8px">Blockbench remains the source of truth for geometry, UVs, textures and PBR channels.</div>
                        <button class="tool_button" style="width:100%" @click="refresh"><i class="material-icons">refresh</i> Refresh native PBR materials</button>
                    </div>

                    <div style="display:flex;gap:6px">
                        <select v-model.number="resolution" style="flex:1">
                            <option :value="1">1x PNG</option>
                            <option :value="2">2x PNG</option>
                            <option :value="4">4x PNG</option>
                            <option :value="8">8x PNG</option>
                        </select>
                        <button class="tool_button" style="flex:1" @click="render"><i class="material-icons">image</i> Render PNG</button>
                    </div>
                    <div style="font-size:10px;opacity:.55;margin-top:8px;line-height:1.4">Lighting, shadows, exposure, fog and parallax affect the live preview. Color grading, bloom and depth-of-field are applied to the final PNG.</div>
                </div>`,
                data() {
                    return Object.assign({}, studio.settings);
                },
                methods: {
                    changed(key, value) { setStudioValue(key, value); },
                    refresh() {
                        const count = refreshNativeMaterials();
                        applyParallax();
                        Blockbench.showQuickMessage(`Refreshed ${count} native material${count === 1 ? '' : 's'}`);
                    },
                    render() { renderPNG(); },
                    reset() {
                        restoreParallaxMaterials();
                        studio.settings = Object.assign({}, DEFAULT_SETTINGS);
                        applyStudio();
                        Object.assign(this, studio.settings);
                    }
                }
            }
        });

        openStudioAction = new Action('blockbench_light_plug_open_studio', {
            name: 'Light Studio',
            description: 'Open Blockbench Light Plug lighting and rendering controls',
            icon: BB_LIGHT_PLUG_ICON,
            condition: () => hasProject(),
            click: openLightStudio
        });

        renderAction = new Action('blockbench_light_plug_render_png', {
            name: 'Render Light Studio PNG',
            description: 'Render the current Blockbench preview using Light Studio settings',
            icon: 'image',
            condition: () => hasProject(),
            click: renderPNG
        });

        refreshPBRAction = new Action('blockbench_light_plug_refresh_pbr', {
            name: 'Refresh Native PBR Materials',
            description: 'Refresh Blockbench native texture materials without replacing model data',
            icon: 'refresh',
            condition: () => hasProject(),
            click() {
                const count = refreshNativeMaterials();
                applyParallax();
                Blockbench.showQuickMessage(`Refreshed ${count} native material${count === 1 ? '' : 's'}`);
            }
        });

        MenuBar.menus.view.addAction(openStudioAction);
        MenuBar.menus.view.addAction(renderAction);
        MenuBar.menus.view.addAction(refreshPBRAction);
        addEventListeners();
    },

    oninstall() {},

    onuninstall() {
        this.onunload();
    },

    onunload() {
        studio.running = false;
        removeEventListeners();
        restoreParallaxMaterials();
        const preview = studio.preview || getPreview();
        if (preview?.renderer) restoreRenderer(preview.renderer);
        removeStudioLights();
        try {
            if (Canvas?.scene) Canvas.scene.fog = null;
            Canvas?.updateView?.();
        } catch (e) {}
        if (openStudioAction) openStudioAction.delete();
        if (renderAction) renderAction.delete();
        if (refreshPBRAction) refreshPBRAction.delete();
        if (lightStudioPanel) lightStudioPanel.delete();
        openStudioAction = null;
        renderAction = null;
        refreshPBRAction = null;
        lightStudioPanel = null;
        studio.preview = null;
    }
});
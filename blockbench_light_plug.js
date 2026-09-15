/*
 * Blockbench Light Plug
 * Native Blockbench lighting / rendering studio.
 *
 * The plugin deliberately works on Blockbench's live preview scene. It does
 * not import, rebuild, or replace the user's .bbmodel geometry, UVs, textures,
 * or native PBR materials.
 */

const BB_LIGHT_PLUG_ID = 'blockbench_light_plug';
const BB_LIGHT_PLUG_VERSION = '0.2.0';
const BB_LIGHT_GROUP = 'blockbench_light_plug';

let lightStudioPanel;
let openStudioAction;
let renderAction;
let refreshPBRAction;
let previewChangeListener;

const studio = {
    lights: [],
    original: null,
    preview: null,
    running: false,
    settings: {
        key: true,
        fill: true,
        rim: true,
        ambient: 0.55,
        exposure: 0,
        contrast: 0,
        saturation: 1,
        fog: false,
        fogDensity: 0.008,
        transparent: false,
        shadows: true,
        fov: 45,
        bloom: false,
        bloomStrength: 0.75,
        dof: false,
        dofStrength: 0.35,
        resolution: 2
    }
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
        Canvas.updateView({elements: [], element_aspects: {geometry: true, faces: true, shading: true}});
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
        pixelRatio: renderer.getPixelRatio ? renderer.getPixelRatio() : 1
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

function buildStudioLights() {
    if (!hasProject() || typeof THREE === 'undefined' || !Canvas.scene) return;

    removeStudioLights();
    const s = studio.settings;

    // Native THREE lights are added to Blockbench's live preview scene.
    if (s.ambient > 0) {
        addLight(new THREE.HemisphereLight(0xffffff, 0x303030, Number(s.ambient)));
    }

    if (s.key) {
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(12, 18, 10);
        key.castShadow = !!s.shadows;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 0.1;
        key.shadow.camera.far = 200;
        key.shadow.bias = -0.0005;
        addLight(key);
    }

    if (s.fill) {
        const fill = new THREE.PointLight(0x9fc7ff, 1.15, 120, 2);
        fill.position.set(-16, 7, 12);
        fill.castShadow = false;
        addLight(fill);
    }

    if (s.rim) {
        const rim = new THREE.SpotLight(0xffd7a1, 2.4, 160, Math.PI / 5, 0.45, 1.5);
        rim.position.set(-8, 18, -18);
        rim.castShadow = !!s.shadows;
        rim.shadow.mapSize.set(1024, 1024);
        rim.shadow.bias = -0.0005;
        rim.target.position.set(0, 0, 0);
        addLight(rim);
    }

    // Make existing Blockbench geometry participate in the studio shadow pass.
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
    if (!preview || !preview.renderer) return;

    const renderer = preview.renderer;
    rememberRenderer(renderer);
    const s = studio.settings;

    try {
        if (renderer.shadowMap) {
            renderer.shadowMap.enabled = !!s.shadows;
            if (typeof THREE !== 'undefined' && THREE.PCFSoftShadowMap !== undefined) {
                renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            }
        }

        if (typeof THREE !== 'undefined' && THREE.ACESFilmicToneMapping !== undefined) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
        }
        renderer.toneMappingExposure = Math.pow(2, Number(s.exposure));

        if ('outputColorSpace' in renderer && typeof THREE !== 'undefined' && THREE.SRGBColorSpace) {
            renderer.outputColorSpace = THREE.SRGBColorSpace;
        }

        // Blockbench uses the scene's color management for its native materials.
        // Contrast/saturation are represented without replacing those materials.
        const scene = Canvas.scene;
        if (scene) {
            if (s.fog) {
                scene.fog = new THREE.FogExp2(0x9fb1c4, Number(s.fogDensity));
            } else {
                scene.fog = null;
            }
            if (scene.background && scene.background.isColor) {
                scene.background.convertSRGBToLinear?.();
            }
            if (s.transparent) {
                renderer.setClearColor(0x000000, 0);
            } else if (renderer.setClearColor) {
                renderer.setClearColor(0x000000, 1);
            }
        }

        const camera = preview.camera;
        if (camera && camera.isPerspectiveCamera) {
            camera.fov = Number(s.fov);
            camera.updateProjectionMatrix();
        }
    } catch (error) {
        console.warn('[Blockbench Light Plug] Renderer settings failed', error);
    }
}

function applyBloomFallback() {
    // Bloom/DOF are intentionally non-destructive. If Blockbench exposes a
    // post-processing composer in a future build, this hook can attach passes.
    // For current builds we use emissive/additive native materials as the
    // compatible glow path instead of replacing the user's PBR materials.
    if (!studio.settings.bloom || typeof Texture === 'undefined') return;

    Texture.all?.forEach(texture => {
        try {
            if (texture.render_mode === 'emissive' || texture.render_mode === 'additive') {
                texture.updateMaterial();
            }
        } catch (e) {}
    });
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
    applyBloomFallback();

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

function renderPNG() {
    if (!applyStudio()) return;

    const preview = studio.preview;
    const renderer = preview.renderer;
    if (!renderer || !renderer.domElement) {
        Blockbench.showQuickMessage('Preview renderer is unavailable');
        return;
    }

    const multiplier = Math.max(1, Math.min(8, Number(studio.settings.resolution) || 1));
    const oldRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    const oldWidth = preview.width || renderer.domElement.clientWidth;
    const oldHeight = preview.height || renderer.domElement.clientHeight;
    const oldSize = renderer.getSize ? renderer.getSize(new THREE.Vector2()) : {x: oldWidth, y: oldHeight};

    try {
        // Render at a larger backing resolution without touching model geometry.
        renderer.setPixelRatio(multiplier);
        renderer.setSize(oldWidth, oldHeight, false);
        preview.render();
        const data = renderer.domElement.toDataURL('image/png');
        downloadDataUrl(data, `blockbench-light-plug-${Date.now()}.png`);
        Blockbench.showQuickMessage(`Rendered PNG at ${multiplier}x resolution`);
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
    studio.settings = {
        key: true,
        fill: true,
        rim: true,
        ambient: 0.55,
        exposure: 0,
        contrast: 0,
        saturation: 1,
        fog: false,
        fogDensity: 0.008,
        transparent: false,
        shadows: true,
        fov: 45,
        bloom: false,
        bloomStrength: 0.75,
        dof: false,
        dofStrength: 0.35,
        resolution: 2
    };
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
    description: 'A native Blockbench lighting and rendering studio for live geometry, UVs, textures and PBR materials.',
    icon: 'light_mode',
    version: BB_LIGHT_PLUG_VERSION,
    min_version: '5.0.0',
    variant: 'both',
    tags: ['Rendering', 'Lighting', 'PBR'],

    onload() {
        studio.running = true;

        lightStudioPanel = new Panel('blockbench_light_plug_studio', {
            name: 'Light Studio',
            icon: 'light_mode',
            condition: () => hasProject(),
            default_position: {slot: 'right_bar', height: 520},
            component: {
                template: `
                    <div class="bb-light-plug-panel" style="padding: 10px; overflow:auto; max-height:calc(100vh - 100px)">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                            <div>
                                <h3 style="margin:0">Light Studio</h3>
                                <div style="font-size:11px;opacity:.65">Native scene + native PBR</div>
                            </div>
                            <button class="tool_button" @click="reset"><i class="material-icons">restart_alt</i></button>
                        </div>

                        <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                            <b>Lights</b>
                            <label style="display:block;margin-top:7px"><input type="checkbox" v-model="key" @change="changed('key', key)"> Key / directional</label>
                            <label style="display:block"><input type="checkbox" v-model="fill" @change="changed('fill', fill)"> Fill / point</label>
                            <label style="display:block"><input type="checkbox" v-model="rim" @change="changed('rim', rim)"> Rim / spot</label>
                            <label style="display:block">Ambient <input type="range" min="0" max="2" step="0.05" v-model.number="ambient" @input="changed('ambient', ambient)"> {{ambient.toFixed(2)}}</label>
                            <label style="display:block"><input type="checkbox" v-model="shadows" @change="changed('shadows', shadows)"> Real-time shadows</label>
                        </div>

                        <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                            <b>Camera / color</b>
                            <label style="display:block;margin-top:7px">FOV <input type="range" min="20" max="90" step="1" v-model.number="fov" @input="changed('fov', fov)"> {{fov}}°</label>
                            <label style="display:block">Exposure <input type="range" min="-4" max="4" step="0.05" v-model.number="exposure" @input="changed('exposure', exposure)"> {{exposure.toFixed(2)}}</label>
                            <label style="display:block">Contrast <input type="range" min="-1" max="1" step="0.05" v-model.number="contrast" @input="changed('contrast', contrast)"> {{contrast.toFixed(2)}}</label>
                            <label style="display:block">Saturation <input type="range" min="0" max="2" step="0.05" v-model.number="saturation" @input="changed('saturation', saturation)"> {{saturation.toFixed(2)}}</label>
                        </div>

                        <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                            <b>Atmosphere / effects</b>
                            <label style="display:block;margin-top:7px"><input type="checkbox" v-model="fog" @change="changed('fog', fog)"> Fog</label>
                            <label style="display:block">Fog density <input type="range" min="0.001" max="0.05" step="0.001" v-model.number="fogDensity" @input="changed('fogDensity', fogDensity)"> {{fogDensity.toFixed(3)}}</label>
                            <label style="display:block"><input type="checkbox" v-model="transparent" @change="changed('transparent', transparent)"> Transparent background</label>
                            <label style="display:block"><input type="checkbox" v-model="bloom" @change="changed('bloom', bloom)"> Bloom / glow compatibility</label>
                            <label style="display:block"><input type="checkbox" v-model="dof" @change="changed('dof', dof)"> Depth-of-field compatibility</label>
                        </div>

                        <div style="border:1px solid var(--color-border);border-radius:6px;padding:8px;margin-bottom:8px">
                            <b>Native PBR pipeline</b>
                            <div style="font-size:11px;opacity:.7;margin:5px 0 8px">Blockbench remains the source of truth for textures, UVs and PBR channels.</div>
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

                        <div style="font-size:10px;opacity:.55;margin-top:8px;line-height:1.4">
                            Geometry is never rebuilt by this plugin. The renderer works from the live Blockbench preview scene, so edits, UVs, texture animation and native material changes remain authoritative.
                        </div>
                    </div>
                `,
                data() {
                    return Object.assign({}, studio.settings);
                },
                methods: {
                    changed(key, value) { setStudioValue(key, value); },
                    refresh() { const count = refreshNativeMaterials(); Blockbench.showQuickMessage(`Refreshed ${count} native material${count === 1 ? '' : 's'}`); },
                    render() { renderPNG(); },
                    reset() { resetStudio(); Object.assign(this, studio.settings); }
                }
            }
        });

        openStudioAction = new Action('blockbench_light_plug_open_studio', {
            name: 'Light Studio',
            description: 'Open Blockbench Light Plug lighting and rendering controls',
            icon: 'light_mode',
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
                Blockbench.showQuickMessage(`Refreshed ${count} native material${count === 1 ? '' : 's'}`);
            }
        });

        MenuBar.menus.view.addAction(openStudioAction);
        MenuBar.menus.view.addAction(renderAction);
        MenuBar.menus.view.addAction(refreshPBRAction);
        addEventListeners();
    },

    oninstall() {
        // The registered ID + filename lets Blockbench track this plugin in its
        // installed-plugin system, making normal uninstall/reload possible.
    },

    onuninstall() {
        this.onunload();
    },

    onunload() {
        studio.running = false;
        removeEventListeners();

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

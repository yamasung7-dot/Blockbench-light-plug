/*
 * Blockbench Light Plug
 * Native Blockbench lighting/rendering foundation.
 *
 * The plugin intentionally uses Blockbench's existing model, UVs, textures,
 * and material system instead of importing or rebuilding .bbmodel files.
 */

const BB_LIGHT_PLUG_ID = 'blockbench_light_plug';

let lightStudioPanel;
let refreshPBRAction;
let openStudioAction;

function refreshNativeMaterials() {
    if (!Project || !Project.selected) {
        Blockbench.showQuickMessage('Open a Blockbench model first');
        return 0;
    }

    let refreshed = 0;
    Texture.all.forEach(texture => {
        try {
            // Blockbench owns the material. Updating it keeps its native texture,
            // UV behavior, and PBR channels intact.
            texture.updateMaterial();
            const material = texture.getMaterial();
            if (material) refreshed++;
        } catch (error) {
            console.warn('[Blockbench Light Plug] Could not refresh texture material', texture?.name, error);
        }
    });

    try {
        Canvas.updateAll();
    } catch (error) {
        console.warn('[Blockbench Light Plug] Canvas refresh failed', error);
    }

    return refreshed;
}

function openLightStudio() {
    if (!Project || !Project.selected) {
        Blockbench.showQuickMessage('Open a Blockbench model first');
        return;
    }

    lightStudioPanel.show();
    refreshNativeMaterials();
}

Plugin.register(BB_LIGHT_PLUG_ID, {
    title: 'Blockbench Light Plug',
    author: 'Yama Sung',
    description: 'Native Blockbench lighting and rendering tools using the current model, textures, UVs, and PBR material system.',
    icon: 'light_mode',
    version: '0.1.0',
    min_version: '5.0.0',
    variant: 'both',
    tags: ['Rendering', 'Lighting', 'PBR'],

    onload() {
        lightStudioPanel = new Panel('blockbench_light_plug_studio', {
            name: 'Light Studio',
            icon: 'light_mode',
            condition: () => !!Project && !!Project.selected,
            default_position: {
                slot: 'right_bar',
                height: 360
            },
            component: {
                template: `
                    <div class="bb-light-plug-panel">
                        <div style="padding: 12px">
                            <h3 style="margin: 0 0 8px">Light Studio</h3>
                            <p style="opacity: .75; margin-top: 0">
                                Uses Blockbench's current model and native materials.
                            </p>

                            <div style="margin: 12px 0; padding: 10px; border: 1px solid var(--color-border); border-radius: 6px">
                                <b>Material pipeline</b>
                                <div style="margin-top: 6px; opacity: .8">
                                    Existing textures and PBR channels are kept intact.
                                </div>
                            </div>

                            <button class="tool_button" style="width: 100%; margin-bottom: 8px" @click="refreshMaterials">
                                <i class="material-icons">refresh</i>
                                Refresh PBR Materials
                            </button>

                            <div style="font-size: 12px; opacity: .65; line-height: 1.45">
                                Next renderer stages will add scene lights, shadows, bloom,
                                camera controls and high-resolution PNG output without
                                replacing Blockbench's model/material data.
                            </div>
                        </div>
                    </div>
                `,
                methods: {
                    refreshMaterials() {
                        const count = refreshNativeMaterials();
                        Blockbench.showQuickMessage(`Refreshed ${count} native material${count === 1 ? '' : 's'}`);
                    }
                }
            }
        });

        refreshPBRAction = new Action('blockbench_light_plug_refresh_pbr', {
            name: 'Refresh Native PBR Materials',
            description: 'Refresh Blockbench native texture materials without replacing model data',
            icon: 'refresh',
            condition: () => !!Project && !!Project.selected,
            click() {
                const count = refreshNativeMaterials();
                Blockbench.showQuickMessage(`Refreshed ${count} native material${count === 1 ? '' : 's'}`);
            }
        });

        openStudioAction = new Action('blockbench_light_plug_open_studio', {
            name: 'Light Studio',
            description: 'Open Blockbench Light Plug controls',
            icon: 'light_mode',
            condition: () => !!Project && !!Project.selected,
            click: openLightStudio
        });

        MenuBar.menus.view.addAction(openStudioAction);
        MenuBar.menus.view.addAction(refreshPBRAction);
    },

    onunload() {
        if (openStudioAction) openStudioAction.delete();
        if (refreshPBRAction) refreshPBRAction.delete();
        if (lightStudioPanel) lightStudioPanel.delete();

        openStudioAction = null;
        refreshPBRAction = null;
        lightStudioPanel = null;
    }
});

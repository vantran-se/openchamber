export type MobileComposerViewportMode = 'fixed' | 'reveal-if-obscured' | 'native';

export interface MobileComposerViewportEnvironment {
    isDraftScreen: boolean;
    isAndroidBrowser: boolean;
    isStandaloneBrowser: boolean;
}

export function getMobileComposerViewportMode(
    environment: MobileComposerViewportEnvironment,
): MobileComposerViewportMode {
    if (environment.isDraftScreen || environment.isAndroidBrowser) return 'fixed';
    if (environment.isStandaloneBrowser) return 'reveal-if-obscured';
    return 'native';
}

export function isComposerObscured(
    formBottom: number,
    visualViewportBottom: number,
    layoutViewportBottom: number,
): boolean {
    return formBottom > Math.min(visualViewportBottom, layoutViewportBottom);
}

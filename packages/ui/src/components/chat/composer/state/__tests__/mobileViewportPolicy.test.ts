import { describe, expect, test } from 'bun:test';

import {
    getMobileComposerViewportMode,
    isComposerObscured,
    type MobileComposerViewportEnvironment,
} from '../mobileViewportPolicy';

const IOS_CHAT: MobileComposerViewportEnvironment = {
    isDraftScreen: false,
    isAndroidBrowser: false,
    isStandaloneBrowser: false,
};

describe('getMobileComposerViewportMode', () => {
    const cases = [
        {
            name: 'mobile draft screens',
            environment: { ...IOS_CHAT, isDraftScreen: true },
            expected: 'fixed',
        },
        {
            name: 'Android chat',
            environment: { ...IOS_CHAT, isAndroidBrowser: true },
            expected: 'fixed',
        },
        {
            name: 'iOS standalone chat',
            environment: { ...IOS_CHAT, isStandaloneBrowser: true },
            expected: 'reveal-if-obscured',
        },
        {
            name: 'iOS Safari chat',
            environment: IOS_CHAT,
            expected: 'native',
        },
    ] as const;

    for (const { name, environment, expected } of cases) {
        test(`uses ${expected} positioning for ${name}`, () => {
            expect(getMobileComposerViewportMode(environment)).toBe(expected);
        });
    }
});

describe('isComposerObscured', () => {
    const cases = [
        {
            name: 'form ends above both viewport bottoms',
            formBottom: 500,
            visualViewportBottom: 600,
            layoutViewportBottom: 620,
            expected: false,
        },
        {
            name: 'form ends exactly at the visible bottom',
            formBottom: 600,
            visualViewportBottom: 600,
            layoutViewportBottom: 620,
            expected: false,
        },
        {
            name: 'visual viewport is the smaller boundary',
            formBottom: 601,
            visualViewportBottom: 600,
            layoutViewportBottom: 620,
            expected: true,
        },
        {
            name: 'layout viewport is the smaller stale-visual-viewport boundary',
            formBottom: 521,
            visualViewportBottom: 844,
            layoutViewportBottom: 520,
            expected: true,
        },
    ] as const;

    for (const {
        name,
        formBottom,
        visualViewportBottom,
        layoutViewportBottom,
        expected,
    } of cases) {
        test(`returns ${expected} when ${name}`, () => {
            expect(isComposerObscured(formBottom, visualViewportBottom, layoutViewportBottom)).toBe(expected);
        });
    }
});

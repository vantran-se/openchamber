import { describe, expect, test } from 'bun:test';

import {
    captureComposerAncestorScroll,
    createComposerScrollRestore,
    restoreComposerAncestorScroll,
    type ComposerScrollElement,
} from '../mobileViewportScroll';

function scrollElement(
    scrollTop: number,
    scrollLeft: number,
    parentElement: ComposerScrollElement | null = null,
): ComposerScrollElement {
    return { scrollTop, scrollLeft, parentElement };
}

describe('composer ancestor scroll restoration', () => {
    test('returns every ancestor to its position from before keyboard reveal', () => {
        const root = scrollElement(0, 0);
        const shell = scrollElement(24, 3, root);
        const slot = scrollElement(0, 0, shell);
        const form = scrollElement(0, 0, slot);
        const snapshot = captureComposerAncestorScroll(form);

        shell.scrollTop = 286;
        shell.scrollLeft = 11;
        root.scrollTop = 90;

        restoreComposerAncestorScroll(snapshot);

        expect(shell.scrollTop).toBe(24);
        expect(shell.scrollLeft).toBe(3);
        expect(root.scrollTop).toBe(0);
    });

    test('does not change the form scroll position', () => {
        const shell = scrollElement(0, 0);
        const form = scrollElement(7, 2, shell);
        const snapshot = captureComposerAncestorScroll(form);

        form.scrollTop = 18;
        restoreComposerAncestorScroll(snapshot);

        expect(form.scrollTop).toBe(18);
        expect(form.scrollLeft).toBe(2);
    });

    test('restores immediately and after keyboard settlement while blurred', () => {
        const shell = scrollElement(12, 0);
        const form = scrollElement(0, 0, shell);
        const scheduled: Array<() => void> = [];
        const restore = createComposerScrollRestore(
            captureComposerAncestorScroll(form),
            () => false,
            (callback) => {
                scheduled.push(callback);
            },
        );

        shell.scrollTop = 260;
        restore();
        expect(shell.scrollTop).toBe(12);

        shell.scrollTop = 80;
        scheduled[0]?.();
        expect(shell.scrollTop).toBe(12);
    });

    test('does not restore when the editor refocused before cleanup', () => {
        const shell = scrollElement(12, 0);
        const form = scrollElement(0, 0, shell);
        const scheduled: Array<() => void> = [];
        const restore = createComposerScrollRestore(
            captureComposerAncestorScroll(form),
            () => true,
            (callback) => {
                scheduled.push(callback);
            },
        );

        shell.scrollTop = 260;
        restore();
        expect(shell.scrollTop).toBe(260);

        scheduled[0]?.();
        expect(shell.scrollTop).toBe(260);
    });
});

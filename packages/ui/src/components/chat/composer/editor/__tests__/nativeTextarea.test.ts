import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
    composerTextEdit,
    replaceComposerText,
    textareaCaretCoords,
    shouldRenderNativeComposerTextarea,
    shouldUseNativeComposerTextarea,
} from '../nativeTextarea';

const IPAD_NAVIGATOR = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
    vendor: 'Apple Computer, Inc.',
    maxTouchPoints: 5,
};

describe('composerTextEdit', () => {
    test('reports inserted text for typing and replacement', () => {
        expect(composerTextEdit('xin', 'xin chào')).toEqual({
            value: 'xin chào',
            insertedText: ' chào',
        });
        expect(composerTextEdit('ddungs', 'đúng')).toEqual({
            value: 'đúng',
            insertedText: 'đúng',
        });
    });

    test('reports no inserted text for deletion', () => {
        expect(composerTextEdit('xin chào', 'xin')).toEqual({
            value: 'xin',
            insertedText: '',
        });
    });
});

describe('replaceComposerText', () => {
    test('replaces a range and leaves the caret after inserted text', () => {
        expect(replaceComposerText('xin chao', 4, 8, 'chào')).toEqual({
            value: 'xin chào',
            caret: 8,
        });
    });

    test('clamps ranges to the document', () => {
        expect(replaceComposerText('xin', -5, 99, 'chào')).toEqual({
            value: 'chào',
            caret: 4,
        });
    });
});

describe('textareaCaretCoords', () => {
    test('returns the caret position for a wide textarea', () => {
        const win = new Window();
        Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
        Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) });
        const textarea = document.createElement('textarea');
        textarea.value = 'hello';
        textarea.setSelectionRange(5, 5);
        textarea.getBoundingClientRect = () => new win.DOMRect(20, 100, 400, 80);
        const coords = textareaCaretCoords(textarea);
        expect(coords).not.toBeNull();
        expect(coords?.left).toBeDefined();
    });

    test('offsets the mirror by the textarea scroll position', () => {
        const win = new Window();
        Object.defineProperty(globalThis, 'document', { configurable: true, value: win.document });
        Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) });
        const textarea = document.createElement('textarea');
        textarea.value = 'hello';
        textarea.setSelectionRange(5, 5);
        textarea.scrollTop = 40;
        textarea.scrollLeft = 7;
        textarea.getBoundingClientRect = () => new win.DOMRect(20, 100, 400, 80);
        let mirrorPosition: { left: string; top: string } | null = null;
        const append = document.body.append.bind(document.body);
        document.body.append = (...nodes) => {
            const mirror = nodes[0];
            if (mirror instanceof win.HTMLElement) {
                mirrorPosition = { left: mirror.style.left, top: mirror.style.top };
            }
            append(...nodes);
        };

        textareaCaretCoords(textarea);

        expect(mirrorPosition).toEqual({ left: '13px', top: '60px' });
    });
});

describe('shouldUseNativeComposerTextarea', () => {
    test('uses the native editor on iOS and touch iPadOS', () => {
        expect(shouldUseNativeComposerTextarea({
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6) Mobile/15E148 Safari/604.1',
            vendor: 'Apple Computer, Inc.',
            maxTouchPoints: 5,
        })).toBe(true);
        expect(shouldUseNativeComposerTextarea(IPAD_NAVIGATOR)).toBe(true);
    });

    test('selects the native editor for wide iPadOS even when the layout is not mobile', () => {
        expect(shouldRenderNativeComposerTextarea(false, IPAD_NAVIGATOR)).toBe(true);
    });

    test('keeps CodeMirror on desktop and Android', () => {
        expect(shouldUseNativeComposerTextarea({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
            vendor: 'Apple Computer, Inc.',
            maxTouchPoints: 0,
        })).toBe(false);
        expect(shouldUseNativeComposerTextarea({
            userAgent: 'Mozilla/5.0 (Linux; Android 15)',
            vendor: 'Google Inc.',
            maxTouchPoints: 5,
        })).toBe(false);
    });
});

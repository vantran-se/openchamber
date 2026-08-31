import { describe, expect, test } from 'bun:test';

import {
    composerTextEdit,
    replaceComposerText,
    shouldUseNativeComposerTextarea,
} from '../nativeTextarea';

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

describe('shouldUseNativeComposerTextarea', () => {
    test('uses the native editor on iOS and touch iPadOS', () => {
        expect(shouldUseNativeComposerTextarea({
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6) Mobile/15E148 Safari/604.1',
            vendor: 'Apple Computer, Inc.',
            maxTouchPoints: 5,
        })).toBe(true);
        expect(shouldUseNativeComposerTextarea({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
            vendor: 'Apple Computer, Inc.',
            maxTouchPoints: 5,
        })).toBe(true);
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

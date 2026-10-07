import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { focusChatInput } from '../dom';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
let win: Window;

const composer = (
    column: 'main' | 'pinned',
    editor: 'codemirror' | 'textarea' = 'codemirror',
) => `
    <div data-chat-column="${column}">
        <div data-chat-input="true">
            ${editor === 'textarea'
                ? `<textarea id="${column}-editor"></textarea>`
                : `<div class="cm-content" tabindex="0" id="${column}-editor"></div>`}
        </div>
    </div>`;

beforeEach(() => {
    win = new Window({ url: 'http://localhost' });
    Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true, writable: true });
});

afterEach(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    void win.happyDOM.close();
});

test('focuses the main CodeMirror chat input', () => {
    win.document.body.innerHTML = composer('main');

    focusChatInput();

    expect(win.document.activeElement?.id).toBe('main-editor');
});

test('focuses the main native textarea chat input', () => {
    win.document.body.innerHTML = composer('main', 'textarea');

    focusChatInput();

    expect(win.document.activeElement?.id).toBe('main-editor');
});

test('skips a chat pinned in the side panel, wherever it sits in the page', () => {
    win.document.body.innerHTML = composer('pinned') + composer('main');

    focusChatInput();

    expect(win.document.activeElement?.id).toBe('main-editor');
});

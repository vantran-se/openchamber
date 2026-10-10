export interface ComposerTextEdit {
    value: string;
    insertedText: string;
}

export function composerTextEdit(previous: string, next: string): ComposerTextEdit {
    let prefix = 0;
    const prefixLimit = Math.min(previous.length, next.length);
    while (prefix < prefixLimit && previous[prefix] === next[prefix]) prefix += 1;

    let previousSuffix = previous.length;
    let nextSuffix = next.length;
    while (previousSuffix > prefix && nextSuffix > prefix && previous[previousSuffix - 1] === next[nextSuffix - 1]) {
        previousSuffix -= 1;
        nextSuffix -= 1;
    }
    return { value: next, insertedText: next.slice(prefix, nextSuffix) };
}

export interface ComposerTextReplacement { value: string; caret: number }

export interface TextareaCaretCoords {
    top: number;
    bottom: number;
    left: number;
}

/** Return the viewport coordinates of a textarea's caret, including its x position. */
export function textareaCaretCoords(textarea: HTMLTextAreaElement): TextareaCaretCoords | null {
    const rect = textarea.getBoundingClientRect();
    const ownerDocument = textarea.ownerDocument ?? document;
    const mirror = ownerDocument.createElement('div');
    const marker = ownerDocument.createElement('span');
    const style = ownerDocument.defaultView?.getComputedStyle(textarea) ?? getComputedStyle(textarea);

    mirror.style.position = 'fixed';
    mirror.style.left = `${rect.left}px`;
    mirror.style.top = `${rect.top}px`;
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.height = `${textarea.clientHeight}px`;
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    for (const property of [
        'font', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
        'padding', 'border', 'textTransform', 'wordSpacing',
    ] as const) {
        mirror.style[property] = style[property];
    }

    const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
    mirror.textContent = before;
    marker.textContent = '\u200b';
    mirror.append(marker);
    ownerDocument.body.append(mirror);
    const markerRect = marker.getBoundingClientRect();
    mirror.remove();

    return {
        top: markerRect.top,
        bottom: markerRect.bottom,
        left: markerRect.left,
    };
}

export function replaceComposerText(value: string, from: number, to: number, text: string): ComposerTextReplacement {
    const start = Math.min(Math.max(from, 0), value.length);
    const end = Math.min(Math.max(to, start), value.length);
    return { value: `${value.slice(0, start)}${text}${value.slice(end)}`, caret: start + text.length };
}

export function shouldUseNativeComposerTextarea(nav: Pick<Navigator, 'maxTouchPoints' | 'userAgent' | 'vendor'> | undefined = globalThis.navigator): boolean {
    if (!nav || !/Apple Computer/.test(nav.vendor)) return false;
    return /Mobile\/\w+/.test(nav.userAgent) || nav.maxTouchPoints > 2;
}

export function shouldRenderNativeComposerTextarea(
    _isMobile: boolean,
    nav: Pick<Navigator, 'maxTouchPoints' | 'userAgent' | 'vendor'> | undefined = globalThis.navigator,
): boolean {
    return shouldUseNativeComposerTextarea(nav);
}

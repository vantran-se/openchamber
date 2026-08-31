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
    while (
        previousSuffix > prefix
        && nextSuffix > prefix
        && previous[previousSuffix - 1] === next[nextSuffix - 1]
    ) {
        previousSuffix -= 1;
        nextSuffix -= 1;
    }

    return {
        value: next,
        insertedText: next.slice(prefix, nextSuffix),
    };
}

export interface ComposerTextReplacement {
    value: string;
    caret: number;
}

export function replaceComposerText(
    value: string,
    from: number,
    to: number,
    text: string,
): ComposerTextReplacement {
    const start = Math.min(Math.max(from, 0), value.length);
    const end = Math.min(Math.max(to, start), value.length);
    return {
        value: `${value.slice(0, start)}${text}${value.slice(end)}`,
        caret: start + text.length,
    };
}

export function shouldUseNativeComposerTextarea(nav: Pick<Navigator, 'maxTouchPoints' | 'userAgent' | 'vendor'> | undefined = globalThis.navigator): boolean {
    if (!nav || !/Apple Computer/.test(nav.vendor)) return false;
    return /Mobile\/\w+/.test(nav.userAgent) || nav.maxTouchPoints > 2;
}

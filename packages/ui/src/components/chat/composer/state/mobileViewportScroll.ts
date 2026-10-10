export interface ComposerScrollElement {
    scrollTop: number;
    scrollLeft: number;
    parentElement: ComposerScrollElement | null;
}

export interface ComposerAncestorScrollPosition {
    element: ComposerScrollElement;
    top: number;
    left: number;
}

export function captureComposerAncestorScroll(
    form: ComposerScrollElement,
): ComposerAncestorScrollPosition[] {
    const positions: ComposerAncestorScrollPosition[] = [];
    let element = form.parentElement;
    while (element) {
        positions.push({
            element,
            top: element.scrollTop,
            left: element.scrollLeft,
        });
        element = element.parentElement;
    }
    return positions;
}

export function restoreComposerAncestorScroll(
    positions: readonly ComposerAncestorScrollPosition[],
): void {
    for (const { element, top, left } of positions) {
        element.scrollTop = top;
        element.scrollLeft = left;
    }
}

export function createComposerScrollRestore(
    positions: readonly ComposerAncestorScrollPosition[],
    isEditorFocused: () => boolean,
    schedule: (callback: () => void) => void,
): () => void {
    const restoreWhileBlurred = () => {
        if (!isEditorFocused()) restoreComposerAncestorScroll(positions);
    };

    return () => {
        restoreWhileBlurred();
        schedule(restoreWhileBlurred);
    };
}

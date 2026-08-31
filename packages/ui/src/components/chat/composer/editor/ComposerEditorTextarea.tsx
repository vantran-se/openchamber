import React from 'react';

import { cn } from '@/lib/utils';
import type { ComposerEditorHandle, ComposerEditorProps, ComposerSelection } from './ComposerEditor';
import { composerTextEdit, replaceComposerText } from './nativeTextarea';

function readSelection(textarea: HTMLTextAreaElement | null): ComposerSelection {
    return textarea
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : { start: 0, end: 0 };
}

function setSelection(textarea: HTMLTextAreaElement, start: number, end = start): ComposerSelection {
    const clampedStart = Math.min(Math.max(start, 0), textarea.value.length);
    const clampedEnd = Math.min(Math.max(end, 0), textarea.value.length);
    const selection = {
        start: Math.min(clampedStart, clampedEnd),
        end: Math.max(clampedStart, clampedEnd),
    };
    textarea.setSelectionRange(selection.start, selection.end);
    return selection;
}

export const ComposerEditorTextarea = React.forwardRef<ComposerEditorHandle, ComposerEditorProps>(
    function ComposerEditorTextarea(props, ref) {
        const {
            value,
            onChange,
            onSelectionChange,
            onKeyDown,
            onFocus,
            onBlur,
            onPaste,
            placeholder,
            editable = true,
            spellCheck = false,
            autoCorrect = 'off',
            autoCapitalize = 'none',
            fillContainer = false,
            maxLines = 8,
            boundSelector,
            boundGapPx = 0,
            className,
            contentClassName,
        } = props;
        const hostRef = React.useRef<HTMLDivElement | null>(null);
        const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
        const valueRef = React.useRef(value);
        const valueChangedExternally = value !== valueRef.current;
        valueRef.current = value;

        const reportChange = React.useCallback((nextValue: string, selection: ComposerSelection, fromPaste: boolean) => {
            const edit = composerTextEdit(valueRef.current, nextValue);
            valueRef.current = nextValue;
            onChange({ ...edit, selection, fromPaste });
        }, [onChange]);

        const applyEdit = React.useCallback((
            from: number,
            to: number,
            text: string,
            selectionStart?: number,
            selectionEnd = selectionStart,
        ) => {
            const textarea = textareaRef.current;
            if (!textarea) return;
            const edit = replaceComposerText(textarea.value, from, to, text);
            const start = selectionStart ?? edit.caret;
            const end = selectionEnd ?? start;

            // Keep the DOM authoritative until React commits the controlled
            // value. Consecutive imperative edits in one event must build on
            // each other rather than reading the previous render's value.
            textarea.value = edit.value;
            const selection = setSelection(textarea, start, end);
            reportChange(edit.value, selection, false);
        }, [reportChange]);

        React.useLayoutEffect(() => {
            const textarea = textareaRef.current;
            if (!textarea || !valueChangedExternally || textarea.value !== value) return;
            const selection = setSelection(textarea, value.length);
            onSelectionChange?.(selection);
        }, [onSelectionChange, value, valueChangedExternally]);

        React.useLayoutEffect(() => {
            const textarea = textareaRef.current;
            const host = hostRef.current;
            if (!textarea || !host) return;
            if (fillContainer) {
                textarea.style.height = '100%';
                textarea.style.maxHeight = '';
                return;
            }

            const bound = boundSelector ? host.closest<HTMLElement>(boundSelector) : null;
            let branch: HTMLElement | null = null;
            if (bound) {
                branch = host;
                while (branch.parentElement && branch.parentElement !== bound) {
                    branch = branch.parentElement;
                }
            }

            const resize = () => {
                const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight || '');
                if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
                let cap = lineHeight * maxLines;
                if (bound && branch) {
                    const chrome = branch.offsetHeight - textarea.offsetHeight;
                    const available = bound.clientHeight - chrome - boundGapPx;
                    if (available > 0) cap = Math.min(cap, available);
                }
                textarea.style.height = '0';
                textarea.style.maxHeight = `${cap}px`;
                textarea.style.height = `${Math.min(textarea.scrollHeight, cap)}px`;
                textarea.style.overflowY = textarea.scrollHeight > cap ? 'auto' : 'hidden';
            };

            resize();
            if (!globalThis.ResizeObserver) return;
            const observer = new ResizeObserver(resize);
            observer.observe(host);
            if (branch) observer.observe(branch);
            if (bound) observer.observe(bound);
            return () => observer.disconnect();
        }, [boundGapPx, boundSelector, fillContainer, maxLines, value]);

        React.useImperativeHandle(ref, (): ComposerEditorHandle => ({
            focus(options) {
                textareaRef.current?.focus({ preventScroll: options?.preventScroll });
            },
            blur() {
                textareaRef.current?.blur();
            },
            isFocused() {
                return document.activeElement === textareaRef.current;
            },
            getValue() {
                return textareaRef.current?.value ?? '';
            },
            getSelection() {
                return readSelection(textareaRef.current);
            },
            setSelection(start, end = start) {
                const textarea = textareaRef.current;
                if (!textarea) return;
                const selection = setSelection(textarea, start, end);
                onSelectionChange?.(selection);
            },
            selectAll() {
                textareaRef.current?.select();
            },
            insertText(text) {
                const textarea = textareaRef.current;
                if (!textarea || !text) return;
                applyEdit(textarea.selectionStart, textarea.selectionEnd, text);
            },
            replaceRange(from, to, text, selectionStart, selectionEnd) {
                applyEdit(from, to, text, selectionStart, selectionEnd);
            },
            caretCoords() {
                return null;
            },
            getScrollDOM() {
                return textareaRef.current;
            },
        }), [applyEdit, onSelectionChange]);

        return (
            <div
                ref={hostRef}
                data-chat-input="true"
                className={cn(
                    'composer-editor w-full',
                    fillContainer && 'flex min-h-0 flex-1 flex-col',
                    className,
                )}
            >
                <textarea
                    ref={textareaRef}
                    data-testid={props['data-testid']}
                    value={value}
                    readOnly={!editable}
                    placeholder={placeholder}
                    spellCheck={spellCheck}
                    autoCorrect={autoCorrect}
                    autoCapitalize={autoCapitalize}
                    aria-label={props['aria-label']}
                    onChange={(event) => {
                        const nativeEvent = event.nativeEvent;
                        const fromPaste = nativeEvent instanceof InputEvent
                            && nativeEvent.inputType === 'insertFromPaste';
                        reportChange(event.currentTarget.value, readSelection(event.currentTarget), fromPaste);
                    }}
                    onSelect={(event) => onSelectionChange?.(readSelection(event.currentTarget))}
                    onKeyDown={(event) => {
                        if (onKeyDown?.(event.nativeEvent)) event.preventDefault();
                    }}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onPaste={(event) => onPaste?.(event.nativeEvent)}
                    className={cn(
                        'block min-h-full w-full resize-none overflow-x-hidden bg-transparent p-0 pl-px font-[inherit] text-[inherit] leading-[inherit] text-foreground outline-none placeholder:text-muted-foreground',
                        fillContainer && 'flex-1',
                        contentClassName,
                    )}
                />
            </div>
        );
    },
);

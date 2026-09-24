const CHAT_INPUT_EDITOR_SELECTOR = '[data-chat-input="true"] .cm-content, [data-chat-input="true"] textarea';

export function focusChatInput(): void {
    document.querySelector<HTMLElement>(CHAT_INPUT_EDITOR_SELECTOR)?.focus();
}

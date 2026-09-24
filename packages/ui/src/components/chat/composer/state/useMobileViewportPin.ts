/**
 * Pinning the composer to the visual viewport in mobile browsers.
 *
 * Capacitor has a keyboard choreography that resizes the shell, so the
 * composer stays where it belongs on its own. A mobile browser has nothing of
 * the sort: Safari pans the visual viewport over an unchanged layout instead
 * of shrinking it, so a composer positioned in normal flow ends up partly
 * off-screen or behind the keyboard. Both effects here exist to put it back,
 * and both are deliberately restricted to non-Capacitor mobile.
 *
 * Neither is verifiable from a test: they are corrections for specific WebKit
 * behaviors, and every guard in them marks a case that was observed breaking.
 */

import React from 'react';

import { isCapacitorApp } from '@/lib/platform';
import type { ComposerEditorHandle } from '../editor/ComposerEditor';
import { getMobileComposerViewportMode, isComposerObscured } from './mobileViewportPolicy';

// Android mobile browsers are the pan-mode holdouts this pin exists for on
// the CHAT screen too: interactive-widget=resizes-content is ignored by a
// fair share of Android WebView/Chrome builds, and unlike iOS Safari they do
// not reliably reveal the focused field either — the composer just stays
// behind the keyboard. iOS keeps its browser-native reveal on the chat
// screen in Safari, but standalone mode loses it after keyboard transitions.
// Callers are browser-only React effects, so navigator always exists here.
const isAndroidBrowser = (): boolean => /Android/i.test(navigator.userAgent);

const isStandaloneBrowser = (): boolean =>
    window.matchMedia?.('(display-mode: standalone)')?.matches === true;

export interface MobileViewportPinOptions {
    isMobile: boolean;
    /** Composer expanded to fullscreen on mobile. */
    isFullscreen: boolean;
    /** The new-session draft screen is showing. */
    isDraftScreen: boolean;
    /** The composer has focus, i.e. the keyboard is up. */
    isFocused: boolean;
    formRef: React.RefObject<HTMLFormElement | null>;
    editorRef: React.RefObject<ComposerEditorHandle | null>;
}

/** Clear every style the pin writes, returning the form to normal flow. */
function releaseForm(form: HTMLFormElement): void {
    form.style.position = '';
    form.style.left = '';
    form.style.right = '';
    form.style.width = '';
    form.style.top = '';
    form.style.height = '';
    form.style.zIndex = '';
    form.style.background = '';
}

export function useMobileViewportPin(options: MobileViewportPinOptions): void {
    const { isMobile, isFullscreen, isDraftScreen, isFocused, formRef, editorRef } = options;

    // Fullscreen: fix the form over the whole visible viewport and track the pan.
    React.useLayoutEffect(() => {
        if (!isMobile || !isFullscreen || isCapacitorApp()) return;
        const vv = window.visualViewport;
        const form = formRef.current;
        const editor = editorRef.current;
        if (!vv || !form) return;

        // The form is trapped inside lower stacking contexts (the composer
        // wrapper's z-10), so it cannot out-stack the app header with z-index
        // alone — hide the header for the duration via a root class instead.
        document.documentElement.classList.add('oc-browser-kb-fullscreen');

        const apply = () => {
            const top = Math.max(0, Math.floor(vv.offsetTop));
            // Stale-visualViewport guard: when the layout viewport is
            // keyboard-resized (interactive-widget), its clientHeight is the
            // authoritative above-keyboard height.
            const layoutHeight = document.documentElement.clientHeight;
            form.style.position = 'fixed';
            form.style.left = '0';
            form.style.right = '0';
            form.style.top = `${top}px`;
            form.style.height = `${Math.floor(Math.min(vv.height, layoutHeight - top))}px`;
            form.style.zIndex = '40';
            form.style.background = 'var(--background)';
        };

        apply();
        vv.addEventListener('resize', apply);
        vv.addEventListener('scroll', apply);
        window.addEventListener('resize', apply);
        window.addEventListener('scroll', apply, true);

        return () => {
            vv.removeEventListener('resize', apply);
            vv.removeEventListener('scroll', apply);
            window.removeEventListener('resize', apply);
            window.removeEventListener('scroll', apply, true);
            document.documentElement.classList.remove('oc-browser-kb-fullscreen');
            releaseForm(form);
            // Back in flow: the browser panned for the fullscreen session and
            // will not re-reveal the still-focused field on its own, which left
            // the composer parked behind the keyboard.
            requestAnimationFrame(() => {
                if (editor?.isFocused()) {
                    editor.getScrollDOM()?.scrollIntoView({ block: 'nearest' });
                }
            });
        };
    }, [editorRef, formRef, isFullscreen, isMobile]);

    // Keyboard up: draft screens and Android chat need fixed pinning. iOS
    // standalone chat must remain in flow: WebKit can draw the textarea's
    // native text and hit-test layers at its pre-fixed coordinates, splitting
    // the visible editor from typing and making the send button miss taps.
    React.useLayoutEffect(() => {
        if (!isMobile || isCapacitorApp()) return;
        if (isFullscreen || !isFocused) return;
        const vv = window.visualViewport;
        const form = formRef.current;
        if (!vv || !form) return;

        const mode = getMobileComposerViewportMode({
            isDraftScreen,
            isAndroidBrowser: isAndroidBrowser(),
            isStandaloneBrowser: isStandaloneBrowser(),
        });
        if (mode === 'native') return;

        if (mode === 'reveal-if-obscured') {
            const reveal = () => {
                const formBottom = form.getBoundingClientRect().bottom;
                const visualViewportBottom = vv.offsetTop + vv.height;
                const layoutViewportBottom = document.documentElement.clientHeight;
                if (isComposerObscured(formBottom, visualViewportBottom, layoutViewportBottom)) {
                    form.scrollIntoView({ block: 'end' });
                }
            };

            reveal();
            vv.addEventListener('resize', reveal);
            vv.addEventListener('scroll', reveal);
            window.addEventListener('resize', reveal);
            window.addEventListener('scroll', reveal, true);
            return () => {
                vv.removeEventListener('resize', reveal);
                vv.removeEventListener('scroll', reveal);
                window.removeEventListener('resize', reveal);
                window.removeEventListener('scroll', reveal, true);
            };
        }

        // Keep the in-flow horizontal geometry (page paddings) while fixed.
        const rect = form.getBoundingClientRect();
        form.style.position = 'fixed';
        form.style.left = `${Math.floor(rect.left)}px`;
        form.style.width = `${Math.floor(rect.width)}px`;
        form.style.zIndex = '40';
        form.style.background = 'var(--background)';

        // Safari's visualViewport events are unreliable mid keyboard pan (they
        // can simply not fire), so track the pan with a rAF loop instead —
        // cheap math per frame, a style write only when the value changes.
        let lastTop = Number.NaN;
        let frame = 0;
        const track = () => {
            const layoutBottom = document.documentElement.clientHeight;
            const vvBottom = vv.offsetTop + vv.height;
            const top = Math.max(0, Math.floor(Math.min(vvBottom, layoutBottom) - form.offsetHeight));
            if (top !== lastTop) {
                lastTop = top;
                form.style.top = `${top}px`;
            }
            frame = requestAnimationFrame(track);
        };
        track();

        return () => {
            cancelAnimationFrame(frame);
            releaseForm(form);
        };
    }, [formRef, isDraftScreen, isFocused, isFullscreen, isMobile]);
}

// useKeyboardInset — single source of truth for keyboard avoidance.
//
// Replaces the 8 hand-rolled copies of the "listen to keyboard events →
// setState(height) → apply as paddingBottom" pattern that had drifted
// across the app. Encapsulates the ONE thing that has to be platform-
// and surface-aware on Expo SDK 54 with edgeToEdgeEnabled:
//
//   iOS — the RN view never resizes for the keyboard, so a manual lift
//     (paddingBottom = keyboard height) is the only mechanism. iOS emits
//     keyboardWillShow/Hide, so the lift animates in on the same frame
//     the keyboard starts rising — no perceptible lag.
//
//   Android — with edgeToEdgeEnabled:true (Expo SDK 54 / Android 15), the
//     activity's softwareKeyboardLayoutMode:'resize' (adjustResize) is
//     INEFFECTIVE: an edge-to-edge window is NOT auto-resized for the IME —
//     the keyboard draws OVER the content, and the app must inset itself. So
//     Android needs the SAME manual lift as iOS. (A previous version returned
//     0 here, trusting adjustResize to lift the dock; that left the main-chat
//     input covered by the keyboard on Samsung One UI / Android 15 — the bug
//     this fixes. Android emits only keyboardDidShow, so the lift lands a frame
//     after the keyboard is up — a tiny, acceptable lag.)
//
//   RN <Modal> — a Modal is a separate window that never inherited the
//     activity's adjustResize anyway, so it was always lifted manually and is
//     unaffected by this. { insideModal: true } is retained for back-compat
//     but no longer changes the decision.
//
// History (why this keeps getting "fixed"): v1 used softwareKeyboardLayoutMode
// 'pan' + manual padding (double-shift / covered on One UI); v2 used 'resize'
// + NO manual padding on Android (covered — adjustResize is a no-op under
// edge-to-edge). BOTH relied on the OS. This version does not: it lifts
// manually on every native surface — exactly what already works in <Modal>s.
//
// onShow — optional callback fired on every keyboard-show, on ALL
// platforms (even where the inset stays 0), for side effects like
// scroll-to-end in a chat thread.

import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardInset(opts?: {
  insideModal?: boolean;
  onShow?: () => void;
}): number {
  const insideModal = !!opts?.insideModal;
  const onShow = opts?.onShow;
  const [inset, setInset] = useState(0);

  // Hold the latest onShow without forcing the listener effect to
  // re-subscribe on every render (callers usually pass an inline fn).
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;

  useEffect(() => {
    // Lift manually on every native surface (iOS + Android). We do NOT rely
    // on the Android activity's adjustResize: under edgeToEdgeEnabled the
    // window is not auto-resized for the IME, so a non-modal Android screen
    // gets no lift unless we provide it — the same mechanism iOS and RN
    // <Modal>s already use. (insideModal is kept for API back-compat; it no
    // longer affects this decision.)
    const padThisSurface = Platform.OS !== 'web';

    // Web never lifts and has no onShow side effects worth wiring.
    if (!padThisSurface && !onShowRef.current) return;

    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      if (padThisSurface) setInset(e.endCoordinates?.height ?? 0);
      onShowRef.current?.();
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      if (padThisSurface) setInset(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insideModal]);

  return inset;
}

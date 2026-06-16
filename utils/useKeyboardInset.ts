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
//   Android, normal screens — the activity is set to
//     softwareKeyboardLayoutMode:'resize' (app.config.js). With edge-to-
//     edge that makes the OS shrink the window to the area above the IME,
//     so a bottom-docked input ALREADY clears the keyboard. Adding manual
//     padding on top of that double-shifts the input (floats it above the
//     keyboard with a gap, or — depending on measure timing — leaves it
//     hidden). So on Android we return 0 and let the OS resize do the work.
//
//   Android, inside an RN <Modal> — a Modal is a separate window that does
//     NOT inherit the activity's adjustResize, so the OS does not shrink
//     it and the keyboard covers the modal's input. There we DO need the
//     manual lift, same as iOS. Pass { insideModal: true }.
//
// The prior approach used softwareKeyboardLayoutMode:'pan' + manual
// padding everywhere. 'pan' + edge-to-edge does not deliver a reliable IME
// inset on all OEM keyboards (worked on the AOSP emulator, left the input
// covered on Samsung One UI) — which is the bug this replaces.
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
    // Whether THIS surface lifts manually: iOS always; Android only
    // inside a Modal (the activity-level resize doesn't reach Modals).
    const padThisSurface = Platform.OS === 'ios' || insideModal;

    // Nothing to do on an Android normal screen with no onShow side
    // effect — the OS resize handles the lift, so we skip the listeners.
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

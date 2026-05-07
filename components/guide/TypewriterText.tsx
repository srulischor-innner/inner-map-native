// Typewriter text — types `text` in character-by-character at ~35ms
// per character with a blinking cursor while typing, fading the cursor
// out once the full string lands.
//
// Used by the Guide tab's Welcome section on the user's first encounter
// (gated by an AsyncStorage `hasSeenWelcome` flag). After the flag is
// set the parent renders body copy as a plain <Text> instead, skipping
// this component entirely — there's no "instant" mode here on purpose,
// because the parent owns that decision.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TextStyle } from 'react-native';

const CHAR_INTERVAL_MS = 35;
const CURSOR_FADE_MS = 400;
const CURSOR_BLINK_MS = 420;

export function TypewriterText({
  text,
  style,
  startDelayMs = 0,
  onDone,
}: {
  text: string;
  style?: TextStyle | TextStyle[];
  /** Optional delay before the first character is revealed. Useful for
   *  staggering multiple paragraphs so the first line lands cleanly
   *  before the second begins. */
  startDelayMs?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  // Type characters in. Cancellable via the cancelled flag so a parent
  // unmount or text-prop change never leaves a runaway interval.
  useEffect(() => {
    let cancelled = false;
    let i = 0;
    setShown('');
    setDone(false);

    const tick = () => {
      if (cancelled) return;
      i += 1;
      setShown(text.slice(0, i));
      if (i < text.length) {
        timer = setTimeout(tick, CHAR_INTERVAL_MS);
      } else {
        setDone(true);
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: CURSOR_FADE_MS,
          useNativeDriver: true,
        }).start();
        onDone?.();
      }
    };

    console.log(`[typewriter] starting — len=${text.length} startDelayMs=${startDelayMs} preview="${text.slice(0, 32)}${text.length > 32 ? '…' : ''}"`);
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, startDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // text and startDelayMs only — onDone deliberately excluded so a
    // parent re-rendering with a new closure doesn't re-trigger typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, startDelayMs]);

  // Blinking cursor loop while typing. Stops once `done` flips and the
  // fade-out animation above takes over the opacity.
  useEffect(() => {
    if (done) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: CURSOR_BLINK_MS,
          useNativeDriver: true,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: CURSOR_BLINK_MS,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [done, cursorOpacity]);

  return (
    <Text style={style}>
      {shown}
      <Animated.Text style={[style, styles.cursor, { opacity: cursorOpacity }]}>
        ▍
      </Animated.Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  cursor: {
    // Slightly tighter than the body letter-spacing so the bar sits
    // close to the last character. The font-family is inherited from
    // the passed-in style so the cursor matches the body type.
    letterSpacing: -1,
  },
});

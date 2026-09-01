// Map tab — the inner map visualization. Pulls the current map state from the
// Railway backend on mount, measures the canvas area with onLayout, and hands
// geometry + tap handler to InnerMapCanvas. Tapping a node opens a bottom-sheet
// folder. Map conversation (mic, OpenAI Realtime) lands in a later step.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Easing, PanResponder, Modal, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

import { colors, fonts } from '../../constants/theme';
import { api } from '../../services/api';
import { computeMapGeometry, MapGeometry } from '../../utils/mapLayout';
import { InnerMapCanvas, NodeKey } from '../../components/map/InnerMapCanvas';
import { ReadingElement } from '../../components/map/ReadingElement';
import { ReadingModal } from '../../components/map/ReadingModal';
import { PartFolderModal } from '../../components/map/PartFolderModal';
import { MapVoiceBar } from '../../components/map/MapVoiceBar';
import { ProgressStrip } from '../../components/map/ProgressStrip';
import { CircleMapCanvas, IntegrationKey } from '../../components/map/CircleMapCanvas';
import { IntegrationPanel } from '../../components/map/IntegrationPanel';
import { subscribeMapActivation } from '../../utils/mapActivation';
import { subscribeBeliefChanged } from '../../utils/beliefEvents';
import { markMapSeen, refreshMapSeenStatus } from '../../services/mapSeen';

const INTEGRATION_VIEW_SEEN_KEY = 'integration_view_seen';
const SECOND_LAYER_INTRODUCED_KEY = 'second_layer_introduced';
const CIRCLE_VIEW_INTRO_SEEN_KEY = 'circle_view_intro_seen';
const MAP_INTRO_SEEN_KEY = 'map_intro_seen';

// A "layer" is one wound + its surrounding fixer/skeptic/compromise/objective
// /alternative-story content. The map tab renders one layer at a time. When
// the user has more than one mapped wound, dot indicators + a horizontal
// swipe let them traverse layers. Default users (one wound) see exactly the
// same UI as before — no dots, no swipe affordance.
type MapLayer = {
  layerId: string;
  layerIndex: number;
  woundBelief: string;
  fixerSummary: string;
  skepticSummary: string;
  usualZoneLean: string;
  objectiveStory: string;
  alternativeStory: string;
};

export default function MapScreen() {
  // THE READING (cycle 3). The element owns its own gating and polling; the
  // screen only holds the opened document. Both render nothing at all when
  // the server has no /api/reading, so an old server is silent, not broken.
  const [readingOpen, setReadingOpen] = useState(false);
  const [readingBody, setReadingBody] = useState<string | null>(null);
  const [readingAt, setReadingAt] = useState<string | undefined>(undefined);
  // Mark the user's map as seen every time this tab gains focus.
  // services/mapSeen.ts handles the optimistic broadcast + the
  // mark-seen POST + the confirmation refresh; the dot in the top
  // tab bar clears the moment the focus event fires, before the
  // network round-trip completes.
  // "Changed since last visit" baseline. We snapshot mapLastViewedAt BEFORE
  // markMapSeen advances it to now — otherwise the per-node markers would
  // self-clear on entry before they ever render. Re-read each focus so the
  // baseline steps forward to the previous visit's mark. null → first-ever
  // visit (changedNodes lights every populated node; see below).
  const [seenBaselineAt, setSeenBaselineAt] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      refreshMapSeenStatus()
        .then((st) => { if (active) setSeenBaselineAt(st?.lastSeenMapAt ?? null); })
        .catch(() => {})
        .finally(() => {
          markMapSeen().catch((e) =>
            console.warn('[map] markMapSeen on focus threw:', (e as Error)?.message),
          );
        });
      return () => { active = false; };
    }, []),
  );

  // The root SafeAreaView opts out of insets entirely (edges={[]}) so the
  // background paints edge-to-edge. The terminal in-flow child — the
  // ProgressStrip — has to clear the Android nav bar on its own.
  const insets = useSafeAreaInsets();

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [mapData, setMapData] = useState<any | null>(null);
  const [activePart, setActivePart] = useState<NodeKey | null>(null);
  // Specific part label that came in with the activation — only set for
  // manager / firefighter (e.g. "perfectionist", "image-manager"). For
  // the triangle nodes there's only one of each so this stays null.
  // Cleared alongside activePart so the canvas reverts to its idle
  // labels after the same 8s the ring stays inflated.
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [folderPart, setFolderPart] = useState<NodeKey | null>(null);
  // Part ids opened during THIS session. The visit stamp is fire-and-forget
  // and `parts` is not refetched when a folder closes, so without this the
  // dot would stay lit until the next app launch. Deliberately NOT written
  // into `parts`: while you are standing in a folder, its LAST OPENED line
  // should still show the PREVIOUS visit. "Just now" is not information.
  const [visitedThisSession, setVisitedThisSession] = useState<Set<string>>(new Set());
  const sessionIdRef = useRef<string>(uuidv4());

  // Wound layers — array from /api/latest-map. Index 0 is the primary
  // (original) wound; subsequent indices are secondary wounds the AI has
  // explicitly identified. The array is empty until the first map exists.
  const [layers, setLayers] = useState<MapLayer[]>([]);

  // First-session completion state — drives the Map-tab empty-state
  // CTA. When the user has nothing mapped yet AND firstSessionCompletedAt
  // is null, the empty state shows a "Start building" button that
  // navigates back to the Chat tab. If they've already finished their
  // first session and the map is somehow still empty (edge case), we
  // show the explainer without the CTA. undefined while the
  // /api/first-session-status poll is in flight — treated like "no
  // CTA yet" so we don't briefly flash the button for returning users.
  const [firstSessionDoneAt, setFirstSessionDoneAt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api.getFirstSessionStatus()
      .then(({ completedAt }) => { if (!cancelled) setFirstSessionDoneAt(completedAt); })
      .catch(() => { if (!cancelled) setFirstSessionDoneAt(null); });
    return () => { cancelled = true; };
  }, []);
  const [currentLayerIndex, setCurrentLayerIndex] = useState<number>(0);

  // Wipe activePart + activeLabel after ~8 s so the breathing node
  // doesn't stay inflated forever and the specific name doesn't linger
  // past when the chat-side detection actually meant something.
  useEffect(() => {
    if (!activePart) return;
    const t = setTimeout(() => {
      setActivePart(null);
      setActiveLabel(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [activePart]);

  // Subscribe to chat-tab activations — when the AI detects a part during
  // conversation (CHAT_META fires), activatePartOnMap is called from the
  // chat tab and the Map's activePart gets set, which springs the matching
  // node + lights up the connection lines + emits a ripple. Lets the map
  // respond to what's happening in the chat, not just to user taps.
  //
  // For manager/firefighter activations the chat also passes the SPECIFIC
  // part label ("perfectionist" etc.) so we can show it inside the
  // corresponding circle. Other categories ignore the label.
  useEffect(() => {
    const unsub = subscribeMapActivation((part, label) => {
      const known: Record<string, NodeKey> = {
        wound: 'wound', fixer: 'fixer', skeptic: 'skeptic', self: 'self',
        'self-like': 'self-like', manager: 'manager', firefighter: 'firefighter',
      };
      const key = known[part];
      if (!key) return;
      setActivePart(key);
      // Only manager/firefighter circles benefit from the specific
      // label — the others have a single canonical name already.
      if (key === 'manager' || key === 'firefighter') {
        setActiveLabel(label || null);
      } else {
        setActiveLabel(null);
      }
    });
    return unsub;
  }, []);

  // Fetch the latest map + parts on mount. Swallow errors — empty still renders.
  // The DB columns + API fields keep their legacy "...Score" suffix to avoid a
  // destructive rename, but every user-facing string says "reading" instead.
  const [outsideInScore, setOutsideInScore] = useState<number | null>(null);
  const [fragmentedScore, setFragmentedScore] = useState<number | null>(null);
  const [blendedSelfLedScore, setBlendedSelfLedScore] = useState<number | null>(null);
  // Per-spectrum provenance from /api/latest-map. The ProgressStrip shows a
  // reading's dot only when its flag is true (a real SPECTRUM_UPDATE earned
  // it) — otherwise an honest "still getting to know you" state.
  const [spectrumEarned, setSpectrumEarned] = useState<{ outsideIn?: boolean; fragmented?: boolean; blendedSelfLed?: boolean } | null>(null);
  const [parts, setParts] = useState<any[]>([]);
  // clinicalPatterns (outsideInKeywords / insideOutKeywords / blendedKeywords /
  // selfLedKeywords / ...) powers the "what the spectrum is picking up" lists
  // in the detail panel. Pulled from /api/journey lazily on mount.
  const [clinicalPatterns, setClinicalPatterns] = useState<any>(null);
  // 'idle' = first fetch in flight; 'loaded' = response received (success
  // or null); 'error' = network/transport failure (catch block hit).
  const [loadStatus, setLoadStatus] = useState<'idle' | 'loaded' | 'error'>('idle');
  const router = useRouter();
  const loadMap = useCallback(async () => {
    try {
      const [res, ps, journey] = await Promise.all([
        api.getLatestMap(),
        api.getParts(),
        api.getJourney(),
      ]);
      const md = res?.mapData || res || {};
      setMapData(md);
      if (res?.detectedManagers) md.detectedManagers = res.detectedManagers;
      if (res?.detectedFirefighters) md.detectedFirefighters = res.detectedFirefighters;
      if (typeof res?.outsideInScore === 'number') setOutsideInScore(res.outsideInScore);
      if (typeof res?.fragmentedScore === 'number') setFragmentedScore(res.fragmentedScore);
      if (typeof res?.blendedSelfLedScore === 'number') setBlendedSelfLedScore(res.blendedSelfLedScore);
      if (res?.spectrumEarned && typeof res.spectrumEarned === 'object') setSpectrumEarned(res.spectrumEarned);
      setParts(ps);
      if (journey?.clinicalPatterns) setClinicalPatterns(journey.clinicalPatterns);
      // TEMP DEBUG — print the raw layers payload so Metro logs make it
      // obvious whether the second wound is reaching the client at all.
      // Pair with the [latest-map] line on Railway. Delete once the
      // regression is closed.
      console.log(
        '[map] received res.layers=',
        Array.isArray(res?.layers) ? `[${res.layers.length}]` : `(not-array: ${typeof res?.layers})`,
        Array.isArray(res?.layers)
          ? res.layers.map((L: any, i: number) => `${i}:${(L?.woundBelief || '').slice(0, 40)}`).join(' | ')
          : '',
      );
      // Layers — use the server-provided array if present. Cap at 5 (also
      // capped server-side; defensive double-check). Default behavior (one
      // wound) means layers has length 0 or 1 → no dots, no swipe gesture.
      if (Array.isArray(res?.layers) && res.layers.length > 0) {
        setLayers(res.layers.slice(0, 5));
      } else {
        console.log('[map] layers payload empty or missing — keeping previous state');
      }
      setLoadStatus('loaded');
    } catch (e) {
      console.warn('[map] load failed:', (e as Error)?.message);
      setLoadStatus('error');
    }
  }, []);
  useEffect(() => { loadMap(); }, [loadMap]);

  // Per-node "changed since you last opened it" marker. Still category-level
  // (the map has 7 nodes, not one per part), but the COMPARISON is per part
  // and both sides of it are now real (founder ruling 2026-08-25):
  //
  //   lastChangedAt  — derived server-side: the newest write stamp across the
  //                    part's own fields. An actual change to the content.
  //   lastVisitedAt  — when the PERSON opened that part. Written only by
  //                    POST /api/parts/visited.
  //
  // It used to compare lastDetected — which advances whenever the MODEL
  // mentions a part — against one map-wide "last viewed" stamp. So the dot
  // fired for a part being talked about rather than changed, and it fired on
  // parts the person had opened minutes earlier. Neither is what it claims.
  //
  // FIRST-VISIT RULE. A part that has never been opened does not light merely
  // for existing: the old code lit EVERY populated node on a first look,
  // which is a map full of dots asserting a change since a visit that never
  // happened. A never-opened part lights only when it APPEARED since the last
  // time the person looked at the map at all — the one case where the dot is
  // saying something both true and new. On the first-ever map view there is
  // no baseline, and nothing lights.
  //
  // Self is excluded by KEYS — it never carries map changes.
  const changedNodes = useMemo(() => {
    const set = new Set<NodeKey>();
    const KEYS: NodeKey[] = ['wound', 'fixer', 'skeptic', 'self-like', 'manager', 'firefighter'];
    const baseline = seenBaselineAt ? Date.parse(seenBaselineAt) : NaN;
    for (const p of parts) {
      const cat = String(p?.category || '').toLowerCase().trim() as NodeKey;
      if (!KEYS.includes(cat)) continue;
      if (visitedThisSession.has(String(p?.id || ''))) continue;
      const visited = Date.parse(p?.lastVisitedAt || '');
      if (Number.isFinite(visited)) {
        const changed = Date.parse(p?.lastChangedAt || '');
        if (Number.isFinite(changed) && changed > visited) set.add(cat);
        continue;
      }
      // Never opened — new-since-your-last-look only.
      const appeared = Date.parse(p?.firstDetected || '');
      if (Number.isFinite(baseline) && Number.isFinite(appeared) && appeared > baseline) set.add(cat);
    }
    return set;
  }, [parts, seenBaselineAt, visitedThisSession]);


  // The mapData passed to the canvas + folder reflects whichever layer is
  // currently active. We splice the layer's wound/fixer/skeptic/compromise
  // text into a copy of the base mapData so all downstream components keep
  // working without changes. Layer 0 is identical to the legacy single-map
  // view, so default users see no behavioral change.
  const activeMapData = useMemo(() => {
    if (!mapData) return mapData;
    const layer = layers[currentLayerIndex];
    if (!layer) return mapData;
    return {
      ...mapData,
      wound: layer.woundBelief || mapData.wound,
      fixer: layer.fixerSummary || mapData.fixer,
      skeptic: layer.skepticSummary || mapData.skeptic,
      compromise: layer.usualZoneLean || mapData.compromise,
      objectiveStory: layer.objectiveStory || mapData.objectiveStory,
      alternativeStory: layer.alternativeStory || mapData.alternativeStory,
    };
  }, [mapData, layers, currentLayerIndex]);

  // Re-fetch parts when the belief changes while this tab stays mounted. Two
  // paths emit on the belief bus after their server write lands: the Self-like
  // folder's editor (save AND clear) and the SAVE_BELIEF marker in the chat
  // flow (Map tab never re-mounts on a tab switch).
  //
  // The belief no longer renders on this screen — the front band was removed
  // 2026-08-27 and "what you stand on" lives in the Self-like folder now. This
  // stays because the FIRST save can CREATE the canonical self-like row, and
  // without a re-fetch the diamond that leads to the folder would not appear
  // until the tab re-mounted.
  useEffect(
    () =>
      subscribeBeliefChanged(() => {
        api.getParts()
          .then(setParts)
          .catch((e) => console.warn('[map] belief refetch failed:', (e as Error)?.message));
      }),
    [],
  );

  // ===== MIC-ROW CLEARANCE (measured, cross-platform) =====
  // The MapVoiceBar mics are absolutely positioned over the canvas, so on
  // taller-aspect devices (Samsung 20:9 etc.) the bottom orbs (Fixer /
  // Skeptic at 0.78h, Self-like diamond at 0.86h) rendered UNDER the mic
  // stack. Fix: measure both surfaces in WINDOW coordinates — the canvas
  // wrap's top (canvasTopW) and the mic bar's top (micBarTopW, reported by
  // MapVoiceBar via onBarTop) — and hand computeMapGeometry a reduced
  // height that stops above the mics. Every node position is proportional
  // to geometry height, so the WHOLE triangle scales up into the clear
  // region rather than just squeezing the bottom row. No device special-
  // casing: window measurement inherently accounts for safe-area insets,
  // tab-bar heights, and any future layout shifts around the canvas.
  const [canvasTopW, setCanvasTopW] = useState<number | null>(null);
  const [micBarTopW, setMicBarTopW] = useState<number | null>(null);
  const canvasWrapRef = useRef<View>(null);
  const MIC_CLEARANCE = 12; // breathing gap between diamond and mic stack
  // THE READING STRIP TAKES ITS OWN HEIGHT OUT OF THE MAP.
  //
  // Phone round two: "THE WHOLE PICTURE" overlapped the YOU diamond and made the
  // diamond's own label unreadable underneath it. The cause is in effectiveH
  // below: the geometry was sized to end exactly where the strip's BOTTOM edge
  // sits, so the strip extended upward into the diamond, which lives at
  // 0.86 x height and is the lowest thing on the canvas.
  //
  // The band's previous occupant (the belief ground) was given room by
  // compressing the geometry above it -- see the note under THE FREED STRIP. The
  // reading element inherited the band but never inherited that. Measured, not
  // assumed, for the same reason the mic bar is measured.
  const [readingStripH, setReadingStripH] = useState<number>(0);
  const READING_GAP = 10; // breathing gap between the diamond and the strip

  // The mic bar's top edge in canvasWrap-LOCAL coordinates. Both inputs are
  // window measurements, so this already accounts for safe-area insets, the
  // tab bar, and the ProgressStrip's inset-driven growth — nothing here needs
  // to add insets.bottom by hand.
  const micTopLocal = useMemo(() => {
    if (canvasTopW == null || micBarTopW == null) return null;
    const y = micBarTopW - canvasTopW;
    return Number.isFinite(y) ? y : null;
  }, [canvasTopW, micBarTopW]);

  // ===== THE FREED STRIP =====
  // The band between the bottom of the map geometry and the mic clearance used
  // to hold the belief ground, and the geometry above it gave up height to
  // make room. Both are gone (founder ruling 2026-08-27): "what you stand on"
  // moved into the Self-like folder, reached by the diamond on the triangle.
  // The map now gets that height back, and the strip is where the reading
  // element is going to live.

  const effectiveH = useMemo(() => {
    if (!size) return null;
    let h = size.h;
    if (micTopLocal != null) {
      const measured = micTopLocal - MIC_CLEARANCE - (readingStripH > 0 ? readingStripH + READING_GAP : 0);
      // Defensive clamp on the MEASUREMENT ONLY — a bogus value (tiny or past
      // the wrap's own bottom) falls back to the full canvas rather than
      if (measured >= size.h * 0.55 && measured < size.h) h = measured;
    }
    // Hard ceiling on what the band may take. Node radii are fixed while node
    // POSITIONS are proportional, so an unbounded reserve would eventually
    // stack the wound off the top of the canvas. 22% covers the worst
    // realistic band (3 lines at 1.4x font scaling) with room to spare.
    return h;
  }, [size, micTopLocal, readingStripH]);

  const geom: MapGeometry | null = size && effectiveH ? computeMapGeometry(size.w, effectiveH) : null;

  // Counts for the corner badges on the manager / firefighter rings.
  // Reading from the parts table (rich rows with category + name) and
  // falling back to the legacy detectedManagers / detectedFirefighters
  // arrays on mapData if the parts table hasn't been populated yet for
  // older accounts. Either way we get a single number per category.
  const managerCount = useMemo(() => {
    const fromParts = parts.filter((p: any) => p?.category === 'manager').length;
    if (fromParts > 0) return fromParts;
    return Array.isArray(mapData?.detectedManagers) ? mapData.detectedManagers.length : 0;
  }, [parts, mapData]);
  const firefighterCount = useMemo(() => {
    const fromParts = parts.filter((p: any) => p?.category === 'firefighter').length;
    if (fromParts > 0) return fromParts;
    return Array.isArray(mapData?.detectedFirefighters) ? mapData.detectedFirefighters.length : 0;
  }, [parts, mapData]);

  // Node-specific haptic patterns. Heavier impact for parts that carry heavier
  // somatic weight (wound, firefighter), soft notification for Self. Matches the
  // clinical spec that each part has its own felt-sense.
  // Per-node haptic pattern. Matches the clinical weight each part carries:
  //   heavier parts (wound) → heavier impact
  //   medium-weight (fixer, firefighter) → medium
  //   lighter protectors + soft-self (skeptic, manager, self-like) → light
  //   true Self → soft success notification (the landed feeling)
  function tapHaptic(k: NodeKey) {
    switch (k) {
      case 'wound':       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}); break;
      case 'fixer':       Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); break;
      case 'firefighter': Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); break;
      case 'skeptic':     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'manager':     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'self-like':   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); break;
      case 'self':        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); break;
    }
  }

  // The person opened this folder. Stamp every part the folder shows: the one
  // row for wound / fixer / skeptic / self-like, and EVERY row for manager /
  // firefighter, because that folder opens every protector card at once — each
  // of those is a real visit. Fire-and-forget: a failed stamp costs a recency
  // line, never the folder.
  function markPartsVisited(k: NodeKey) {
    const ids = (parts || [])
      .filter((p) => String(p?.category || '').toLowerCase().trim() === k)
      .map((p) => String(p?.id || ''))
      .filter(Boolean);
    if (!ids.length) return;
    setVisitedThisSession((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    for (const id of ids) api.markPartVisited(id);
  }

  function handleTap(k: NodeKey) {
    tapHaptic(k);
    setActivePart(k);
    setFolderPart(k);
    markPartsVisited(k);
  }

  // ---------- INTEGRATION (TIKUN) VIEW ----------
  // Toggle between the triangle map and a circle layout that shows what
  // the system looks like in integration. Cross-fades over 800ms.
  const [view, setView] = useState<'triangle' | 'circle'>('triangle');
  const [integrationPartKey, setIntegrationPartKey] = useState<IntegrationKey | null>(null);
  const triangleOpacity = useRef(new Animated.Value(1)).current;
  const circleOpacity = useRef(new Animated.Value(0)).current;

  // First-time discoverability label — fades in beside the toggle for
  // 4s the very first time the Map tab is shown after the integration
  // toggle exists. AsyncStorage flag ensures it never shows again.
  const [showSeeIntegrationLabel, setShowSeeIntegrationLabel] = useState(false);
  const labelOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(INTEGRATION_VIEW_SEEN_KEY);
        if (seen === '1' || cancelled) return;
        setShowSeeIntegrationLabel(true);
        Animated.timing(labelOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
        setTimeout(() => {
          Animated.timing(labelOpacity, { toValue: 0, duration: 500, useNativeDriver: true }).start(
            () => setShowSeeIntegrationLabel(false),
          );
          AsyncStorage.setItem(INTEGRATION_VIEW_SEEN_KEY, '1').catch(() => {});
        }, 4000);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [labelOpacity]);

  // ---------- LAYER SWIPE ----------
  // Horizontal swipe between layers. 60px threshold per spec; on commit, the
  // canvas slides 300ms in the swipe direction, the layer index updates, and
  // it slides back from the opposite edge. Vertical movement is ignored so
  // ScrollView/Modal interactions stay intact. Only active when layers > 1.
  const slideX = useRef(new Animated.Value(0)).current;
  const layersRef = useRef(layers);
  const idxRef = useRef(currentLayerIndex);
  const widthRef = useRef(0);
  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { idxRef.current = currentLayerIndex; }, [currentLayerIndex]);
  useEffect(() => { widthRef.current = size?.w || 0; }, [size]);

  function commitLayerChange(direction: -1 | 1) {
    const len = layersRef.current.length;
    if (len < 2) return;
    const next = idxRef.current + direction;
    if (next < 0 || next >= len) {
      // Bounce back if at the edge.
      Animated.spring(slideX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    const w = widthRef.current || 400;
    // Slide the current view fully off in the swipe direction (note: a
    // forward swipe goes -direction visually because the gesture pulls the
    // current content the opposite way).
    Animated.timing(slideX, {
      toValue: -direction * w,
      duration: 150,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setCurrentLayerIndex(next);
      // Jump to the opposite edge instantly, then slide to center.
      slideX.setValue(direction * w);
      Animated.timing(slideX, {
        toValue: 0,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start();
    });
  }

  // Swipe-detection thresholds. Tuned for one-handed thumb swipes
  // across the canvas — too tight and quick flicks miss; too loose
  // and a vertical scroll inside the canvas wrap accidentally pages.
  const SWIPE_MIN_DX           = 8;     // pickup threshold for declaring "this is a swipe"
  const SWIPE_DIRECTION_RATIO  = 1.0;   // |dx| must exceed |dy| (strict horizontal)
  const SWIPE_COMMIT_DX        = 40;    // distance threshold to commit the page change
  const SWIPE_COMMIT_VX        = 0.3;   // velocity threshold for fast-flick commits

  // Shared horizontal-pan detector used by both the regular and
  // Capture phases. The capture phase claims the gesture from
  // child views (the tappable InnerMapCanvas nodes) when the user
  // moves enough horizontally — without it, a Pressable inside the
  // canvas can briefly hold the gesture and the swipe gets dropped.
  function isHorizontalSwipe(g: { dx: number; dy: number }) {
    if (layersRef.current.length < 2) return false;
    const absDx = Math.abs(g.dx);
    const absDy = Math.abs(g.dy);
    return absDx > SWIPE_MIN_DX && absDx > absDy * SWIPE_DIRECTION_RATIO;
  }

  const panResponder = useRef(
    PanResponder.create({
      // Touch start NEVER claims the gesture — taps on canvas nodes
      // (handleTap on InnerMapCanvas) need to reach their handlers,
      // and the swipe is only declared once the user actually moves.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // Move-phase: regular AND capture variants both run the same
      // horizontal-swipe test. Capture claims from descendants the
      // moment a horizontal drag is identifiable — this is the
      // single biggest reliability fix; without Capture, the
      // first child Pressable to react to the touch wins, and the
      // swipe silently drops on contact.
      onMoveShouldSetPanResponder:        (_evt, g) => isHorizontalSwipe(g),
      onMoveShouldSetPanResponderCapture: (_evt, g) => isHorizontalSwipe(g),
      // Once we own the gesture, refuse to give it back to a child —
      // otherwise mid-swipe a Pressable could re-claim and drop us.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_evt, g) => {
        slideX.setValue(g.dx);
      },
      onPanResponderRelease: (_evt, g) => {
        // Two ways to commit a page change:
        //   1. Distance crossed: |dx| ≥ 40px.
        //   2. Fast flick: |vx| ≥ 0.3 in the dx direction. Lets a
        //      quick decisive flick advance even if the finger only
        //      traveled 25-30px before lifting.
        const distOK = Math.abs(g.dx) >= SWIPE_COMMIT_DX;
        const flickOK = Math.abs(g.vx) >= SWIPE_COMMIT_VX && Math.sign(g.vx) === Math.sign(g.dx);
        if (distOK || flickOK) {
          // dx < 0 (finger moved LEFT) → +1, advancing toward
          // secondary (layers[1+]). dx > 0 (finger moved RIGHT) →
          // -1, returning toward primary (layers[0]). Standard
          // page-carousel convention; do NOT flip.
          commitLayerChange(g.dx < 0 ? 1 : -1);
        } else {
          Animated.spring(slideX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slideX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      },
    }),
  ).current;

  // First-time second-layer label — fires once when the user discovers that
  // a second layer exists. Stored under SECOND_LAYER_INTRODUCED_KEY so it
  // never re-shows even if more layers appear later.
  const [showSecondLayerLabel, setShowSecondLayerLabel] = useState(false);
  const secondLayerOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (layers.length < 2) return;
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SECOND_LAYER_INTRODUCED_KEY);
        if (seen === '1' || cancelled) return;
        setShowSecondLayerLabel(true);
        Animated.timing(secondLayerOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
        setTimeout(() => {
          Animated.timing(secondLayerOpacity, { toValue: 0, duration: 500, useNativeDriver: true })
            .start(() => setShowSecondLayerLabel(false));
          AsyncStorage.setItem(SECOND_LAYER_INTRODUCED_KEY, '1').catch(() => {});
        }, 5000);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [layers.length, secondLayerOpacity]);

  // First-time intro panel for the Map tab itself. Slides up the very
  // first time a user opens the Map; never reappears once dismissed.
  // Replaces the on-canvas hint that was getting in the way of the
  // (faint) triangle.
  const [mapIntroVisible, setMapIntroVisible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(MAP_INTRO_SEEN_KEY);
        if (seen === '1' || cancelled) return;
        // Small delay so the tab transition + canvas first paint settle
        // before the bottom sheet slides up.
        setTimeout(() => { if (!cancelled) setMapIntroVisible(true); }, 500);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  function dismissMapIntro() {
    setMapIntroVisible(false);
    AsyncStorage.setItem(MAP_INTRO_SEEN_KEY, '1').catch(() => {});
  }

  // First-time intro panel for the integration view. Auto-opens 600ms
  // after the user toggles into circle view for the very first time, so
  // the cross-fade can complete before the sheet slides up. AsyncStorage
  // flag CIRCLE_VIEW_INTRO_SEEN_KEY ensures it never appears again.
  const [circleIntroVisible, setCircleIntroVisible] = useState(false);

  function toggleView() {
    Haptics.selectionAsync().catch(() => {});
    const goingToCircle = view === 'triangle';
    setView(goingToCircle ? 'circle' : 'triangle');
    Animated.parallel([
      Animated.timing(triangleOpacity, {
        toValue: goingToCircle ? 0 : 1,
        duration: 2000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(circleOpacity, {
        toValue: goingToCircle ? 1 : 0,
        duration: 2000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
    // Trigger the first-time intro panel only when entering circle view.
    if (goingToCircle) {
      (async () => {
        try {
          const seen = await AsyncStorage.getItem(CIRCLE_VIEW_INTRO_SEEN_KEY);
          if (seen === '1') return;
          // 600ms delay so the circle's ambient breath + cross-fade settle
          // before the bottom sheet slides up.
          setTimeout(() => setCircleIntroVisible(true), 600);
        } catch {}
      })();
    }
  }
  function dismissCircleIntro() {
    setCircleIntroVisible(false);
    AsyncStorage.setItem(CIRCLE_VIEW_INTRO_SEEN_KEY, '1').catch(() => {});
  }

  return (
    <SafeAreaView style={styles.root} edges={[]}>
      {/* Title/subtitle removed on mobile — they ate valuable real estate and
          the map's triangle itself is the title. The tab bar already tells
          the user where they are. */}
      {/* Persistent header — only in circle (integration) view. A single
          quiet line of italic copy that tells the user the parts are
          tappable. Hidden when the triangle view is active. */}
      {view === 'circle' ? (
        <View pointerEvents="none">
          <Text style={styles.circleTitle}>Integrated Map</Text>
          <Text style={styles.circleHeader}>Tap any part to see its transformation</Text>
        </View>
      ) : null}

      {/* What the dot means. It sat unlabelled on the wound — the most loaded
          element on the map — where an unexplained mark reads as "something is
          wrong with this" (founder ruling 2026-08-25). Rendered only while at
          least one dot is actually showing, and only in triangle view, so it
          costs nothing the rest of the time; it lives in the header band the
          circle view already uses, well clear of the mic bar. */}
      {view === 'triangle' && changedNodes.size > 0 ? (
        <View pointerEvents="none">
          <Text style={styles.changedLegend}>
            {'\u25CF  Changed since you last opened it'}
          </Text>
        </View>
      ) : null}

      <View
        ref={canvasWrapRef}
        style={styles.canvasWrap}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) setSize({ w: width, h: height });
          // Window-coordinate top for the mic-clearance math. rAF so the
          // measurement runs after the frame settles (Android needs this
          // for accurate first-layout values).
          requestAnimationFrame(() => {
            canvasWrapRef.current?.measureInWindow((_x, y) => {
              if (Number.isFinite(y)) setCanvasTopW(y);
            });
          });
        }}
        {...(layers.length > 1 ? panResponder.panHandlers : {})}
      >
        {/* Slide layer — translates in X during a layer swipe. Triangle &
            circle canvases live inside it so both move together. */}
        <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ translateX: slideX }] }]}
                       pointerEvents="box-none">
          {/* Triangle map — always mounted, opacity cross-fades with circle. */}
          {geom ? (
            <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: triangleOpacity }]}
                           pointerEvents={view === 'triangle' ? 'box-none' : 'none'}>
              <InnerMapCanvas
                geom={geom}
                activePart={activePart}
                activeLabel={activeLabel}
                managerCount={managerCount}
                firefighterCount={firefighterCount}
                onNodeTap={handleTap}
                changedNodes={changedNodes}
              />
            </Animated.View>
          ) : null}
          {/* Circle (integration) map — also always mounted; the inactive
              view has pointerEvents:'none' so it can't intercept taps. */}
          {size ? (
            <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: circleOpacity }]}
                           pointerEvents={view === 'circle' ? 'box-none' : 'none'}>
              <CircleMapCanvas
                width={size.w}
                height={size.h}
                onNodeTap={(k) => {
                  Haptics.selectionAsync().catch(() => {});
                  setIntegrationPartKey(k);
                }}
              />
            </Animated.View>
          ) : null}
        </Animated.View>

        {/* ===== THE READING, IN THE FREED STRIP =====
            The band between the bottom of the map geometry and the mic
            clearance — vacated when the belief ground moved into the You
            folder (founder ruling 2026-08-27).

            It sits DIRECTLY ABOVE the mic row on purpose: it borrows that row's
            visual grammar (glyph over a tracked uppercase label, cream when
            locked, amber when live), and putting it anywhere else would make
            two things that behave identically look unrelated.

            Outside the slide layer, like the belief band before it: there is
            one reading per account, so it must not page away when the user
            swipes between wound layers. Bottom-anchored, so its position never
            depends on its own height and the map geometry above it no longer
            has to reserve anything.

            Visible in BOTH views, unlike the band it replaced — that was
            literally the floor the triangle stood on, whereas a reading of the
            whole map is no less true in the integration view. */}
        {size && micTopLocal != null ? (
          <View
            style={[styles.readingStripWrap, { bottom: Math.max(0, size.h - micTopLocal + MIC_CLEARANCE) }]}
            pointerEvents="box-none"
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              // Only grow the reservation, and only on a real change — a
              // measurement that feeds back into the geometry it is measured
              // against can otherwise oscillate by a pixel forever.
              if (Number.isFinite(h) && Math.abs(h - readingStripH) > 1) setReadingStripH(h);
            }}
          >
            <ReadingElement
              onOpen={(b, at) => { setReadingBody(b); setReadingAt(at); setReadingOpen(true); }}
            />
          </View>
        ) : null}

        {/* Empty / error overlays — sit above the (faint) triangle when no
            wound has been mapped yet or the network call failed. They
            invite the user to start a conversation rather than presenting
            an unexplained blank canvas. */}
        {/* Empty-state hint removed — was getting in the way of the
            (faint) triangle. The empty triangle itself reads as the
            invitation. The error overlay below is still rendered when
            the network call fails because it carries the RETRY pill. */}
        {loadStatus === 'error' ? (
          <View style={styles.emptyOverlay}>
            <Text style={styles.emptyText}>
              Map data is taking a moment to load.
            </Text>
            <Pressable
              onPress={() => { setLoadStatus('idle'); loadMap(); }}
              hitSlop={10}
              style={styles.retryBtn}
              accessibilityLabel="Retry loading map"
            >
              <Text style={styles.retryText}>RETRY</Text>
            </Pressable>
          </View>
        ) : null}
        {/* First-visit empty state — single clean CTA.
            Build-13 fix: the prior two-sentence explainer body was
            overlapping the MapVoiceBar mics + START BUILDING button
            on Android (verified on emulator, version code 10+).
            Both surfaces share the bottom region of the screen, so
            stacking a 2-line paragraph at bottom: 64 collided with
            the mics at bottom: 50.
            New layout (Option B per the bug report): the faint
            triangle from InnerMapCanvas IS the explainer — it
            silently shows "this is what a built map looks like".
            We add only a single START BUILDING CTA, anchored well
            above the mic bar so the two surfaces never overlap on
            either Android or iOS. The edge case (firstSessionDone
            but map somehow empty) was unreachable in practice and
            rendered an un-actionable text-only overlay; dropped. */}
        {view === 'triangle'
          && loadStatus === 'loaded'
          && layers.length === 0
          && firstSessionDoneAt === null ? (
          <View style={styles.mapEmptyOverlay} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                router.push('/');
              }}
              style={styles.mapEmptyCta}
              accessibilityLabel="Start building your map"
              accessibilityRole="button"
            >
              <Text style={styles.mapEmptyCtaText}>START BUILDING</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Layer dot indicators — only shown when multiple layers exist.
            Sit centered just above the YOUR PROGRESS strip. */}
        {layers.length > 1 ? (
          <View style={styles.dotsRow} pointerEvents="none">
            {layers.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === currentLayerIndex ? styles.dotActive : styles.dotIdle]}
              />
            ))}
          </View>
        ) : null}

        {/* First-time second-layer discoverability label. */}
        {showSecondLayerLabel ? (
          <Animated.View
            style={[styles.secondLayerLabel, { opacity: secondLayerOpacity }]}
            pointerEvents="none"
          >
            <Text style={styles.secondLayerLabelText}>
              A new layer has been added — swipe to explore
            </Text>
          </Animated.View>
        ) : null}

        {/* Integration toggle button — bottom left, above the YOUR PROGRESS
            strip. Outline circle when triangle view is active, filled
            circle when integration view is active. */}
        <View style={styles.toggleWrap} pointerEvents="box-none">
          {showSeeIntegrationLabel ? (
            <Animated.View style={[styles.toggleLabel, { opacity: labelOpacity }]} pointerEvents="none">
              <Text style={styles.toggleLabelText}>See integration</Text>
            </Animated.View>
          ) : null}
          <Pressable
            onPress={toggleView}
            hitSlop={10}
            style={styles.toggleBtn}
            accessibilityLabel={view === 'triangle' ? 'Switch to integration view' : 'Switch back to map view'}
          >
            <View
              style={[
                styles.toggleInner,
                view === 'circle' ? styles.toggleInnerFilled : styles.toggleInnerOutline,
              ]}
            />
          </Pressable>
        </View>
      </View>

      <MapVoiceBar
        sessionId={sessionIdRef.current}
        onBarTop={setMicBarTopW}
        // The mic row is absolute against this zero-inset root, and the
        // ProgressStrip below it grows by insets.bottom — so the bar has to
        // ride up by the same amount to keep its 9px clearance.
        bottomInset={insets.bottom}
        onDetectedPart={(part) => {
          // Narrowing the string to NodeKey — guarded by the known part list so a
          // future server-side category doesn't crash the canvas.
          const known: Record<string, NodeKey> = {
            wound: 'wound', fixer: 'fixer', skeptic: 'skeptic', self: 'self',
            'self-like': 'self-like', compromised: 'self-like',
            manager: 'manager', firefighter: 'firefighter',
          };
          const key = known[part];
          if (key) setActivePart(key);
        }}
      />

      <ProgressStrip
        outsideInScore={outsideInScore}
        fragmentedScore={fragmentedScore}
        blendedSelfLedScore={blendedSelfLedScore}
        spectrumEarned={spectrumEarned}
        clinicalPatterns={clinicalPatterns}
        bottomInset={insets.bottom}
      />

      <IntegrationPanel
        visible={!!integrationPartKey}
        partKey={integrationPartKey}
        onClose={() => setIntegrationPartKey(null)}
      />

      <CircleIntroPanel
        visible={circleIntroVisible}
        onClose={dismissCircleIntro}
      />

      <MapIntroPanel
        visible={mapIntroVisible}
        onClose={dismissMapIntro}
      />

      <PartFolderModal
        visible={!!folderPart}
        partKey={folderPart}
        mapData={activeMapData}
        parts={parts}
        onClose={() => setFolderPart(null)}
      />
      <ReadingModal
        visible={readingOpen}
        body={readingBody}
        createdAt={readingAt}
        onClose={() => setReadingOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  canvasWrap: { flex: 1, overflow: 'hidden' },

  // Integration toggle — bottom left of the canvas, above the
  // YOUR PROGRESS strip. Small, unobtrusive; reads as a quiet
  // alternative-view affordance, not a feature button.
  toggleWrap: {
    position: 'absolute',
    left: 16,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20,19,26,0.7)',
  },
  toggleInner: {
    width: 18, height: 18, borderRadius: 9,
  },
  toggleInnerOutline: {
    borderWidth: 1.5,
    borderColor: 'rgba(230,180,122,0.5)',
  },
  toggleInnerFilled: {
    backgroundColor: '#E6B47A',
    shadowColor: '#E6B47A',
    shadowOpacity: 0.6, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  // First-time discoverability label "See integration" beside the toggle.
  toggleLabel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(20,19,26,0.85)',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
  },
  toggleLabelText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  // The reading element's strip — full-bleed, pinned above the mic clearance.
  // No height: the element sizes to its own content, and nothing reserves
  // space for it (the geometry above is no longer height-coupled to this band,
  // which is the whole point of having removed the belief reservation).
  readingStripWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },

  // Dot indicators for layer count, centered above the YOUR PROGRESS strip.
  dotsRow: {
    position: 'absolute',
    bottom: 18,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
  },
  dotIdle: { backgroundColor: 'rgba(255,255,255,0.22)' },
  dotActive: {
    backgroundColor: '#E6B47A',
    shadowColor: '#E6B47A',
    shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 },
  },
  // First-time second-layer label — sits just below the top safe area.
  secondLayerLabel: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(20,19,26,0.85)',
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: 'rgba(230,180,122,0.3)',
  },
  secondLayerLabelText: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.2,
  },

  // Persistent header for circle (integration) view — Cormorant SemiBold
  // amber title sits above a single quiet italic line that hints the parts
  // are tappable. Both lines are hidden when the triangle view is active.
  circleTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 28,
    color: '#E6B47A',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 4,
  },
  circleHeader: {
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    color: 'rgba(230,180,122,0.5)',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  // Same quiet grammar as circleHeader. The glyph is part of the string so it
  // inherits the line's colour — the key reads as one phrase, not a caption
  // with a decoration in front of it.
  changedLegend: {
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    color: 'rgba(230,180,122,0.55)',
    textAlign: 'center',
    letterSpacing: 0.4,
    marginTop: 2,
    marginBottom: 6,
  },

  // Error overlay — uses a centered layout because it needs the RETRY
  // pill to be tappable, so it stays in the middle of the canvas.
  emptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: colors.creamFaint,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 26,
    textAlign: 'center',
    letterSpacing: 0.3,
    opacity: 0.85,
  },
  retryBtn: {
    marginTop: 18,
    paddingHorizontal: 22, paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(230,180,122,0.45)',
  },
  retryText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    letterSpacing: 2,
  },

  // Empty-state explainer (no layers mapped yet). Sits on top of the
  // faint triangle from InnerMapCanvas — that triangle IS the "what
  // this looks like once populated" preview. The overlay positions
  // copy + CTA in the lower half so the triangle remains the focal
  // point. pointerEvents="box-none" on the wrapper lets touches pass
  // through to the canvas; only the explicit Pressable below catches
  // taps for the CTA.
  // Bottom-anchored CTA-only overlay (build-13 layout fix). The
  // MapVoiceBar mic row anchors at bottom: 50 + insets.bottom, with the
  // mic + label stack rising to roughly bottom: 140 + insets.bottom —
  // both measured from the RAW screen bottom. paddingBottom: 200 leaves
  // a comfortable gap between the START BUILDING button and the top of
  // the mic stack on standard 19.5:9 / 20:9 Android displays — verified
  // clear on a 1080×2400 emulator and on iPhone 15 Pro.
  // NOTE — this value deliberately does NOT take a safe-area term. The
  // overlay is absolutely positioned inside canvasWrap, an in-flow flex:1
  // child that already shrinks by insets.bottom when the ProgressStrip
  // grows. Its bottom edge and the mic stack therefore both rise by
  // exactly insets.bottom, so the gap is already inset-invariant; adding
  // the inset here again would over-correct and push the CTA up by an
  // extra insets.bottom on nav-bar devices.
  // pointerEvents="box-none" on the parent View still lets taps fall
  // through to the canvas everywhere except on the explicit Pressable.
  mapEmptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 200,
    paddingHorizontal: 32,
  },
  mapEmptyCta: {
    marginTop: 18,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 28,
    backgroundColor: colors.amber,
  },
  mapEmptyCtaText: {
    color: colors.background,
    fontFamily: fonts.sansBold,
    fontSize: 12,
    letterSpacing: 1.4,
  },

  // ===== Circle-view first-time intro panel =====
  introBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  introSheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    maxHeight: '60%',
    backgroundColor: '#14131A',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(230,180,122,0.35)',
    paddingTop: 10,
  },
  introHandle: {
    alignSelf: 'center',
    width: 42, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom: 14,
  },
  introHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 22, paddingBottom: 8,
  },
  introTitle: {
    fontFamily: fonts.serifBold,
    fontSize: 26,
    color: colors.amber,
    letterSpacing: 0.3,
  },
  introClose: { padding: 6 },
  introBody: { paddingHorizontal: 22, paddingBottom: 22 },
  introParagraph: {
    color: colors.cream,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 26,
    marginBottom: 14,
  },
  introButton: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 32, paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.amber,
    backgroundColor: 'rgba(230,180,122,0.12)',
  },
  introButtonText: {
    color: colors.amber,
    fontFamily: fonts.sansBold,
    fontSize: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});

// ============================================================================
// First-time intro panel for the circle (integration) view. Slides up the
// very first time the user enters integration view, then never reappears
// once dismissed (gated by AsyncStorage flag CIRCLE_VIEW_INTRO_SEEN_KEY).
// Same bottom-sheet grammar as IntegrationPanel / PartFolderModal — drag
// handle, dark background, safe-area padding, X close.
// ============================================================================
function CircleIntroPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.introBackdrop} onPress={onClose} />
      <View style={[styles.introSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.introHandle} />
        <View style={styles.introHeaderRow}>
          <Text style={styles.introTitle}>Integration</Text>
          <Pressable onPress={onClose} style={styles.introClose} accessibilityLabel="Close" hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.introBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.introParagraph}>
            This is what the same system looks like when the wound has healed.
            Nothing is gone — everything has transformed. The parts that were
            in conflict become one movement.
          </Text>
          <Text style={styles.introParagraph}>
            Tap any part to see what it becomes.
          </Text>
          <Pressable onPress={onClose} style={styles.introButton} accessibilityLabel="Explore">
            <Text style={styles.introButtonText}>Explore</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ============================================================================
// First-time intro panel for the Map tab itself. Auto-opens 500ms after
// the Map tab first mounts; AsyncStorage flag MAP_INTRO_SEEN_KEY ensures
// it never reappears. Same bottom-sheet grammar as CircleIntroPanel.
// ============================================================================
function MapIntroPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.introBackdrop} onPress={onClose} />
      <View style={[styles.introSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.introHandle} />
        <View style={styles.introHeaderRow}>
          <Text style={styles.introTitle}>Your Map</Text>
          <Pressable onPress={onClose} style={styles.introClose} accessibilityLabel="Close" hitSlop={10}>
            <Ionicons name="close" size={22} color={colors.creamFaint} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.introBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.introParagraph}>
            This is where your inner world takes shape. As you have
            conversations, parts of your system will appear here. Tap any
            node to learn more. Your map gets more accurate the longer you
            use it.
          </Text>
          <Pressable onPress={onClose} style={styles.introButton} accessibilityLabel="Got it">
            <Text style={styles.introButtonText}>Got it</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

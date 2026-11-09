// Inner Map Guide content — mirrors the web app's Guide tab word-for-word.
// Three sections: the map, healing, using it.
// Editing copy here is the single source of truth for the mobile Guide tab.

import { PARTNER_ENABLED } from '../constants/features';

// Every slide has its own distinct visual. See GuideNodeVisual.tsx for the
// Skia render for each kind. Names match the slide concepts so the intent is
// obvious at the point of assignment.
export type NodeVisualKind =
  | 'intro'                // expanding amber rings radiating outward
  | 'everyone'             // ring of small circles — many people, one hidden center
  | 'wound'                // single red circle, slow pulse
  | 'woundLayers'          // wound with two distinct rings (story + feeling)
  | 'fixer'                // amber circle + three upward lines
  | 'skeptic'              // blue circle + heavy horizontal bar underneath
  | 'tension'              // mini triangle with atmospheric glow
  | 'selfLike'             // dimmer lavender diamond
  | 'managersFirefighters' // two dashed circles with inner dots
  | 'self'                 // purple, largest, steady, no pulse
  | 'fullmap'              // complete mini map, everything breathing
  | 'seed'                 // bottom circle with line growing upward
  | 'responsibility'       // right-arrow fades / left-arrow brightens
  | 'unblending'           // two overlapping circles drift apart and back
  | 'release'              // wound with outer ring expanding + fading
  | 'newCreation'          // full map with golden glow from Self center
  // ----- Healing Stage one (1A / 1B / 1C). Three animated visuals
  //       that form a related family — same orb / glow language, same
  //       deep-navy + warm-amber palette. Added polish round 6. -----
  | 'observerDrift'        // steady center orb + 3 colored orbs drifting across
  | 'coachOrbits'          // central coach orb + 3 smaller orbs orbiting + cycling connection line
  | 'steadyPillar'         // static pillar of warm light + active orbs swirling around it
  // ----- onboarding / welcome -----
  | 'mapDrawing'           // triangle draws itself, then nodes bloom in
  | 'chatBubble'           // chat bubble silhouette with breathing triangle inside
  | 'nodeDetect'           // node fades in, ripple expands outward, fades
  | 'privacy'              // breathing amber rings around a small lock glyph
  | 'readyToBegin'         // full map fades in; Self brightens last and holds
  // ----- "what holds you" — opens the HEALING section (3 slides) -----
  | 'safetyCapacity'       // expanding warm circle = capacity growing
  | 'survivalMode'         // 3 small colored dots huddled close, pulsing rapidly
  | 'groundBuilding'       // ground line + warm root dots below + soft glow above
  // ----- legacy visuals (kept so the dispatcher type-checks even if some
  //       older code still references them; not used by current slides) -----
  | 'buildingCapacity'
  | 'windowOfTolerance'
  | 'twoTracks'
  | 'energyMoves'
  | 'triangleToCircle'     // closing visual — triangle with three colored nodes morphs into a unified circle
  | 'noVisual';            // no canvas — text-only slides

export type GuideSlide = {
  visual: NodeVisualKind;
  title: string;
  titleColor?: string;      // override amber for part-specific slides
  body: string[];           // each string is a paragraph
};

// ===== SECTION 0: WELCOME =====
// Same slides shown during onboarding AND in the Guide tab's WELCOME pill.
// (1.4.0: there is one deck. The "learns who you are" paragraph that the old
// stack showed is gone; KEEPS_WHAT_IT_KEEPS below is the only version.)
// Single source of truth so concepts can be revisited later without
// drifting out of sync with the first-time experience.
//
// History: previously 7 entries. The two map-evolution slides were
// merged into one ("Your map starts as a sketch" + "The map changes
// everything" → a single combined slide) to remove the redundancy.
// The "This is not therapy" closing slide was briefly removed but
// then restored — the redundancy with the dedicated NotTherapyScreen
// later in onboarding is intentional. Safety messaging in
// mental-health-adjacent apps benefits from reinforcement, and App
// Review favors multiple disclosures over a single buried one.
// July 2026: "You talk. It listens." added at position 3 — the deck
// previously jumped from the human-condition slide straight into
// "As you talk, patterns emerge" without ever practically saying the
// app IS a conversation. This slide carries that fact (and revives
// the chatBubble visual, whose renderer had outlived its original
// slide), so the patterns slide reads as a payoff, not a cold open.
// Result: 7 slides total.

// M2 (ruling 2026-11-05, "invented memory"): "learns who you are … the more it
// knows you" claims more than the app keeps. What it keeps across
// conversations is the map, key moments and some of what was said — Draft
// 3.5's own description (draft3 (10).md, line 99). The words are the app's,
// written to that line for the founder's review; the audit
// (other-surfaces-audit.md, guideContent.ts:130) named the problem and
// offered no replacement. No "transcript" claim either way: the app does save
// conversations to the person's history, so "it doesn't keep a transcript"
// would be false here.
const KEEPS_WHAT_IT_KEEPS =
  "Over time, Inner Map keeps your map, key moments and some of what you've said, so you don't have to start over each time.";

export const WELCOME_SLIDES: GuideSlide[] = [
  {
    visual: 'intro',
    title: 'Inner Map',
    body: [
      "A place to understand what's happening inside you — beneath the surface.",
    ],
  },
  {
    visual: 'everyone',
    title: 'We all have patterns',
    body: [
      "Ways we react. Things that trigger us. Feelings we can't explain. Most of us don't fully understand why — they live just below the surface, shaping our days without us seeing them.",
    ],
  },
  {
    visual: 'chatBubble',
    title: 'You talk. It listens.',
    body: [
      "Inner Map is a conversation — you bring whatever is alive right now, in your own words, and it meets you there. No forms, no exercises. Just talking, the way you'd talk to someone who really listens.",
    ],
  },
  {
    visual: 'mapDrawing',
    title: 'Inner Map helps you see them',
    body: [
      "As you talk, patterns show themselves: the same feelings, the same voices, the same pushes and pulls. The conversation notices them and offers them back to you, and what you recognise goes on your map, in your own words.",
    ],
  },
  {
    // Merged slide — keeps slide-5's nodeDetect visual (the open
    // circle outline). The earlier chatBubble visual was discarded
    // with its slide. Body opens with the sketch framing then flows
    // into the impact paragraph as one continuous thought. Title and
    // body: the founder's copy v2 (2026-11-09).
    visual: 'nodeDetect',
    title: 'The map is the point',
    body: [
      "Your map starts as a sketch and gets sharper with every conversation you add to. As it does, you stop being surprised by yourself: you start to see the sense in what felt like chaos, where your patterns came from and what each one is trying to do for you. Once you can see it, you can work with it instead of against it.",
    ],
  },
  {
    // Companion slide — breathing full map (every node alive, lines
    // shimmering) communicates "system alive over time" rather than
    // "your data is private". Two paragraphs; the sequential
    // paragraph animation in GuideSlide makes paragraph 2 wait until
    // paragraph 1 fully types out.
    visual: 'fullmap',
    title: 'A companion for the long journey',
    body: [
      "Open the app when something is stirred up and you can't quite name it. Come back when a pattern keeps repeating and you want to understand why. Use it when you need to be heard without advice or fixing. Sit with it between therapy sessions, when you need somewhere to land.",
      KEEPS_WHAT_IT_KEEPS,
    ],
  },
  {
    // Closing slide — restores the "this is not therapy + come back
    // anytime" beat that was briefly removed. Lives as the final
    // welcome slide so the BEGIN button (onboarding) lands on this
    // moment. The dedicated NotTherapyScreen later in onboarding
    // reinforces the same message; the duplication is intentional
    // safety-by-design.
    visual: 'readyToBegin',
    title: 'This is not therapy',
    body: [
      "It's a mirror. A space to see yourself more clearly. Nothing you share is judged.",
      'Everything in this introduction lives in the Guide tab — come back anytime.',
    ],
  },
];


// ===== SECTION 1: THE MAP =====
export const MAP_SLIDES: GuideSlide[] = [
  {
    visual: 'intro',
    title: 'Inner Map',
    body: [
      "You can't change what you can't see. The map is a tool for seeing.",
      "Through conversation it builds a picture of your inner world — the parts that push and pull, the beliefs underneath them, the wound they're all organized around.",
      "This is not therapy. But it can help you see yourself — and seeing is always where change begins.",
    ],
  },
  {
    visual: 'everyone',
    title: 'This is everyone',
    body: [
      "Everyone has a wound. Not from trauma necessarily, just from being human. Somewhere early, usually over many small moments rather than one, a child met something they couldn't make sense of and drew a conclusion about themselves.",
      "The wound doesn't require a villain. It doesn't require a diagnosis. It just requires being a child in a world too big to fully understand.",
      "The parts that grew up around it aren't signs of damage. They're signs of intelligence — a child being resourceful with what they were given.",
    ],
  },
  {
    visual: 'wound',
    title: 'The Wound',
    titleColor: '#E05050',
    body: [
      "Before the protectors, before the patterns, there was that conclusion. A child making sense of what was happening the only way a child can: by deciding something about themselves.",
      '"I am not enough." "I am invisible." "I am too much." "I am not safe."',
      'That conclusion became a lens. Everything since has been organized around it — trying to prove it wrong, trying to avoid feeling it.',
    ],
  },
  {
    visual: 'woundLayers',
    title: 'How the wound develops',
    titleColor: '#E05050',
    body: [
      "The wound doesn't stay quiet. It generates a feeling — loneliness, fear, heaviness — that lives in the body. And a story — the belief the child formed to explain it.",
      "The feeling often comes first. A heaviness in the chest. A hollow ache in the stomach. That's the wound speaking — not through words but through sensation.",
      "Most people don't notice the wound directly. They notice what grew up around it.",
    ],
  },
  {
    visual: 'fixer',
    title: 'The Fixer',
    titleColor: '#E6B47A',
    body: [
      'A part that decided to do something about the wound. If the wound says "I am not enough" — the Fixer says "watch me."',
      "It channels the pain into drive, ambition, performance. It carries enormous energy — because it's powered by the wound itself.",
      "The Fixer isn't the enemy. It's been fighting for you. It just can't finish the job — because no achievement can fill an internal wound.",
    ],
  },
  {
    visual: 'skeptic',
    title: 'The Skeptic',
    titleColor: '#86BDDC',
    body: [
      "The Fixer doesn't always work. Sometimes it overreaches, crashes. And a part noticed.",
      "The Skeptic grew to protect you from the crash. On the surface it pumps the brakes: stop, this will end in more pain. Underneath, it's holding out for something: it won't settle for a version of you that isn't real, so it refuses the performance.",
      "It looks like defeat. From the inside it's integrity, a part that pays attention, draws reasonable conclusions from real evidence, and won't be fooled.",
    ],
  },
  {
    visual: 'tension',
    title: 'The tension between them',
    body: [
      "The Fixer and Skeptic were once one thing — the natural drive and wisdom of a whole person. The wound split them apart.",
      "Now they pull in opposite directions. Most people live in the tension between them — a compromise the system engineers to stay functional.",
      "The shape of your compromise reveals the shape of your wound.",
    ],
  },
  {
    visual: 'selfLike',
    title: 'You',
    titleColor: '#8A7AAA',
    body: [
      "As the fixer pushed outward and the skeptic pulled back, someone had to navigate the space between them. That was you — the architect of your actual life, the choices, the career, the relationships, the rhythms you built.",
      "Look at what you love. Your work, your interests, the things that give you satisfaction and meaning — much of this lives in the compromise zone. You found ways to express something real within the constraints of the wound.",
      "You don't choose which part speaks up. The system sends what it sends — the fixer's urgency, the skeptic's doubt — and it arrives whether you asked for it or not. What you choose is your relationship to what arrives. That choice is always yours, even when it doesn't feel like it.",
      "Mostly it hasn't felt like it. You have been so fused with the system that you couldn't feel yourself as separate from it — in the game rather than coaching it. That isn't a flaw in you; it's how close you have been standing.",
      "You and Self are not the same thing. You is the one who receives and chooses; Self is what there is to receive from, always there underneath. It can be touched at any moment, and the more you stand there, the more of it gets lived.",
    ],
  },
  {
    visual: 'managersFirefighters',
    title: 'Managers & Firefighters',
    body: [
      "Managers work proactively — before the wound gets activated. They feel like personality: the perfectionist, the people-pleaser, the achiever.",
      "Firefighters respond reactively — when pain breaks through anyway. Distraction, rage, numbness. Their only job is to make the pain stop.",
      "Neither is the enemy. Both are protecting the same wound.",
    ],
  },
  {
    visual: 'self',
    title: 'Self',
    titleColor: '#C1AAD8',
    body: [
      "Underneath all the protecting and proving and managing — something was never wounded.",
      "Self has no agenda. No fear. No need for anything to be different. Just genuine curiosity, warmth, and presence.",
      "Self is not built. It's uncovered. The work doesn't create Self; it changes which part of yourself you take to be you, so that more of what was always there gets lived.",
    ],
  },
  {
    visual: 'fullmap',
    title: 'Your map',
    body: [
      "This is your map. Not a diagnosis. Not fixed. A living picture of how you're put together — growing more accurate the more you share.",
      "Every conversation can add to it. What you recognise as yours, in your own words, goes on; nothing goes on that you didn't say yes to.",
      "You don't have to understand everything now. The map will explain itself over time.",
    ],
  },
];

// ===== SECTION 2: HEALING =====
// ===== "WHAT HOLDS YOU" — opens the HEALING section =====
// Three slides that frame healing through capacity, system protection, and
// the ground that makes inner work possible. Lands FIRST in the HEALING
// pill so it sets up everything that follows about the three stages.
//
// The three slides form a deliberate arc:
//   1. Capacity is built (safety = capacity)
//   2. The system protects itself when capacity is short (survival mode)
//   3. Ground first — the actual work
export const WHAT_HOLDS_YOU_SLIDES: GuideSlide[] = [
  {
    // Visual unchanged — the brown concentric circles still
    // represent the safety/capacity expansion the body describes.
    // Title + body rewritten to lead with the "healing happens
    // from safety" framing rather than the equivalence framing
    // (the prior title was conceptually accurate but landed as a
    // tautology on first read).
    visual: 'safetyCapacity',
    title: 'Healing happens from safety',
    body: [
      "Real inner work — meeting your parts, seeing what's underneath — happens from a place of relative groundedness. Not from desperation. Not in crisis. Not by force of will.",
      "The stronger your foundation, the more you can feel — and stay yourself.",
    ],
  },
  {
    visual: 'survivalMode',
    title: 'When the system is in survival mode',
    body: [
      "When parts are activated and scared, allowing feelings to surface and move through becomes very difficult.",
      "The system is protecting itself — and that protection makes sense. Going deep before there's enough safety doesn't work.",
      "The system will resist because it's trying to keep you safe.",
    ],
  },
  {
    visual: 'groundBuilding',
    title: 'Build the ground first',
    body: [
      "Relationships. Therapy. Exercise. Hobbies. Sleep. Consistency. Basic stability.",
      "These aren't preparation for the real work. They are the real work. They build your sense of safety — which in turn opens the door to healing.",
      "Healing usually happens from a place of okayness, not desperation. If life feels thin right now, that's where to start.",
    ],
  },
];

export const HEALING_SLIDES: GuideSlide[] = [
  // The 3 "What Holds You" slides land first — this section is the
  // foundation everything else in HEALING (the three stages + creating
  // something new) builds on. Concatenated rather than rendered as a
  // separate sub-section so the user just scrolls through one ordered
  // sequence within the HEALING pill.
  //
  // Current arc (10 slides total):
  //   1. Healing happens from safety
  //   2. When the system is in survival mode
  //   3. Build the ground first
  //   4. How healing actually happens
  //   5. Stage one — A: Realizing you have parts
  //   6. Stage one — B: Becoming the coach
  //   7. Stage one — C: Leading from your own ground
  //   8. Stage two — Unblending
  //   9. Stage three — Release
  //  10. Creating something new   (BEGIN YOUR MAP button surfaces here)
  ...WHAT_HOLDS_YOU_SLIDES,
  {
    visual: 'seed',
    title: 'How healing actually happens',
    body: [
      "Understanding your map is not the same as healing. Insight is the beginning — not the destination.",
      "Healing happens in layers. It's not linear and it's rarely dramatic.",
      "But there is a shape to it — a direction things move when the work is genuine.",
      "The stages describe the shape, not a grade. People move through them and back again, and nobody is told which one they're at.",
    ],
  },
  // Stage 1 — split into two slides. The old single "Taking
  // responsibility" framing flattened a richer movement: outside-in →
  // inside-out (responsibility), THEN radical acceptance of the parts
  // one didn't choose + getting into relationship with them. The two
  // slides below preserve that fuller arc. Both share the "Stage one"
  // prefix so they read as paired beats in the Healing carousel.
  {
    // Polish round 6 — rewrote the three Stage one slides (1A / 1B /
    // 1C) with new body text + new animated visuals that form a
    // related family. 1A: a steady observer with parts drifting
    // across the field — the foundational "I'm not this thought,
    // I'm watching it" move.
    visual: 'observerDrift',
    title: 'Stage one — A: Realizing you have parts',
    body: [
      "A lot of what we call \"feeling anxious\" or \"being self-critical\" is really a part of us speaking. Most of the time we don't notice. The thought just feels like us — I'm not enough. I have to fix this. Just give up.",
      "When something starts to shift, it's usually small. A moment of noticing that the voice in your head isn't quite the same as you. Just hearing it from a step back. You're not silencing anything. You're not arguing with it. You're just starting to see it.",
      "For many people, this is where everything begins.",
    ],
  },
  {
    // 1B: the shift from fighting parts to being in relationship
    // with them. Coach metaphor. Coach at center, three players
    // orbiting at different rhythms, with a connection line cycling
    // through them.
    visual: 'coachOrbits',
    title: 'Stage one — B: Becoming the coach',
    body: [
      "When you first start seeing your parts clearly, there's often something painful in it. The wish that they weren't there. The shame that they are. The quiet sense that something about you must be wrong for them to exist.",
      "A lot of healing begins with accepting that it's there, and that it isn't going anywhere, before anything about it changes.",
      "Not by forcing acceptance, but by quietly noticing what's true: these parts are here. They came online for reasons that made sense at the time. You didn't create them. You don't really control them. What you have, what you've always had, is a relationship with them.",
      "You are the coach. You didn't pick the players — the system did, long ago, for reasons that made sense then. A coach can't trade his players, can't shame them off the roster, can't make them into different players. But he can be in real relationship with them — meet each one where they are, get to know what they need, help them grow over time. And slowly, he can help them work together as a team.",
      "You were always the coach. When the players were running the game, that wasn't a failure, and it wasn't a job you forgot to do — you just couldn't hear yourself over the noise. Coaching starts the moment you can.",
      "The shift is from how things should be to how they actually are. From fighting parts to being with them.",
    ],
  },
  {
    // 1C: leading from one's own ground. Static pillar of warm
    // light at the base (the ground that doesn't move) + active
    // orbs swirling around it. The contrast IS the visual.
    visual: 'steadyPillar',
    title: 'Stage one — C: Leading from your own ground',
    body: [
      "Knowing the parts are there is one thing. Leading them is something else. For that, you need your own ground — your own sense of who you are, separate from any single part's story.",
      "Not against the parts. Just yours.",
      "When a part comes online with its certainty — \"I have to fix this,\" \"I'm not enough,\" \"Shut down, this is too much\" — there can be space to hear it without becoming it. To honor what it feels without doing what it demands. Something like: \"I see why you feel that way. I'm still going a different way.\"",
      "That \"no\" usually isn't rejection. It comes with the validation, not against it. That is you holding your own ground while still being with the player — the coach who has started coaching.",
      "When parts are met this way, they often begin to settle. There starts to be someone home.",
    ],
  },
  {
    visual: 'unblending',
    title: 'Stage two — Unblending',
    body: [
      '"I am this pain" becomes "I notice this part."',
      "When something difficult surfaces — instead of being consumed by it — there is a moment of space. A witness. Something that can observe the fixer without being the fixer.",
      'This happens in layers. First from the part. Then from what the part believes — "I am not enough" becomes "this is something I carry, not Truth."',
      "Seeing it as the part's isn't the resolution — it's what makes room for one of your own. You can't work out what you stand on while you still think you're standing on the truth.",
      "That second layer is where the world starts to shift.",
      "Real unblending happens on three levels at once — in your thinking, in how it feels, and in your body. All three together is the real thing.",
    ],
  },
  {
    visual: 'release',
    title: 'Stage three — Release',
    body: [
      "Through real relationship with a part, being seen, being received, something changes in how you hold it. The deepest part of this, a hurt letting go of what it has carried, is usually done with a real person present; here the ground for it gets built.",
      "The Fixer stops having to prove anything, and its force is still yours. The Skeptic stops having to brace, and its refusal to be fooled is still yours. The wound stops being the truth about who you are. Nothing gets smaller. Both sides, at full strength, led by you, make something that was never there before.",
      "This stage happens in its own time. It cannot be forced — but it can be prepared for.",
    ],
  },
  {
    visual: 'newCreation',
    title: 'Creating something new',
    body: [
      "A word about what healing actually means here.",
      "Most people think of healing as going back — returning to some original state before the wound. That's not what this is.",
      "The wound changed you. It pressed things out of you that wouldn't have shown themselves otherwise: the Fixer's drive, the Skeptic's discernment, the depth that comes from having felt things. None of that disappears. It gets to be yours, instead of a job.",
      "What you're moving toward has never existed before. Not a restoration of something lost — a creation of something new. A version of yourself that is both shaped by everything you've been through AND no longer limited by it.",
      "This isn't about undoing your history. Who you are was always there, underneath, and has never yet been fully lived. That's what the work is for.",
      "What was always whole underneath gets lived, a little more each time, and what gets built from there is new.",
    ],
  },
  // 'Creating something new' is the last slide in the Healing arc. The
  // BEGIN YOUR MAP button surfaces here automatically because the
  // carousel's atLast check is computed from slides.length.
];

// ===== SECTION 3: USING IT =====
// Card icon variants. The 4-card April spec (chat / map / self / journey) grew
// with the app: two Map Voice mics, the Partner tab, the Journal, and (2026-09)
// the reading. Each variant gets a matching Ionicons glyph in FeatureCard.
//
// 1.4.0 (founder's copy v2, 2026-11-09): there are no modes to name. The Chat
// card says the conversation follows you and that you never choose; the
// Messages card (new) and the cards' offer-and-tap wording say what the M2
// app does. The mode sheet and its "ONE STORY" naming rule went with the mode
// control (f3ffa52).
export type GuideFeature = {
  icon: 'chat' | 'messages' | 'map' | 'self' | 'self-like' | 'partner' | 'journal' | 'journey' | 'reading';
  title: string;
  body: string[];
};

export const USING_FEATURES: GuideFeature[] = [
  {
    icon: 'chat',
    title: 'Chat',
    body: [
      "Chat is where most of it happens. It's one conversation, and it follows you: sometimes it just listens, sometimes it stays with how something feels, sometimes it looks at a pattern with you, sometimes it looks at one belief. You never have to choose or name any of that. \"Can we slow down,\" \"I just want to talk,\" \"why does this keep happening\" all work.",
      "When something you've said sounds like it belongs on your map, the conversation offers it in words and a small card appears under that reply. Your tap is what puts it on the map; nothing goes on without one. You can edit the wording on the card first, or leave it. If you don't tap, the card waits for you in Messages.",
      "The first conversation is a little different: it builds the start of your map, so the conversation leads more and asks a bit more than it usually will, and you decide each entry. After that, it's your space.",
      "You can type, or press and hold the mic to speak. When a conversation goes quiet, a short record of it is written, in your words, and it's there under Journey and the next time you come back.",
    ],
  },
  {
    // New card (founder's copy v2, 2026-11-09): the M2 card's second home.
    icon: 'messages',
    title: 'Messages',
    body: [
      "Messages is where things wait for you. After a conversation goes quiet, the app looks back over it and proposes anything it recognised but didn't offer at the time: a part, something more about a part, where you live between your parts, a moment of being yourself, a key moment. Anything from a shared journal entry comes here too. Cards you didn't tap in the chat land here as well.",
      "Each is a card: tap to add it to your map, edit the words first, or leave it off. Nothing here is on your map until you say so.",
    ],
  },
  {
    icon: 'map',
    title: 'Map',
    body: [
      "The Map is your inner system drawn as one picture: the wound at the centre, the part that pushes and the part that gives up on either side, you in the middle with what you stand on and where you live, the managers and firefighters around, and Self underneath. The shapes are drawn for everyone; what's yours is what you've put on it, in your words, together with the conversation. Tap any part to open what's there. Managers and Firefighters are groups: tapping one opens each protector in it.",
      "A part's folder fills as you add to it: what it does, when it fires, what it protects, how it shows up in your body, your own words for its voice. The wound's folder also holds who that part is underneath what it carries, if you've found that. Self is the one exception: no rows to fill and nothing to add. Self isn't a part to be mapped; it's where the speaking comes from.",
      "Two beliefs live on the map and they're not the same. The wound's belief is the one the rest of the map is arranged around, and it goes on like everything else, offered and tapped. What you stand on, in the You folder, is yours: a belief of your own, formed in the conversation from the moments the old voice was quiet, and you can edit or clear it there.",
      "Two mics sit at the bottom of the Map. The first time you press either, an explainer opens instead of recording; after that, press and hold, say what's alive right now, and let go. Slide your finger up before you let go to throw the take away. The Leading mic waits for one thing before it will record; its card says what.",
    ],
  },
  {
    icon: 'self',
    title: 'Self mic',
    body: [
      "Use the Self mic when you want to be met rather than helped. Press and hold, say what's true, let go. What answers is Self: the part of you that was never hurt, calm, open, without an agenda, speaking to whichever part of you is loud right now. It doesn't fix anything. The point is that you hear what that voice sounds like, so you can recognise it as your own and find it in yourself.",
    ],
  },
  {
    icon: 'self-like',
    title: 'The Leading mic',
    body: [
      "Use the Leading mic when you're ready to lead a part rather than be run by it. It speaks to whichever part is active the way you would from the ground you stand on: your own belief, separate from what your parts believe. It doesn't argue with the part and doesn't ask it to stop. It sees what the part is doing, says what's true in it, and stands where you stand. The point is to hear what that sounds like so you can come to say it yourself.",
      "It opens once you have a belief of your own. Until then it sits dimmed, and pressing it tells you what it's waiting for. Your belief comes out of the conversation, when you've found something of your own to stand on; it's kept in your You folder, where you can edit or clear it.",
      "Once it's set, press and hold, say what's alive, and let go. You don't pick which part it answers: the app listens for the one speaking through you, lights it on the map, and speaks to that one. If it can't tell, it says so and asks you to try again with one specific situation.",
    ],
  },
  // Partner card hidden behind PARTNER_ENABLED for v1 launch — the Guide
  // shouldn't describe a tab that isn't in the bar. Flips back on with
  // the flag (constants/features.ts).
  ...(PARTNER_ENABLED
    ? [{
        icon: 'partner' as const,
        title: 'Partner',
        body: [
          "Partner mode is for relationship work — between you and one person you've connected with through the app. Your private chat is yours; the AI helps you notice patterns about you and them.",
          "First time in, the AI does a short intake — how long you've been together, how you met, what's working, what isn't. After that, sessions are open-ended.",
          "Anything you choose to share with your partner goes through a consent step — nothing is forwarded automatically. Each session ends with a summary and a few practices, which you can keep private, send to your partner, or forward to anyone you want.",
        ],
      }]
    : []),
  {
    icon: 'journal',
    title: 'Journal',
    body: [
      "Free space for whatever needs to come out, typed or spoken. Entries you share with the app are read the way a conversation is: anything it recognises comes to Messages as a card for you to tap, never straight onto the map. One switch in Settings, Share journal with AI, turns sharing off for every new entry from then on; those stay encrypted on your phone, unread, and have no mic, since dictation sends audio to be transcribed.",
    ],
  },
  {
    icon: 'reading',
    title: 'The whole picture',
    body: [
      "A reading is a page written about your whole map at once, instead of a part at a time. It's the one thing the conversation can't do: chat stays with what's in front of you; this stands back and reads all of it together.",
      "It waits until there's enough to read: the belief at the centre, both sides that answer it, and at least one protector with something filled in. Until then the card on the Map tab says what's missing.",
      "When it's ready, tap it on the Map tab. It takes about a minute. A new reading replaces the one you have, so if there's something you want to keep, copy it out first.",
    ],
  },
  {
    icon: 'journey',
    title: 'Journey',
    body: [
      "Journey shows how things have moved over time: three directions (from outside-in to inside-out, from fragmented to integrated, from blended to you leading), the words that keep coming back, and the record of each conversation. It's a way to see movement without a diagnosis, not a score to reach.",
    ],
  },
];

export const USING_PRINCIPLES: string[] = [
  "Come when things are ordinary, not only when they're bad. The map is built from everyday life as much as from hard days, and it gets truer the more of you it has seen.",
  "Be honest about what you're avoiding. The most useful things to share are the ones you're slightly reluctant to say.",
  "Let it surprise you. Something you said in passing may come back as a card you didn't expect. You decide whether it's yours; if it isn't, leave it off.",
  "Use it alongside therapy, not instead of it. What comes up here is yours to bring to your therapist — but the deep work is most safely done with a real person present.",
  "The map is not a verdict. Everything on it is provisional, revisable, and yours to interpret. If something doesn't land — say so.",
];

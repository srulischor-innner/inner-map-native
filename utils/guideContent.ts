// Inner Map Guide content — mirrors the web app's Guide tab word-for-word.
// Three sections: the map, healing, using it.
// Editing copy here is the single source of truth for the mobile Guide tab.

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
  // ----- onboarding / welcome -----
  | 'mapDrawing'           // triangle draws itself, then nodes bloom in
  | 'chatBubble'           // chat bubble silhouette with breathing triangle inside
  | 'nodeDetect'           // node fades in, ripple expands outward, fades
  | 'privacy'              // breathing amber rings around a small lock glyph
  | 'readyToBegin'         // full map fades in; Self brightens last and holds
  // ----- "what holds you" — opens the HEALING section (3 slides) -----
  | 'buildingCapacity'     // base of warm dots builds, threshold line rises
  | 'survivalMode'         // triangle with all three nodes lit + pulsing, then settling
  | 'groundBuilding'       // dim canvas warms as life elements appear, energy flows up
  // ----- legacy visuals (kept so the dispatcher type-checks even if some
  //       older code still references them; not used by current slides) -----
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
// Single source of truth so concepts can be revisited later without
// drifting out of sync with the first-time experience.
export const WELCOME_SLIDES: GuideSlide[] = [
  {
    visual: 'intro',
    title: 'Inner Map',
    body: [
      "Understand what's happening inside you.",
    ],
  },
  {
    visual: 'everyone',
    title: 'We all have patterns',
    body: [
      "Ways we react. Things that trigger us. Feelings we can't explain. Most of us don't fully understand why.",
    ],
  },
  {
    visual: 'mapDrawing',
    title: 'Inner Map helps you see them',
    body: [
      'As you talk, patterns emerge. The same feelings, the same voices, the same pushes and pulls — the AI listens for them and gradually reflects them back. We call it your map.',
    ],
  },
  {
    visual: 'chatBubble',
    title: 'Your map starts as a sketch',
    body: [
      'The more we talk, the more detailed and accurate it becomes. Every conversation adds a layer.',
    ],
  },
  {
    visual: 'nodeDetect',
    title: 'The map changes everything',
    body: [
      'When you can see your patterns clearly — where they come from, what drives them, what holds you back — you stop being surprised by yourself. You start to see the logic underneath what felt like chaos. And once you can see it, you can actually work with it.',
    ],
  },
  {
    // Slide 6 spec: use the breathing full map (every node alive, lines
    // shimmering) instead of the privacy lock — communicates "system
    // alive over time" rather than "your data is private".
    visual: 'fullmap',
    title: 'A companion for the long journey',
    body: [
      "Come when something is activated and you don't know what you're feeling. Come when a pattern repeated and you want to understand why. Come when you need to be heard without advice or fixing. Come when something shifted and you want to mark it. Come when you're in between therapy sessions and need somewhere to land.",
      'The longer you come — the more it knows you. The more it knows you — the more useful it becomes.',
    ],
  },
  {
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
      "Everyone has a wound. Not from trauma necessarily — just from being human. Every child, at some point, encountered something overwhelming and formed a conclusion.",
      "The wound doesn't require a villain. It doesn't require a diagnosis. It just requires being a child in a world too big to fully understand.",
      "The parts that grew up around it aren't signs of damage. They're signs of intelligence — a child being resourceful with what they were given.",
    ],
  },
  {
    visual: 'wound',
    title: 'The Wound',
    titleColor: '#E05050',
    body: [
      "Before the protectors, before the patterns — there was a moment. A child who concluded something about themselves to make sense of what was happening.",
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
      "The Skeptic developed to protect you from the crash. It pumps the brakes before the Fixer overextends. It says: stop, this will end in more pain.",
      "It looks like defeat. From the inside it's dignity — a part paying attention and drawing reasonable conclusions from real evidence.",
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
    title: 'The Self-Like Part',
    titleColor: '#8A7AAA',
    body: [
      "As the fixer pushed outward and the skeptic pulled back, something had to navigate the space between them. The self-like part emerged as the architect of your actual life — the choices, the career, the relationships, the rhythms you built.",
      "Look at what you love. Your work, your interests, the things that give you satisfaction and meaning — much of this lives in the compromise zone. The self-like part found ways to express something real within the constraints of the wound.",
      "What it wants, underneath everything, is simply to feel okay. To find equilibrium. To keep the system stable enough to function. And it has done this — often brilliantly — for your entire life.",
      "The difference between the self-like part and Self is not that one is fake and one is real. Both are real. The difference is agenda. The self-like part always has one. Self has none.",
      "As the wound heals, the self-like part doesn't disappear. It relaxes. The agenda quietly falls away.",
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
      "Self is not built. It's uncovered. The healing work doesn't create Self — it removes what's been covering it.",
    ],
  },
  {
    visual: 'fullmap',
    title: 'Your map',
    body: [
      "This is your map. Not a diagnosis. Not fixed. A living picture of how you're put together — growing more accurate the more you share.",
      "Every conversation adds to it. Every pattern that surfaces, every feeling named — all of it becomes part of the picture.",
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
    visual: 'buildingCapacity',
    title: 'Safety and capacity are the same thing',
    body: [
      "As you build safety in your life, you also build your capacity to hold painful or heavy emotions without being overwhelmed by them.",
      "The stronger your foundation, the more you can feel — and let pass through.",
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
  // The 5 "What Holds You" slides land first — this section is the
  // foundation everything else in HEALING (the three stages + creating
  // something new) builds on. Concatenated rather than rendered as a
  // separate sub-section so the user just scrolls through one ordered
  // sequence within the HEALING pill.
  ...WHAT_HOLDS_YOU_SLIDES,
  {
    visual: 'seed',
    title: 'How healing actually happens',
    body: [
      "Understanding your map is not the same as healing. Insight is the beginning — not the destination.",
      "Healing happens in layers. It's not linear and it's rarely dramatic.",
      "But there is a shape to it — a direction things move when the work is genuine.",
    ],
  },
  {
    visual: 'responsibility',
    title: 'Stage one — Taking responsibility',
    body: [
      "The shift from outside-in to inside-out. The recognition that external things can soothe but never fill.",
      "What's happening inside is an inside job. No relationship, achievement, or circumstance can do what only inner work can do.",
      "This is a conceptual shift — but knowing it and living it are different things.",
    ],
  },
  {
    visual: 'unblending',
    title: 'Stage two — Unblending',
    body: [
      '"I am this pain" becomes "I notice this part."',
      "When something difficult surfaces — instead of being consumed by it — there is a moment of space. A witness. Something that can observe the fixer without being the fixer.",
      "This is not detachment. It's the beginning of genuine Self presence.",
    ],
  },
  {
    visual: 'release',
    title: 'Stage three — Release',
    body: [
      "Through genuine relationship with a part — being truly seen, being truly received — the part begins to see itself differently.",
      "The fixer discovers it doesn't have to prove anything. The skeptic relaxes its vigilance. The wound discovers it is not the truth about who you are.",
      "This stage happens in its own time. It cannot be forced — but it can be prepared for.",
    ],
  },
  {
    visual: 'newCreation',
    title: 'Creating something new',
    body: [
      "A word about what healing actually means here.",
      "Most people think of healing as going back — returning to some original state before the wound. That's not what this is.",
      "The wound changed you. It revealed depths that wouldn't have existed without the breaking. The fixer's extraordinary drive, the skeptic's hard-won wisdom, the sensitivity that comes from having felt things deeply — none of that disappears. It transforms.",
      "What you're moving toward has never existed before. Not a restoration of something lost — a creation of something new. A version of yourself that is both shaped by everything you've been through AND no longer limited by it.",
      "This is why the work is worth doing. Not to undo your history. To become what your history was always pointing toward.",
    ],
  },
  // Closing slide — the last thing a user sees in the entire Guide tab.
  // No header. The words land on their own; the triangle slowly becomes
  // a circle behind them, looping continuously. Felt sense over content.
  {
    visual: 'triangleToCircle',
    title: '',
    body: [
      'You are not broken.',
      'You are compressed.',
      'What you are has always been there —',
      'waiting for the parts to stop fighting',
      'long enough to let it through.',
    ],
  },
];

// ===== SECTION 3: USING IT =====
export type GuideFeature = { icon: 'chat' | 'map' | 'self' | 'journey'; title: string; body: string[] };

export const USING_FEATURES: GuideFeature[] = [
  {
    icon: 'chat',
    title: 'Chat — where your map gets built',
    body: [
      "Just talk. Share what's on your mind, what's been activated lately, what pattern keeps showing up. As you talk the map gradually fills in.",
      "Come when something is alive — not just when everything is fine. Be specific. Notice what you're slightly reluctant to say — that's usually the most important thing.",
    ],
  },
  {
    icon: 'map',
    title: 'Map — see yourself clearly',
    body: [
      "The Map tab shows a visual picture of your inner world. As conversations progress the nodes fill in. Tap any node to see its full folder.",
      "The most powerful feature: tap the microphone on the Map tab and have a live voice conversation while watching the map. The node of whichever part is most active lights up in real time.",
    ],
  },
  {
    icon: 'self',
    title: 'Self — being truly received',
    body: [
      "Sometimes you don't need to explore. You need to be received.",
      "Tapping the Self circle on the map shifts the conversation entirely. No mapping, no detecting, no guiding. Just pure presence and warmth — for when you need to feel held rather than understood.",
    ],
  },
  {
    icon: 'journey',
    title: 'Journey — watching yourself change',
    body: [
      "The Journey tab tracks how you're changing — through patterns in your language over time. It shows which energies are most active and how your two spectrums are moving.",
      "Outside-In → Inside-Out tracks how your protective parts orient to the world. Fragmented → Flowing tracks how your whole system is actually running. Both move slowly. That's correct.",
    ],
  },
];

export const USING_PRINCIPLES: string[] = [
  "Come regularly, not just when things are bad. The map builds over time. Twenty conversations give you a picture of yourself most people never get.",
  "Be honest about what you're avoiding. The most useful things to share are the ones you're slightly reluctant to say.",
  "Let it surprise you. The map sometimes sees things before you consciously do. Don't dismiss that.",
  "Use it alongside therapy, not instead of it. Inner Map can help you go deeper in sessions — but the deep work is most safely done with a real person present.",
  "The map is not a verdict. Everything on it is provisional, revisable, and yours to interpret. If something doesn't land — say so.",
];

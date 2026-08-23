// Age gate — the 18+ eligibility computation, as PURE functions.
//
// WHY THIS FILE EXISTS AS PURE LOGIC:
// Two reasons. (1) It is the only part of the age gate that can be wrong in a
// way nobody notices — an off-by-one at the 18th-birthday boundary silently
// admits 17-year-olds or turns away adults on their birthday. (2) Nothing here
// imports React Native, so scripts/smoke-age-gate.js can require the same
// contract in plain Node and hammer the boundary exhaustively. Keep it that
// way: no RN imports, no AsyncStorage, no Date formatting locale calls.
//
// ============================================================================
// THE STORAGE CONTRACT — READ THIS BEFORE CHANGING ANYTHING HERE
// ============================================================================
// The live Privacy Policy (my-inner-map.com/privacy-policy.html, "What we
// don't collect") states verbatim:
//
//     "We do NOT collect dates of birth (only age confirmation that you're
//      18+)."
//
// So the date of birth entered on this screen is a TRANSIENT INPUT. It exists
// in React component state for as long as the user is on the step, it is
// reduced to a boolean here, and it is then discarded. It is never written to
// AsyncStorage, never written to SecureStore, never put in a log line, and
// never sent over the wire. The server has no field to receive it — see
// POST /api/age-confirm, which 400s on any date-shaped key precisely so this
// promise is enforced by the endpoint and not merely by convention.
//
// If you ever find yourself wanting to persist the date "just for support" or
// "just for analytics", that Privacy line becomes false and the founder would
// need a legal-doc edit he has explicitly not authorised. Derive, gate,
// discard.
//
// ============================================================================
// THE TIMEZONE DECISION — device local calendar, deliberately
// ============================================================================
// The comparison runs entirely on CIVIL DATE TRIPLES (year, month, day) in the
// DEVICE'S LOCAL TIMEZONE. No UTC conversion, no Date subtraction, no
// millisecond arithmetic anywhere in this file.
//
// Why local and not UTC:
//   - What the user types is a civil date. "14 March 2008" carries no
//     timezone; it is a calendar fact, not an instant.
//   - "Today" for the person holding the phone is their local calendar day.
//   - The ruling is that someone whose 18th birthday is TODAY is 18 and must
//     pass. That is only true under the user's own calendar. Comparing against
//     UTC would turn away a user in UTC+13 for the first thirteen hours of
//     their actual birthday, and would admit a user in UTC-8 eight hours
//     early. Local is both the kinder and the more correct reading.
//   - Date-object arithmetic across a DST boundary can shift a "days between"
//     result by one. Comparing triples cannot: there is no duration involved,
//     only an ordering of calendar labels.
//
// The device clock is trusted. A user who sets their clock forward to pass the
// gate has misrepresented their age just as surely as one who types a false
// date, and that misrepresentation is the liability-shifting mechanism the
// gate exists to create. Detecting it is not the job of this file.

/** Minimum age, in years, to use Inner Map. Asserted by both live legal
 *  documents (Terms "Eligibility and age requirement", Privacy "Age
 *  requirement"). */
export const MINIMUM_AGE = 18;

/** Oldest plausible birth year, expressed as an age. Anything older is a
 *  typo (year 1200) rather than a person, and we say "check that" rather
 *  than silently admitting it. Generous on purpose — the oldest verified
 *  human lived to 122, and being wrongly told your birthday is invalid is a
 *  far worse experience than the alternative. */
export const MAX_PLAUSIBLE_AGE = 130;

/** A civil date as the user typed it. All three are already-parsed integers;
 *  `null` means "this box is empty or not yet a number". */
export type DobInput = {
  year: number | null;
  month: number | null; // 1-12, NOT the JS 0-11 convention
  day: number | null;   // 1-31
};

/** A civil date triple known to be complete. Used for "today". */
export type CivilDate = { year: number; month: number; day: number };

export type AgeGateStatus =
  /** At least one box is empty / unparseable. The CTA stays disabled; we say
   *  nothing, because scolding someone mid-typing is obnoxious. */
  | 'incomplete'
  /** Complete, but not a real calendar date (Feb 30, month 13), implausibly
   *  old, or in the future. Distinct from 'under' on purpose: this is a typo,
   *  and a typo must NEVER consume the one retry or trip the block. */
  | 'invalid'
  /** A real, plausible, past date belonging to someone under 18. */
  | 'under'
  /** A real, plausible, past date belonging to someone 18 or older. */
  | 'ok';

/** Days in a given civil month. Handles leap years by the full Gregorian
 *  rule (÷4 yes, ÷100 no, ÷400 yes), so 1900 has 28 and 2000 has 29. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

/** Order two civil dates. Negative if a is earlier, 0 if same day, positive
 *  if a is later. Pure integer comparison — this is the whole reason the
 *  timezone story above holds. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Today, as a civil date in the DEVICE'S LOCAL timezone. Split out so tests
 *  can inject a fixed "today" and so there is exactly one place in the app
 *  that decides what "now" means for the gate. */
export function localToday(now: Date = new Date()): CivilDate {
  return {
    year: now.getFullYear(),   // local, not getUTCFullYear
    month: now.getMonth() + 1, // local, and shifted off the 0-11 convention
    day: now.getDate(),        // local
  };
}

/**
 * The gate. Given what the user typed and what today is, say whether they may
 * proceed — and nothing else. No age in years is returned, deliberately: a
 * caller that cannot see the number cannot be tempted to store it.
 *
 * THE BOUNDARY RULE: a person is 18 on the day their 18th birthday lands, not
 * the day after. So the eligibility date is the birth date with the year moved
 * forward by 18, and the test is `today >= that date` — inclusive.
 *
 * FEB 29 BIRTHDAYS: someone born 2008-02-29 has an eligibility triple of
 * (2026, 2, 29), and 2026 is not a leap year, so that calendar day never
 * occurs. Under the comparison above they become 18 on 2026-03-01 rather than
 * 2026-02-28. Jurisdictions genuinely differ on which is correct. We take
 * March 1 because it is the direction that never admits someone early, and
 * because the cost of the alternative reading is one day of waiting.
 */
export function evaluateDob(input: DobInput, today: CivilDate): AgeGateStatus {
  const { year, month, day } = input;

  // --- completeness ---------------------------------------------------
  // Note !Number.isInteger covers null, NaN, Infinity and 3.5 in one test.
  if (
    !Number.isInteger(year as number) ||
    !Number.isInteger(month as number) ||
    !Number.isInteger(day as number)
  ) {
    return 'incomplete';
  }
  const y = year as number;
  const m = month as number;
  const d = day as number;

  // A year is only "complete" once it has four digits. Without this, typing
  // "2" into the year box reads as year 2 — a complete, ancient, INVALID
  // date — and the user gets told they made a mistake after one keystroke.
  // Partial entry must stay silent.
  if (y < 1000) return 'incomplete';

  // --- real calendar date ---------------------------------------------
  if (m < 1 || m > 12) return 'invalid';
  if (d < 1 || d > daysInMonth(y, m)) return 'invalid'; // Feb 30, Apr 31, Feb 29 in 2025

  const dob: CivilDate = { year: y, month: m, day: d };

  // --- future ----------------------------------------------------------
  // Strictly later than today. Someone born today is 0, which is under 18 and
  // would be caught below anyway, but a FUTURE date is a typo rather than a
  // minor and must not burn the retry or trip the block.
  if (compareCivil(dob, today) > 0) return 'invalid';

  // --- implausibly old -------------------------------------------------
  if (today.year - y > MAX_PLAUSIBLE_AGE) return 'invalid'; // year 1200

  // --- the actual gate --------------------------------------------------
  const eligibleOn: CivilDate = { year: y + MINIMUM_AGE, month: m, day: d };
  return compareCivil(today, eligibleOn) >= 0 ? 'ok' : 'under';
}

/** Parse one digit-box into the integer the gate wants. Empty string → null
 *  (i.e. 'incomplete'), never 0 — otherwise an empty day box would read as
 *  day 0 and render as 'invalid' while the user is still typing. */
export function parseBox(raw: string): number | null {
  const t = (raw || '').trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  return parseInt(t, 10);
}

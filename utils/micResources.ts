// THE RESOURCES A SPOKEN MIC REPLY CARRIES (2026-11-09).
//
// The map's Self and Leading mics answer aloud. On a crisis turn the server
// used to speak the resources, URLs included; on the M2 stack it stops
// speaking URLs and sends the list instead (lib/m2/mics.js CRISIS_RESOURCES,
// as `crisis_resources` on the map-voice turn), for the app to show as links.
// The server's entries look like:
//   { name: "988 Suicide & Crisis Lifeline", where: "US", call: "988", text: "988" }
//   { name: "National Domestic Violence Hotline", for: "abuse or control",
//     call: "1-800-799-7233", text: "START to 88788", url: "https://www.thehotline.org" }
//   { name: "Emergency services", where: "immediate danger",
//     call: "your local emergency number (911 in the US)" }
//
// PURE, so scripts/smoke-mic-resources.mjs runs it. Everything off the wire
// is checked: only a dialable number becomes tel:, only "<WORD> to <digits>"
// or a number becomes sms:, only an https URL becomes a link. Anything else
// is shown as text and never made tappable.

export type MicResourceLink = { kind: 'call' | 'text' | 'web'; label: string; href: string };
export type MicResource = {
  name: string;
  /** "US", "UK and Ireland", "abuse or control", … — whichever the server sent. */
  context: string | null;
  /** The call / text / web values as the server wrote them, for the line under the name. */
  details: string[];
  hours: string | null;
  links: MicResourceLink[];
};

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A number a phone can dial: digits with spaces, dashes, dots or brackets,
 *  3 to 15 digits. "your local emergency number (911 in the US)" is not. */
function dialable(v: string): string | null {
  if (!/^[+\d][\d\s().-]*$/.test(v)) return null;
  const digits = v.replace(/[^\d+]/g, '');
  const n = digits.replace(/\+/g, '').length;
  return n >= 3 && n <= 15 ? digits : null;
}

/** "988" → sms:988; "START to 88788" → sms:88788 with body START. */
function textHref(v: string): string | null {
  const keyword = v.match(/^([A-Za-z]{2,20}) to ([\d\s-]{3,15})$/);
  if (keyword) {
    const to = dialable(keyword[2]);
    return to ? `sms:${to}?body=${encodeURIComponent(keyword[1].toUpperCase())}` : null;
  }
  const to = dialable(v);
  return to ? `sms:${to}` : null;
}

function webHref(v: string): string | null {
  return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(v) ? v : null;
}

/** The server's list as the card shows it. Unknown shapes are dropped;
 *  an entry with nothing usable but its name still shows its name. */
export function parseMicResources(raw: unknown): MicResource[] {
  if (!Array.isArray(raw)) return [];
  const out: MicResource[] = [];
  for (const r of raw.slice(0, 12)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const name = str(o.name, 80);
    if (!name) continue;
    const call = str(o.call, 80);
    const text = str(o.text, 80);
    const url = str(o.url, 200);
    const links: MicResourceLink[] = [];
    const tel = call ? dialable(call) : null;
    if (tel) links.push({ kind: 'call', label: `Call ${call}`, href: `tel:${tel}` });
    const sms = text ? textHref(text) : null;
    if (sms) links.push({ kind: 'text', label: `Text ${text}`, href: sms });
    const web = url ? webHref(url) : null;
    if (web) links.push({ kind: 'web', label: url.replace(/^https:\/\/(www\.)?/i, '').replace(/\/$/, ''), href: web });
    const details: string[] = [];
    if (call && !tel) details.push(call);
    out.push({
      name,
      context: str(o.where, 60) || str(o.for, 60) || null,
      details,
      hours: str(o.hours, 120) || null,
      links,
    });
  }
  return out;
}

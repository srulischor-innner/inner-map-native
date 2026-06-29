// Display helpers for a session's "started vs last-active" provenance.
//
// Sessions are ordered by updatedAt (last activity) so a reopened/continued
// session rises to the top of the list + Journey timeline — but its `date`
// stays pinned to when it began. continuedLabel() surfaces the difference
// truthfully: "continued today" / "continued yesterday" / "continued Jun 27",
// or null when the session hasn't been continued on a later calendar day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Returns a "continued <when>" label when the session's last activity
 *  (updatedAt) lands on a calendar day LATER than its start date, else null.
 *  startDate is 'YYYY-MM-DD'; updatedAt is an ISO timestamp string. */
export function continuedLabel(startDate?: string | null, updatedAt?: string | null): string | null {
  if (!startDate || !updatedAt) return null;
  const upDay = String(updatedAt).slice(0, 10); // 'YYYY-MM-DD'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(upDay)) return null;
  if (upDay <= startDate) return null; // same day (or earlier) → not continued

  const today = new Date();
  const todayStr = ymd(today);
  const yesterdayStr = ymd(new Date(today.getTime() - 24 * 60 * 60 * 1000));

  if (upDay === todayStr) return 'continued today';
  if (upDay === yesterdayStr) return 'continued yesterday';
  const [, m, d] = upDay.split('-');
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `continued ${MONTHS[mi]} ${parseInt(d, 10)}`;
}

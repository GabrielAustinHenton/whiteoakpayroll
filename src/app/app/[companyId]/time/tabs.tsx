/** Sub-navigation for the Time Tracking pages. */
export function TimeTabs({ companyId, manage }: { companyId: string; manage: boolean }) {
  const base = `/app/${companyId}/time`;
  return (
    <nav className="time-tabs small" aria-label="Time Tracking">
      <a href={base}>Timecards</a>
      <a href={`${base}/locations`}>Work locations</a>
      {manage && <a href={`${base}/settings`}>Settings</a>}
    </nav>
  );
}

// Magnitude -> color scale (green minor, yellow-orange moderate, red major)
export function magnitudeColor(mag) {
  if (mag == null) return '#888';
  if (mag < 2) return '#4ade80'; // green
  if (mag < 4) return '#a3e635'; // yellow-green
  if (mag < 5) return '#facc15'; // yellow
  if (mag < 6) return '#fb923c'; // orange
  return '#ef4444'; // red
}

export function magnitudeRadius(mag) {
  if (mag == null) return 4;
  return Math.max(4, mag * 3.2);
}

export function magnitudeLabel(mag) {
  if (mag == null) return 'Unknown';
  if (mag < 2) return 'Minor';
  if (mag < 4) return 'Light';
  if (mag < 5) return 'Moderate';
  if (mag < 6) return 'Strong';
  return 'Major';
}

export function timeAgo(ms) {
  if (!ms) return 'unknown time';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

export function formatTimestamp(ms) {
  if (!ms) return 'Unknown';
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

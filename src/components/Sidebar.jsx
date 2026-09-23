import { magnitudeColor, magnitudeLabel, timeAgo } from '../utils/magnitude';

export default function Sidebar({ quakes, selectedQuake, onSelect }) {
  const recent = [...quakes].sort((a, b) => b.time - a.time).slice(0, 10);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Recent activity</h2>
        <span className="sidebar-count">{quakes.length} shown</span>
      </div>
      <ul className="quake-list">
        {recent.length === 0 && <li className="quake-list-empty">No earthquakes match current filters.</li>}
        {recent.map((q) => (
          <li
            key={q.id}
            className={`quake-list-item ${selectedQuake?.id === q.id ? 'selected' : ''}`}
            onClick={() => onSelect(q)}
          >
            <div
              className="quake-list-mag"
              style={{ backgroundColor: magnitudeColor(q.magnitude) }}
            >
              {q.magnitude?.toFixed(1)}
            </div>
            <div className="quake-list-info">
              <div className="quake-list-place">{q.place}</div>
              <div className="quake-list-meta">
                <span>{magnitudeLabel(q.magnitude)}</span>
                <span>&middot;</span>
                <span>{timeAgo(q.time)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

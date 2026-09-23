import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { magnitudeColor, magnitudeRadius, magnitudeLabel, timeAgo, formatTimestamp } from '../utils/magnitude';

const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const DARK_TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function FlyToSelected({ quake }) {
  const map = useMap();
  useEffect(() => {
    if (quake) {
      map.flyTo([quake.lat, quake.lon], Math.max(map.getZoom(), 4), { duration: 0.6 });
    }
  }, [quake, map]);
  return null;
}

export default function EarthquakeMap({ quakes, selectedQuake, onSelect }) {
  const markerRefs = useRef({});

  useEffect(() => {
    if (selectedQuake && markerRefs.current[selectedQuake.id]) {
      markerRefs.current[selectedQuake.id].openPopup();
    }
  }, [selectedQuake]);

  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      worldCopyJump
      className="quake-map"
      preferCanvas
    >
      <TileLayer url={DARK_TILE_URL} attribution={DARK_TILE_ATTR} />
      {selectedQuake && <FlyToSelected quake={selectedQuake} />}
      {quakes.map((q) => (
        <CircleMarker
          key={q.id}
          center={[q.lat, q.lon]}
          radius={magnitudeRadius(q.magnitude)}
          pathOptions={{
            color: magnitudeColor(q.magnitude),
            fillColor: magnitudeColor(q.magnitude),
            fillOpacity: 0.65,
            weight: 1,
          }}
          eventHandlers={{ click: () => onSelect(q) }}
          ref={(el) => {
            if (el) markerRefs.current[q.id] = el;
          }}
        >
          <Popup>
            <div className="quake-popup">
              <div className="quake-popup-mag" style={{ color: magnitudeColor(q.magnitude) }}>
                M {q.magnitude?.toFixed(1)} &middot; {magnitudeLabel(q.magnitude)}
              </div>
              <div className="quake-popup-place">{q.place}</div>
              <div className="quake-popup-row">
                <span>Depth</span>
                <span>{q.depth != null ? `${q.depth.toFixed(1)} km` : 'Unknown'}</span>
              </div>
              <div className="quake-popup-row">
                <span>Time</span>
                <span>{timeAgo(q.time)}</span>
              </div>
              <div className="quake-popup-row quake-popup-timestamp">
                {formatTimestamp(q.time)}
              </div>
              <div className="quake-popup-source">Source: {q.source}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

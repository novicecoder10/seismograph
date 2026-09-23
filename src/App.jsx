import { useEffect, useState, useCallback } from 'react';
import EarthquakeMap from './components/EarthquakeMap';
import Sidebar from './components/Sidebar';
import { fetchEarthquakes } from './utils/fetchEarthquakes';
import './App.css';

function App() {
  const [quakes, setQuakes] = useState([]);
  const [selectedQuake, setSelectedQuake] = useState(null);
  const [source, setSource] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const loadData = useCallback(async () => {
    try {
      const { quakes: data, source: src, fetchedAt } = await fetchEarthquakes('day');
      setQuakes(data);
      setSource(src);
      setLastUpdated(fetchedAt);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Seismograph</h1>
          <span className="app-subtitle">Live global earthquake tracker</span>
        </div>
        <div className="status-badge">
          {status === 'loading' && <span className="badge badge-loading">Loading&hellip;</span>}
          {status === 'ready' && (
            <>
              <span className={`badge badge-source badge-${source?.toLowerCase()}`}>
                {source}
              </span>
              <span className="badge-updated">
                Updated {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            </>
          )}
          {status === 'error' && <span className="badge badge-error">Data unavailable</span>}
        </div>
      </header>

      <main className="app-main">
        {status === 'error' ? (
          <div className="error-panel">
            <h2>Couldn&rsquo;t load earthquake data</h2>
            <p>{errorMsg}</p>
            <button onClick={loadData}>Retry</button>
          </div>
        ) : (
          <>
            <EarthquakeMap
              quakes={quakes}
              selectedQuake={selectedQuake}
              onSelect={setSelectedQuake}
            />
            <Sidebar quakes={quakes} selectedQuake={selectedQuake} onSelect={setSelectedQuake} />
          </>
        )}
        {status === 'loading' && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p>Fetching latest earthquakes&hellip;</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;

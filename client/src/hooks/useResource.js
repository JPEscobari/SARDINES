import { useEffect, useState } from 'react';
// Loaders are stable module-level functions. Unmounted/stale requests never replace newer state.
export default function useResource(loader, revision = 0) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) setState({ data: null, loading: true, error: '' }); return loader(); })
      .then(data => { if (active) setState({ data, loading: false, error: '' }); })
      .catch(error => { if (active) setState({ data: null, loading: false, error: error.message }); });
    return () => { active = false; };
  }, [loader, revision]);
  return state;
}

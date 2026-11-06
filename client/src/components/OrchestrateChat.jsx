import { useEffect, useRef } from 'react';

// These are read from .env via Vite's VITE_ prefix (safe for client bundle, not secret keys)
const ORCHESTRATION_ID = import.meta.env.VITE_WATSONX_ORCHESTRATION_ID;
const AGENT_ID = import.meta.env.VITE_WATSONX_AGENT_ID;
const HOST_URL = 'https://eu-gb.watson-orchestrate.cloud.ibm.com';
const ROOT_ID = 'wxo-chat-root';

export default function OrchestrateChat() {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    // Ensure the root element exists in the DOM before the loader runs
    const rootEl = document.getElementById(ROOT_ID);
    if (!rootEl) return;

    window.wxOConfiguration = {
      orchestrationID: ORCHESTRATION_ID,
      hostURL: HOST_URL,
      rootElementID: ROOT_ID,
      deploymentPlatform: 'ibmcloud',
      crn: import.meta.env.VITE_WATSONX_CRN,
      chatOptions: {
        agentId: AGENT_ID,
        openChatByDefault: true,
        showLauncher: false,
      },
    };

    // Remove any previously injected loader script to avoid duplicates on HMR
    const existing = document.querySelector('script[src*="wxoLoader.js"]');
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.src = `${HOST_URL}/wxochat/wxoLoader.js?embed=true`;

    // wxoLoader is declared as `var` inside the script's IIFE — it becomes a
    // global only after the script fully executes. Poll briefly after load.
    script.onload = () => {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        // eslint-disable-next-line no-undef
        if (typeof wxoLoader !== 'undefined' && typeof wxoLoader.init === 'function') {
          clearInterval(poll);
          // eslint-disable-next-line no-undef
          wxoLoader.init(window.wxOConfiguration);
        } else if (attempts > 20) {
          clearInterval(poll);
          console.error('[OrchestrateChat] wxoLoader.init not found after 2s');
        }
      }, 100);
    };
    document.head.appendChild(script);
  }, []);

  return (
    <div
      id={ROOT_ID}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '4px',
      }}
    />
  );
}

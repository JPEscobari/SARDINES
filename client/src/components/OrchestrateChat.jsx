import { useEffect, useRef } from 'react';

const ORCHESTRATION_ID = '7838179339f5461d966c1b1b23929de7_502d0951-4120-41ff-9da2-7464a95e1e25';
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
      crn: `crn:v1:bluemix:public:watsonx-orchestrate:eu-gb:a/7838179339f5461d966c1b1b23929de7:502d0951-4120-41ff-9da2-7464a95e1e25::`,
      chatOptions: {
        agentId: '72654d07-d228-4e9e-93b0-61aebeedf283',
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

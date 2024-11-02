import { Log } from '$lib';

const handleMessage = (e: Event) => rxSandbox(e);

export const rxListen = () => {
  window.addEventListener('message', handleMessage);
};

// Function to remove the listener
export const rxDispose = () => {
  window.removeEventListener('message', handleMessage);
};

// mostly a passthrough module at present -- 
// sandbox events can undergo filtering of validation before being re-emitted

// receive (serialized w/ structuredClone)
export const rxSandbox = (e: Event) => {
  // if (e.origin !== 'parent-origin') return; 

  const tx: string = e.data.tx;
  switch (tx) {
    // RESP.
    case 'sandbox-build-start':
      Log.debug('Sandbox build started.')
      break;
    case 'sandbox-render-stop':
      Log.debug('Sanbox render stopped.');
      break;
    case 'sandbox-status-report':
      Log.debug('Sandbox status received. ', e.data.status);
      break;
    case 'sandbox-resize-confirm':
      Log.debug('Sandbox resize confirmation received.');
      break;
    // SPONT.
    case 'sandbox-build-success':
      Log.debug('Sandbox build successful.');
      window.dispatchEvent(new CustomEvent('build-success'));
      break;
    case 'sandbox-error':
      window.dispatchEvent(new CustomEvent('build-error', {
        detail: {
          name:     e.data.name,
          message:  e.data.err,
          hash:     e.data.hash,
        },
      }));
      Log.scriptError(e.data.err);
      break;
    case 'sandbox-stack-line':
      window.dispatchEvent(new CustomEvent('build-err-stack-line', {
        detail: {
          source: e.data.source,
          lineno: e.data.lineno,
          colno:  e.data.colno,
          hash:   e.data.hash,
        },
      }));
      break;
    case 'sandbox-error-frag':
      window.dispatchEvent(new CustomEvent('build-err-frag', {
        detail: {
          frag:     e.data.frag,
          hash:     e.data.hash,
        },
      }));
      break;
    // I dont think a default warning is necessary. Something will be always spamming messages, for some reason.
    // default:
    //   Log.warning('Unrecognized message: ', e);
  }
};

// transmit
export const txBuild = (sandbox: Window, script: string) => {
  sandbox.postMessage({ tx: 'harbor-build', script: script });
  window.dispatchEvent(new CustomEvent('build-start', {
    detail: {
      script:   script,
    }
  }));
};

export const txStop = (sandbox: Window) => {
  sandbox.postMessage({ tx: 'harbor-stop' });
};

export const txStatus = (sandbox: Window) => {
  sandbox.postMessage({ tx: 'harbor-status' });
};

export const txResize = (sandbox: Window, width:number, height:number ) => {
  sandbox.postMessage({ tx: 'harbor-resize', width: width, height: height });
};
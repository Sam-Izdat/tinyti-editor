import { writable } from 'svelte/store';

// Define types for stack trace lines and the main store structure
interface StackTraceLine {
  source: string;
  lineno: number;
  colno: number;
}

type StackTraceMap = Map<string, StackTraceLine[]>;

function createStackTraceStore() {
  const { subscribe, update, set } = writable<StackTraceMap>(new Map());

  return {
    subscribe,
    addTrace(errorId: string, line: StackTraceLine) {
      update((traces) => {
        const traceLines = traces.get(errorId) || [];
        traceLines.push(line);
        traces.set(errorId, traceLines);
        return traces;
      });
    },
    setTrace(errorId: string, traceLines: StackTraceLine[]) {
      update((traces) => {
        traces.set(errorId, traceLines);
        return traces;
      });
    },
    clear() {
      set(new Map());
    }
  };
}
export const StackTrace = createStackTraceStore();
import { writable } from 'svelte/store';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

// Initialize with undefined so it can be set when the editor mounts
export const monacoStore = writable<typeof Monaco>(undefined);
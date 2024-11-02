<script lang="ts">
  import { Log } from '$lib';
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { StackTrace } from '$lib/stores';
  import type { StackTraceMap, StackTraceLine } from '$lib/stores/stack_trace';
  import { instance } from "@viz-js/viz";
  import { makeDotCallGraph } from '$lib';

  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
  export let monacoEditor: Monaco.editor.IStandaloneCodeEditor;
  import { monacoStore } from '$lib/stores';
  import { get } from 'svelte/store';
  let monaco: typeof Monaco = get(monacoStore);
  monacoStore.subscribe(value => (monaco = value));

  // State
  let errors: Map = new Map();
  let script: string  = '';
  let decorations: monaco.editor.IEditorDecorationsCollection;

  // Icons
  import { Icon } from 'svelte-hero-icons';
  import * as hero from 'svelte-hero-icons';
  import { CustomIcon } from '$lib/components/icons';
  import * as ico from '$lib/components/icons';

  const highlightText = (searchString) => {
    // Get the editor model
    const model = monacoEditor;
    const content = model.getValue();

    // Find position of the search string
    const startIndex = content.indexOf(searchString);
    if (startIndex === -1) return; // Text not found

    // Calculate start and end position
    const startPosition = model.getPositionAt(startIndex);
    const endPosition = model.getPositionAt(startIndex + searchString.length);

    // Set markers for highlighting
    monaco.editor.setModelMarkers(model, 'highlightOwner', [
      {
        severity: monaco.MarkerSeverity.Warning, // You can change this to Error, Info, etc.
        startLineNumber: startPosition.lineNumber,
        startColumn: startPosition.column,
        endLineNumber: endPosition.lineNumber,
        endColumn: endPosition.column,
        message: `Highlight: "${searchString}"`,
      }
    ]);
  };

  const markLineCol = (err, lineno, colno) => {
    const model = monacoEditor.getModel();
    const wordInfo = model.getWordAtPosition({ lineNumber: lineno, column: colno });
    const endColumn = wordInfo ? wordInfo.endColumn : startColumn + 1;
    decorations.set([
      {
        range: new monaco.Range(lineno, 1, lineno, 1),
        options: {
          isWholeLine: true,
          className: "compileErrorGlyph",
          glyphMarginClassName: "compileErrorBackground",
        },
      },
    ]);
    monaco.editor.setModelMarkers(model, 'taichijs', [
      {
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: lineno,
        startColumn: colno,
        endLineNumber: lineno,
        endColumn: endColumn,
        message: err,
      }
    ]);
  };

  function unMarkLines(){
    const model = monacoEditor.getModel()
    if (model) {
      monaco.editor.setModelMarkers(model, "taichijs", [])
      decorations.set([])
    }
  };

  const drawSVG = (id, lineno, colno, dotGraph, currentNode, prevNode, nextNode) => {
    if (browser) {

      // Maybe, maybe not:
      // rankdir="LR";
      const dot = `
  digraph { 
  size="6.5,6.5"
  node [colorscheme=set39]
  node [shape=ellipse, style="filled", fillcolor=4, fontname="Consolas"]
    ${currentNode}
  ${nextNode ? `node [shape=record, style="filled", fillcolor=2, fontname="Consolas"]\n  `+nextNode : ''}
  ${prevNode ? `node [shape=record, style="filled", fillcolor=6, fontname="Consolas"]\n  `+prevNode : ''}
  node [shape=box, style="filled", fillcolor=1, fontname="Consolas"];
    ${dotGraph}
    bgcolor=transparent
  }`;
      instance().then(viz => {
        const el = document.querySelector(`#callgraph_${id}_${lineno}_${colno}`);
        el.replaceChildren();
        el.appendChild(viz.renderSVGElement(dot));
      });
    }
  };

  const findAdjacentLines = (
  id: string,
  source: string,
  lineno: number,
  colno: number
  ): { previous?: StackTraceLine; next?: StackTraceLine } => {
    const lines = $StackTrace.get(id);

    if (!lines) return {};

    const index = lines.findIndex(line => line.lineno === lineno && line.colno === colno);

    if (index === -1) return {};

    return {
      previous: index > 0 ? lines[index - 1].source : '',
      next: index < (lines.length - 1) ? lines[index + 1].source : '',
    };
  };

  const makeGraph = (id, source, lineno, colno) => {
    const containerEl = document.querySelector(`#row_${id}_${lineno}_${colno}`);
    if (containerEl.classList.contains('hidden')) {        
      const dot = makeDotCallGraph(script, source);
      const adjacent = findAdjacentLines(id, source, lineno, colno);
      drawSVG(id, lineno, colno, dot, source, adjacent.previous, adjacent.next);
    }    
    containerEl.classList.toggle('hidden');
  };

  // Register event listeners on mount and remove them on destroy
  onMount(async () => {
    if (browser) {
      const handleBuildStart = (e: CustomEvent) => {
        if (decorations) unMarkLines();
        decorations = monacoEditor.createDecorationsCollection([]); 
        StackTrace.clear();
        errors.clear();
        script = e.detail.script ?? '';
      }

      const handleError = (e: CustomEvent) => {
        const { name, message, hash } = e.detail;
        errors.set(hash, `${name}: ${message}`);
      };

      const handleStackLine = (e: CustomEvent) => {
        const { source, lineno, colno, hash } = e.detail;
        StackTrace.addTrace(hash, { source, lineno, colno });
        if ($StackTrace.size == 1 && $StackTrace.values().next().value.length == 1) {
          unMarkLines();
          markLineCol(errors.get(hash) ?? 'error', lineno, colno);
        }
      };

      const handleErrorFrag = (e: CustomEvent) => {
        const { frag, hash } = e.detail;
        Log.debug(`Error fragment received: ${frag}`);
        // Optionally, you could also update StackTrace or handle the fragment differently here
      };

      // Add event listeners
      window.addEventListener('build-start', handleBuildStart as EventListener);
      window.addEventListener('build-error', handleError as EventListener);
      window.addEventListener('build-err-stack-line', handleStackLine as EventListener);
      window.addEventListener('build-err-frag', handleErrorFrag as EventListener);
    }
  });
  // Remove event listeners on component destroy
  onDestroy(() => {
    if (browser) {
      window.removeEventListener('build-start', handleBuildStart as EventListener);
      window.removeEventListener('build-error', handleError as EventListener);
      window.removeEventListener('build-err-stack-line', handleStackLine as EventListener);
      window.removeEventListener('build-err-frag', handleErrorFrag as EventListener);
    }
  });
</script>

<!-- Iterate through stack traces, displaying each in a table -->
{#each $StackTrace as [errorId, stackLines]}
<h2>{errors.get(errorId) ?? ''}</h2>
<div class="table-container w-full shadow-xl">
  <table class="table table-hover">
    <thead>
      <tr>
        <th class="w-full !p-1">Source</th>
        <th class="w-24 !p-1">Line</th>
        <th class="w-24 !p-1">Col</th> 
        <th class="w-24 !p-1">Graph</th> 
      </tr>
    </thead>
    <tbody class="font-mono">
      {#each stackLines as { source, lineno, colno }}
        <tr>
          <td class="!pt-1 !pb-1">
            <button class="w-full text-left" on:click={
              () => { unMarkLines(); markLineCol(errors.get(errorId), lineno, colno); }
            }>
              {source}
            </button>
          </td>
          <td class="!pt-1 !pb-1">{lineno}</td>
          <td class="!pt-1 !pb-1">{colno}</td>
          <td class="!pt-1 !pb-1">
            <button class="w-full flex justify-center items-center" on:click={
              () => { makeGraph(errorId, source, lineno, colno); }
            }>
              <Icon src={hero.MagnifyingGlass} size='16' />
            </button>
          </td>
        </tr>
        <tr>
          <td id="row_{errorId}_{lineno}_{colno}" colspan=4 class="!pt-1 !pb-1 hidden">
            <div id="callgraph_{errorId}_{lineno}_{colno}" class="h-fit w-full flex justify-center p-2 callgraph" />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{/each}
<style>
:global(.callgraph > svg, .callgraph > svg)  {
  filter: drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.4)) !important;
}
:global(.compileErrorGlyph) {
  background-color: rgba(255, 0, 0, 0.2); /* Just an example color */
}
:global(.compileErrorBackground) {
  border-left: 2px solid red;
}
</style>
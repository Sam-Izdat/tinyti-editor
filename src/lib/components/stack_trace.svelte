<script lang="ts">
  import type { SvelteComponent } from 'svelte';
  import { Accordion, AccordionItem } from '@skeletonlabs/skeleton';
  import { TabGroup, Tab, TabAnchor } from '@skeletonlabs/skeleton';

  import { Log } from '$lib';
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { StackTrace } from '$lib/stores';
  import type { StackTraceMap, StackTraceLine } from '$lib/stores/stack_trace';
  import { instance } from "@viz-js/viz";
  import { makeDotCallGraph, findEnclosingJSFunction } from '$lib';

  import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
  export let monacoEditor: Monaco.editor.IStandaloneCodeEditor;
  import { monacoStore, isDark } from '$lib/stores';
  import { get } from 'svelte/store';
  let monaco: typeof Monaco = get(monacoStore);
  monacoStore.subscribe(value => (monaco = value));

  // export let parent: SvelteComponent;

  // State
  let errors: Map = new Map();
  let script: string  = '';
  let decorations: monaco.editor.IEditorDecorationsCollection;

  // Icons
  import { Icon } from 'svelte-hero-icons';
  import * as hero from 'svelte-hero-icons';
  import { CustomIcon } from '$lib/components/icons';
  import * as ico from '$lib/components/icons';

  const findCodeString = (searchString) => {
    const model = monacoEditor.getModel();
    const content = model.getValue();

    const startIndex = content.indexOf(searchString);
    if (startIndex === -1) return; 

    const startPosition = model.getPositionAt(startIndex);
    const endPosition = model.getPositionAt(startIndex + searchString.length);
    return {
      lineStart: startPosition.lineNumber, 
      colStart: startPosition.column, 
      lineEnd: endPosition.lineNumber, 
      colEnd:endPosition.column,
      };
  };

  const markLineCol = (err, lineStart, colStart, lineEnd = null, colEnd = null) => {
    const model = monacoEditor.getModel();
    const wordInfo = model.getWordAtPosition({ lineNumber: lineStart, column: colStart });
    const lineContent = model.getLineContent(lineStart);
    const colEndToken = wordInfo ? wordInfo.endColumn : lineContent.length + 1;
    decorations.set([
      {
        range: new monaco.Range(lineStart, 1, lineStart, 1),
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
        startLineNumber: lineStart,
        startColumn: colStart,
        endLineNumber: lineEnd ?? lineStart,
        endColumn: colEnd ?? colEndToken,
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

      if (nextNode) dotGraph = dotGraph.replace('"'+currentNode+'" -> "'+nextNode+'";', '');
      if (prevNode) dotGraph = dotGraph.replace('"'+prevNode+'" -> "'+currentNode+'";', '');
      // ${dotGraph}
      const dot = `
  digraph { 
  size="6.5,6.5"
  rankdir="LR"
  
  node [colorscheme=set39]
  node [shape=rect, style="filled", fillcolor=4, fontname="Consolas"]
  edge[arrowhead=tee, arrowsize=0.85, color="${$isDark ? 'white' : 'black'}", fontsize=10, fontcolor=navy]
    "${currentNode}"
  ${nextNode ? 'node [shape=rect, style="filled", fillcolor=2, fontname="Consolas"]\n  "'+currentNode+'" -> "'+nextNode+'"\n' : ''}
  ${prevNode ? 'node [shape=rect, style="filled", fillcolor=6, fontname="Consolas"]\n  "'+prevNode+'" -> "'+currentNode+'"\n' : ''}
  node [shape=rect, style="filled", fillcolor=1, fontname="Consolas"]; 
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
      next: index > 0 ? lines[index - 1].source : '',
      previous: index < (lines.length - 1) ? lines[index + 1].source : '',
    };
  };

  const makeGraph = (id, source, lineno, colno) => {
    lineno = parseInt(lineno);
    colno = parseInt(colno);
    const containerEl = document.querySelector(`#row_${id}_${lineno}_${colno}`);
    if (containerEl.classList.contains('hidden')) {        
      const dot = makeDotCallGraph(script, source, lineno, colno);
      const adjacent = findAdjacentLines(id, source, lineno, colno);
      drawSVG(id, lineno, colno, dot, source, adjacent.previous, adjacent.next);
    }    
    containerEl.classList.toggle('hidden');
  };

  const jumpToPos = (lineno, colno) => {
    monacoEditor.setPosition({ lineNumber: lineno, column: colno });
    monacoEditor.revealPositionInCenter({ lineNumber: lineno, column: colno });
  }

  const handleBuildStart = (e: CustomEvent) => {
    if (decorations) unMarkLines();
    decorations = monacoEditor.createDecorationsCollection([]); 
    StackTrace.clear();
    errors.clear();
    script = e.detail.script ?? '';
  };

  const handleErrorSelect = (message, lineno, colno) => {
    unMarkLines(); 
    markLineCol(message, lineno, colno);
    jumpToPos(lineno, colno);
  }

  // Register event listeners on mount and remove them on destroy
  onMount(async () => {
    if (browser) {

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
        const positions = findCodeString(frag);
        const source = findEnclosingJSFunction(script, positions.lineStart, positions.colStart );
        StackTrace.addTrace(hash, { source: source, lineno: positions.lineStart, colno: positions.colStart });
        if ($StackTrace.size == 1 && $StackTrace.values().next().value.length == 1) {
          unMarkLines();
          markLineCol(errors.get(hash) ?? 'Taichi JS error', positions.lineStart, positions.colStart, positions.lineEnd, positions.colEnd);
        }
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


<Accordion>
  <AccordionItem open padding="py-1 px-px">
    <svelte:fragment slot="lead">
      <Icon src="{hero.CircleStack}" size="20" class="mx-0 my-1" solid/>
    </svelte:fragment>
    <svelte:fragment slot="summary"><p class="font-semibold text-base">Debug</p></svelte:fragment>
    <svelte:fragment slot="content">


    <Accordion padding="py-1 px-0.5">

      {#each $StackTrace as [errorId, stackLines]}
      <AccordionItem open class="variant-ghost-error ">
        <svelte:fragment slot="lead">
          <Icon src="{hero.ExclamationCircle}" size="20" class="ml-2 mr-0 my-0" solid/>
        </svelte:fragment>
        <svelte:fragment slot="summary">
          <p class="font-semibold text-base alert m-1 p-1">
            {errors.get(errorId) ?? ''}
          </p>
        </svelte:fragment>
        <svelte:fragment slot="content">
          <div class="table-container w-full shadow-xl p-0 m-0">
            <table class="table table-hover m-0">
              <thead>
                <tr>
                  <th class="w-full !p-1">Stack Trace</th>
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
                        () => { handleErrorSelect(errors.get(errorId), lineno, colno) }
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
        </svelte:fragment>
      </AccordionItem>
      {/each}
    </Accordion>

    </svelte:fragment>
  </AccordionItem>
</Accordion>
<style>
:global(.callgraph > svg)  {
  width: 100%;
  filter: drop-shadow(2px 4px 6px rgba(0, 0, 0, 0.4)) !important;
}
:global(.callgraph > svg polygon)  {
  opacity: 0.2 !important;
}

:global(html.dark .callgraph > svg)  {
  fill: #fff !important;
}

:global(.callgraph > svg text)  {
  padding: 10px;
}

:global(.compileErrorGlyph) {
  background-color: rgba(255, 0, 0, 0.2); /* Just an example color */
}
:global(.compileErrorBackground) {
  border-left: 2px solid red;
}
</style>
<script>
import { instance } from "@viz-js/viz";
import { onMount, onDestroy } from 'svelte';
import { browser } from '$app/environment';
import { makeDotCallGraph } from '$lib';


        // node [colorscheme=set39];
        // node [shape=record, style="filled", fillcolor=1]
        //     main
        // node [shape=ellipse, style="filled", fillcolor=4]
        //     foo
const drawGraph = (dotGraph, currentNode, prevNode, nextNode) => {
  if (browser) {

    // Maybe, maybe not:
    // rankdir="LR";
    const dot = `
digraph { 
size="6.5,6.5"
node [colorscheme=set39]
node [shape=record, style="filled", fillcolor=4, fontname="Consolas"]
  ${currentNode}
${nextNode ? `node [shape=record, style="filled", fillcolor=2, fontname="Consolas"]\n  `+nextNode : ''}
${prevNode ? `node [shape=record, style="filled", fillcolor=6, fontname="Consolas"]\n  `+prevNode : ''}
node [shape=box, style="filled", fillcolor=1, fontname="Consolas"];
  ${dotGraph}
  bgcolor=transparent
}`;
    instance().then(viz => {
      document.querySelector('#callgraph').appendChild(viz.renderSVGElement(dot))
    });
  }
};

var code = `
console.log('a');
const anotherPrettyLongName = () => { does_not_exist(); }
const aRatherLongFunctionName = () => { anotherPrettyLongName(); }
const bee = () => {}
function letsMakeThisOneLong() { aRatherLongFunctionName(); anotherPrettyLongName(); letsMakeThisOneLong(); notmain(); bee()};
function notmain() { letsMakeThisOneLong(); anotherPrettyLongName(); };
function main() { letsMakeThisOneLong(); anotherPrettyLongName(); };
main();
`;

const testDot = makeDotCallGraph(code, 'letsMakeThisOneLong');
drawGraph(testDot, 'letsMakeThisOneLong', 'main', 'anotherPrettyLongName');
onMount(async () => {

});


// console.log(makeDotCallGraph(code, 'compute_area_light_pdf'));
</script>

<div id="callgraph" class="h-96 w-full flex justify-center overflow-auto">
</div>

<style>

</style>
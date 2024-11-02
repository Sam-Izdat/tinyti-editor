import { Log } from '$lib';
import uglifyJS from '$lib/vendor/uglifyjs_parse.js';

export const makeDotCallGraph = (script, nodeName) => {
  var out = ''; 
  try {
    var top = uglifyJS.parse(script);
    var funcsDef = new Set();
    var edges = new Set();
    var funcCurrent = "(global)";
    var walker = new uglifyJS.TreeWalker(function(node) {
        if (!node.TYPE) return;
        if (node instanceof uglifyJS.AST_Defun || node instanceof uglifyJS.AST_Lambda) {
            var funcName = node.name ? node.name.name : (
              walker.parent().name 
                ? walker.parent().name.name
                : '(anonymous)'
              );
            if (funcName && !funcsDef.has(funcName)) {
                // out += `"${funcName}";\n`;
                funcsDef.add(funcName);
            }
            var previousFunction = funcCurrent;
            funcCurrent = funcName;
            node.body.forEach(child => child.walk(walker));
            funcCurrent = previousFunction; 
            return; 
        }
        if (node instanceof uglifyJS.AST_Call) {
            var calledFuncName = node.expression.name || node.expression.property;
            if (calledFuncName && !["$", "Number", "Date"].includes(calledFuncName)) {
                if (funcCurrent && funcCurrent !== "(global)") {
                  if (funcCurrent == nodeName || calledFuncName == nodeName) {
                    var edge = `"${funcCurrent}" -> "${calledFuncName}"`;
                    if (!edges.has(edge)) {
                        out += `${edge};\n`;
                        edges.add(edge);
                    }                  
                  }
                }
                if (!funcsDef.has(calledFuncName)) {
                    // out += `"${calledFuncName}";\n`;
                    funcsDef.add(calledFuncName);
                }
            }
        }
    });
    top.walk(walker);
  } catch(e) {
    Log.debug('failed to parse script for call graph');
  }
  return out;
};
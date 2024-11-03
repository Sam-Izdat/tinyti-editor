import { Log } from '$lib';
import uglifyJS from '$lib/vendor/uglifyjs_parse.js';

export const findEnclosingJSFunction = (script, targetLine, targetCol) => {
  var top = uglifyJS.parse(script);
  let enclosingFunctionName = null;
  let minLineSpan = Infinity;
  let minColSpan = Infinity;

  const nameWalker = new uglifyJS.TreeWalker(function (node) {
    // Check for function (AST_Defun for named functions, AST_Lambda for anonymous)
    if (node instanceof uglifyJS.AST_Defun || node instanceof uglifyJS.AST_Lambda) {
      const isWithinNode = 
        node.start.line <= targetLine &&
        node.end.line >= targetLine &&
        (node.start.line < targetLine || node.start.col <= targetCol) &&
        (node.end.line > targetLine || node.end.col >= targetCol);

      if (isWithinNode) {
        const lineSpan = node.end.line - node.start.line;
        const colSpan = node.end.col - node.start.col;
        if (lineSpan < minLineSpan || (lineSpan == minLineSpan && colSpan < minColSpan)) {
          minLineSpan = lineSpan;
          minColSpan = colSpan;
          enclosingFunctionName = node.name ? node.name.name : (
            nameWalker.parent().name 
              ? nameWalker.parent().name.name
              : '(anonymous)'
            );          
        }
      }
    }
    
    if (node instanceof uglifyJS.AST_ClassMethod || node instanceof uglifyJS.AST_ClassField) {
      const isWithinMethod = 
        node.start.line <= targetLine &&
        node.end.line >= targetLine &&
        (node.start.line < targetLine || node.start.col <= targetCol) &&
        (node.end.line > targetLine || node.end.col >= targetCol);

      if (isWithinMethod) {
        const className = nameWalker.parent().name?.name;
        const methodName = node.key;
        enclosingFunctionName = `${className}.${methodName}`;
      }
    }
  });
  top.walk(nameWalker);
  return enclosingFunctionName;
}

export const makeDotCallGraph = (script, targetNodeName, targetLineno, targetColno) => {
  var out = ''; 
  let funcCounter = 0;
  let targetNodeNameMangled = targetNodeName;
  const nameMap = {}; // map of original to mangled names

  try {
    var top = uglifyJS.parse(script);
    var funcsDef = new Set();
    var edges = new Set();
    var funcCurrent = "(global)";

    const mangleWalker = new uglifyJS.TreeWalker(function(node) {
      if (!node.TYPE) return;

      // Step 1: Mangle Function Definitions (functions, arrow functions, and class methods)
      if (node instanceof uglifyJS.AST_Defun || node instanceof uglifyJS.AST_Lambda) {
        const parent = mangleWalker.parent();

        // Standard named function definitions
        if (node instanceof uglifyJS.AST_Defun && node.name) {
          const originalName = node.name?.name;
          if (!nameMap[originalName]) {
            const mangledName = `${originalName}%%${funcCounter++}`;
            const targetInNode = (targetLineno >= node.start.line && targetLineno <= node.end.line);
            if (originalName == targetNodeName && targetInNode) targetNodeNameMangled = mangledName;
            nameMap[originalName] = mangledName;
            node.name.name = mangledName; // Update AST with mangled name
          }
        }

        // Arrow functions assigned to a variable or property
        else if (parent instanceof uglifyJS.AST_VarDef || parent instanceof uglifyJS.AST_Assign) {
          const originalName = parent.name?.name || parent.left?.property;
          if (!nameMap[originalName]) {
            const mangledName = `${originalName}%%${funcCounter++}`;
            const targetInNode = (targetLineno >= node.start.line && targetLineno <= node.end.line);
            if (originalName == targetNodeName && targetInNode) targetNodeNameMangled = mangledName;
            nameMap[originalName] = mangledName;
            if (parent.name) parent.name.name = mangledName; // Variable
            else if (parent.left) parent.left.property = mangledName; // Property
          }
        }
      }

      // Step 2: Mangle Class Names and Method Names
      if (node instanceof uglifyJS.AST_Class) {
        const className = node.name?.name;
        if (className && !nameMap[className]) {
          const mangledClassName = `${className}%%${funcCounter++}`;
          const targetInNode = (targetLineno >= node.start.line && targetLineno <= node.end.line);
          if (className == targetNodeName && targetInNode) targetNodeNameMangled = mangledClassName;
          nameMap[className] = mangledClassName;
          node.name.name = mangledClassName; // Update AST with mangled class name
        }

        // Mangle method names within the class
        node.properties.forEach((prop) => {
          if (prop.key && typeof prop.key === 'string' && !nameMap[prop.key]) {
            const mangledMethodName = `${prop.key}%%${funcCounter++}`;
            nameMap[prop.key] = mangledMethodName;
            prop.key = mangledMethodName; // Update AST with mangled method name
          }
        });
      }

      // Step 3: Replace Function and Method Call Names
      if (node instanceof uglifyJS.AST_Call) {
        const calledFuncName = node.expression.name || node.expression.property;
        if (calledFuncName && nameMap[calledFuncName]) {
          // Replace the function or method name in the call with the mangled name
          if (node.expression instanceof uglifyJS.AST_SymbolRef) {
            node.expression.name = nameMap[calledFuncName];
          }
          // For member expressions (object methods), replace `.property`
          else if (node.expression instanceof uglifyJS.AST_Dot && node.expression.property === calledFuncName) {
            node.expression.property = nameMap[calledFuncName];
          }
        }
      }
    });
    top.walk(mangleWalker);

    var walker = new uglifyJS.TreeWalker(function(node) {
      if (!node.TYPE) return;
      if (node instanceof uglifyJS.AST_Defun || node instanceof uglifyJS.AST_Lambda) {
            var funcName = node.name ? node.name.name : (
              walker.parent().name 
                ? walker.parent().name.name
                : '(anonymous)'
              );
            if (funcName && !funcsDef.has(funcName)) {
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
                  const neitherAnon = (funcCurrent != '(anonymous)' && calledFuncName != '(anonymous)');
                  const currentIsTarget = funcCurrent == targetNodeNameMangled;
                  const calledIsTarget = calledFuncName == targetNodeNameMangled;
                  const calledIsNotMethod = !(node.expression instanceof uglifyJS.AST_Dot || node.expression instanceof uglifyJS.AST_Sub);
                  if (neitherAnon && (calledIsTarget || currentIsTarget) && calledIsNotMethod) {
                    var edge = `"${funcCurrent.split('%%')[0]}" -> "${calledFuncName.split('%%')[0]}";\n`;
                    if (!edges.has(edge)) {
                        out += edge;
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
    Log.debug(e, 'failed to parse script for call graph');
  };
  return out;
};
// From: https://github.com/Skalman/UglifyJS-online
// We only need the AST and parser.

const uglifyJS = (() => {
    /***********************************************************************

      A JavaScript tokenizer / parser / beautifier / compressor.
      https://github.com/mishoo/UglifyJS

      -------------------------------- (C) ---------------------------------

                               Author: Mihai Bazon
                             <mihai.bazon@gmail.com>
                           http://mihai.bazon.net/blog

      Distributed under the BSD license:

        Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

        Redistribution and use in source and binary forms, with or without
        modification, are permitted provided that the following conditions
        are met:

            * Redistributions of source code must retain the above
              copyright notice, this list of conditions and the following
              disclaimer.

            * Redistributions in binary form must reproduce the above
              copyright notice, this list of conditions and the following
              disclaimer in the documentation and/or other materials
              provided with the distribution.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
        EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
        IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
        PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
        LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
        OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
        PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
        PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
        THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
        TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
        THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
        SUCH DAMAGE.

     ***********************************************************************/

    "use strict";

    function characters(str) {
        return str.split("");
    }

    function member(name, array) {
        return array.indexOf(name) >= 0;
    }

    function find_if(func, array) {
        for (var i = array.length; --i >= 0;) if (func(array[i])) return array[i];
    }

    function configure_error_stack(ex, cause) {
        var stack = ex.name + ": " + ex.message;
        Object.defineProperty(ex, "stack", {
            get: function() {
                if (cause) {
                    cause.name = "" + ex.name;
                    stack = "" + cause.stack;
                    var msg = "" + cause.message;
                    cause = null;
                    var index = stack.indexOf(msg);
                    if (index < 0) {
                        index = 0;
                    } else {
                        index += msg.length;
                        index = stack.indexOf("\n", index) + 1;
                    }
                    stack = stack.slice(0, index) + stack.slice(stack.indexOf("\n", index) + 1);
                }
                return stack;
            },
        });
    }

    function DefaultsError(msg, defs) {
        this.message = msg;
        this.defs = defs;
        try {
            throw new Error(msg);
        } catch (cause) {
            configure_error_stack(this, cause);
        }
    }
    DefaultsError.prototype = Object.create(Error.prototype);
    DefaultsError.prototype.constructor = DefaultsError;
    DefaultsError.prototype.name = "DefaultsError";

    function defaults(args, defs, croak) {
        if (croak) for (var i in args) {
            if (HOP(args, i) && !HOP(defs, i)) throw new DefaultsError("`" + i + "` is not a supported option", defs);
        }
        for (var i in args) {
            if (HOP(args, i)) defs[i] = args[i];
        }
        return defs;
    }

    function noop() {}
    function return_false() { return false; }
    function return_true() { return true; }
    function return_this() { return this; }
    function return_null() { return null; }

    var List = (function() {
        function List(a, f) {
            var ret = [];
            for (var i = 0; i < a.length; i++) {
                var val = f(a[i], i);
                if (val === skip) continue;
                if (val instanceof Splice) {
                    ret.push.apply(ret, val.v);
                } else {
                    ret.push(val);
                }
            }
            return ret;
        }
        List.is_op = function(val) {
            return val === skip || val instanceof Splice;
        };
        List.splice = function(val) {
            return new Splice(val);
        };
        var skip = List.skip = {};
        function Splice(val) {
            this.v = val;
        }
        return List;
    })();

    function push_uniq(array, el) {
        if (array.indexOf(el) < 0) return array.push(el);
    }

    function string_template(text, props) {
        return text.replace(/\{([^{}]+)\}/g, function(str, p) {
            var value = p == "this" ? props : props[p];
            if (value instanceof AST_Node) return value.print_to_string();
            if (value instanceof AST_Token) return value.file + ":" + value.line + "," + value.col;
            return value;
        });
    }

    function remove(array, el) {
        var index = array.indexOf(el);
        if (index >= 0) array.splice(index, 1);
    }

    function makePredicate(words) {
        if (!Array.isArray(words)) words = words.split(" ");
        var map = Object.create(null);
        words.forEach(function(word) {
            map[word] = true;
        });
        return map;
    }

    function all(array, predicate) {
        for (var i = array.length; --i >= 0;)
            if (!predicate(array[i], i))
                return false;
        return true;
    }

    function Dictionary() {
        this.values = Object.create(null);
    }
    Dictionary.prototype = {
        set: function(key, val) {
            if (key == "__proto__") {
                this.proto_value = val;
            } else {
                this.values[key] = val;
            }
            return this;
        },
        add: function(key, val) {
            var list = this.get(key);
            if (list) {
                list.push(val);
            } else {
                this.set(key, [ val ]);
            }
            return this;
        },
        get: function(key) {
            return key == "__proto__" ? this.proto_value : this.values[key];
        },
        del: function(key) {
            if (key == "__proto__") {
                delete this.proto_value;
            } else {
                delete this.values[key];
            }
            return this;
        },
        has: function(key) {
            return key == "__proto__" ? "proto_value" in this : key in this.values;
        },
        all: function(predicate) {
            for (var i in this.values)
                if (!predicate(this.values[i], i)) return false;
            if ("proto_value" in this && !predicate(this.proto_value, "__proto__")) return false;
            return true;
        },
        each: function(f) {
            for (var i in this.values)
                f(this.values[i], i);
            if ("proto_value" in this) f(this.proto_value, "__proto__");
        },
        size: function() {
            return Object.keys(this.values).length + ("proto_value" in this);
        },
        map: function(f) {
            var ret = [];
            for (var i in this.values)
                ret.push(f(this.values[i], i));
            if ("proto_value" in this) ret.push(f(this.proto_value, "__proto__"));
            return ret;
        },
        clone: function() {
            var ret = new Dictionary();
            this.each(function(value, i) {
                ret.set(i, value);
            });
            return ret;
        },
        toObject: function() {
            var obj = {};
            this.each(function(value, i) {
                obj["$" + i] = value;
            });
            return obj;
        },
    };
    Dictionary.fromObject = function(obj) {
        var dict = new Dictionary();
        for (var i in obj)
            if (HOP(obj, i)) dict.set(i.slice(1), obj[i]);
        return dict;
    };

    function HOP(obj, prop) {
        return Object.prototype.hasOwnProperty.call(obj, prop);
    }

    // return true if the node at the top of the stack (that means the
    // innermost node in the current output) is lexically the first in
    // a statement.
    function first_in_statement(stack, arrow, export_default) {
        var node = stack.parent(-1);
        for (var i = 0, p; p = stack.parent(i++); node = p) {
            if (is_arrow(p)) {
                return arrow && p.value === node;
            } else if (p instanceof AST_Binary) {
                if (p.left === node) continue;
            } else if (p.TYPE == "Call") {
                if (p.expression === node) continue;
            } else if (p instanceof AST_Conditional) {
                if (p.condition === node) continue;
            } else if (p instanceof AST_ExportDefault) {
                return export_default;
            } else if (p instanceof AST_PropAccess) {
                if (p.expression === node) continue;
            } else if (p instanceof AST_Sequence) {
                if (p.expressions[0] === node) continue;
            } else if (p instanceof AST_SimpleStatement) {
                return true;
            } else if (p instanceof AST_Template) {
                if (p.tag === node) continue;
            } else if (p instanceof AST_UnaryPostfix) {
                if (p.expression === node) continue;
            }
            return false;
        }
    }

    function DEF_BITPROPS(ctor, props) {
        if (props.length > 31) throw new Error("Too many properties: " + props.length + "\n" + props.join(", "));
        props.forEach(function(name, pos) {
            var mask = 1 << pos;
            Object.defineProperty(ctor.prototype, name, {
                get: function() {
                    return !!(this._bits & mask);
                },
                set: function(val) {
                    if (val)
                        this._bits |= mask;
                    else
                        this._bits &= ~mask;
                },
            });
        });
    }














    /***********************************************************************

      A JavaScript tokenizer / parser / beautifier / compressor.
      https://github.com/mishoo/UglifyJS

      -------------------------------- (C) ---------------------------------

                               Author: Mihai Bazon
                             <mihai.bazon@gmail.com>
                           http://mihai.bazon.net/blog

      Distributed under the BSD license:

        Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

        Redistribution and use in source and binary forms, with or without
        modification, are permitted provided that the following conditions
        are met:

            * Redistributions of source code must retain the above
              copyright notice, this list of conditions and the following
              disclaimer.

            * Redistributions in binary form must reproduce the above
              copyright notice, this list of conditions and the following
              disclaimer in the documentation and/or other materials
              provided with the distribution.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
        EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
        IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
        PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
        LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
        OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
        PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
        PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
        THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
        TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
        THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
        SUCH DAMAGE.

     ***********************************************************************/

    "use strict";

    function DEFNODE(type, props, methods, base) {
        if (typeof base === "undefined") base = AST_Node;
        props = props ? props.split(/\s+/) : [];
        var self_props = props;
        if (base && base.PROPS) props = props.concat(base.PROPS);
        var code = [
            "return function AST_", type, "(props){",
            // not essential, but speeds up compress by a few percent
            "this._bits=0;",
            "if(props){",
        ];
        props.forEach(function(prop) {
            code.push("this.", prop, "=props.", prop, ";");
        });
        code.push("}");
        var proto = Object.create(base && base.prototype);
        if (methods.initialize || proto.initialize) code.push("this.initialize();");
        code.push("};");
        var ctor = new Function(code.join(""))();
        ctor.prototype = proto;
        ctor.prototype.CTOR = ctor;
        ctor.prototype.TYPE = ctor.TYPE = type;
        if (base) {
            ctor.BASE = base;
            base.SUBCLASSES.push(ctor);
        }
        ctor.DEFMETHOD = function(name, method) {
            this.prototype[name] = method;
        };
        ctor.PROPS = props;
        ctor.SELF_PROPS = self_props;
        ctor.SUBCLASSES = [];
        for (var name in methods) if (HOP(methods, name)) {
            if (/^\$/.test(name)) {
                ctor[name.substr(1)] = methods[name];
            } else {
                ctor.DEFMETHOD(name, methods[name]);
            }
        }
        if (typeof exports !== "undefined") exports["AST_" + type] = ctor;
        return ctor;
    }

    var AST_Token = DEFNODE("Token", "type value line col pos endline endcol endpos nlb comments_before comments_after file raw", {
    }, null);

    var AST_Node = DEFNODE("Node", "start end", {
        _clone: function(deep) {
            if (deep) {
                var self = this.clone();
                return self.transform(new TreeTransformer(function(node) {
                    if (node !== self) {
                        return node.clone(true);
                    }
                }));
            }
            return new this.CTOR(this);
        },
        clone: function(deep) {
            return this._clone(deep);
        },
        $documentation: "Base class of all AST nodes",
        $propdoc: {
            start: "[AST_Token] The first token of this node",
            end: "[AST_Token] The last token of this node"
        },
        equals: function(node) {
            return this.TYPE == node.TYPE && this._equals(node);
        },
        walk: function(visitor) {
            visitor.visit(this);
        },
        _validate: function() {
            if (this.TYPE == "Node") throw new Error("should not instantiate AST_Node");
        },
        validate: function() {
            var ctor = this.CTOR;
            do {
                ctor.prototype._validate.call(this);
            } while (ctor = ctor.BASE);
        },
        validate_ast: function() {
            var marker = {};
            this.walk(new TreeWalker(function(node) {
                if (node.validate_visited === marker) {
                    throw new Error(string_template("cannot reuse AST_{TYPE} from [{start}]", node));
                }
                node.validate_visited = marker;
            }));
        },
    }, null);

    DEF_BITPROPS(AST_Node, [
        // AST_Node
        "_optimized",
        "_squeezed",
        // AST_Call
        "call_only",
        // AST_Lambda
        "collapse_scanning",
        // AST_SymbolRef
        "defined",
        "evaluating",
        "falsy",
        // AST_SymbolRef
        "in_arg",
        // AST_Return
        "in_bool",
        // AST_SymbolRef
        "is_undefined",
        // AST_LambdaExpression
        // AST_LambdaDefinition
        "inlined",
        // AST_Lambda
        "length_read",
        // AST_Yield
        "nested",
        // AST_Lambda
        "new",
        // AST_Call
        // AST_PropAccess
        "optional",
        // AST_ClassProperty
        "private",
        // AST_Call
        "pure",
        // AST_Node
        "single_use",
        // AST_ClassProperty
        "static",
        // AST_Call
        // AST_PropAccess
        "terminal",
        "truthy",
        // AST_Scope
        "uses_eval",
        // AST_Scope
        "uses_with",
    ]);

    (AST_Node.log_function = function(fn, verbose) {
        if (typeof fn != "function") {
            AST_Node.info = AST_Node.warn = noop;
            return;
        }
        var printed = Object.create(null);
        AST_Node.info = verbose ? function(text, props) {
            log("INFO: " + string_template(text, props));
        } : noop;
        AST_Node.warn = function(text, props) {
            log("WARN: " + string_template(text, props));
        };

        function log(msg) {
            if (printed[msg]) return;
            printed[msg] = true;
            fn(msg);
        }
    })();

    var restore_transforms = [];
    AST_Node.enable_validation = function() {
        AST_Node.disable_validation();
        (function validate_transform(ctor) {
            ctor.SUBCLASSES.forEach(validate_transform);
            if (!HOP(ctor.prototype, "transform")) return;
            var transform = ctor.prototype.transform;
            ctor.prototype.transform = function(tw, in_list) {
                var node = transform.call(this, tw, in_list);
                if (node instanceof AST_Node) {
                    node.validate();
                } else if (!(node === null || in_list && List.is_op(node))) {
                    throw new Error("invalid transformed value: " + node);
                }
                return node;
            };
            restore_transforms.push(function() {
                ctor.prototype.transform = transform;
            });
        })(this);
    };

    AST_Node.disable_validation = function() {
        var restore;
        while (restore = restore_transforms.pop()) restore();
    };

    function all_equals(k, l) {
        return k.length == l.length && all(k, function(m, i) {
            return m.equals(l[i]);
        });
    }

    function list_equals(s, t) {
        return s.length == t.length && all(s, function(u, i) {
            return u == t[i];
        });
    }

    function prop_equals(u, v) {
        if (u === v) return true;
        if (u == null) return v == null;
        return u instanceof AST_Node && v instanceof AST_Node && u.equals(v);
    }

    /* -----[ statements ]----- */

    var AST_Statement = DEFNODE("Statement", null, {
        $documentation: "Base class of all statements",
        _validate: function() {
            if (this.TYPE == "Statement") throw new Error("should not instantiate AST_Statement");
        },
    });

    var AST_Debugger = DEFNODE("Debugger", null, {
        $documentation: "Represents a debugger statement",
        _equals: return_true,
    }, AST_Statement);

    var AST_Directive = DEFNODE("Directive", "quote value", {
        $documentation: "Represents a directive, like \"use strict\";",
        $propdoc: {
            quote: "[string?] the original quote character",
            value: "[string] The value of this directive as a plain string (it's not an AST_String!)",
        },
        _equals: function(node) {
            return this.value == node.value;
        },
        _validate: function() {
            if (this.quote != null) {
                if (typeof this.quote != "string") throw new Error("quote must be string");
                if (!/^["']$/.test(this.quote)) throw new Error("invalid quote: " + this.quote);
            }
            if (typeof this.value != "string") throw new Error("value must be string");
        },
    }, AST_Statement);

    var AST_EmptyStatement = DEFNODE("EmptyStatement", null, {
        $documentation: "The empty statement (empty block or simply a semicolon)",
        _equals: return_true,
    }, AST_Statement);

    function is_statement(node) {
        return node instanceof AST_Statement
            && !(node instanceof AST_ClassExpression)
            && !(node instanceof AST_LambdaExpression);
    }

    function validate_expression(value, prop, multiple, allow_spread, allow_hole) {
        multiple = multiple ? "contain" : "be";
        if (!(value instanceof AST_Node)) throw new Error(prop + " must " + multiple + " AST_Node");
        if (value instanceof AST_DefaultValue) throw new Error(prop + " cannot " + multiple + " AST_DefaultValue");
        if (value instanceof AST_Destructured) throw new Error(prop + " cannot " + multiple + " AST_Destructured");
        if (value instanceof AST_Hole && !allow_hole) throw new Error(prop + " cannot " + multiple + " AST_Hole");
        if (value instanceof AST_Spread && !allow_spread) throw new Error(prop + " cannot " + multiple + " AST_Spread");
        if (is_statement(value)) throw new Error(prop + " cannot " + multiple + " AST_Statement");
        if (value instanceof AST_SymbolDeclaration) {
            throw new Error(prop + " cannot " + multiple + " AST_SymbolDeclaration");
        }
    }

    function must_be_expression(node, prop) {
        validate_expression(node[prop], prop);
    }

    var AST_SimpleStatement = DEFNODE("SimpleStatement", "body", {
        $documentation: "A statement consisting of an expression, i.e. a = 1 + 2",
        $propdoc: {
            body: "[AST_Node] an expression node (should not be instanceof AST_Statement)",
        },
        _equals: function(node) {
            return this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.body.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "body");
        },
    }, AST_Statement);

    var AST_BlockScope = DEFNODE("BlockScope", "_var_names enclosed functions make_def parent_scope variables", {
        $documentation: "Base class for all statements introducing a lexical scope",
        $propdoc: {
            enclosed: "[SymbolDef*/S] a list of all symbol definitions that are accessed from this scope or any inner scopes",
            functions: "[Dictionary/S] like `variables`, but only lists function declarations",
            parent_scope: "[AST_Scope?/S] link to the parent scope",
            variables: "[Dictionary/S] a map of name ---> SymbolDef for all variables/functions defined in this scope",
        },
        clone: function(deep) {
            var node = this._clone(deep);
            if (this.enclosed) node.enclosed = this.enclosed.slice();
            if (this.functions) node.functions = this.functions.clone();
            if (this.variables) node.variables = this.variables.clone();
            return node;
        },
        pinned: function() {
            return this.resolve().pinned();
        },
        resolve: function() {
            return this.parent_scope.resolve();
        },
        _validate: function() {
            if (this.TYPE == "BlockScope") throw new Error("should not instantiate AST_BlockScope");
            if (this.parent_scope == null) return;
            if (!(this.parent_scope instanceof AST_BlockScope)) throw new Error("parent_scope must be AST_BlockScope");
            if (!(this.resolve() instanceof AST_Scope)) throw new Error("must be contained within AST_Scope");
        },
    }, AST_Statement);

    function walk_body(node, visitor) {
        node.body.forEach(function(node) {
            node.walk(visitor);
        });
    }

    var AST_Block = DEFNODE("Block", "body", {
        $documentation: "A body of statements (usually braced)",
        $propdoc: {
            body: "[AST_Statement*] an array of statements"
        },
        _equals: function(node) {
            return all_equals(this.body, node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                walk_body(node, visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "Block") throw new Error("should not instantiate AST_Block");
            this.body.forEach(function(node) {
                if (!is_statement(node)) throw new Error("body must contain AST_Statement");
            });
        },
    }, AST_BlockScope);

    var AST_BlockStatement = DEFNODE("BlockStatement", null, {
        $documentation: "A block statement",
    }, AST_Block);

    var AST_StatementWithBody = DEFNODE("StatementWithBody", "body", {
        $documentation: "Base class for all statements that contain one nested body: `For`, `ForIn`, `Do`, `While`, `With`",
        $propdoc: {
            body: "[AST_Statement] the body; this should always be present, even if it's an AST_EmptyStatement"
        },
        _validate: function() {
            if (this.TYPE == "StatementWithBody") throw new Error("should not instantiate AST_StatementWithBody");
            if (!is_statement(this.body)) throw new Error("body must be AST_Statement");
        },
    }, AST_BlockScope);

    var AST_LabeledStatement = DEFNODE("LabeledStatement", "label", {
        $documentation: "Statement with a label",
        $propdoc: {
            label: "[AST_Label] a label definition"
        },
        _equals: function(node) {
            return this.label.equals(node.label)
                && this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.label.walk(visitor);
                node.body.walk(visitor);
            });
        },
        clone: function(deep) {
            var node = this._clone(deep);
            if (deep) {
                var label = node.label;
                var def = this.label;
                node.walk(new TreeWalker(function(node) {
                    if (node instanceof AST_LoopControl) {
                        if (!node.label || node.label.thedef !== def) return;
                        node.label.thedef = label;
                        label.references.push(node);
                        return true;
                    }
                    if (node instanceof AST_Scope) return true;
                }));
            }
            return node;
        },
        _validate: function() {
            if (!(this.label instanceof AST_Label)) throw new Error("label must be AST_Label");
        },
    }, AST_StatementWithBody);

    var AST_IterationStatement = DEFNODE("IterationStatement", null, {
        $documentation: "Internal class.  All loops inherit from it.",
        _validate: function() {
            if (this.TYPE == "IterationStatement") throw new Error("should not instantiate AST_IterationStatement");
        },
    }, AST_StatementWithBody);

    var AST_DWLoop = DEFNODE("DWLoop", "condition", {
        $documentation: "Base class for do/while statements",
        $propdoc: {
            condition: "[AST_Node] the loop condition.  Should not be instanceof AST_Statement"
        },
        _equals: function(node) {
            return this.body.equals(node.body)
                && this.condition.equals(node.condition);
        },
        _validate: function() {
            if (this.TYPE == "DWLoop") throw new Error("should not instantiate AST_DWLoop");
            must_be_expression(this, "condition");
        },
    }, AST_IterationStatement);

    var AST_Do = DEFNODE("Do", null, {
        $documentation: "A `do` statement",
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.body.walk(visitor);
                node.condition.walk(visitor);
            });
        },
    }, AST_DWLoop);

    var AST_While = DEFNODE("While", null, {
        $documentation: "A `while` statement",
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.condition.walk(visitor);
                node.body.walk(visitor);
            });
        },
    }, AST_DWLoop);

    var AST_For = DEFNODE("For", "init condition step", {
        $documentation: "A `for` statement",
        $propdoc: {
            init: "[AST_Node?] the `for` initialization code, or null if empty",
            condition: "[AST_Node?] the `for` termination clause, or null if empty",
            step: "[AST_Node?] the `for` update clause, or null if empty"
        },
        _equals: function(node) {
            return prop_equals(this.init, node.init)
                && prop_equals(this.condition, node.condition)
                && prop_equals(this.step, node.step)
                && this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.init) node.init.walk(visitor);
                if (node.condition) node.condition.walk(visitor);
                if (node.step) node.step.walk(visitor);
                node.body.walk(visitor);
            });
        },
        _validate: function() {
            if (this.init != null) {
                if (!(this.init instanceof AST_Node)) throw new Error("init must be AST_Node");
                if (is_statement(this.init) && !(this.init instanceof AST_Definitions)) {
                    throw new Error("init cannot be AST_Statement");
                }
            }
            if (this.condition != null) must_be_expression(this, "condition");
            if (this.step != null) must_be_expression(this, "step");
        },
    }, AST_IterationStatement);

    var AST_ForEnumeration = DEFNODE("ForEnumeration", "init object", {
        $documentation: "Base class for enumeration loops, i.e. `for ... in`, `for ... of` & `for await ... of`",
        $propdoc: {
            init: "[AST_Node] the assignment target during iteration",
            object: "[AST_Node] the object to iterate over"
        },
        _equals: function(node) {
            return this.init.equals(node.init)
                && this.object.equals(node.object)
                && this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.init.walk(visitor);
                node.object.walk(visitor);
                node.body.walk(visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "ForEnumeration") throw new Error("should not instantiate AST_ForEnumeration");
            if (this.init instanceof AST_Definitions) {
                if (this.init.definitions.length != 1) throw new Error("init must have single declaration");
            } else {
                validate_destructured(this.init, function(node) {
                    if (!(node instanceof AST_PropAccess || node instanceof AST_SymbolRef)) {
                        throw new Error("init must be assignable: " + node.TYPE);
                    }
                });
            }
            must_be_expression(this, "object");
        },
    }, AST_IterationStatement);

    var AST_ForIn = DEFNODE("ForIn", null, {
        $documentation: "A `for ... in` statement",
    }, AST_ForEnumeration);

    var AST_ForOf = DEFNODE("ForOf", null, {
        $documentation: "A `for ... of` statement",
    }, AST_ForEnumeration);

    var AST_ForAwaitOf = DEFNODE("ForAwaitOf", null, {
        $documentation: "A `for await ... of` statement",
    }, AST_ForOf);

    var AST_With = DEFNODE("With", "expression", {
        $documentation: "A `with` statement",
        $propdoc: {
            expression: "[AST_Node] the `with` expression"
        },
        _equals: function(node) {
            return this.expression.equals(node.expression)
                && this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
                node.body.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "expression");
        },
    }, AST_StatementWithBody);

    /* -----[ scope and functions ]----- */

    var AST_Scope = DEFNODE("Scope", "fn_defs may_call_this uses_eval uses_with", {
        $documentation: "Base class for all statements introducing a lambda scope",
        $propdoc: {
            uses_eval: "[boolean/S] tells whether this scope contains a direct call to the global `eval`",
            uses_with: "[boolean/S] tells whether this scope uses the `with` statement",
        },
        pinned: function() {
            return this.uses_eval || this.uses_with;
        },
        resolve: return_this,
        _validate: function() {
            if (this.TYPE == "Scope") throw new Error("should not instantiate AST_Scope");
        },
    }, AST_Block);

    var AST_Toplevel = DEFNODE("Toplevel", "globals", {
        $documentation: "The toplevel scope",
        $propdoc: {
            globals: "[Dictionary/S] a map of name ---> SymbolDef for all undeclared names",
        },
        wrap: function(name) {
            var body = this.body;
            return parse([
                "(function(exports){'$ORIG';})(typeof ",
                name,
                "=='undefined'?(",
                name,
                "={}):",
                name,
                ");"
            ].join(""), {
                filename: "wrap=" + JSON.stringify(name)
            }).transform(new TreeTransformer(function(node) {
                if (node instanceof AST_Directive && node.value == "$ORIG") {
                    return List.splice(body);
                }
            }));
        },
        enclose: function(args_values) {
            if (typeof args_values != "string") args_values = "";
            var index = args_values.indexOf(":");
            if (index < 0) index = args_values.length;
            var body = this.body;
            return parse([
                "(function(",
                args_values.slice(0, index),
                '){"$ORIG"})(',
                args_values.slice(index + 1),
                ")"
            ].join(""), {
                filename: "enclose=" + JSON.stringify(args_values)
            }).transform(new TreeTransformer(function(node) {
                if (node instanceof AST_Directive && node.value == "$ORIG") {
                    return List.splice(body);
                }
            }));
        }
    }, AST_Scope);

    var AST_ClassInitBlock = DEFNODE("ClassInitBlock", null, {
        $documentation: "Value for `class` static initialization blocks",
    }, AST_Scope);

    var AST_Lambda = DEFNODE("Lambda", "argnames length_read rest safe_ids uses_arguments", {
        $documentation: "Base class for functions",
        $propdoc: {
            argnames: "[(AST_DefaultValue|AST_Destructured|AST_SymbolFunarg)*] array of function arguments and/or destructured literals",
            length_read: "[boolean/S] whether length property of this function is accessed",
            rest: "[(AST_Destructured|AST_SymbolFunarg)?] rest parameter, or null if absent",
            uses_arguments: "[boolean|number/S] whether this function accesses the arguments array",
        },
        each_argname: function(visit) {
            var tw = new TreeWalker(function(node) {
                if (node instanceof AST_DefaultValue) {
                    node.name.walk(tw);
                    return true;
                }
                if (node instanceof AST_DestructuredKeyVal) {
                    node.value.walk(tw);
                    return true;
                }
                if (node instanceof AST_SymbolFunarg) visit(node);
            });
            this.argnames.forEach(function(argname) {
                argname.walk(tw);
            });
            if (this.rest) this.rest.walk(tw);
        },
        _equals: function(node) {
            return prop_equals(this.rest, node.rest)
                && prop_equals(this.name, node.name)
                && prop_equals(this.value, node.value)
                && all_equals(this.argnames, node.argnames)
                && all_equals(this.body, node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.name) node.name.walk(visitor);
                node.argnames.forEach(function(argname) {
                    argname.walk(visitor);
                });
                if (node.rest) node.rest.walk(visitor);
                walk_body(node, visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "Lambda") throw new Error("should not instantiate AST_Lambda");
            this.argnames.forEach(function(node) {
                validate_destructured(node, function(node) {
                    if (!(node instanceof AST_SymbolFunarg)) throw new Error("argnames must be AST_SymbolFunarg[]");
                }, true);
            });
            if (this.rest != null) validate_destructured(this.rest, function(node) {
                if (!(node instanceof AST_SymbolFunarg)) throw new Error("rest must be AST_SymbolFunarg");
            });
        },
    }, AST_Scope);

    var AST_Accessor = DEFNODE("Accessor", null, {
        $documentation: "A getter/setter function",
        _validate: function() {
            if (this.name != null) throw new Error("name must be null");
        },
    }, AST_Lambda);

    var AST_LambdaExpression = DEFNODE("LambdaExpression", "inlined", {
        $documentation: "Base class for function expressions",
        $propdoc: {
            inlined: "[boolean/S] whether this function has been inlined",
        },
        _validate: function() {
            if (this.TYPE == "LambdaExpression") throw new Error("should not instantiate AST_LambdaExpression");
        },
    }, AST_Lambda);

    function is_arrow(node) {
        return node instanceof AST_Arrow || node instanceof AST_AsyncArrow;
    }

    function is_async(node) {
        return node instanceof AST_AsyncArrow
            || node instanceof AST_AsyncDefun
            || node instanceof AST_AsyncFunction
            || node instanceof AST_AsyncGeneratorDefun
            || node instanceof AST_AsyncGeneratorFunction;
    }

    function is_generator(node) {
        return node instanceof AST_AsyncGeneratorDefun
            || node instanceof AST_AsyncGeneratorFunction
            || node instanceof AST_GeneratorDefun
            || node instanceof AST_GeneratorFunction;
    }

    function walk_lambda(node, tw) {
        if (is_arrow(node) && node.value) {
            node.value.walk(tw);
        } else {
            walk_body(node, tw);
        }
    }

    var AST_Arrow = DEFNODE("Arrow", "value", {
        $documentation: "An arrow function expression",
        $propdoc: {
            value: "[AST_Node?] simple return expression, or null if using function body.",
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.argnames.forEach(function(argname) {
                    argname.walk(visitor);
                });
                if (node.rest) node.rest.walk(visitor);
                if (node.value) {
                    node.value.walk(visitor);
                } else {
                    walk_body(node, visitor);
                }
            });
        },
        _validate: function() {
            if (this.name != null) throw new Error("name must be null");
            if (this.uses_arguments) throw new Error("uses_arguments must be false");
            if (this.value != null) {
                must_be_expression(this, "value");
                if (this.body.length) throw new Error("body must be empty if value exists");
            }
        },
    }, AST_LambdaExpression);

    var AST_AsyncArrow = DEFNODE("AsyncArrow", "value", {
        $documentation: "An asynchronous arrow function expression",
        $propdoc: {
            value: "[AST_Node?] simple return expression, or null if using function body.",
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.argnames.forEach(function(argname) {
                    argname.walk(visitor);
                });
                if (node.rest) node.rest.walk(visitor);
                if (node.value) {
                    node.value.walk(visitor);
                } else {
                    walk_body(node, visitor);
                }
            });
        },
        _validate: function() {
            if (this.name != null) throw new Error("name must be null");
            if (this.uses_arguments) throw new Error("uses_arguments must be false");
            if (this.value != null) {
                must_be_expression(this, "value");
                if (this.body.length) throw new Error("body must be empty if value exists");
            }
        },
    }, AST_LambdaExpression);

    var AST_AsyncFunction = DEFNODE("AsyncFunction", "name", {
        $documentation: "An asynchronous function expression",
        $propdoc: {
            name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
        },
        _validate: function() {
            if (this.name != null) {
                if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
            }
        },
    }, AST_LambdaExpression);

    var AST_AsyncGeneratorFunction = DEFNODE("AsyncGeneratorFunction", "name", {
        $documentation: "An asynchronous generator function expression",
        $propdoc: {
            name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
        },
        _validate: function() {
            if (this.name != null) {
                if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
            }
        },
    }, AST_LambdaExpression);

    var AST_Function = DEFNODE("Function", "name", {
        $documentation: "A function expression",
        $propdoc: {
            name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
        },
        _validate: function() {
            if (this.name != null) {
                if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
            }
        },
    }, AST_LambdaExpression);

    var AST_GeneratorFunction = DEFNODE("GeneratorFunction", "name", {
        $documentation: "A generator function expression",
        $propdoc: {
            name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
        },
        _validate: function() {
            if (this.name != null) {
                if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
            }
        },
    }, AST_LambdaExpression);

    var AST_LambdaDefinition = DEFNODE("LambdaDefinition", "inlined name", {
        $documentation: "Base class for function definitions",
        $propdoc: {
            inlined: "[boolean/S] whether this function has been inlined",
            name: "[AST_SymbolDefun] the name of this function",
        },
        _validate: function() {
            if (this.TYPE == "LambdaDefinition") throw new Error("should not instantiate AST_LambdaDefinition");
            if (!(this.name instanceof AST_SymbolDefun)) throw new Error("name must be AST_SymbolDefun");
        },
    }, AST_Lambda);

    var AST_AsyncDefun = DEFNODE("AsyncDefun", null, {
        $documentation: "An asynchronous function definition",
    }, AST_LambdaDefinition);

    var AST_AsyncGeneratorDefun = DEFNODE("AsyncGeneratorDefun", null, {
        $documentation: "An asynchronous generator function definition",
    }, AST_LambdaDefinition);

    var AST_Defun = DEFNODE("Defun", null, {
        $documentation: "A function definition",
    }, AST_LambdaDefinition);

    var AST_GeneratorDefun = DEFNODE("GeneratorDefun", null, {
        $documentation: "A generator function definition",
    }, AST_LambdaDefinition);

    /* -----[ classes ]----- */

    var AST_Class = DEFNODE("Class", "extends name properties", {
        $documentation: "Base class for class literals",
        $propdoc: {
            extends: "[AST_Node?] the super class, or null if not specified",
            properties: "[AST_ClassProperty*] array of class properties",
        },
        _equals: function(node) {
            return prop_equals(this.name, node.name)
                && prop_equals(this.extends, node.extends)
                && all_equals(this.properties, node.properties);
        },
        resolve: function(def_class) {
            return def_class ? this : this.parent_scope.resolve();
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.name) node.name.walk(visitor);
                if (node.extends) node.extends.walk(visitor);
                node.properties.forEach(function(prop) {
                    prop.walk(visitor);
                });
            });
        },
        _validate: function() {
            if (this.TYPE == "Class") throw new Error("should not instantiate AST_Class");
            if (this.extends != null) must_be_expression(this, "extends");
            this.properties.forEach(function(node) {
                if (!(node instanceof AST_ClassProperty)) throw new Error("properties must contain AST_ClassProperty");
            });
        },
    }, AST_BlockScope);

    var AST_DefClass = DEFNODE("DefClass", null, {
        $documentation: "A class definition",
        $propdoc: {
            name: "[AST_SymbolDefClass] the name of this class",
        },
        _validate: function() {
            if (!(this.name instanceof AST_SymbolDefClass)) throw new Error("name must be AST_SymbolDefClass");
        },
    }, AST_Class);

    var AST_ClassExpression = DEFNODE("ClassExpression", null, {
        $documentation: "A class expression",
        $propdoc: {
            name: "[AST_SymbolClass?] the name of this class, or null if not specified",
        },
        _validate: function() {
            if (this.name != null) {
                if (!(this.name instanceof AST_SymbolClass)) throw new Error("name must be AST_SymbolClass");
            }
        },
    }, AST_Class);

    var AST_ClassProperty = DEFNODE("ClassProperty", "key private static value", {
        $documentation: "Base class for `class` properties",
        $propdoc: {
            key: "[string|AST_Node?] property name (AST_Node for computed property, null for initialization block)",
            private: "[boolean] whether this is a private property",
            static: "[boolean] whether this is a static property",
            value: "[AST_Node?] property value (AST_Accessor for getters/setters, AST_LambdaExpression for methods, null if not specified for fields)",
        },
        _equals: function(node) {
            return !this.private == !node.private
                && !this.static == !node.static
                && prop_equals(this.key, node.key)
                && prop_equals(this.value, node.value);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.key instanceof AST_Node) node.key.walk(visitor);
                if (node.value) node.value.walk(visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "ClassProperty") throw new Error("should not instantiate AST_ClassProperty");
            if (this instanceof AST_ClassInit) {
                if (this.key != null) throw new Error("key must be null");
            } else if (typeof this.key != "string") {
                if (!(this.key instanceof AST_Node)) throw new Error("key must be string or AST_Node");
                if (this.private) throw new Error("computed key cannot be private");
                must_be_expression(this, "key");
            } else if (this.private) {
                if (!/^#/.test(this.key)) throw new Error("private key must prefix with #");
            }
            if (this.value != null) {
                if (!(this.value instanceof AST_Node)) throw new Error("value must be AST_Node");
            }
        },
    });

    var AST_ClassField = DEFNODE("ClassField", null, {
        $documentation: "A `class` field",
        _validate: function() {
            if (this.value != null) must_be_expression(this, "value");
        },
    }, AST_ClassProperty);

    var AST_ClassGetter = DEFNODE("ClassGetter", null, {
        $documentation: "A `class` getter",
        _validate: function() {
            if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
        },
    }, AST_ClassProperty);

    var AST_ClassSetter = DEFNODE("ClassSetter", null, {
        $documentation: "A `class` setter",
        _validate: function() {
            if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
        },
    }, AST_ClassProperty);

    var AST_ClassMethod = DEFNODE("ClassMethod", null, {
        $documentation: "A `class` method",
        _validate: function() {
            if (!(this.value instanceof AST_LambdaExpression)) throw new Error("value must be AST_LambdaExpression");
            if (is_arrow(this.value)) throw new Error("value cannot be AST_Arrow or AST_AsyncArrow");
            if (this.value.name != null) throw new Error("name of class method's lambda must be null");
        },
    }, AST_ClassProperty);

    var AST_ClassInit = DEFNODE("ClassInit", null, {
        $documentation: "A `class` static initialization block",
        _validate: function() {
            if (!this.static) throw new Error("static must be true");
            if (!(this.value instanceof AST_ClassInitBlock)) throw new Error("value must be AST_ClassInitBlock");
        },
        initialize: function() {
            this.static = true;
        },
    }, AST_ClassProperty);

    /* -----[ JUMPS ]----- */

    var AST_Jump = DEFNODE("Jump", null, {
        $documentation: "Base class for “jumps” (for now that's `return`, `throw`, `break` and `continue`)",
        _validate: function() {
            if (this.TYPE == "Jump") throw new Error("should not instantiate AST_Jump");
        },
    }, AST_Statement);

    var AST_Exit = DEFNODE("Exit", "value", {
        $documentation: "Base class for “exits” (`return` and `throw`)",
        $propdoc: {
            value: "[AST_Node?] the value returned or thrown by this statement; could be null for AST_Return"
        },
        _equals: function(node) {
            return prop_equals(this.value, node.value);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.value) node.value.walk(visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "Exit") throw new Error("should not instantiate AST_Exit");
        },
    }, AST_Jump);

    var AST_Return = DEFNODE("Return", null, {
        $documentation: "A `return` statement",
        _validate: function() {
            if (this.value != null) must_be_expression(this, "value");
        },
    }, AST_Exit);

    var AST_Throw = DEFNODE("Throw", null, {
        $documentation: "A `throw` statement",
        _validate: function() {
            must_be_expression(this, "value");
        },
    }, AST_Exit);

    var AST_LoopControl = DEFNODE("LoopControl", "label", {
        $documentation: "Base class for loop control statements (`break` and `continue`)",
        $propdoc: {
            label: "[AST_LabelRef?] the label, or null if none",
        },
        _equals: function(node) {
            return prop_equals(this.label, node.label);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.label) node.label.walk(visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "LoopControl") throw new Error("should not instantiate AST_LoopControl");
            if (this.label != null) {
                if (!(this.label instanceof AST_LabelRef)) throw new Error("label must be AST_LabelRef");
            }
        },
    }, AST_Jump);

    var AST_Break = DEFNODE("Break", null, {
        $documentation: "A `break` statement"
    }, AST_LoopControl);

    var AST_Continue = DEFNODE("Continue", null, {
        $documentation: "A `continue` statement"
    }, AST_LoopControl);

    /* -----[ IF ]----- */

    var AST_If = DEFNODE("If", "condition alternative", {
        $documentation: "A `if` statement",
        $propdoc: {
            condition: "[AST_Node] the `if` condition",
            alternative: "[AST_Statement?] the `else` part, or null if not present"
        },
        _equals: function(node) {
            return this.body.equals(node.body)
                && this.condition.equals(node.condition)
                && prop_equals(this.alternative, node.alternative);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.condition.walk(visitor);
                node.body.walk(visitor);
                if (node.alternative) node.alternative.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "condition");
            if (this.alternative != null) {
                if (!is_statement(this.alternative)) throw new Error("alternative must be AST_Statement");
            }
        },
    }, AST_StatementWithBody);

    /* -----[ SWITCH ]----- */

    var AST_Switch = DEFNODE("Switch", "expression", {
        $documentation: "A `switch` statement",
        $propdoc: {
            expression: "[AST_Node] the `switch` “discriminant”"
        },
        _equals: function(node) {
            return this.expression.equals(node.expression)
                && all_equals(this.body, node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
                walk_body(node, visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "expression");
            this.body.forEach(function(node) {
                if (!(node instanceof AST_SwitchBranch)) throw new Error("body must be AST_SwitchBranch[]");
            });
        },
    }, AST_Block);

    var AST_SwitchBranch = DEFNODE("SwitchBranch", null, {
        $documentation: "Base class for `switch` branches",
        _validate: function() {
            if (this.TYPE == "SwitchBranch") throw new Error("should not instantiate AST_SwitchBranch");
        },
    }, AST_Block);

    var AST_Default = DEFNODE("Default", null, {
        $documentation: "A `default` switch branch",
    }, AST_SwitchBranch);

    var AST_Case = DEFNODE("Case", "expression", {
        $documentation: "A `case` switch branch",
        $propdoc: {
            expression: "[AST_Node] the `case` expression"
        },
        _equals: function(node) {
            return this.expression.equals(node.expression)
                && all_equals(this.body, node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
                walk_body(node, visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "expression");
        },
    }, AST_SwitchBranch);

    /* -----[ EXCEPTIONS ]----- */

    var AST_Try = DEFNODE("Try", "bcatch bfinally", {
        $documentation: "A `try` statement",
        $propdoc: {
            bcatch: "[AST_Catch?] the catch block, or null if not present",
            bfinally: "[AST_Finally?] the finally block, or null if not present"
        },
        _equals: function(node) {
            return all_equals(this.body, node.body)
                && prop_equals(this.bcatch, node.bcatch)
                && prop_equals(this.bfinally, node.bfinally);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                walk_body(node, visitor);
                if (node.bcatch) node.bcatch.walk(visitor);
                if (node.bfinally) node.bfinally.walk(visitor);
            });
        },
        _validate: function() {
            if (this.bcatch != null) {
                if (!(this.bcatch instanceof AST_Catch)) throw new Error("bcatch must be AST_Catch");
            }
            if (this.bfinally != null) {
                if (!(this.bfinally instanceof AST_Finally)) throw new Error("bfinally must be AST_Finally");
            }
        },
    }, AST_Block);

    var AST_Catch = DEFNODE("Catch", "argname", {
        $documentation: "A `catch` node; only makes sense as part of a `try` statement",
        $propdoc: {
            argname: "[(AST_Destructured|AST_SymbolCatch)?] symbol for the exception, or null if not present",
        },
        _equals: function(node) {
            return prop_equals(this.argname, node.argname)
                && all_equals(this.body, node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.argname) node.argname.walk(visitor);
                walk_body(node, visitor);
            });
        },
        _validate: function() {
            if (this.argname != null) validate_destructured(this.argname, function(node) {
                if (!(node instanceof AST_SymbolCatch)) throw new Error("argname must be AST_SymbolCatch");
            });
        },
    }, AST_Block);

    var AST_Finally = DEFNODE("Finally", null, {
        $documentation: "A `finally` node; only makes sense as part of a `try` statement"
    }, AST_Block);

    /* -----[ VAR ]----- */

    var AST_Definitions = DEFNODE("Definitions", "definitions", {
        $documentation: "Base class for `var` nodes (variable declarations/initializations)",
        $propdoc: {
            definitions: "[AST_VarDef*] array of variable definitions"
        },
        _equals: function(node) {
            return all_equals(this.definitions, node.definitions);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.definitions.forEach(function(defn) {
                    defn.walk(visitor);
                });
            });
        },
        _validate: function() {
            if (this.TYPE == "Definitions") throw new Error("should not instantiate AST_Definitions");
            if (this.definitions.length < 1) throw new Error("must have at least one definition");
        },
    }, AST_Statement);

    var AST_Const = DEFNODE("Const", null, {
        $documentation: "A `const` statement",
        _validate: function() {
            this.definitions.forEach(function(node) {
                if (!(node instanceof AST_VarDef)) throw new Error("definitions must be AST_VarDef[]");
                validate_destructured(node.name, function(node) {
                    if (!(node instanceof AST_SymbolConst)) throw new Error("name must be AST_SymbolConst");
                });
            });
        },
    }, AST_Definitions);

    var AST_Let = DEFNODE("Let", null, {
        $documentation: "A `let` statement",
        _validate: function() {
            this.definitions.forEach(function(node) {
                if (!(node instanceof AST_VarDef)) throw new Error("definitions must be AST_VarDef[]");
                validate_destructured(node.name, function(node) {
                    if (!(node instanceof AST_SymbolLet)) throw new Error("name must be AST_SymbolLet");
                });
            });
        },
    }, AST_Definitions);

    var AST_Var = DEFNODE("Var", null, {
        $documentation: "A `var` statement",
        _validate: function() {
            this.definitions.forEach(function(node) {
                if (!(node instanceof AST_VarDef)) throw new Error("definitions must be AST_VarDef[]");
                validate_destructured(node.name, function(node) {
                    if (!(node instanceof AST_SymbolVar)) throw new Error("name must be AST_SymbolVar");
                });
            });
        },
    }, AST_Definitions);

    var AST_VarDef = DEFNODE("VarDef", "name value", {
        $documentation: "A variable declaration; only appears in a AST_Definitions node",
        $propdoc: {
            name: "[AST_Destructured|AST_SymbolVar] name of the variable",
            value: "[AST_Node?] initializer, or null of there's no initializer",
        },
        _equals: function(node) {
            return this.name.equals(node.name)
                && prop_equals(this.value, node.value);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.name.walk(visitor);
                if (node.value) node.value.walk(visitor);
            });
        },
        _validate: function() {
            if (this.value != null) must_be_expression(this, "value");
        },
    });

    /* -----[ OTHER ]----- */

    var AST_ExportDeclaration = DEFNODE("ExportDeclaration", "body", {
        $documentation: "An `export` statement",
        $propdoc: {
            body: "[AST_DefClass|AST_Definitions|AST_LambdaDefinition] the statement to export",
        },
        _equals: function(node) {
            return this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.body.walk(visitor);
            });
        },
        _validate: function() {
            if (!(this.body instanceof AST_DefClass
                || this.body instanceof AST_Definitions
                || this.body instanceof AST_LambdaDefinition)) {
                throw new Error("body must be AST_DefClass, AST_Definitions or AST_LambdaDefinition");
            }
        },
    }, AST_Statement);

    var AST_ExportDefault = DEFNODE("ExportDefault", "body", {
        $documentation: "An `export default` statement",
        $propdoc: {
            body: "[AST_Node] the default export",
        },
        _equals: function(node) {
            return this.body.equals(node.body);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.body.walk(visitor);
            });
        },
        _validate: function() {
            if (!(this.body instanceof AST_DefClass || this.body instanceof AST_LambdaDefinition)) {
                must_be_expression(this, "body");
            }
        },
    }, AST_Statement);

    var AST_ExportForeign = DEFNODE("ExportForeign", "aliases keys path", {
        $documentation: "An `export ... from '...'` statement",
        $propdoc: {
            aliases: "[AST_String*] array of aliases to export",
            keys: "[AST_String*] array of keys to import",
            path: "[AST_String] the path to import module",
        },
        _equals: function(node) {
            return this.path.equals(node.path)
                && all_equals(this.aliases, node.aliases)
                && all_equals(this.keys, node.keys);
        },
        _validate: function() {
            if (this.aliases.length != this.keys.length) {
                throw new Error("aliases:key length mismatch: " + this.aliases.length + " != " + this.keys.length);
            }
            this.aliases.forEach(function(name) {
                if (!(name instanceof AST_String)) throw new Error("aliases must contain AST_String");
            });
            this.keys.forEach(function(name) {
                if (!(name instanceof AST_String)) throw new Error("keys must contain AST_String");
            });
            if (!(this.path instanceof AST_String)) throw new Error("path must be AST_String");
        },
    }, AST_Statement);

    var AST_ExportReferences = DEFNODE("ExportReferences", "properties", {
        $documentation: "An `export { ... }` statement",
        $propdoc: {
            properties: "[AST_SymbolExport*] array of aliases to export",
        },
        _equals: function(node) {
            return all_equals(this.properties, node.properties);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.properties.forEach(function(prop) {
                    prop.walk(visitor);
                });
            });
        },
        _validate: function() {
            this.properties.forEach(function(prop) {
                if (!(prop instanceof AST_SymbolExport)) throw new Error("properties must contain AST_SymbolExport");
            });
        },
    }, AST_Statement);

    var AST_Import = DEFNODE("Import", "all default path properties", {
        $documentation: "An `import` statement",
        $propdoc: {
            all: "[AST_SymbolImport?] the imported namespace, or null if not specified",
            default: "[AST_SymbolImport?] the alias for default `export`, or null if not specified",
            path: "[AST_String] the path to import module",
            properties: "[(AST_SymbolImport*)?] array of aliases, or null if not specified",
        },
        _equals: function(node) {
            return this.path.equals(node.path)
                && prop_equals(this.all, node.all)
                && prop_equals(this.default, node.default)
                && !this.properties == !node.properties
                && (!this.properties || all_equals(this.properties, node.properties));
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.all) node.all.walk(visitor);
                if (node.default) node.default.walk(visitor);
                if (node.properties) node.properties.forEach(function(prop) {
                    prop.walk(visitor);
                });
            });
        },
        _validate: function() {
            if (this.all != null) {
                if (!(this.all instanceof AST_SymbolImport)) throw new Error("all must be AST_SymbolImport");
                if (this.properties != null) throw new Error("cannot import both * and {} in the same statement");
            }
            if (this.default != null) {
                if (!(this.default instanceof AST_SymbolImport)) throw new Error("default must be AST_SymbolImport");
                if (this.default.key.value !== "") throw new Error("invalid default key: " + this.default.key.value);
            }
            if (!(this.path instanceof AST_String)) throw new Error("path must be AST_String");
            if (this.properties != null) this.properties.forEach(function(node) {
                if (!(node instanceof AST_SymbolImport)) throw new Error("properties must contain AST_SymbolImport");
            });
        },
    }, AST_Statement);

    var AST_DefaultValue = DEFNODE("DefaultValue", "name value", {
        $documentation: "A default value declaration",
        $propdoc: {
            name: "[AST_Destructured|AST_SymbolDeclaration] name of the variable",
            value: "[AST_Node] value to assign if variable is `undefined`",
        },
        _equals: function(node) {
            return this.name.equals(node.name)
                && this.value.equals(node.value);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.name.walk(visitor);
                node.value.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "value");
        },
    });

    function must_be_expressions(node, prop, allow_spread, allow_hole) {
        node[prop].forEach(function(node) {
            validate_expression(node, prop, true, allow_spread, allow_hole);
        });
    }

    var AST_Call = DEFNODE("Call", "args expression optional pure terminal", {
        $documentation: "A function call expression",
        $propdoc: {
            args: "[AST_Node*] array of arguments",
            expression: "[AST_Node] expression to invoke as function",
            optional: "[boolean] whether the expression is optional chaining",
            pure: "[boolean/S] marker for side-effect-free call expression",
            terminal: "[boolean] whether the chain has ended",
        },
        _equals: function(node) {
            return !this.optional == !node.optional
                && this.expression.equals(node.expression)
                && all_equals(this.args, node.args);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
                node.args.forEach(function(arg) {
                    arg.walk(visitor);
                });
            });
        },
        _validate: function() {
            must_be_expression(this, "expression");
            must_be_expressions(this, "args", true);
        },
    });

    var AST_New = DEFNODE("New", null, {
        $documentation: "An object instantiation.  Derives from a function call since it has exactly the same properties",
        _validate: function() {
            if (this.optional) throw new Error("optional must be false");
            if (this.terminal) throw new Error("terminal must be false");
        },
    }, AST_Call);

    var AST_Sequence = DEFNODE("Sequence", "expressions", {
        $documentation: "A sequence expression (comma-separated expressions)",
        $propdoc: {
            expressions: "[AST_Node*] array of expressions (at least two)",
        },
        _equals: function(node) {
            return all_equals(this.expressions, node.expressions);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expressions.forEach(function(expr) {
                    expr.walk(visitor);
                });
            });
        },
        _validate: function() {
            if (this.expressions.length < 2) throw new Error("expressions must contain multiple elements");
            must_be_expressions(this, "expressions");
        },
    });

    function root_expr(prop) {
        while (prop instanceof AST_PropAccess) prop = prop.expression;
        return prop;
    }

    var AST_PropAccess = DEFNODE("PropAccess", "expression optional property terminal", {
        $documentation: "Base class for property access expressions, i.e. `a.foo` or `a[\"foo\"]`",
        $propdoc: {
            expression: "[AST_Node] the “container” expression",
            optional: "[boolean] whether the expression is optional chaining",
            property: "[AST_Node|string] the property to access.  For AST_Dot this is always a plain string, while for AST_Sub it's an arbitrary AST_Node",
            terminal: "[boolean] whether the chain has ended",
        },
        _equals: function(node) {
            return !this.optional == !node.optional
                && prop_equals(this.property, node.property)
                && this.expression.equals(node.expression);
        },
        get_property: function() {
            var p = this.property;
            if (p instanceof AST_Constant) return p.value;
            if (p instanceof AST_UnaryPrefix && p.operator == "void" && p.expression instanceof AST_Constant) return;
            return p;
        },
        _validate: function() {
            if (this.TYPE == "PropAccess") throw new Error("should not instantiate AST_PropAccess");
            must_be_expression(this, "expression");
        },
    });

    var AST_Dot = DEFNODE("Dot", "quoted", {
        $documentation: "A dotted property access expression",
        $propdoc: {
            quoted: "[boolean] whether property is transformed from a quoted string",
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
            });
        },
        _validate: function() {
            if (typeof this.property != "string") throw new Error("property must be string");
        },
    }, AST_PropAccess);

    var AST_Sub = DEFNODE("Sub", null, {
        $documentation: "Index-style property access, i.e. `a[\"foo\"]`",
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
                node.property.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "property");
        },
    }, AST_PropAccess);

    var AST_Spread = DEFNODE("Spread", "expression", {
        $documentation: "Spread expression in array/object literals or function calls",
        $propdoc: {
            expression: "[AST_Node] expression to be expanded",
        },
        _equals: function(node) {
            return this.expression.equals(node.expression);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "expression");
        },
    });

    var AST_Unary = DEFNODE("Unary", "operator expression", {
        $documentation: "Base class for unary expressions",
        $propdoc: {
            operator: "[string] the operator",
            expression: "[AST_Node] expression that this unary operator applies to",
        },
        _equals: function(node) {
            return this.operator == node.operator
                && this.expression.equals(node.expression);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "Unary") throw new Error("should not instantiate AST_Unary");
            if (typeof this.operator != "string") throw new Error("operator must be string");
            must_be_expression(this, "expression");
        },
    });

    var AST_UnaryPrefix = DEFNODE("UnaryPrefix", null, {
        $documentation: "Unary prefix expression, i.e. `typeof i` or `++i`"
    }, AST_Unary);

    var AST_UnaryPostfix = DEFNODE("UnaryPostfix", null, {
        $documentation: "Unary postfix expression, i.e. `i++`"
    }, AST_Unary);

    var AST_Binary = DEFNODE("Binary", "operator left right", {
        $documentation: "Binary expression, i.e. `a + b`",
        $propdoc: {
            left: "[AST_Node] left-hand side expression",
            operator: "[string] the operator",
            right: "[AST_Node] right-hand side expression"
        },
        _equals: function(node) {
            return this.operator == node.operator
                && this.left.equals(node.left)
                && this.right.equals(node.right);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.left.walk(visitor);
                node.right.walk(visitor);
            });
        },
        _validate: function() {
            if (!(this instanceof AST_Assign)) must_be_expression(this, "left");
            if (typeof this.operator != "string") throw new Error("operator must be string");
            must_be_expression(this, "right");
        },
    });

    var AST_Conditional = DEFNODE("Conditional", "condition consequent alternative", {
        $documentation: "Conditional expression using the ternary operator, i.e. `a ? b : c`",
        $propdoc: {
            condition: "[AST_Node]",
            consequent: "[AST_Node]",
            alternative: "[AST_Node]"
        },
        _equals: function(node) {
            return this.condition.equals(node.condition)
                && this.consequent.equals(node.consequent)
                && this.alternative.equals(node.alternative);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.condition.walk(visitor);
                node.consequent.walk(visitor);
                node.alternative.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "condition");
            must_be_expression(this, "consequent");
            must_be_expression(this, "alternative");
        },
    });

    var AST_Assign = DEFNODE("Assign", null, {
        $documentation: "An assignment expression — `a = b + 5`",
        _validate: function() {
            if (this.operator.indexOf("=") < 0) throw new Error('operator must contain "="');
            if (this.left instanceof AST_Destructured) {
                if (this.operator != "=") throw new Error("invalid destructuring operator: " + this.operator);
                validate_destructured(this.left, function(node) {
                    if (!(node instanceof AST_PropAccess || node instanceof AST_SymbolRef)) {
                        throw new Error("left must be assignable: " + node.TYPE);
                    }
                });
            } else if (!(this.left instanceof AST_Infinity
                || this.left instanceof AST_NaN
                || this.left instanceof AST_PropAccess && !this.left.optional
                || this.left instanceof AST_SymbolRef
                || this.left instanceof AST_Undefined)) {
                throw new Error("left must be assignable");
            }
        },
    }, AST_Binary);

    var AST_Await = DEFNODE("Await", "expression", {
        $documentation: "An await expression",
        $propdoc: {
            expression: "[AST_Node] expression with Promise to resolve on",
        },
        _equals: function(node) {
            return this.expression.equals(node.expression);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.expression.walk(visitor);
            });
        },
        _validate: function() {
            must_be_expression(this, "expression");
        },
    });

    var AST_Yield = DEFNODE("Yield", "expression nested", {
        $documentation: "A yield expression",
        $propdoc: {
            expression: "[AST_Node?] return value for iterator, or null if undefined",
            nested: "[boolean] whether to iterate over expression as generator",
        },
        _equals: function(node) {
            return !this.nested == !node.nested
                && prop_equals(this.expression, node.expression);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.expression) node.expression.walk(visitor);
            });
        },
        _validate: function() {
            if (this.expression != null) {
                must_be_expression(this, "expression");
            } else if (this.nested) {
                throw new Error("yield* must contain expression");
            }
        },
    });

    /* -----[ LITERALS ]----- */

    var AST_Array = DEFNODE("Array", "elements", {
        $documentation: "An array literal",
        $propdoc: {
            elements: "[AST_Node*] array of elements"
        },
        _equals: function(node) {
            return all_equals(this.elements, node.elements);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.elements.forEach(function(element) {
                    element.walk(visitor);
                });
            });
        },
        _validate: function() {
            must_be_expressions(this, "elements", true, true);
        },
    });

    var AST_Destructured = DEFNODE("Destructured", "rest", {
        $documentation: "Base class for destructured literal",
        $propdoc: {
            rest: "[(AST_Destructured|AST_SymbolDeclaration|AST_SymbolRef)?] rest parameter, or null if absent",
        },
        _validate: function() {
            if (this.TYPE == "Destructured") throw new Error("should not instantiate AST_Destructured");
        },
    });

    function validate_destructured(node, check, allow_default) {
        if (node instanceof AST_DefaultValue && allow_default) return validate_destructured(node.name, check);
        if (node instanceof AST_Destructured) {
            if (node.rest != null) validate_destructured(node.rest, check);
            if (node instanceof AST_DestructuredArray) return node.elements.forEach(function(node) {
                if (!(node instanceof AST_Hole)) validate_destructured(node, check, true);
            });
            if (node instanceof AST_DestructuredObject) return node.properties.forEach(function(prop) {
                validate_destructured(prop.value, check, true);
            });
        }
        check(node);
    }

    var AST_DestructuredArray = DEFNODE("DestructuredArray", "elements", {
        $documentation: "A destructured array literal",
        $propdoc: {
            elements: "[(AST_DefaultValue|AST_Destructured|AST_SymbolDeclaration|AST_SymbolRef)*] array of elements",
        },
        _equals: function(node) {
            return prop_equals(this.rest, node.rest)
                && all_equals(this.elements, node.elements);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.elements.forEach(function(element) {
                    element.walk(visitor);
                });
                if (node.rest) node.rest.walk(visitor);
            });
        },
    }, AST_Destructured);

    var AST_DestructuredKeyVal = DEFNODE("DestructuredKeyVal", "key value", {
        $documentation: "A key: value destructured property",
        $propdoc: {
            key: "[string|AST_Node] property name.  For computed property this is an AST_Node.",
            value: "[AST_DefaultValue|AST_Destructured|AST_SymbolDeclaration|AST_SymbolRef] property value",
        },
        _equals: function(node) {
            return prop_equals(this.key, node.key)
                && this.value.equals(node.value);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.key instanceof AST_Node) node.key.walk(visitor);
                node.value.walk(visitor);
            });
        },
        _validate: function() {
            if (typeof this.key != "string") {
                if (!(this.key instanceof AST_Node)) throw new Error("key must be string or AST_Node");
                must_be_expression(this, "key");
            }
            if (!(this.value instanceof AST_Node)) throw new Error("value must be AST_Node");
        },
    });

    var AST_DestructuredObject = DEFNODE("DestructuredObject", "properties", {
        $documentation: "A destructured object literal",
        $propdoc: {
            properties: "[AST_DestructuredKeyVal*] array of properties",
        },
        _equals: function(node) {
            return prop_equals(this.rest, node.rest)
                && all_equals(this.properties, node.properties);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.properties.forEach(function(prop) {
                    prop.walk(visitor);
                });
                if (node.rest) node.rest.walk(visitor);
            });
        },
        _validate: function() {
            this.properties.forEach(function(node) {
                if (!(node instanceof AST_DestructuredKeyVal)) throw new Error("properties must be AST_DestructuredKeyVal[]");
            });
        },
    }, AST_Destructured);

    var AST_Object = DEFNODE("Object", "properties", {
        $documentation: "An object literal",
        $propdoc: {
            properties: "[(AST_ObjectProperty|AST_Spread)*] array of properties"
        },
        _equals: function(node) {
            return all_equals(this.properties, node.properties);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                node.properties.forEach(function(prop) {
                    prop.walk(visitor);
                });
            });
        },
        _validate: function() {
            this.properties.forEach(function(node) {
                if (!(node instanceof AST_ObjectProperty || node instanceof AST_Spread)) {
                    throw new Error("properties must contain AST_ObjectProperty and/or AST_Spread only");
                }
            });
        },
    });

    var AST_ObjectProperty = DEFNODE("ObjectProperty", "key value", {
        $documentation: "Base class for literal object properties",
        $propdoc: {
            key: "[string|AST_Node] property name.  For computed property this is an AST_Node.",
            value: "[AST_Node] property value.  For getters and setters this is an AST_Accessor.",
        },
        _equals: function(node) {
            return prop_equals(this.key, node.key)
                && this.value.equals(node.value);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.key instanceof AST_Node) node.key.walk(visitor);
                node.value.walk(visitor);
            });
        },
        _validate: function() {
            if (this.TYPE == "ObjectProperty") throw new Error("should not instantiate AST_ObjectProperty");
            if (typeof this.key != "string") {
                if (!(this.key instanceof AST_Node)) throw new Error("key must be string or AST_Node");
                must_be_expression(this, "key");
            }
            if (!(this.value instanceof AST_Node)) throw new Error("value must be AST_Node");
        },
    });

    var AST_ObjectKeyVal = DEFNODE("ObjectKeyVal", null, {
        $documentation: "A key: value object property",
        _validate: function() {
            must_be_expression(this, "value");
        },
    }, AST_ObjectProperty);

    var AST_ObjectMethod = DEFNODE("ObjectMethod", null, {
        $documentation: "A key(){} object property",
        _validate: function() {
            if (!(this.value instanceof AST_LambdaExpression)) throw new Error("value must be AST_LambdaExpression");
            if (is_arrow(this.value)) throw new Error("value cannot be AST_Arrow or AST_AsyncArrow");
            if (this.value.name != null) throw new Error("name of object method's lambda must be null");
        },
    }, AST_ObjectKeyVal);

    var AST_ObjectSetter = DEFNODE("ObjectSetter", null, {
        $documentation: "An object setter property",
        _validate: function() {
            if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
        },
    }, AST_ObjectProperty);

    var AST_ObjectGetter = DEFNODE("ObjectGetter", null, {
        $documentation: "An object getter property",
        _validate: function() {
            if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
        },
    }, AST_ObjectProperty);

    var AST_Symbol = DEFNODE("Symbol", "scope name thedef", {
        $documentation: "Base class for all symbols",
        $propdoc: {
            name: "[string] name of this symbol",
            scope: "[AST_Scope/S] the current scope (not necessarily the definition scope)",
            thedef: "[SymbolDef/S] the definition of this symbol"
        },
        _equals: function(node) {
            return this.thedef ? this.thedef === node.thedef : this.name == node.name;
        },
        _validate: function() {
            if (this.TYPE == "Symbol") throw new Error("should not instantiate AST_Symbol");
            if (typeof this.name != "string") throw new Error("name must be string");
        },
    });

    var AST_SymbolDeclaration = DEFNODE("SymbolDeclaration", "init", {
        $documentation: "A declaration symbol (symbol in var, function name or argument, symbol in catch)",
    }, AST_Symbol);

    var AST_SymbolConst = DEFNODE("SymbolConst", null, {
        $documentation: "Symbol defining a constant",
    }, AST_SymbolDeclaration);

    var AST_SymbolImport = DEFNODE("SymbolImport", "key", {
        $documentation: "Symbol defined by an `import` statement",
        $propdoc: {
            key: "[AST_String] the original `export` name",
        },
        _equals: function(node) {
            return this.name == node.name
                && this.key.equals(node.key);
        },
        _validate: function() {
            if (!(this.key instanceof AST_String)) throw new Error("key must be AST_String");
        },
    }, AST_SymbolConst);

    var AST_SymbolLet = DEFNODE("SymbolLet", null, {
        $documentation: "Symbol defining a lexical-scoped variable",
    }, AST_SymbolDeclaration);

    var AST_SymbolVar = DEFNODE("SymbolVar", null, {
        $documentation: "Symbol defining a variable",
    }, AST_SymbolDeclaration);

    var AST_SymbolFunarg = DEFNODE("SymbolFunarg", "unused", {
        $documentation: "Symbol naming a function argument",
    }, AST_SymbolVar);

    var AST_SymbolDefun = DEFNODE("SymbolDefun", null, {
        $documentation: "Symbol defining a function",
    }, AST_SymbolDeclaration);

    var AST_SymbolLambda = DEFNODE("SymbolLambda", null, {
        $documentation: "Symbol naming a function expression",
    }, AST_SymbolDeclaration);

    var AST_SymbolDefClass = DEFNODE("SymbolDefClass", null, {
        $documentation: "Symbol defining a class",
    }, AST_SymbolConst);

    var AST_SymbolClass = DEFNODE("SymbolClass", null, {
        $documentation: "Symbol naming a class expression",
    }, AST_SymbolConst);

    var AST_SymbolCatch = DEFNODE("SymbolCatch", null, {
        $documentation: "Symbol naming the exception in catch",
    }, AST_SymbolDeclaration);

    var AST_Label = DEFNODE("Label", "references", {
        $documentation: "Symbol naming a label (declaration)",
        $propdoc: {
            references: "[AST_LoopControl*] a list of nodes referring to this label"
        },
        initialize: function() {
            this.references = [];
            this.thedef = this;
        },
    }, AST_Symbol);

    var AST_SymbolRef = DEFNODE("SymbolRef", "fixed in_arg redef", {
        $documentation: "Reference to some symbol (not definition/declaration)",
    }, AST_Symbol);

    var AST_SymbolExport = DEFNODE("SymbolExport", "alias", {
        $documentation: "Reference in an `export` statement",
        $propdoc: {
            alias: "[AST_String] the `export` alias",
        },
        _equals: function(node) {
            return this.name == node.name
                && this.alias.equals(node.alias);
        },
        _validate: function() {
            if (!(this.alias instanceof AST_String)) throw new Error("alias must be AST_String");
        },
    }, AST_SymbolRef);

    var AST_LabelRef = DEFNODE("LabelRef", null, {
        $documentation: "Reference to a label symbol",
    }, AST_Symbol);

    var AST_ObjectIdentity = DEFNODE("ObjectIdentity", null, {
        $documentation: "Base class for `super` & `this`",
        _equals: return_true,
        _validate: function() {
            if (this.TYPE == "ObjectIdentity") throw new Error("should not instantiate AST_ObjectIdentity");
        },
    }, AST_Symbol);

    var AST_Super = DEFNODE("Super", null, {
        $documentation: "The `super` symbol",
        _validate: function() {
            if (this.name !== "super") throw new Error('name must be "super"');
        },
    }, AST_ObjectIdentity);

    var AST_This = DEFNODE("This", null, {
        $documentation: "The `this` symbol",
        _validate: function() {
            if (this.TYPE == "This" && this.name !== "this") throw new Error('name must be "this"');
        },
    }, AST_ObjectIdentity);

    var AST_NewTarget = DEFNODE("NewTarget", null, {
        $documentation: "The `new.target` symbol",
        initialize: function() {
            this.name = "new.target";
        },
        _validate: function() {
            if (this.name !== "new.target") throw new Error('name must be "new.target": ' + this.name);
        },
    }, AST_This);

    var AST_Template = DEFNODE("Template", "expressions strings tag", {
        $documentation: "A template literal, i.e. tag`str1${expr1}...strN${exprN}strN+1`",
        $propdoc: {
            expressions: "[AST_Node*] the placeholder expressions",
            strings: "[string*] the raw text segments",
            tag: "[AST_Node?] tag function, or null if absent",
        },
        _equals: function(node) {
            return prop_equals(this.tag, node.tag)
                && list_equals(this.strings, node.strings)
                && all_equals(this.expressions, node.expressions);
        },
        walk: function(visitor) {
            var node = this;
            visitor.visit(node, function() {
                if (node.tag) node.tag.walk(visitor);
                node.expressions.forEach(function(expr) {
                    expr.walk(visitor);
                });
            });
        },
        _validate: function() {
            if (this.expressions.length + 1 != this.strings.length) {
                throw new Error("malformed template with " + this.expressions.length + " placeholder(s) but " + this.strings.length + " text segment(s)");
            }
            must_be_expressions(this, "expressions");
            this.strings.forEach(function(string) {
                if (typeof string != "string") throw new Error("strings must contain string");
            });
            if (this.tag != null) must_be_expression(this, "tag");
        },
    });

    var AST_Constant = DEFNODE("Constant", null, {
        $documentation: "Base class for all constants",
        _equals: function(node) {
            return this.value === node.value;
        },
        _validate: function() {
            if (this.TYPE == "Constant") throw new Error("should not instantiate AST_Constant");
        },
    });

    var AST_String = DEFNODE("String", "quote value", {
        $documentation: "A string literal",
        $propdoc: {
            quote: "[string?] the original quote character",
            value: "[string] the contents of this string",
        },
        _validate: function() {
            if (this.quote != null) {
                if (typeof this.quote != "string") throw new Error("quote must be string");
                if (!/^["']$/.test(this.quote)) throw new Error("invalid quote: " + this.quote);
            }
            if (typeof this.value != "string") throw new Error("value must be string");
        },
    }, AST_Constant);

    var AST_Number = DEFNODE("Number", "value", {
        $documentation: "A number literal",
        $propdoc: {
            value: "[number] the numeric value",
        },
        _validate: function() {
            if (typeof this.value != "number") throw new Error("value must be number");
            if (!isFinite(this.value)) throw new Error("value must be finite");
            if (this.value < 0) throw new Error("value cannot be negative");
        },
    }, AST_Constant);

    var AST_BigInt = DEFNODE("BigInt", "value", {
        $documentation: "A BigInt literal",
        $propdoc: {
            value: "[string] the numeric representation",
        },
        _validate: function() {
            if (typeof this.value != "string") throw new Error("value must be string");
            if (this.value[0] == "-") throw new Error("value cannot be negative");
        },
    }, AST_Constant);

    var AST_RegExp = DEFNODE("RegExp", "value", {
        $documentation: "A regexp literal",
        $propdoc: {
            value: "[RegExp] the actual regexp"
        },
        _equals: function(node) {
            return "" + this.value == "" + node.value;
        },
        _validate: function() {
            if (!(this.value instanceof RegExp)) throw new Error("value must be RegExp");
        },
    }, AST_Constant);

    var AST_Atom = DEFNODE("Atom", null, {
        $documentation: "Base class for atoms",
        _equals: return_true,
        _validate: function() {
            if (this.TYPE == "Atom") throw new Error("should not instantiate AST_Atom");
        },
    }, AST_Constant);

    var AST_Null = DEFNODE("Null", null, {
        $documentation: "The `null` atom",
        value: null,
    }, AST_Atom);

    var AST_NaN = DEFNODE("NaN", null, {
        $documentation: "The impossible value",
        value: 0/0,
    }, AST_Atom);

    var AST_Undefined = DEFNODE("Undefined", null, {
        $documentation: "The `undefined` value",
        value: function(){}(),
    }, AST_Atom);

    var AST_Hole = DEFNODE("Hole", null, {
        $documentation: "A hole in an array",
        value: function(){}(),
    }, AST_Atom);

    var AST_Infinity = DEFNODE("Infinity", null, {
        $documentation: "The `Infinity` value",
        value: 1/0,
    }, AST_Atom);

    var AST_Boolean = DEFNODE("Boolean", null, {
        $documentation: "Base class for booleans",
        _validate: function() {
            if (this.TYPE == "Boolean") throw new Error("should not instantiate AST_Boolean");
        },
    }, AST_Atom);

    var AST_False = DEFNODE("False", null, {
        $documentation: "The `false` atom",
        value: false,
    }, AST_Boolean);

    var AST_True = DEFNODE("True", null, {
        $documentation: "The `true` atom",
        value: true,
    }, AST_Boolean);

    /* -----[ TreeWalker ]----- */

    function TreeWalker(callback) {
        this.callback = callback;
        this.directives = Object.create(null);
        this.stack = [];
    }
    TreeWalker.prototype = {
        visit: function(node, descend) {
            this.push(node);
            var done = this.callback(node, descend || noop);
            if (!done && descend) descend();
            this.pop();
        },
        parent: function(n) {
            return this.stack[this.stack.length - 2 - (n || 0)];
        },
        push: function(node) {
            var value;
            if (node instanceof AST_Class) {
                this.directives = Object.create(this.directives);
                value = "use strict";
            } else if (node instanceof AST_Directive) {
                value = node.value;
            } else if (node instanceof AST_Lambda) {
                this.directives = Object.create(this.directives);
            }
            if (value && !this.directives[value]) this.directives[value] = node;
            this.stack.push(node);
        },
        pop: function() {
            var node = this.stack.pop();
            if (node instanceof AST_Class || node instanceof AST_Lambda) {
                this.directives = Object.getPrototypeOf(this.directives);
            }
        },
        self: function() {
            return this.stack[this.stack.length - 1];
        },
        find_parent: function(type) {
            var stack = this.stack;
            for (var i = stack.length - 1; --i >= 0;) {
                var x = stack[i];
                if (x instanceof type) return x;
            }
        },
        has_directive: function(type) {
            var dir = this.directives[type];
            if (dir) return dir;
            var node = this.stack[this.stack.length - 1];
            if (node instanceof AST_Scope) {
                for (var i = 0; i < node.body.length; ++i) {
                    var st = node.body[i];
                    if (!(st instanceof AST_Directive)) break;
                    if (st.value == type) return st;
                }
            }
        },
        loopcontrol_target: function(node) {
            var stack = this.stack;
            if (node.label) for (var i = stack.length; --i >= 0;) {
                var x = stack[i];
                if (x instanceof AST_LabeledStatement && x.label.name == node.label.name)
                    return x.body;
            } else for (var i = stack.length; --i >= 0;) {
                var x = stack[i];
                if (x instanceof AST_IterationStatement
                    || node instanceof AST_Break && x instanceof AST_Switch)
                    return x;
            }
        },
        in_boolean_context: function() {
            for (var drop = true, level = 0, parent, self = this.self(); parent = this.parent(level++); self = parent) {
                if (parent instanceof AST_Binary) switch (parent.operator) {
                  case "&&":
                  case "||":
                    if (parent.left === self) drop = false;
                    continue;
                  default:
                    return false;
                }
                if (parent instanceof AST_Conditional) {
                    if (parent.condition === self) return true;
                    continue;
                }
                if (parent instanceof AST_DWLoop) return parent.condition === self;
                if (parent instanceof AST_For) return parent.condition === self;
                if (parent instanceof AST_If) return parent.condition === self;
                if (parent instanceof AST_Return) {
                    if (parent.in_bool) return true;
                    while (parent = this.parent(level++)) {
                        if (parent instanceof AST_Lambda) {
                            if (parent.name) return false;
                            parent = this.parent(level++);
                            if (parent.TYPE != "Call") return false;
                            break;
                        }
                    }
                }
                if (parent instanceof AST_Sequence) {
                    if (parent.tail_node() === self) continue;
                    return drop ? "d" : true;
                }
                if (parent instanceof AST_SimpleStatement) return drop ? "d" : true;
                if (parent instanceof AST_UnaryPrefix) return parent.operator == "!";
                return false;
            }
        }
    };








    /***********************************************************************

      A JavaScript tokenizer / parser / beautifier / compressor.
      https://github.com/mishoo/UglifyJS

      -------------------------------- (C) ---------------------------------

                               Author: Mihai Bazon
                             <mihai.bazon@gmail.com>
                           http://mihai.bazon.net/blog

      Distributed under the BSD license:

        Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>
        Parser based on parse-js (http://marijn.haverbeke.nl/parse-js/).

        Redistribution and use in source and binary forms, with or without
        modification, are permitted provided that the following conditions
        are met:

            * Redistributions of source code must retain the above
              copyright notice, this list of conditions and the following
              disclaimer.

            * Redistributions in binary form must reproduce the above
              copyright notice, this list of conditions and the following
              disclaimer in the documentation and/or other materials
              provided with the distribution.

        THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
        EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
        IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
        PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
        LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
        OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
        PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
        PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
        THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
        TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
        THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
        SUCH DAMAGE.

     ***********************************************************************/

    "use strict";

    var KEYWORDS = "break case catch class const continue debugger default delete do else extends finally for function if in instanceof new return switch throw try typeof var void while with";
    var KEYWORDS_ATOM = "false null true";
    var RESERVED_WORDS = [
        "abstract async await boolean byte char double enum export final float goto implements import int interface let long native package private protected public short static super synchronized this throws transient volatile yield",
        KEYWORDS_ATOM,
        KEYWORDS,
    ].join(" ");
    var KEYWORDS_BEFORE_EXPRESSION = "return new delete throw else case";

    KEYWORDS = makePredicate(KEYWORDS);
    RESERVED_WORDS = makePredicate(RESERVED_WORDS);
    KEYWORDS_BEFORE_EXPRESSION = makePredicate(KEYWORDS_BEFORE_EXPRESSION);
    KEYWORDS_ATOM = makePredicate(KEYWORDS_ATOM);

    var RE_BIN_NUMBER = /^0b([01]+)$/i;
    var RE_HEX_NUMBER = /^0x([0-9a-f]+)$/i;
    var RE_OCT_NUMBER = /^0o?([0-7]+)$/i;

    var OPERATORS = makePredicate([
        "in",
        "instanceof",
        "typeof",
        "new",
        "void",
        "delete",
        "++",
        "--",
        "+",
        "-",
        "!",
        "~",
        "&",
        "|",
        "^",
        "*",
        "/",
        "%",
        "**",
        ">>",
        "<<",
        ">>>",
        "<",
        ">",
        "<=",
        ">=",
        "==",
        "===",
        "!=",
        "!==",
        "?",
        "=",
        "+=",
        "-=",
        "/=",
        "*=",
        "%=",
        "**=",
        ">>=",
        "<<=",
        ">>>=",
        "&=",
        "|=",
        "^=",
        "&&",
        "||",
        "??",
        "&&=",
        "||=",
        "??=",
    ]);

    var NEWLINE_CHARS = "\n\r\u2028\u2029";
    var OPERATOR_CHARS = "+-*&%=<>!?|~^";
    var PUNC_OPENERS = "[{(";
    var PUNC_SEPARATORS = ",;:";
    var PUNC_CLOSERS = ")}]";
    var PUNC_AFTER_EXPRESSION = PUNC_SEPARATORS + PUNC_CLOSERS;
    var PUNC_BEFORE_EXPRESSION = PUNC_OPENERS + PUNC_SEPARATORS;
    var PUNC_CHARS = PUNC_BEFORE_EXPRESSION + "`" + PUNC_CLOSERS;
    var WHITESPACE_CHARS = NEWLINE_CHARS + " \u00a0\t\f\u000b\u200b\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\uFEFF";
    var NON_IDENTIFIER_CHARS = makePredicate(characters("./'\"#" + OPERATOR_CHARS + PUNC_CHARS + WHITESPACE_CHARS));

    NEWLINE_CHARS = makePredicate(characters(NEWLINE_CHARS));
    OPERATOR_CHARS = makePredicate(characters(OPERATOR_CHARS));
    PUNC_AFTER_EXPRESSION = makePredicate(characters(PUNC_AFTER_EXPRESSION));
    PUNC_BEFORE_EXPRESSION = makePredicate(characters(PUNC_BEFORE_EXPRESSION));
    PUNC_CHARS = makePredicate(characters(PUNC_CHARS));
    WHITESPACE_CHARS = makePredicate(characters(WHITESPACE_CHARS));

    /* -----[ Tokenizer ]----- */

    function is_surrogate_pair_head(code) {
        return code >= 0xd800 && code <= 0xdbff;
    }

    function is_surrogate_pair_tail(code) {
        return code >= 0xdc00 && code <= 0xdfff;
    }

    function is_digit(code) {
        return code >= 48 && code <= 57;
    }

    function is_identifier_char(ch) {
        return !NON_IDENTIFIER_CHARS[ch];
    }

    function is_identifier_string(str) {
        return /^[a-z_$][a-z0-9_$]*$/i.test(str);
    }

    function decode_escape_sequence(seq) {
        switch (seq[0]) {
          case "b": return "\b";
          case "f": return "\f";
          case "n": return "\n";
          case "r": return "\r";
          case "t": return "\t";
          case "u":
            var code;
            if (seq[1] == "{" && seq.slice(-1) == "}") {
                code = seq.slice(2, -1);
            } else if (seq.length == 5) {
                code = seq.slice(1);
            } else {
                return;
            }
            var num = parseInt(code, 16);
            if (num < 0 || isNaN(num)) return;
            if (num < 0x10000) return String.fromCharCode(num);
            if (num > 0x10ffff) return;
            return String.fromCharCode((num >> 10) + 0xd7c0) + String.fromCharCode((num & 0x03ff) + 0xdc00);
          case "v": return "\u000b";
          case "x":
            if (seq.length != 3) return;
            var num = parseInt(seq.slice(1), 16);
            if (num < 0 || isNaN(num)) return;
            return String.fromCharCode(num);
          case "\r":
          case "\n":
            return "";
          default:
            if (seq == "0") return "\0";
            if (seq[0] >= "0" && seq[0] <= "9") return;
            return seq;
        }
    }

    function parse_js_number(num) {
        var match;
        if (match = RE_BIN_NUMBER.exec(num)) return parseInt(match[1], 2);
        if (match = RE_HEX_NUMBER.exec(num)) return parseInt(match[1], 16);
        if (match = RE_OCT_NUMBER.exec(num)) return parseInt(match[1], 8);
        var val = parseFloat(num);
        if (val == num) return val;
    }

    function JS_Parse_Error(message, filename, line, col, pos) {
        this.message = message;
        this.filename = filename;
        this.line = line;
        this.col = col;
        this.pos = pos;
        try {
            throw new SyntaxError(message, filename, line, col);
        } catch (cause) {
            configure_error_stack(this, cause);
        }
    }
    JS_Parse_Error.prototype = Object.create(SyntaxError.prototype);
    JS_Parse_Error.prototype.constructor = JS_Parse_Error;

    function js_error(message, filename, line, col, pos) {
        throw new JS_Parse_Error(message, filename, line, col, pos);
    }

    function is_token(token, type, val) {
        return token.type == type && (val == null || token.value == val);
    }

    var EX_EOF = {};

    function tokenizer($TEXT, filename, html5_comments, shebang) {

        var S = {
            text            : $TEXT,
            filename        : filename,
            pos             : 0,
            tokpos          : 0,
            line            : 1,
            tokline         : 0,
            col             : 0,
            tokcol          : 0,
            newline_before  : false,
            regex_allowed   : false,
            comments_before : [],
            directives      : Object.create(null),
            read_template   : with_eof_error("Unterminated template literal", function(strings) {
                var s = "";
                for (;;) {
                    var ch = read();
                    switch (ch) {
                      case "\\":
                        ch += read();
                        break;
                      case "`":
                        strings.push(s);
                        return;
                      case "$":
                        if (peek() == "{") {
                            next();
                            strings.push(s);
                            S.regex_allowed = true;
                            return true;
                        }
                    }
                    s += ch;
                }

                function read() {
                    var ch = next(true, true);
                    return ch == "\r" ? "\n" : ch;
                }
            }),
        };
        var prev_was_dot = false;

        function peek() {
            return S.text.charAt(S.pos);
        }

        function next(signal_eof, in_string) {
            var ch = S.text.charAt(S.pos++);
            if (signal_eof && !ch)
                throw EX_EOF;
            if (NEWLINE_CHARS[ch]) {
                S.col = 0;
                S.line++;
                if (!in_string) S.newline_before = true;
                if (ch == "\r" && peek() == "\n") {
                    // treat `\r\n` as `\n`
                    S.pos++;
                    ch = "\n";
                }
            } else {
                S.col++;
            }
            return ch;
        }

        function forward(i) {
            while (i-- > 0) next();
        }

        function looking_at(str) {
            return S.text.substr(S.pos, str.length) == str;
        }

        function find_eol() {
            var text = S.text;
            for (var i = S.pos; i < S.text.length; ++i) {
                if (NEWLINE_CHARS[text[i]]) return i;
            }
            return -1;
        }

        function find(what, signal_eof) {
            var pos = S.text.indexOf(what, S.pos);
            if (signal_eof && pos == -1) throw EX_EOF;
            return pos;
        }

        function start_token() {
            S.tokline = S.line;
            S.tokcol = S.col;
            S.tokpos = S.pos;
        }

        function token(type, value, is_comment) {
            S.regex_allowed = type == "operator" && !UNARY_POSTFIX[value]
                || type == "keyword" && KEYWORDS_BEFORE_EXPRESSION[value]
                || type == "punc" && PUNC_BEFORE_EXPRESSION[value];
            if (type == "punc" && value == ".") prev_was_dot = true;
            else if (!is_comment) prev_was_dot = false;
            var ret = {
                type    : type,
                value   : value,
                line    : S.tokline,
                col     : S.tokcol,
                pos     : S.tokpos,
                endline : S.line,
                endcol  : S.col,
                endpos  : S.pos,
                nlb     : S.newline_before,
                file    : filename
            };
            if (/^(?:num|string|regexp)$/i.test(type)) {
                ret.raw = $TEXT.substring(ret.pos, ret.endpos);
            }
            if (!is_comment) {
                ret.comments_before = S.comments_before;
                ret.comments_after = S.comments_before = [];
            }
            S.newline_before = false;
            return new AST_Token(ret);
        }

        function skip_whitespace() {
            while (WHITESPACE_CHARS[peek()])
                next();
        }

        function read_while(pred) {
            var ret = "", ch;
            while ((ch = peek()) && pred(ch, ret)) ret += next();
            return ret;
        }

        function parse_error(err) {
            js_error(err, filename, S.tokline, S.tokcol, S.tokpos);
        }

        function is_octal(num) {
            return /^0[0-7_]+$/.test(num);
        }

        function read_num(prefix) {
            var has_e = false, after_e = false, has_x = false, has_dot = prefix == ".";
            var num = read_while(function(ch, str) {
                switch (ch) {
                  case "x": case "X":
                    return has_x ? false : (has_x = true);
                  case "e": case "E":
                    return has_x ? true : has_e ? false : (has_e = after_e = true);
                  case "+": case "-":
                    return after_e;
                  case (after_e = false, "."):
                    return has_dot || has_e || has_x || is_octal(str) ? false : (has_dot = true);
                }
                return /[_0-9a-dfo]/i.test(ch);
            });
            if (prefix) num = prefix + num;
            if (is_octal(num)) {
                if (next_token.has_directive("use strict")) parse_error("Legacy octal literals are not allowed in strict mode");
            } else {
                num = num.replace(has_x ? /([1-9a-f]|.0)_(?=[0-9a-f])/gi : /([1-9]|.0)_(?=[0-9])/gi, "$1");
            }
            var valid = parse_js_number(num);
            if (isNaN(valid)) parse_error("Invalid syntax: " + num);
            if (has_dot || has_e || peek() != "n") return token("num", valid);
            next();
            return token("bigint", num.toLowerCase());
        }

        function read_escaped_char(in_string) {
            var seq = next(true, in_string);
            if (seq >= "0" && seq <= "7") return read_octal_escape_sequence(seq);
            if (seq == "u") {
                var ch = next(true, in_string);
                seq += ch;
                if (ch != "{") {
                    seq += next(true, in_string) + next(true, in_string) + next(true, in_string);
                } else do {
                    ch = next(true, in_string);
                    seq += ch;
                } while (ch != "}");
            } else if (seq == "x") {
                seq += next(true, in_string) + next(true, in_string);
            }
            var str = decode_escape_sequence(seq);
            if (typeof str != "string") parse_error("Invalid escape sequence: \\" + seq);
            return str;
        }

        function read_octal_escape_sequence(ch) {
            // Read
            var p = peek();
            if (p >= "0" && p <= "7") {
                ch += next(true);
                if (ch[0] <= "3" && (p = peek()) >= "0" && p <= "7")
                    ch += next(true);
            }

            // Parse
            if (ch === "0") return "\0";
            if (ch.length > 0 && next_token.has_directive("use strict"))
                parse_error("Legacy octal escape sequences are not allowed in strict mode");
            return String.fromCharCode(parseInt(ch, 8));
        }

        var read_string = with_eof_error("Unterminated string constant", function(quote_char) {
            var quote = next(), ret = "";
            for (;;) {
                var ch = next(true, true);
                if (ch == "\\") ch = read_escaped_char(true);
                else if (NEWLINE_CHARS[ch]) parse_error("Unterminated string constant");
                else if (ch == quote) break;
                ret += ch;
            }
            var tok = token("string", ret);
            tok.quote = quote_char;
            return tok;
        });

        function skip_line_comment(type) {
            var regex_allowed = S.regex_allowed;
            var i = find_eol(), ret;
            if (i == -1) {
                ret = S.text.substr(S.pos);
                S.pos = S.text.length;
            } else {
                ret = S.text.substring(S.pos, i);
                S.pos = i;
            }
            S.col = S.tokcol + (S.pos - S.tokpos);
            S.comments_before.push(token(type, ret, true));
            S.regex_allowed = regex_allowed;
            return next_token;
        }

        var skip_multiline_comment = with_eof_error("Unterminated multiline comment", function() {
            var regex_allowed = S.regex_allowed;
            var i = find("*/", true);
            var text = S.text.substring(S.pos, i).replace(/\r\n|\r|\u2028|\u2029/g, "\n");
            // update stream position
            forward(text.length /* doesn't count \r\n as 2 char while S.pos - i does */ + 2);
            S.comments_before.push(token("comment2", text, true));
            S.regex_allowed = regex_allowed;
            return next_token;
        });

        function read_name() {
            var backslash = false, ch, escaped = false, name = peek() == "#" ? next() : "";
            while (ch = peek()) {
                if (!backslash) {
                    if (ch == "\\") escaped = backslash = true, next();
                    else if (is_identifier_char(ch)) name += next();
                    else break;
                } else {
                    if (ch != "u") parse_error("Expecting UnicodeEscapeSequence -- uXXXX");
                    ch = read_escaped_char();
                    if (!is_identifier_char(ch)) parse_error("Unicode char: " + ch.charCodeAt(0) + " is not valid in identifier");
                    name += ch;
                    backslash = false;
                }
            }
            if (KEYWORDS[name] && escaped) {
                var hex = name.charCodeAt(0).toString(16).toUpperCase();
                name = "\\u" + "0000".substr(hex.length) + hex + name.slice(1);
            }
            return name;
        }

        var read_regexp = with_eof_error("Unterminated regular expression", function(source) {
            var prev_backslash = false, ch, in_class = false;
            while ((ch = next(true))) if (NEWLINE_CHARS[ch]) {
                parse_error("Unexpected line terminator");
            } else if (prev_backslash) {
                source += "\\" + ch;
                prev_backslash = false;
            } else if (ch == "[") {
                in_class = true;
                source += ch;
            } else if (ch == "]" && in_class) {
                in_class = false;
                source += ch;
            } else if (ch == "/" && !in_class) {
                break;
            } else if (ch == "\\") {
                prev_backslash = true;
            } else {
                source += ch;
            }
            var mods = read_name();
            try {
                var regexp = new RegExp(source, mods);
                regexp.raw_source = source;
                return token("regexp", regexp);
            } catch (e) {
                parse_error(e.message);
            }
        });

        function read_operator(prefix) {
            function grow(op) {
                if (!peek()) return op;
                var bigger = op + peek();
                if (OPERATORS[bigger]) {
                    next();
                    return grow(bigger);
                } else {
                    return op;
                }
            }
            return token("operator", grow(prefix || next()));
        }

        function handle_slash() {
            next();
            switch (peek()) {
              case "/":
                next();
                return skip_line_comment("comment1");
              case "*":
                next();
                return skip_multiline_comment();
            }
            return S.regex_allowed ? read_regexp("") : read_operator("/");
        }

        function handle_dot() {
            next();
            if (looking_at("..")) return token("operator", "." + next() + next());
            return is_digit(peek().charCodeAt(0)) ? read_num(".") : token("punc", ".");
        }

        function read_word() {
            var word = read_name();
            if (prev_was_dot) return token("name", word);
            return KEYWORDS_ATOM[word] ? token("atom", word)
                : !KEYWORDS[word] ? token("name", word)
                : OPERATORS[word] ? token("operator", word)
                : token("keyword", word);
        }

        function with_eof_error(eof_error, cont) {
            return function(x) {
                try {
                    return cont(x);
                } catch (ex) {
                    if (ex === EX_EOF) parse_error(eof_error);
                    else throw ex;
                }
            };
        }

        function next_token(force_regexp) {
            if (force_regexp != null)
                return read_regexp(force_regexp);
            if (shebang && S.pos == 0 && looking_at("#!")) {
                start_token();
                forward(2);
                skip_line_comment("comment5");
            }
            for (;;) {
                skip_whitespace();
                start_token();
                if (html5_comments) {
                    if (looking_at("<!--")) {
                        forward(4);
                        skip_line_comment("comment3");
                        continue;
                    }
                    if (looking_at("-->") && S.newline_before) {
                        forward(3);
                        skip_line_comment("comment4");
                        continue;
                    }
                }
                var ch = peek();
                if (!ch) return token("eof");
                var code = ch.charCodeAt(0);
                switch (code) {
                  case 34: case 39: return read_string(ch);
                  case 46: return handle_dot();
                  case 47:
                    var tok = handle_slash();
                    if (tok === next_token) continue;
                    return tok;
                }
                if (is_digit(code)) return read_num();
                if (PUNC_CHARS[ch]) return token("punc", next());
                if (looking_at("=>")) return token("punc", next() + next());
                if (OPERATOR_CHARS[ch]) return read_operator();
                if (code == 35 || code == 92 || !NON_IDENTIFIER_CHARS[ch]) return read_word();
                break;
            }
            parse_error("Unexpected character '" + ch + "'");
        }

        next_token.context = function(nc) {
            if (nc) S = nc;
            return S;
        };

        next_token.add_directive = function(directive) {
            S.directives[directive] = true;
        }

        next_token.push_directives_stack = function() {
            S.directives = Object.create(S.directives);
        }

        next_token.pop_directives_stack = function() {
            S.directives = Object.getPrototypeOf(S.directives);
        }

        next_token.has_directive = function(directive) {
            return !!S.directives[directive];
        }

        return next_token;
    }

    /* -----[ Parser (constants) ]----- */

    var UNARY_PREFIX = makePredicate("typeof void delete -- ++ ! ~ - +");

    var UNARY_POSTFIX = makePredicate("-- ++");

    var ASSIGNMENT = makePredicate("= += -= /= *= %= **= >>= <<= >>>= &= |= ^= &&= ||= ??=");

    var PRECEDENCE = function(a, ret) {
        for (var i = 0; i < a.length;) {
            var b = a[i++];
            for (var j = 0; j < b.length; j++) {
                ret[b[j]] = i;
            }
        }
        return ret;
    }([
        ["??"],
        ["||"],
        ["&&"],
        ["|"],
        ["^"],
        ["&"],
        ["==", "===", "!=", "!=="],
        ["<", ">", "<=", ">=", "in", "instanceof"],
        [">>", "<<", ">>>"],
        ["+", "-"],
        ["*", "/", "%"],
        ["**"],
    ], {});

    var ATOMIC_START_TOKEN = makePredicate("atom bigint num regexp string");

    /* -----[ Parser ]----- */

    function parse($TEXT, options) {
        options = defaults(options, {
            bare_returns   : false,
            expression     : false,
            filename       : null,
            html5_comments : true,
            module         : false,
            shebang        : true,
            strict         : false,
            toplevel       : null,
        }, true);

        var S = {
            input         : typeof $TEXT == "string"
                            ? tokenizer($TEXT, options.filename, options.html5_comments, options.shebang)
                            : $TEXT,
            in_async      : false,
            in_directives : true,
            in_funarg     : -1,
            in_function   : 0,
            in_generator  : false,
            in_loop       : 0,
            labels        : [],
            peeked        : null,
            prev          : null,
            token         : null,
        };

        S.token = next();

        function is(type, value) {
            return is_token(S.token, type, value);
        }

        function peek() {
            return S.peeked || (S.peeked = S.input());
        }

        function next() {
            S.prev = S.token;
            if (S.peeked) {
                S.token = S.peeked;
                S.peeked = null;
            } else {
                S.token = S.input();
            }
            S.in_directives = S.in_directives && (
                S.token.type == "string" || is("punc", ";")
            );
            return S.token;
        }

        function prev() {
            return S.prev;
        }

        function croak(msg, line, col, pos) {
            var ctx = S.input.context();
            js_error(msg,
                     ctx.filename,
                     line != null ? line : ctx.tokline,
                     col != null ? col : ctx.tokcol,
                     pos != null ? pos : ctx.tokpos);
        }

        function token_error(token, msg) {
            croak(msg, token.line, token.col);
        }

        function token_to_string(type, value) {
            return type + (value === undefined ? "" : " «" + value + "»");
        }

        function unexpected(token) {
            if (token == null) token = S.token;
            token_error(token, "Unexpected token: " + token_to_string(token.type, token.value));
        }

        function expect_token(type, val) {
            if (is(type, val)) return next();
            token_error(S.token, "Unexpected token: " + token_to_string(S.token.type, S.token.value) + ", expected: " + token_to_string(type, val));
        }

        function expect(punc) {
            return expect_token("punc", punc);
        }

        function has_newline_before(token) {
            return token.nlb || !all(token.comments_before, function(comment) {
                return !comment.nlb;
            });
        }

        function can_insert_semicolon() {
            return !options.strict
                && (is("eof") || is("punc", "}") || has_newline_before(S.token));
        }

        function semicolon(optional) {
            if (is("punc", ";")) next();
            else if (!optional && !can_insert_semicolon()) expect(";");
        }

        function parenthesized() {
            expect("(");
            var exp = expression();
            expect(")");
            return exp;
        }

        function embed_tokens(parser) {
            return function() {
                var start = S.token;
                var expr = parser.apply(null, arguments);
                var end = prev();
                expr.start = start;
                expr.end = end;
                return expr;
            };
        }

        function handle_regexp() {
            if (is("operator", "/") || is("operator", "/=")) {
                S.peeked = null;
                S.token = S.input(S.token.value.substr(1)); // force regexp
            }
        }

        var statement = embed_tokens(function(toplevel) {
            handle_regexp();
            switch (S.token.type) {
              case "string":
                var dir = S.in_directives;
                var body = expression();
                if (dir) {
                    if (body instanceof AST_String) {
                        var value = body.start.raw.slice(1, -1);
                        S.input.add_directive(value);
                        body.value = value;
                    } else {
                        S.in_directives = dir = false;
                    }
                }
                semicolon();
                return dir ? new AST_Directive(body) : new AST_SimpleStatement({ body: body });
              case "num":
              case "bigint":
              case "regexp":
              case "operator":
              case "atom":
                return simple_statement();

              case "name":
                switch (S.token.value) {
                  case "async":
                    if (is_token(peek(), "keyword", "function")) {
                        next();
                        next();
                        if (!is("operator", "*")) return function_(AST_AsyncDefun);
                        next();
                        return function_(AST_AsyncGeneratorDefun);
                    }
                    break;
                  case "await":
                    if (S.in_async) return simple_statement();
                    break;
                  case "export":
                    if (!toplevel && options.module !== "") unexpected();
                    next();
                    return export_();
                  case "import":
                    var token = peek();
                    if (token.type == "punc" && /^[(.]$/.test(token.value)) break;
                    if (!toplevel && options.module !== "") unexpected();
                    next();
                    return import_();
                  case "let":
                    if (is_vardefs()) {
                        next();
                        var node = let_();
                        semicolon();
                        return node;
                    }
                    break;
                  case "yield":
                    if (S.in_generator) return simple_statement();
                    break;
                }
                return is_token(peek(), "punc", ":")
                    ? labeled_statement()
                    : simple_statement();

              case "punc":
                switch (S.token.value) {
                  case "{":
                    return new AST_BlockStatement({
                        start : S.token,
                        body  : block_(),
                        end   : prev()
                    });
                  case "[":
                  case "(":
                  case "`":
                    return simple_statement();
                  case ";":
                    S.in_directives = false;
                    next();
                    return new AST_EmptyStatement();
                  default:
                    unexpected();
                }

              case "keyword":
                switch (S.token.value) {
                  case "break":
                    next();
                    return break_cont(AST_Break);

                  case "class":
                    next();
                    return class_(AST_DefClass);

                  case "const":
                    next();
                    var node = const_();
                    semicolon();
                    return node;

                  case "continue":
                    next();
                    return break_cont(AST_Continue);

                  case "debugger":
                    next();
                    semicolon();
                    return new AST_Debugger();

                  case "do":
                    next();
                    var body = in_loop(statement);
                    expect_token("keyword", "while");
                    var condition = parenthesized();
                    semicolon(true);
                    return new AST_Do({
                        body      : body,
                        condition : condition,
                    });

                  case "while":
                    next();
                    return new AST_While({
                        condition : parenthesized(),
                        body      : in_loop(statement),
                    });

                  case "for":
                    next();
                    return for_();

                  case "function":
                    next();
                    if (!is("operator", "*")) return function_(AST_Defun);
                    next();
                    return function_(AST_GeneratorDefun);

                  case "if":
                    next();
                    return if_();

                  case "return":
                    if (S.in_function == 0 && !options.bare_returns)
                        croak("'return' outside of function");
                    next();
                    var value = null;
                    if (is("punc", ";")) {
                        next();
                    } else if (!can_insert_semicolon()) {
                        value = expression();
                        semicolon();
                    }
                    return new AST_Return({ value: value });

                  case "switch":
                    next();
                    return new AST_Switch({
                        expression : parenthesized(),
                        body       : in_loop(switch_body_),
                    });

                  case "throw":
                    next();
                    if (has_newline_before(S.token))
                        croak("Illegal newline after 'throw'");
                    var value = expression();
                    semicolon();
                    return new AST_Throw({ value: value });

                  case "try":
                    next();
                    return try_();

                  case "var":
                    next();
                    var node = var_();
                    semicolon();
                    return node;

                  case "with":
                    if (S.input.has_directive("use strict")) {
                        croak("Strict mode may not include a with statement");
                    }
                    next();
                    return new AST_With({
                        expression : parenthesized(),
                        body       : statement(),
                    });
                }
            }
            unexpected();
        });

        function labeled_statement() {
            var label = as_symbol(AST_Label);
            if (!all(S.labels, function(l) {
                return l.name != label.name;
            })) {
                // ECMA-262, 12.12: An ECMAScript program is considered
                // syntactically incorrect if it contains a
                // LabelledStatement that is enclosed by a
                // LabelledStatement with the same Identifier as label.
                croak("Label " + label.name + " defined twice");
            }
            expect(":");
            S.labels.push(label);
            var stat = statement();
            S.labels.pop();
            if (!(stat instanceof AST_IterationStatement)) {
                // check for `continue` that refers to this label.
                // those should be reported as syntax errors.
                // https://github.com/mishoo/UglifyJS/issues/287
                label.references.forEach(function(ref) {
                    if (ref instanceof AST_Continue) {
                        token_error(ref.label.start, "Continue label `" + label.name + "` must refer to IterationStatement");
                    }
                });
            }
            return new AST_LabeledStatement({ body: stat, label: label });
        }

        function simple_statement() {
            var body = expression();
            semicolon();
            return new AST_SimpleStatement({ body: body });
        }

        function break_cont(type) {
            var label = null, ldef;
            if (!can_insert_semicolon()) {
                label = as_symbol(AST_LabelRef, true);
            }
            if (label != null) {
                ldef = find_if(function(l) {
                    return l.name == label.name;
                }, S.labels);
                if (!ldef) token_error(label.start, "Undefined label " + label.name);
                label.thedef = ldef;
            } else if (S.in_loop == 0) croak(type.TYPE + " not inside a loop or switch");
            semicolon();
            var stat = new type({ label: label });
            if (ldef) ldef.references.push(stat);
            return stat;
        }

        function has_modifier(name, no_nlb) {
            if (!is("name", name)) return;
            var token = peek();
            if (!token) return;
            if (is_token(token, "operator", "=")) return;
            if (token.type == "punc" && /^[(;}]$/.test(token.value)) return;
            if (no_nlb && has_newline_before(token)) return;
            return next();
        }

        function class_(ctor) {
            var was_async = S.in_async;
            var was_gen = S.in_generator;
            S.input.push_directives_stack();
            S.input.add_directive("use strict");
            var name;
            if (ctor === AST_DefClass) {
                name = as_symbol(AST_SymbolDefClass);
            } else {
                name = as_symbol(AST_SymbolClass, true);
            }
            var parent = null;
            if (is("keyword", "extends")) {
                next();
                handle_regexp();
                parent = expr_atom(true);
            }
            expect("{");
            var props = [];
            while (!is("punc", "}")) {
                if (is("punc", ";")) {
                    next();
                    continue;
                }
                var start = S.token;
                var fixed = !!has_modifier("static");
                var async = has_modifier("async", true);
                if (is("operator", "*")) {
                    next();
                    var internal = is("name") && /^#/.test(S.token.value);
                    var key = as_property_key();
                    var gen_start = S.token;
                    var gen = function_(async ? AST_AsyncGeneratorFunction : AST_GeneratorFunction);
                    gen.start = gen_start;
                    gen.end = prev();
                    props.push(new AST_ClassMethod({
                        start: start,
                        static: fixed,
                        private: internal,
                        key: key,
                        value: gen,
                        end: prev(),
                    }));
                    continue;
                }
                if (fixed && is("punc", "{")) {
                    props.push(new AST_ClassInit({
                        start: start,
                        value: new AST_ClassInitBlock({
                            start: start,
                            body: block_(),
                            end: prev(),
                        }),
                        end: prev(),
                    }));
                    continue;
                }
                var internal = is("name") && /^#/.test(S.token.value);
                var key = as_property_key();
                if (is("punc", "(")) {
                    var func_start = S.token;
                    var func = function_(async ? AST_AsyncFunction : AST_Function);
                    func.start = func_start;
                    func.end = prev();
                    props.push(new AST_ClassMethod({
                        start: start,
                        static: fixed,
                        private: internal,
                        key: key,
                        value: func,
                        end: prev(),
                    }));
                    continue;
                }
                if (async) unexpected(async);
                var value = null;
                if (is("operator", "=")) {
                    next();
                    S.in_async = false;
                    S.in_generator = false;
                    value = maybe_assign();
                    S.in_generator = was_gen;
                    S.in_async = was_async;
                } else if (!(is("punc", ";") || is("punc", "}"))) {
                    var type = null;
                    switch (key) {
                      case "get":
                        type = AST_ClassGetter;
                        break;
                      case "set":
                        type = AST_ClassSetter;
                        break;
                    }
                    if (type) {
                        props.push(new type({
                            start: start,
                            static: fixed,
                            private: is("name") && /^#/.test(S.token.value),
                            key: as_property_key(),
                            value: create_accessor(),
                            end: prev(),
                        }));
                        continue;
                    }
                }
                semicolon();
                props.push(new AST_ClassField({
                    start: start,
                    static: fixed,
                    private: internal,
                    key: key,
                    value: value,
                    end: prev(),
                }));
            }
            next();
            S.input.pop_directives_stack();
            S.in_generator = was_gen;
            S.in_async = was_async;
            return new ctor({
                extends: parent,
                name: name,
                properties: props,
            });
        }

        function for_() {
            var await_token = is("name", "await") && next();
            expect("(");
            var init = null;
            if (await_token || !is("punc", ";")) {
                init = is("keyword", "const")
                    ? (next(), const_(true))
                    : is("name", "let") && is_vardefs()
                    ? (next(), let_(true))
                    : is("keyword", "var")
                    ? (next(), var_(true))
                    : expression(true);
                var ctor;
                if (await_token) {
                    expect_token("name", "of");
                    ctor = AST_ForAwaitOf;
                } else if (is("operator", "in")) {
                    next();
                    ctor = AST_ForIn;
                } else if (is("name", "of")) {
                    next();
                    ctor = AST_ForOf;
                }
                if (ctor) {
                    if (init instanceof AST_Definitions) {
                        if (init.definitions.length > 1) {
                            token_error(init.start, "Only one variable declaration allowed in for..in/of loop");
                        }
                        if (ctor !== AST_ForIn && init.definitions[0].value) {
                            token_error(init.definitions[0].value.start, "No initializers allowed in for..of loop");
                        }
                    } else if (!(is_assignable(init) || (init = to_destructured(init)) instanceof AST_Destructured)) {
                        token_error(init.start, "Invalid left-hand side in for..in/of loop");
                    }
                    return for_enum(ctor, init);
                }
            }
            return regular_for(init);
        }

        function regular_for(init) {
            expect(";");
            var test = is("punc", ";") ? null : expression();
            expect(";");
            var step = is("punc", ")") ? null : expression();
            expect(")");
            return new AST_For({
                init      : init,
                condition : test,
                step      : step,
                body      : in_loop(statement)
            });
        }

        function for_enum(ctor, init) {
            handle_regexp();
            var obj = expression();
            expect(")");
            return new ctor({
                init   : init,
                object : obj,
                body   : in_loop(statement)
            });
        }

        function to_funarg(node) {
            if (node instanceof AST_Array) {
                var rest = null;
                if (node.elements[node.elements.length - 1] instanceof AST_Spread) {
                    rest = to_funarg(node.elements.pop().expression);
                }
                return new AST_DestructuredArray({
                    start: node.start,
                    elements: node.elements.map(to_funarg),
                    rest: rest,
                    end: node.end,
                });
            }
            if (node instanceof AST_Assign) return new AST_DefaultValue({
                start: node.start,
                name: to_funarg(node.left),
                value: node.right,
                end: node.end,
            });
            if (node instanceof AST_DefaultValue) {
                node.name = to_funarg(node.name);
                return node;
            }
            if (node instanceof AST_DestructuredArray) {
                node.elements = node.elements.map(to_funarg);
                if (node.rest) node.rest = to_funarg(node.rest);
                return node;
            }
            if (node instanceof AST_DestructuredObject) {
                node.properties.forEach(function(prop) {
                    prop.value = to_funarg(prop.value);
                });
                if (node.rest) node.rest = to_funarg(node.rest);
                return node;
            }
            if (node instanceof AST_Hole) return node;
            if (node instanceof AST_Object) {
                var rest = null;
                if (node.properties[node.properties.length - 1] instanceof AST_Spread) {
                    rest = to_funarg(node.properties.pop().expression);
                }
                return new AST_DestructuredObject({
                    start: node.start,
                    properties: node.properties.map(function(prop) {
                        if (!(prop instanceof AST_ObjectKeyVal)) token_error(prop.start, "Invalid destructuring assignment");
                        return new AST_DestructuredKeyVal({
                            start: prop.start,
                            key: prop.key,
                            value: to_funarg(prop.value),
                            end: prop.end,
                        });
                    }),
                    rest: rest,
                    end: node.end,
                });
            }
            if (node instanceof AST_SymbolFunarg) return node;
            if (node instanceof AST_SymbolRef) return new AST_SymbolFunarg(node);
            if (node instanceof AST_Yield) return new AST_SymbolFunarg({
                start: node.start,
                name: "yield",
                end: node.end,
            });
            token_error(node.start, "Invalid arrow parameter");
        }

        function arrow(exprs, start, async) {
            var was_async = S.in_async;
            var was_gen = S.in_generator;
            S.in_async = async;
            S.in_generator = false;
            var was_funarg = S.in_funarg;
            S.in_funarg = S.in_function;
            var argnames = exprs.map(to_funarg);
            var rest = exprs.rest || null;
            if (rest) rest = to_funarg(rest);
            S.in_funarg = was_funarg;
            expect("=>");
            var body, value;
            var loop = S.in_loop;
            var labels = S.labels;
            ++S.in_function;
            S.input.push_directives_stack();
            S.in_loop = 0;
            S.labels = [];
            if (is("punc", "{")) {
                S.in_directives = true;
                body = block_();
                value = null;
            } else {
                body = [];
                handle_regexp();
                value = maybe_assign();
            }
            var is_strict = S.input.has_directive("use strict");
            S.input.pop_directives_stack();
            --S.in_function;
            S.in_loop = loop;
            S.labels = labels;
            S.in_generator = was_gen;
            S.in_async = was_async;
            var node = new (async ? AST_AsyncArrow : AST_Arrow)({
                start: start,
                argnames: argnames,
                rest: rest,
                body: body,
                value: value,
                end: prev(),
            });
            if (is_strict) node.each_argname(strict_verify_symbol);
            return node;
        }

        var function_ = function(ctor) {
            var was_async = S.in_async;
            var was_gen = S.in_generator;
            var name;
            if (/Defun$/.test(ctor.TYPE)) {
                name = as_symbol(AST_SymbolDefun);
                S.in_async = /^Async/.test(ctor.TYPE);
                S.in_generator = /Generator/.test(ctor.TYPE);
            } else {
                S.in_async = /^Async/.test(ctor.TYPE);
                S.in_generator = /Generator/.test(ctor.TYPE);
                name = as_symbol(AST_SymbolLambda, true);
            }
            if (name && ctor !== AST_Accessor && !(name instanceof AST_SymbolDeclaration))
                unexpected(prev());
            expect("(");
            var was_funarg = S.in_funarg;
            S.in_funarg = S.in_function;
            var argnames = expr_list(")", !options.strict, false, function() {
                return maybe_default(AST_SymbolFunarg);
            });
            S.in_funarg = was_funarg;
            var loop = S.in_loop;
            var labels = S.labels;
            ++S.in_function;
            S.in_directives = true;
            S.input.push_directives_stack();
            S.in_loop = 0;
            S.labels = [];
            var body = block_();
            var is_strict = S.input.has_directive("use strict");
            S.input.pop_directives_stack();
            --S.in_function;
            S.in_loop = loop;
            S.labels = labels;
            S.in_generator = was_gen;
            S.in_async = was_async;
            var node = new ctor({
                name: name,
                argnames: argnames,
                rest: argnames.rest || null,
                body: body,
            });
            if (is_strict) {
                if (name) strict_verify_symbol(name);
                node.each_argname(strict_verify_symbol);
            }
            return node;
        };

        function if_() {
            var cond = parenthesized(), body = statement(), alt = null;
            if (is("keyword", "else")) {
                next();
                alt = statement();
            }
            return new AST_If({
                condition   : cond,
                body        : body,
                alternative : alt,
            });
        }

        function is_alias() {
            return is("name") || is("string") || is_identifier_string(S.token.value);
        }

        function make_string(token) {
            return new AST_String({
                start: token,
                quote: token.quote,
                value: token.value,
                end: token,
            });
        }

        function as_path() {
            var path = S.token;
            expect_token("string");
            semicolon();
            return make_string(path);
        }

        function export_() {
            if (is("operator", "*")) {
                var key = S.token;
                var alias = key;
                next();
                if (is("name", "as")) {
                    next();
                    if (!is_alias()) expect_token("name");
                    alias = S.token;
                    next();
                }
                expect_token("name", "from");
                return new AST_ExportForeign({
                    aliases: [ make_string(alias) ],
                    keys: [ make_string(key) ],
                    path: as_path(),
                });
            }
            if (is("punc", "{")) {
                next();
                var aliases = [];
                var keys = [];
                while (is_alias()) {
                    var key = S.token;
                    next();
                    keys.push(key);
                    if (is("name", "as")) {
                        next();
                        if (!is_alias()) expect_token("name");
                        aliases.push(S.token);
                        next();
                    } else {
                        aliases.push(key);
                    }
                    if (!is("punc", "}")) expect(",");
                }
                expect("}");
                if (is("name", "from")) {
                    next();
                    return new AST_ExportForeign({
                        aliases: aliases.map(make_string),
                        keys: keys.map(make_string),
                        path: as_path(),
                    });
                }
                semicolon();
                return new AST_ExportReferences({
                    properties: keys.map(function(token, index) {
                        if (!is_token(token, "name")) token_error(token, "Name expected");
                        var sym = _make_symbol(AST_SymbolExport, token);
                        sym.alias = make_string(aliases[index]);
                        return sym;
                    }),
                });
            }
            if (is("keyword", "default")) {
                next();
                var start = S.token;
                var body = export_default_decl();
                if (body) {
                    body.start = start;
                    body.end = prev();
                } else {
                    handle_regexp();
                    body = expression();
                    semicolon();
                }
                return new AST_ExportDefault({ body: body });
            }
            return new AST_ExportDeclaration({ body: export_decl() });
        }

        function maybe_named(def, expr) {
            if (expr.name) {
                expr = new def(expr);
                expr.name = new (def === AST_DefClass ? AST_SymbolDefClass : AST_SymbolDefun)(expr.name);
            }
            return expr;
        }

        function export_default_decl() {
            if (is("name", "async")) {
                if (!is_token(peek(), "keyword", "function")) return;
                next();
                next();
                if (!is("operator", "*")) return maybe_named(AST_AsyncDefun, function_(AST_AsyncFunction));
                next();
                return maybe_named(AST_AsyncGeneratorDefun, function_(AST_AsyncGeneratorFunction));
            } else if (is("keyword")) switch (S.token.value) {
              case "class":
                next();
                return maybe_named(AST_DefClass, class_(AST_ClassExpression));
              case "function":
                next();
                if (!is("operator", "*")) return maybe_named(AST_Defun, function_(AST_Function));
                next();
                return maybe_named(AST_GeneratorDefun, function_(AST_GeneratorFunction));
            }
        }

        var export_decl = embed_tokens(function() {
            if (is("name")) switch (S.token.value) {
              case "async":
                next();
                expect_token("keyword", "function");
                if (!is("operator", "*")) return function_(AST_AsyncDefun);
                next();
                return function_(AST_AsyncGeneratorDefun);
              case "let":
                next();
                var node = let_();
                semicolon();
                return node;
            } else if (is("keyword")) switch (S.token.value) {
              case "class":
                next();
                return class_(AST_DefClass);
              case "const":
                next();
                var node = const_();
                semicolon();
                return node;
              case "function":
                next();
                if (!is("operator", "*")) return function_(AST_Defun);
                next();
                return function_(AST_GeneratorDefun);
              case "var":
                next();
                var node = var_();
                semicolon();
                return node;
            }
            unexpected();
        });

        function import_() {
            var all = null;
            var def = as_symbol(AST_SymbolImport, true);
            var props = null;
            var cont;
            if (def) {
                def.key = new AST_String({
                    start: def.start,
                    value: "",
                    end: def.end,
                });
                if (cont = is("punc", ",")) next();
            } else {
                cont = !is("string");
            }
            if (cont) {
                if (is("operator", "*")) {
                    var key = S.token;
                    next();
                    expect_token("name", "as");
                    all = as_symbol(AST_SymbolImport);
                    all.key = make_string(key);
                } else {
                    expect("{");
                    props = [];
                    while (is_alias()) {
                        var alias;
                        if (is_token(peek(), "name", "as")) {
                            var key = S.token;
                            next();
                            next();
                            alias = as_symbol(AST_SymbolImport);
                            alias.key = make_string(key);
                        } else {
                            alias = as_symbol(AST_SymbolImport);
                            alias.key = new AST_String({
                                start: alias.start,
                                value: alias.name,
                                end: alias.end,
                            });
                        }
                        props.push(alias);
                        if (!is("punc", "}")) expect(",");
                    }
                    expect("}");
                }
            }
            if (all || def || props) expect_token("name", "from");
            return new AST_Import({
                all: all,
                default: def,
                path: as_path(),
                properties: props,
            });
        }

        function block_() {
            expect("{");
            var a = [];
            while (!is("punc", "}")) {
                if (is("eof")) expect("}");
                a.push(statement());
            }
            next();
            return a;
        }

        function switch_body_() {
            expect("{");
            var a = [], branch, cur, default_branch, tmp;
            while (!is("punc", "}")) {
                if (is("eof")) expect("}");
                if (is("keyword", "case")) {
                    if (branch) branch.end = prev();
                    cur = [];
                    branch = new AST_Case({
                        start      : (tmp = S.token, next(), tmp),
                        expression : expression(),
                        body       : cur
                    });
                    a.push(branch);
                    expect(":");
                } else if (is("keyword", "default")) {
                    if (branch) branch.end = prev();
                    if (default_branch) croak("More than one default clause in switch statement");
                    cur = [];
                    branch = new AST_Default({
                        start : (tmp = S.token, next(), expect(":"), tmp),
                        body  : cur
                    });
                    a.push(branch);
                    default_branch = branch;
                } else {
                    if (!cur) unexpected();
                    cur.push(statement());
                }
            }
            if (branch) branch.end = prev();
            next();
            return a;
        }

        function try_() {
            var body = block_(), bcatch = null, bfinally = null;
            if (is("keyword", "catch")) {
                var start = S.token;
                next();
                var name = null;
                if (is("punc", "(")) {
                    next();
                    name = maybe_destructured(AST_SymbolCatch);
                    expect(")");
                }
                bcatch = new AST_Catch({
                    start   : start,
                    argname : name,
                    body    : block_(),
                    end     : prev()
                });
            }
            if (is("keyword", "finally")) {
                var start = S.token;
                next();
                bfinally = new AST_Finally({
                    start : start,
                    body  : block_(),
                    end   : prev()
                });
            }
            if (!bcatch && !bfinally)
                croak("Missing catch/finally blocks");
            return new AST_Try({
                body     : body,
                bcatch   : bcatch,
                bfinally : bfinally
            });
        }

        function vardefs(type, no_in) {
            var a = [];
            for (;;) {
                var start = S.token;
                var name = maybe_destructured(type);
                var value = null;
                if (is("operator", "=")) {
                    next();
                    value = maybe_assign(no_in);
                } else if (!no_in && (type === AST_SymbolConst || name instanceof AST_Destructured)) {
                    croak("Missing initializer in declaration");
                }
                a.push(new AST_VarDef({
                    start : start,
                    name  : name,
                    value : value,
                    end   : prev()
                }));
                if (!is("punc", ","))
                    break;
                next();
            }
            return a;
        }

        function is_vardefs() {
            var token = peek();
            return is_token(token, "name") || is_token(token, "punc", "[") || is_token(token, "punc", "{");
        }

        var const_ = function(no_in) {
            return new AST_Const({
                start       : prev(),
                definitions : vardefs(AST_SymbolConst, no_in),
                end         : prev()
            });
        };

        var let_ = function(no_in) {
            return new AST_Let({
                start       : prev(),
                definitions : vardefs(AST_SymbolLet, no_in),
                end         : prev()
            });
        };

        var var_ = function(no_in) {
            return new AST_Var({
                start       : prev(),
                definitions : vardefs(AST_SymbolVar, no_in),
                end         : prev()
            });
        };

        var new_ = function(allow_calls) {
            var start = S.token;
            expect_token("operator", "new");
            var call;
            if (is("punc", ".") && is_token(peek(), "name", "target")) {
                next();
                next();
                call = new AST_NewTarget();
            } else {
                var exp = expr_atom(false), args;
                if (is("punc", "(")) {
                    next();
                    args = expr_list(")", !options.strict);
                } else {
                    args = [];
                }
                call = new AST_New({ expression: exp, args: args });
            }
            call.start = start;
            call.end = prev();
            return subscripts(call, allow_calls);
        };

        function as_atom_node() {
            var ret, tok = S.token, value = tok.value;
            switch (tok.type) {
              case "num":
                if (isFinite(value)) {
                    ret = new AST_Number({ value: value });
                } else {
                    ret = new AST_Infinity();
                    if (value < 0) ret = new AST_UnaryPrefix({ operator: "-", expression: ret });
                }
                break;
              case "bigint":
                ret = new AST_BigInt({ value: value });
                break;
              case "string":
                ret = new AST_String({ value: value, quote: tok.quote });
                break;
              case "regexp":
                ret = new AST_RegExp({ value: value });
                break;
              case "atom":
                switch (value) {
                  case "false":
                    ret = new AST_False();
                    break;
                  case "true":
                    ret = new AST_True();
                    break;
                  case "null":
                    ret = new AST_Null();
                    break;
                  default:
                    unexpected();
                }
                break;
              default:
                unexpected();
            }
            next();
            ret.start = ret.end = tok;
            return ret;
        }

        var expr_atom = function(allow_calls) {
            if (is("operator", "new")) {
                return new_(allow_calls);
            }
            var start = S.token;
            if (is("punc")) {
                switch (start.value) {
                  case "`":
                    return subscripts(template(null), allow_calls);
                  case "(":
                    next();
                    if (is("punc", ")")) {
                        next();
                        return arrow([], start);
                    }
                    var ex = expression(false, true);
                    var len = start.comments_before.length;
                    [].unshift.apply(ex.start.comments_before, start.comments_before);
                    start.comments_before.length = 0;
                    start.comments_before = ex.start.comments_before;
                    start.comments_before_length = len;
                    if (len == 0 && start.comments_before.length > 0) {
                        var comment = start.comments_before[0];
                        if (!comment.nlb) {
                            comment.nlb = start.nlb;
                            start.nlb = false;
                        }
                    }
                    start.comments_after = ex.start.comments_after;
                    ex.start = start;
                    expect(")");
                    var end = prev();
                    end.comments_before = ex.end.comments_before;
                    end.comments_after.forEach(function(comment) {
                        ex.end.comments_after.push(comment);
                        if (comment.nlb) S.token.nlb = true;
                    });
                    end.comments_after.length = 0;
                    end.comments_after = ex.end.comments_after;
                    ex.end = end;
                    if (is("punc", "=>")) return arrow(ex instanceof AST_Sequence ? ex.expressions : [ ex ], start);
                    return subscripts(ex, allow_calls);
                  case "[":
                    return subscripts(array_(), allow_calls);
                  case "{":
                    return subscripts(object_(), allow_calls);
                }
                unexpected();
            }
            if (is("keyword")) switch (start.value) {
              case "class":
                next();
                var clazz = class_(AST_ClassExpression);
                clazz.start = start;
                clazz.end = prev();
                return subscripts(clazz, allow_calls);
              case "function":
                next();
                var func;
                if (is("operator", "*")) {
                    next();
                    func = function_(AST_GeneratorFunction);
                } else {
                    func = function_(AST_Function);
                }
                func.start = start;
                func.end = prev();
                return subscripts(func, allow_calls);
            }
            if (is("name")) {
                var sym = _make_symbol(AST_SymbolRef, start);
                next();
                if (sym.name == "async") {
                    if (is("keyword", "function")) {
                        next();
                        var func;
                        if (is("operator", "*")) {
                            next();
                            func = function_(AST_AsyncGeneratorFunction);
                        } else {
                            func = function_(AST_AsyncFunction);
                        }
                        func.start = start;
                        func.end = prev();
                        return subscripts(func, allow_calls);
                    }
                    if (is("name") && is_token(peek(), "punc", "=>")) {
                        start = S.token;
                        sym = _make_symbol(AST_SymbolRef, start);
                        next();
                        return arrow([ sym ], start, true);
                    }
                    if (is("punc", "(")) {
                        var call = subscripts(sym, allow_calls);
                        if (!is("punc", "=>")) return call;
                        var args = call.args;
                        if (args[args.length - 1] instanceof AST_Spread) {
                            args.rest = args.pop().expression;
                        }
                        return arrow(args, start, true);
                    }
                }
                return is("punc", "=>") ? arrow([ sym ], start) : subscripts(sym, allow_calls);
            }
            if (ATOMIC_START_TOKEN[S.token.type]) {
                return subscripts(as_atom_node(), allow_calls);
            }
            unexpected();
        };

        function expr_list(closing, allow_trailing_comma, allow_empty, parser) {
            if (!parser) parser = maybe_assign;
            var first = true, a = [];
            while (!is("punc", closing)) {
                if (first) first = false; else expect(",");
                if (allow_trailing_comma && is("punc", closing)) break;
                if (allow_empty && is("punc", ",")) {
                    a.push(new AST_Hole({ start: S.token, end: S.token }));
                } else if (!is("operator", "...")) {
                    a.push(parser());
                } else if (parser === maybe_assign) {
                    a.push(new AST_Spread({
                        start: S.token,
                        expression: (next(), parser()),
                        end: prev(),
                    }));
                } else {
                    next();
                    a.rest = parser();
                    if (a.rest instanceof AST_DefaultValue) token_error(a.rest.start, "Invalid rest parameter");
                    break;
                }
            }
            expect(closing);
            return a;
        }

        var array_ = embed_tokens(function() {
            expect("[");
            return new AST_Array({
                elements: expr_list("]", !options.strict, true)
            });
        });

        var create_accessor = embed_tokens(function() {
            return function_(AST_Accessor);
        });

        var object_ = embed_tokens(function() {
            expect("{");
            var first = true, a = [];
            while (!is("punc", "}")) {
                if (first) first = false; else expect(",");
                // allow trailing comma
                if (!options.strict && is("punc", "}")) break;
                var start = S.token;
                if (is("operator", "*")) {
                    next();
                    var key = as_property_key();
                    var gen_start = S.token;
                    var gen = function_(AST_GeneratorFunction);
                    gen.start = gen_start;
                    gen.end = prev();
                    a.push(new AST_ObjectMethod({
                        start: start,
                        key: key,
                        value: gen,
                        end: prev(),
                    }));
                    continue;
                }
                if (is("operator", "...")) {
                    next();
                    a.push(new AST_Spread({
                        start: start,
                        expression: maybe_assign(),
                        end: prev(),
                    }));
                    continue;
                }
                if (is_token(peek(), "operator", "=")) {
                    var name = as_symbol(AST_SymbolRef);
                    next();
                    a.push(new AST_ObjectKeyVal({
                        start: start,
                        key: start.value,
                        value: new AST_Assign({
                            start: start,
                            left: name,
                            operator: "=",
                            right: maybe_assign(),
                            end: prev(),
                        }),
                        end: prev(),
                    }));
                    continue;
                }
                if (is_token(peek(), "punc", ",") || is_token(peek(), "punc", "}")) {
                    a.push(new AST_ObjectKeyVal({
                        start: start,
                        key: start.value,
                        value: as_symbol(AST_SymbolRef),
                        end: prev(),
                    }));
                    continue;
                }
                var key = as_property_key();
                if (is("punc", "(")) {
                    var func_start = S.token;
                    var func = function_(AST_Function);
                    func.start = func_start;
                    func.end = prev();
                    a.push(new AST_ObjectMethod({
                        start: start,
                        key: key,
                        value: func,
                        end: prev(),
                    }));
                    continue;
                }
                if (is("punc", ":")) {
                    next();
                    a.push(new AST_ObjectKeyVal({
                        start: start,
                        key: key,
                        value: maybe_assign(),
                        end: prev(),
                    }));
                    continue;
                }
                if (start.type == "name") switch (key) {
                  case "async":
                    var is_gen = is("operator", "*") && next();
                    key = as_property_key();
                    var func_start = S.token;
                    var func = function_(is_gen ? AST_AsyncGeneratorFunction : AST_AsyncFunction);
                    func.start = func_start;
                    func.end = prev();
                    a.push(new AST_ObjectMethod({
                        start: start,
                        key: key,
                        value: func,
                        end: prev(),
                    }));
                    continue;
                  case "get":
                    a.push(new AST_ObjectGetter({
                        start: start,
                        key: as_property_key(),
                        value: create_accessor(),
                        end: prev(),
                    }));
                    continue;
                  case "set":
                    a.push(new AST_ObjectSetter({
                        start: start,
                        key: as_property_key(),
                        value: create_accessor(),
                        end: prev(),
                    }));
                    continue;
                }
                unexpected();
            }
            next();
            return new AST_Object({ properties: a });
        });

        function as_property_key() {
            var tmp = S.token;
            switch (tmp.type) {
              case "operator":
                if (!KEYWORDS[tmp.value]) unexpected();
              case "num":
              case "string":
              case "name":
              case "keyword":
              case "atom":
                next();
                return "" + tmp.value;
              case "punc":
                expect("[");
                var key = maybe_assign();
                expect("]");
                return key;
              default:
                unexpected();
            }
        }

        function as_name() {
            var name = S.token.value;
            expect_token("name");
            return name;
        }

        function _make_symbol(type, token) {
            var name = token.value;
            switch (name) {
              case "await":
                if (S.in_async) unexpected(token);
                break;
              case "super":
                type = AST_Super;
                break;
              case "this":
                type = AST_This;
                break;
              case "yield":
                if (S.in_generator) unexpected(token);
                break;
            }
            return new type({
                name: "" + name,
                start: token,
                end: token,
            });
        }

        function strict_verify_symbol(sym) {
            if (sym.name == "arguments" || sym.name == "eval" || sym.name == "let")
                token_error(sym.start, "Unexpected " + sym.name + " in strict mode");
        }

        function as_symbol(type, no_error) {
            if (!is("name")) {
                if (!no_error) croak("Name expected");
                return null;
            }
            var sym = _make_symbol(type, S.token);
            if (S.input.has_directive("use strict") && sym instanceof AST_SymbolDeclaration) {
                strict_verify_symbol(sym);
            }
            next();
            return sym;
        }

        function maybe_destructured(type) {
            var start = S.token;
            if (is("punc", "[")) {
                next();
                var elements = expr_list("]", !options.strict, true, function() {
                    return maybe_default(type);
                });
                return new AST_DestructuredArray({
                    start: start,
                    elements: elements,
                    rest: elements.rest || null,
                    end: prev(),
                });
            }
            if (is("punc", "{")) {
                next();
                var first = true, a = [], rest = null;
                while (!is("punc", "}")) {
                    if (first) first = false; else expect(",");
                    // allow trailing comma
                    if (!options.strict && is("punc", "}")) break;
                    var key_start = S.token;
                    if (is("punc", "[") || is_token(peek(), "punc", ":")) {
                        var key = as_property_key();
                        expect(":");
                        a.push(new AST_DestructuredKeyVal({
                            start: key_start,
                            key: key,
                            value: maybe_default(type),
                            end: prev(),
                        }));
                        continue;
                    }
                    if (is("operator", "...")) {
                        next();
                        rest = maybe_destructured(type);
                        break;
                    }
                    var name = as_symbol(type);
                    if (is("operator", "=")) {
                        next();
                        name = new AST_DefaultValue({
                            start: name.start,
                            name: name,
                            value: maybe_assign(),
                            end: prev(),
                        });
                    }
                    a.push(new AST_DestructuredKeyVal({
                        start: key_start,
                        key: key_start.value,
                        value: name,
                        end: prev(),
                    }));
                }
                expect("}");
                return new AST_DestructuredObject({
                    start: start,
                    properties: a,
                    rest: rest,
                    end: prev(),
                });
            }
            return as_symbol(type);
        }

        function maybe_default(type) {
            var start = S.token;
            var name = maybe_destructured(type);
            if (!is("operator", "=")) return name;
            next();
            return new AST_DefaultValue({
                start: start,
                name: name,
                value: maybe_assign(),
                end: prev(),
            });
        }

        function template(tag) {
            var start = tag ? tag.start : S.token;
            var read = S.input.context().read_template;
            var strings = [];
            var expressions = [];
            while (read(strings)) {
                next();
                expressions.push(expression());
                if (!is("punc", "}")) unexpected();
            }
            next();
            return new AST_Template({
                start: start,
                expressions: expressions,
                strings: strings,
                tag: tag,
                end: prev(),
            });
        }

        function subscripts(expr, allow_calls) {
            var start = expr.start;
            var optional = null;
            while (true) {
                if (is("operator", "?") && is_token(peek(), "punc", ".")) {
                    next();
                    next();
                    optional = expr;
                }
                if (is("punc", "[")) {
                    next();
                    var prop = expression();
                    expect("]");
                    expr = new AST_Sub({
                        start: start,
                        optional: optional === expr,
                        expression: expr,
                        property: prop,
                        end: prev(),
                    });
                } else if (allow_calls && is("punc", "(")) {
                    next();
                    expr = new AST_Call({
                        start: start,
                        optional: optional === expr,
                        expression: expr,
                        args: expr_list(")", !options.strict),
                        end: prev(),
                    });
                } else if (optional === expr || is("punc", ".")) {
                    if (optional !== expr) next();
                    expr = new AST_Dot({
                        start: start,
                        optional: optional === expr,
                        expression: expr,
                        property: as_name(),
                        end: prev(),
                    });
                } else if (is("punc", "`")) {
                    if (optional) croak("Invalid template on optional chain");
                    expr = template(expr);
                } else {
                    break;
                }
            }
            if (optional) expr.terminal = true;
            if (expr instanceof AST_Call && !expr.pure) {
                var start = expr.start;
                var comments = start.comments_before;
                var i = HOP(start, "comments_before_length") ? start.comments_before_length : comments.length;
                while (--i >= 0) {
                    if (/[@#]__PURE__/.test(comments[i].value)) {
                        expr.pure = true;
                        break;
                    }
                }
            }
            return expr;
        }

        function maybe_unary(no_in) {
            var start = S.token;
            if (S.in_async && is("name", "await")) {
                if (S.in_funarg === S.in_function) croak("Invalid use of await in function argument");
                S.input.context().regex_allowed = true;
                next();
                return new AST_Await({
                    start: start,
                    expression: maybe_unary(no_in),
                    end: prev(),
                });
            }
            if (S.in_generator && is("name", "yield")) {
                if (S.in_funarg === S.in_function) croak("Invalid use of yield in function argument");
                S.input.context().regex_allowed = true;
                next();
                var exp = null;
                var nested = false;
                if (is("operator", "*")) {
                    next();
                    exp = maybe_assign(no_in);
                    nested = true;
                } else if (is("punc") ? !PUNC_AFTER_EXPRESSION[S.token.value] : !can_insert_semicolon()) {
                    exp = maybe_assign(no_in);
                }
                return new AST_Yield({
                    start: start,
                    expression: exp,
                    nested: nested,
                    end: prev(),
                });
            }
            if (is("operator") && UNARY_PREFIX[start.value]) {
                next();
                handle_regexp();
                var ex = make_unary(AST_UnaryPrefix, start, maybe_unary(no_in));
                ex.start = start;
                ex.end = prev();
                return ex;
            }
            var val = expr_atom(true);
            while (is("operator") && UNARY_POSTFIX[S.token.value] && !has_newline_before(S.token)) {
                val = make_unary(AST_UnaryPostfix, S.token, val);
                val.start = start;
                val.end = S.token;
                next();
            }
            return val;
        }

        function make_unary(ctor, token, expr) {
            var op = token.value;
            switch (op) {
              case "++":
              case "--":
                if (!is_assignable(expr))
                    token_error(token, "Invalid use of " + op + " operator");
                break;
              case "delete":
                if (expr instanceof AST_SymbolRef && S.input.has_directive("use strict"))
                    token_error(expr.start, "Calling delete on expression not allowed in strict mode");
                break;
            }
            return new ctor({ operator: op, expression: expr });
        }

        var expr_op = function(left, min_precision, no_in) {
            var op = is("operator") ? S.token.value : null;
            if (op == "in" && no_in) op = null;
            var precision = op != null ? PRECEDENCE[op] : null;
            if (precision != null && precision > min_precision) {
                next();
                var right = expr_op(maybe_unary(no_in), op == "**" ? precision - 1 : precision, no_in);
                return expr_op(new AST_Binary({
                    start    : left.start,
                    left     : left,
                    operator : op,
                    right    : right,
                    end      : right.end,
                }), min_precision, no_in);
            }
            return left;
        };

        function expr_ops(no_in) {
            return expr_op(maybe_unary(no_in), 0, no_in);
        }

        var maybe_conditional = function(no_in) {
            var start = S.token;
            var expr = expr_ops(no_in);
            if (is("operator", "?")) {
                next();
                var yes = maybe_assign();
                expect(":");
                return new AST_Conditional({
                    start       : start,
                    condition   : expr,
                    consequent  : yes,
                    alternative : maybe_assign(no_in),
                    end         : prev()
                });
            }
            return expr;
        };

        function is_assignable(expr) {
            return expr instanceof AST_PropAccess && !expr.optional || expr instanceof AST_SymbolRef;
        }

        function to_destructured(node) {
            if (node instanceof AST_Array) {
                var rest = null;
                if (node.elements[node.elements.length - 1] instanceof AST_Spread) {
                    rest = to_destructured(node.elements.pop().expression);
                    if (!(rest instanceof AST_Destructured || is_assignable(rest))) return node;
                }
                var elements = node.elements.map(to_destructured);
                return all(elements, function(node) {
                    return node instanceof AST_DefaultValue
                        || node instanceof AST_Destructured
                        || node instanceof AST_Hole
                        || is_assignable(node);
                }) ? new AST_DestructuredArray({
                    start: node.start,
                    elements: elements,
                    rest: rest,
                    end: node.end,
                }) : node;
            }
            if (node instanceof AST_Assign) {
                var name = to_destructured(node.left);
                return name instanceof AST_Destructured || is_assignable(name) ? new AST_DefaultValue({
                    start: node.start,
                    name: name,
                    value: node.right,
                    end: node.end,
                }) : node;
            }
            if (!(node instanceof AST_Object)) return node;
            var rest = null;
            if (node.properties[node.properties.length - 1] instanceof AST_Spread) {
                rest = to_destructured(node.properties.pop().expression);
                if (!(rest instanceof AST_Destructured || is_assignable(rest))) return node;
            }
            var props = [];
            for (var i = 0; i < node.properties.length; i++) {
                var prop = node.properties[i];
                if (!(prop instanceof AST_ObjectKeyVal)) return node;
                var value = to_destructured(prop.value);
                if (!(value instanceof AST_DefaultValue || value instanceof AST_Destructured || is_assignable(value))) {
                    return node;
                }
                props.push(new AST_DestructuredKeyVal({
                    start: prop.start,
                    key: prop.key,
                    value: value,
                    end: prop.end,
                }));
            }
            return new AST_DestructuredObject({
                start: node.start,
                properties: props,
                rest: rest,
                end: node.end,
            });
        }

        function maybe_assign(no_in) {
            var start = S.token;
            var left = maybe_conditional(no_in), val = S.token.value;
            if (is("operator") && ASSIGNMENT[val]) {
                if (is_assignable(left) || val == "=" && (left = to_destructured(left)) instanceof AST_Destructured) {
                    next();
                    return new AST_Assign({
                        start    : start,
                        left     : left,
                        operator : val,
                        right    : maybe_assign(no_in),
                        end      : prev()
                    });
                }
                croak("Invalid assignment");
            }
            return left;
        }

        function expression(no_in, maybe_arrow) {
            var start = S.token;
            var exprs = [];
            while (true) {
                if (maybe_arrow && is("operator", "...")) {
                    next();
                    exprs.rest = maybe_destructured(AST_SymbolFunarg);
                    break;
                }
                exprs.push(maybe_assign(no_in));
                if (!is("punc", ",")) break;
                next();
                if (maybe_arrow && is("punc", ")") && is_token(peek(), "punc", "=>")) break;
            }
            return exprs.length == 1 && !exprs.rest ? exprs[0] : new AST_Sequence({
                start: start,
                expressions: exprs,
                end: prev(),
            });
        }

        function in_loop(cont) {
            ++S.in_loop;
            var ret = cont();
            --S.in_loop;
            return ret;
        }

        if (options.expression) {
            handle_regexp();
            var exp = expression();
            expect_token("eof");
            return exp;
        }

        return function() {
            var start = S.token;
            var body = [];
            if (options.module) {
                S.in_async = true;
                S.input.add_directive("use strict");
            }
            S.input.push_directives_stack();
            while (!is("eof"))
                body.push(statement(true));
            S.input.pop_directives_stack();
            var end = prev() || start;
            var toplevel = options.toplevel;
            if (toplevel) {
                toplevel.body = toplevel.body.concat(body);
                toplevel.end = end;
            } else {
                toplevel = new AST_Toplevel({ start: start, body: body, end: end });
            }
            return toplevel;
        }();
    }
  return {
    parse,
    TreeWalker,
    AST_Defun,
    AST_Call,
    AST_Lambda,
  };
})();




export default uglifyJS;
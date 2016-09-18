/**
 * @license
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

// Modified from https://github.com/foam-framework/foam/blob/master/core/parse.js.

var stdlib = require('ya-stdlib-js');

var DEBUG_IN_PARSE = 1;
var DEBUG_OUT_PARSE = 1;
var DEBUG_IN_BREAK = 1;
var DEBUG_OUT_BREAK = 1;
var DEBUG_PARSE = 0;
var parserVersion_ = 1;

var parse = { factories_: {} };

//
// The ParserStream interface
//

function ParserStream() {}
ParserStream.prototype = {
  // This stream's notion of "no character". E.g., empty string for
  // StringParserStream.
  nullChar: null,
  // Character position in stream.
  pos: 0,

  init: function init() {
    this.pos = 0;
  },

  // Get a character from the stream.
  getChar: function getChar(pos) { return this.nullChar; },
  // Shallow copy of a stream. Used internally for advancing stream.
  clone: function clone(opt_o) {
    var ret = opt_o || Object.create(this.__proto__);
    var keys = Object.getOwnPropertyNames(this);
    for ( var i = 0; i < keys.length; i++ ) {
      ret[keys[i]] = this[keys[i]];
    }
    return ret;
  },
  // Set the parser output for this specific stream object.
  setValue: function setValue(v) {
    var ret = this.clone();
    ret.value_ = v;
    return ret;
  },
  // Is this stream just used for speculative parsing decisions?
  // E.g., alt(...) "tries" alternatives before advancing one of them "for
  // real" after the tries.
  isSpeculative: function() { return true; },
  toString: function() {
    return 'ParserStream' + JSON.stringify({
      pos: stdlib.toString(this.pos),
      head: stdlib.toString(this.head),
      value: stdlib.toString(this.value)
    }, null, 2);
  },
};
Object.defineProperties(ParserStream.prototype, {
  // Parser output value.
  value: {
    get: function() {
      return this.hasOwnProperty('value_') ? this.value_ :
        this.getChar(this.pos - 1);
    },
  },
  // Next character to be parsed.
  head: {
    get: function() {
      return this.getChar(this.pos);
    },
  },
  // Result of advancing the stream by 1 character.
  tail: {
    get: function() {
      var ret = this.clone();
      ret.pos++;
      return ret;
    },
  },
});

//
// A parser stream for strings
//
function StringParserStream(str) { this.init(str); }
StringParserStream.prototype = Object.create(ParserStream.prototype, {
  nullChar: { value: '' },
  init: {
    value: function init(str) {
      StringParserStream.prototype.__proto__.init.call(this);
      // str_ and tail_ are pointers to a value. Use an array for this.
      this.str_ = [str];
      this.tail_ = [];
    },
  },
  getChar: {
    value: function getchar(pos) {
      return this.pos >= 0 && this.pos < this.str_[0].length ?
        this.str_[0].charAt(pos) : this.nullChar;
    },
  },
  // Pointer to complete string parsed by on this stream.
  str: { set: function(str) { this.str_[0] = str; } },
  // A stream that follows parsing head.
  tail: {
    get: function() {
      if ( ! this.tail_[0] ) {
        var tail = this.clone();
        tail.pos = this.pos + 1;
        tail.tail_ = [];
        this.tail_[0] = tail;
      }
      return this.tail_[0];
    },
  },
  // Set parsed portion of stream.
  setValue: {
    value: function(value) {
      var ret = Object.create(this.__proto__);

      ret.str_ = this.str_;
      ret.pos = this.pos;
      ret.tail_ = this.tail_;
      ret.value_ = value;

      return ret;
    },
  },
  // StringParserStreams are used to actually advance a concrete parse.
  isSpeculative: { value: function() { return false; } },
  toString: {
    value: function() {
      return 'StringParserStream' + JSON.stringify({
        pos:  stdlib.toString(this.pos),
        next: stdlib.toString(this.str_[0].substr(this.pos, 9)),
        value: stdlib.toString(this.value),
      }, null, 2);
    },
  },
});

//
// A parser stream for speculative parsing
//
// TODO: Should implement this with a different pattern. It need not operate
// over strings.
function SpeculativeParserStream(ps) { this.init(ps); };
SpeculativeParserStream.prototype = Object.create(
  StringParserStream.prototype, {
    init: { value: function init(ps) { ps.clone(this); } },
    isSpeculative: { value: function isSpeculative() { return true; } },
    toString: {
      value: function toString() {
        return 'SpeculativeParserStream' + JSON.stringify({
          pos: stdlib.toString(this.pos),
          head: stdlib.toString(this.head),
          value: stdlib.toString(this.value),
        }, null, 2);
      },
    },
  }
);
SpeculativeParserStream.maybeWrap = function(ps, opt_ctor) {
  var Ctor = opt_ctor || SpeculativeParserStream;
  if ( ! ps.isSpeculative() ) return new Ctor(ps);
  else                        return ps;
};

//
// A parser stream for trapping after processing one character
//
function TrapParserStream(ps) { this.init(ps); }
TrapParserStream.prototype = Object.create(
  SpeculativeParserStream.prototype, {
    goodChar: { value: false, writable: true },
    head: { value: null, writable: true },
    value: { value: null, writable: true },

    init: {
      value: function init(ps) {
        TrapParserStream.prototype.__proto__.init.call(this, ps);
        // Store head as static value.
        this.head = this.getChar(this.pos);
      },
    },
    // Do not clone on setValue.
    setValue: {
      value: function setValue(v) {
        this.value_ = this.value = v;
        return this;
      },
    },
    tail: {
      get: function() {
        // Store info: Successfully parsed one character.
        this.goodChar = true;
        this.pos++;
        // Prevent further parsing by setting head to "no character".
        this.head = this.nullChar;
        // Invoke getter in prototype chain.
        var v = this.value;
        // Store value on current object.
        this.value = v;
        return this;
      },
    },
    toString: {
      value: function toString() {
        return 'TrapParserStream' + JSON.stringify({
          pos: stdlib.toString(this.pos),
          goodChar: stdlib.toString(this.goodChar),
        }, null, 2);
      },
    },
  }
);

//
// Helper functions
//

function clone(o) {
  var rtn = {};
  var keys = Object.getOwnPropertyNames(o);
  for ( var i = 0; i < keys.length; i++ ) {
    rtn[keys[i]] = o[keys[i]];
  }
  return rtn;
}
function toJSON(o) {
  var type = typeof o;
  if ( type === 'undefined' ) return undefined;
  if ( o === null ) return null;
  if ( typeof o.toJSON === 'function' )
    return o.toJSON.apply(o, stdlib.argsToArray(arguments).slice(1));
  // TODO: Do all relevant platforms support Array.isArray?
  else if ( Array.isArray(o) )
    return o.map(toJSON);
  else if ( type === 'function' )
    return funcToJSON(o);
  else
    return o;
}
function fromJSON(o) {
  if ( type === 'undefined' ) return undefined;
  if ( o === null ) return null;
  if ( typeof o.ctor === 'string' ) {
    var ctor;
    eval('ctor = ' + o.ctor);
    if ( typeof ctor.fromJSON === 'function' ) {
      delete o.ctor;
      var rtn = ctor.fromJSON(o);
      o.ctor = ctor;
      return rtn;
    }
  }
  return o;
}
function funcToJSON(f) {
  var json = {
    ctor: 'parse.function',
    __function__: Function.prototype.toString.call(f),
    label: f.label ? f.label : f.name
  };
  json.context = toJSON(f.context || null);
  json.closure = f.closure ? stdlib.mapMap(f.closure, toJSON) : {};
  json.args = f.args ? f.args.slice() : [];
  return json;
}
function funcFromJSON(_________) {
  var ret;
  eval((function() {
    var json = _________;
    var str = 'var __function__ = ' + json.__function__ +
          ';\n';
    var keys = Object.getOwnPropertyKeys(json.closure);
    for ( var i = 0; i < keys.length; i++ ) {
      var key = keys[i];
      var value = json.closure[key];
      str += 'var ' + key + ' = fromJSON(' + JSON.stringify(value) + ')';
    }
    if ( json.context === null ) {
      if ( json.args.length > 0 ) {
        str += 'var __args__ = ' + json.args.map(function(arg) {
          return 'fromJSON(' + JSON.stringify(arg) + ')';
        });
      }
      str += 'ret = function ' + json.label + '() { ' +
        'return __function__.apply(this, __args__.concat(' +
        'stdlib.argsToArray(arguments))); }';
    } else {
      str += 'ret = __function__.bind(fromJSON(' +
        JSON.stringify(json.context) + ')' + json.args.map(function(arg) {
          return 'fromJSON(' + JSON.stringify(arg) + ')';
        }) + ');';
    }
    return str;
  })());
  return ret;
}
function f_toJSON() {
  return funcToJSON(this);
}
function f_toString() {
  return 'function ' + this.label + '(' + this.args.join(', ') +
    ') { ... }';
}
function p_toString() {
  var str = this.label;
  var keys = Object.getOwnPropertyNames(this.closure);
  if ( keys.length === 1 && keys[0] === 'arguments' ) {
    str += stdlib.toString(this.closure.arguments);
  } else {
    var sep = keys.length > 3 ? '\n' : ' ';
    str += '{' + sep;
    for ( var i = 0; i < keys.length; i++ ) {
      str += keys[i] + ': ' + stdlib.toString(this.closure[keys[i]]) +','
        + sep;
    }
    str += '}';
  }
  return str;
}
function decorateFunction(f, opts) {
  opts = opts || {};
  f.label = opts.label || f.name;
  console.assert(f.label, 'Decorated functions must be labeled');
  f.context = opts.context || null;
  f.closure = opts.closure || {};
  f.args = opts.args || [];
  f.toJSON = opts.toJSON || f_toJSON;
  f.toString = opts.toString || f_toString;
  return f;
}

parse.function = {
  fromJSON: funcFromJSON,
  toJSON: funcToJSON,
};

//
// Parser controllers: Parsers call into their controller to invoke other
// parsers. This inversion of control allows for additional bookkeeping
// independent of parser implementations.
//

function ParserController(opts) { this.init(opts); }
ParserController.prototype.init = function(opts) {
  opts = opts || {};
  this.factories = opts.factories || clone(parse.factories_);
  this.bindFactories_();

  this.grammar = opts.grammar || { START: parse.grammar.fail };
  this.grammar.fail = this.grammar.fail || parse.grammar.fail;
  this.actions = {};
  this.greatestPos = -1;

  if ( ! opts.actions ) return;

  this.addActions(opts.actions);
};
ParserController.prototype.parse = function(parser, pstream) {
  if ( DEBUG_PARSE !== 0 && ! pstream.isSpeculative() ) {
    if ( DEBUG_PARSE % DEBUG_IN_PARSE === ( DEBUG_IN_PARSE - 1 ) ) {
      console.log(pstream.head, '@', pstream.pos);
      console.log('>>>>', parser.toString());
    }
    if ( DEBUG_PARSE % DEBUG_IN_BREAK === ( DEBUG_IN_BREAK - 1 ) )
      debugger;
    DEBUG_PARSE++;
  }

  var ret = parser.call(this, pstream);
  if ( ret !== null && ret.pos > this.greatestPos )
    this.greatestPos = ret.pos;

  if ( DEBUG_PARSE !== 0 && ! pstream.isSpeculative() ) {
    DEBUG_PARSE--;
    if ( DEBUG_PARSE % DEBUG_OUT_PARSE === ( DEBUG_OUT_PARSE - 1 ) ) {
      if ( ret )
        console.log(parser.toString(), '<<<<', ret.head, '@', ret.pos);
      else
        console.log(parser.toString(), '<<<<', ret);
    }
    if ( DEBUG_PARSE % DEBUG_OUT_BREAK === ( DEBUG_OUT_BREAK - 1 ) )
      debugger;
  }

  return ret;
};
ParserController.prototype.parseString = function(str, opt_start) {
  // TODO: This doesn't re-use a parser stream to save memory. Is such a
  // measure be necessary?
  this.greatestPos = -1;
  var res = this.parse(opt_start || this.grammar.START,
                       new StringParserStream(str));

  return [ res && res.pos === str.length, res && res.value, res ];
};
ParserController.prototype.bindFactories_ = function(sym, action) {
  var keys = Object.getOwnPropertyNames(this.factories);
  for ( var i = 0; i < keys.length; i++ ) {
    this.factories[keys[i]] = this.factories[keys[i]].bind(this);
  }
};
ParserController.prototype.wrapInAction_ = function(sym, action) {
  var f = this.grammar[sym];

  var p2 = decorateFunction(function(ps) {
    var p = f;
    var val = ps.value;
    var ps2 = this.parse(p, ps);

    return ps2 && ps2.setValue(action.call(this, ps2.value, val));
  }, { label: sym, closure: { f: f, action: action } });
  this.grammar[sym] = p2;
};
ParserController.prototype.addAction = function(sym, f) {
  var action = decorateFunction(f, { label: sym });
  this.wrapInAction_(sym, action);

  // Store action for re-wrapping against JSON routines.
  var as = this.actions[sym] = this.actions[sym] || [];
  as.push(action);
};
ParserController.prototype.addActions = function() {
  var actions = arguments;
  for ( var i = 0; i < actions.length; i++ ) {
    this.addAction(actions[i].name, actions[i]);
  }
};
ParserController.prototype.toJSON = function() {
  return {
    ctor: 'parse.ParserController',
    factories: stdlib.mapMap(this.factories, toJSON),
    grammar: stdlib.mapMap(this.grammar, toJSON),
    actions: stdlib.mapMap(this.actions, toJSON),
  };
  return rtn;
};
ParserController.fromJSON = function(json, opt_o) {
  var o = opt_o || Object.create(ParserController.prototype);
  o.init();

  // o.factories = json.factories ? stdlib.mapMap(json.factories, funcFromJSON) :
  //   clone(parse.factories_);
  // o.bindFactories_();

  // o.grammar = json.grammar ? stdlib.mapMap(json.grammar, funcFromJSON) :
  //   { START: parse.grammar.fail };
  // o.grammar.fail = o.grammar.fail || parse.grammar.fail;

  // o.actions = {};

  // if ( json.actions )
  //   o.addActions(stdlib.mapMap(json.actions, funcFromJSON));

  return o;
};
parse.prep = ParserController.prototype.prep = function(arg) {
  if ( typeof arg === 'string' ) return this.factories.literal(arg);
  return arg;
};
parse.prepArgs = ParserController.prototype.prepArgs = function(args) {
  for ( var i = 0 ; i < args.length ; i++ ) {
    args[i] = this.prep(args[i]);
  }
  return args;
};

// TODO: This controller strategy is broken.
// E.g., a parser that skips comments parses "A/* comment */B" as "AB".
function SkipParserController(opts) {
  opts = opts || {};
  this.skip_ = true;
  this.init(opts);
  this.skipParser = opts.skipParser || this.grammar.fail;
}
SkipParserController.prototype = Object.create(
  ParserController.prototype, {
    parse: {
      valuie:  function parse(parser, pstream) {
        if ( ! this.skip_ )
          return SkipParserController.prototype.__proto__.parse.call(
            this, parser, pstream);

        this.skip_ = false;
        var skippstream = pstream;
        while ( skippstream !== null ) {
          skippstream = this.skipParser.call(this, skippstream);
          console.assert(skippstream === null || skippstream.pos > pstream.pos,
                         'Skip parser neither failed nor advanced');
          pstream = skippstream || pstream;
        }
        this.skip_ = true;

        return SkipParserController.prototype.__proto__.parse.call(
          this, parser, pstream);
      },
    },
  }
);
// TODO: Add delegating to/from JSON.

function TokenParserController(opts) { this.init(opts); }
TokenParserController.prototype = Object.create(
  ParserController.prototype, {
    init: {
      value: function init(opts) {
        opts = opts || {};
        if ( opts.separator ) {
          this.separator = parse.factories.nodebug(opts.separator);
        } else {
          var fs = parse.factories;
          var ps = parse.grammar;
          this.separator = fs.nodebug(
            fs.repeat0(fs.alt(ps.whitespace_, ps.cStyleComment_))
          );
        }

        var factories = opts.factories =
              opts.factories || clone(parse.factories_);

        defineParserFactories.call(
          factories,
          function tseq(/* tokens */) {
            var tokenizedSeq = [];
            for ( var i = 0; i < arguments.length; i++ ) {
              tokenizedSeq.push(arguments[i], this.separator);
            }
            var seqParser = this.factories.seq.apply(this, tokenizedSeq);
            return function(ps) {
              var ret = this.parse(seqParser, ps);
              if ( ret === null || ret.value === null ) return ret;
              var v1 = ret.value, v2 = [];
              for ( var i = 0; i < v1.length; i++ ) {
                if ( ( i % 2 ) === 0 ) v2.push(v1[i]);
              }
              return ret.setValue(v2);
            };
          },
          function tseq1(n) {
            var tseqParser = this.factories.tseq.apply(
              this, stdlib.argsToArray(arguments).slice(1));
            return function(ps) {
              var ret = this.parse(tseqParser, ps);
              if ( ret === null || ret.value === null ) return ret;
              return ret.setValue(ret.value[n]);
            };
          },
          function trepeat(p, opt_delim, opt_min, opt_max) {
            opt_delim = opt_delim ?
              this.factories.seq(opt_delim, this.separator) : opt_delim;
            var repeatParser = this.factories.repeat(
              this.factories.tseq(p), opt_delim, opt_min,
              opt_max);
            return function(ps) {
              var ret = this.parse(repeatParser, ps);
              if ( ret === null || ret.value === null ) return ret;
              return ret.setValue(ret.value.map(function(onePartSeq) {
                return onePartSeq[0];
              }));
            };
          },
          function tplus(p, opt_delim) {
            opt_delim = opt_delim ?
              this.factories.tseq(opt_delim) : opt_delim;
            var plusParser = this.factories.plus(
              this.factories.tseq(p), opt_delim);
            return function(ps) {
              var ret = this.parse(plusParser, ps);
              if ( ret === null || ret.value === null ) return ret;
              return ret.setValue(ret.value.map(function(onePartSeq) {
                return onePartSeq[0];
              }));
            };
          }
        );

        TokenParserController.prototype.__proto__.init.call(this, opts);

        var key = 'START';
        while ( this.grammar.hasOwnProperty(key) ) key += '_';
        if ( key !== 'START' ) {
          this.grammar[key] = this.grammar.START;
          this.grammar.START = this.factories.seq(this.separator,
                                                  this.factories.sym(key));
        }
      },
    },
  }
);
// TODO: Add delegating to/from JSON.

//
// Parser factories
//
// These are functions (parser combinators) that return a function (a
// parser) of the following type:
//
// ParserStream => ParserStream|null.
//
// A parser returns null if and only if the parser failed against the input
// stream.
//

function defineParserFactories() {
  function decorateParserFactory(f) {
    var argNames = stdlib.getArgNames(f);
    var f2 = decorateFunction(function() {
      var args = stdlib.argsToArray(arguments);
      var closure = {}, i;
      for ( i = 0; i < argNames.length; i++ ) {
        closure[argNames[i]] = args[i];
      }
      if ( i < args.length ) closure.arguments = args.slice(i);
      return decorateFunction(
        f.apply(this, args),
        {
          label: f.name + 'Parser',
          closure: closure,
          toString: p_toString,
        }
      );
    }, { label: f.name, closure: { f: f } });
    return f2;
  }

  for ( var i = 0; i < arguments.length; i++ ) {
    var f = arguments[i];
    this[f.name] = decorateParserFactory(f);
  }

  return this;
}

var addParserFactories = defineParserFactories.bind(parse.factories_);

addParserFactories(
  // Unicode range from c1 to c2, inclusive.
  function range(c1, c2) {
    return function(ps) {
      if ( ps.head === ps.nullChar ) return null;
      if ( ps.head < c1 || ps.head > c2 ) return null;
      return ps.tail.setValue(ps.head);
    };
  },

  // Literal string value. Optionally report a different value than what is
  // actually parsed.
  (function literal__closure() {
    // Cache of literal parsers, which repeat a lot.
    var cache = {};

    return function literal(str, opt_value) {
      // No caching when invoked with custom value.
      if ( ! opt_value && cache[str] ) return cache[str];

      var f;
      if ( str.length === 1 ) {
        f = function(ps) {
          return str === ps.head ? ps.tail.setValue(opt_value || str) : null;
        };
      } else {
        f = function(ps) {
          for ( var i = 0 ; i < str.length ; i++, ps = ps.tail ) {
            if ( str.charAt(i) !== ps.head ) return null;
          }

          return ps.setValue(opt_value || str);
        };
      }

      // No caching when invoked with custom value.
      if ( ! opt_value ) return cache[str] = f;

      return f;
    };
  })(),

  // Same as above, but case-insensitive. NOTE: Doesn't work for Unicode
  // characters.
  function literal_ic(str, opt_value) {
    str = str.toLowerCase();
    return function(ps) {
      for ( var i = 0 ; i < str.length ; i++, ps = ps.tail ) {
        if ( ps.head === ps.nullChar ||
             str.charAt(i) !== ps.head.toLowerCase() ) return null;
      }

      return ps.setValue(opt_value || str);
    };
  },

  // Single character; any character but c.
  function notChar(c) {
    return function(ps) {
      return ps.head !== ps.nullChar && ps.head !== c ? ps.tail.setValue(ps.head) :
        null;
    };
  },

  // Single character; any character but those listed in s.
  function notChars(s) {
    return function(ps) {
      return ps.head !== ps.nullChar && s.indexOf(ps.head) === -1 ?
        ps.tail.setValue(ps.head) : null;
    };
  },

  // Negate parser p; optionally run opt_else after negation (this is useful
  // for ensuring that input advances when repeating against not(...)).
  function not(p, opt_else) {
    p = this.prep(p);
    opt_else = this.prep(opt_else);
    return function(ps) {
      return this.parse(p, ps) ? null :
        opt_else ? this.parse(opt_else, ps) : ps;
    };
  },

  // Interpret input parser, p, as optional.
  // TODO: In debug mode use a speculative parser, then re-run.
  function optional(p) {
    p = this.prep(p);
    return function(ps) { return this.parse(p, ps) || ps.setValue(null); };
  },

  function copyInput(p) {
    p = this.prep(p);
    return function(ps) {
      var res = this.parse(p, ps);

      return res !== null ?
        res.setValue(ps.str_.toString().substring(ps.pos, res.pos)) : res;
    };
  },

  // Parses if the p parses, but doesn't advance input as a result of
  // running p.
  function lookahead(p) {
    p = this.prep(p);
    return function(ps) { return this.parse(p, ps) && ps; };
  },

  // Repeat parser, p, zero or more times. Optionally use opt_delim to parse
  // delimiters between parses using p. Also optional: succeed if and only
  // if number of successful p parses is in the range [opt_min, opt_max].
  // TODO: In debug mode use a speculative parser, then re-run.
  function repeat(p, opt_delim, opt_min, opt_max) {
    p = this.prep(p);
    opt_delim = this.prep(opt_delim);

    return function(ps) {
      var ret = [];

      for ( var i = 0 ; ! opt_max || i < opt_max; i++ ) {
        var res;

        if ( opt_delim && ret.length !== 0 ) {
          if ( ! ( res = this.parse(opt_delim, ps) ) ) break;
          ps = res;
        }

        if ( ! ( res = this.parse(p, ps) ) ) break;

        ret.push(res.value);
        ps = res;
      }

      if ( opt_min && ret.length < opt_min ) return null;

      return ps.setValue(ret);
    };
  },

  // One or more parses of p, optionally separated by parser, opt_delim.
  function plus(p, opt_delim) {
    return this.factories.repeat(p, opt_delim, 1);
  },

  // Forbid activating the "skip parser" in parsing p
  function noskip(p) {
    return function(ps) {
      this.skip_ = false;
      ps = this.parse(p, ps);
      this.skip_ = true;
      return ps;
    };
  },

  // Like repeat, except doesn't store results
  function repeat0(p) {
    p = this.prep(p);

    return function(ps) {
      var res;
      while ( res = this.parse(p, ps) ) ps = res;
      return ps.setValue('');
    };
  },

  // Like plus, except doesn't store results
  function plus0(p) {
    p = this.prep(p);

    return function(ps) {
      var res;
      if ( ! (res = this.parse(p, ps)) ) return null;
      ps = res;
      while ( res = this.parse(p, ps) ) ps = res;
      return ps.setValue('');
    };
  },

  // Run a sequence of parsers
  function seq(/* vargs */) {
    var args = this.prepArgs(arguments);

    return function(ps) {
      var ret = [];

      for ( var i = 0 ; i < args.length ; i++ ) {
        if ( ! ( ps = this.parse(args[i], ps) ) ) return null;
        ret.push(ps.value);
      }

      return ps.setValue(ret);
    };
  },

  // Like seq, except returns result of n'th parser.
  function seq1(n /*, vargs */) {
    var args = this.prepArgs(stdlib.argsToArray(arguments).slice(1));

    return function(ps) {
      var res = this.factories.seq.apply(this, args).call(this, ps);
      return res !== null ? res.setValue(res.value[n]) : res;
    };
  },

  // Simplified implementation of alt
  function simpleAlt(/* vargs */) {
    var args = this.prepArgs(arguments);

    if ( args.length == 1 ) return args[0];

    return function(ps) {
      var altPS = SpeculativeParserStream.maybeWrap(ps);
      var res = null, pos = -1, p = null;
      for ( var i = 0 ; i < args.length ; i++ ) {
        res = this.parse(args[i], altPS);
        if ( res !== null && pos < res.pos ) {
          p = args[i];
          pos = res.pos;
        }
      }
      return p !== null ? this.parse(p, ps) : null;
    };
  },

  // Match one of the alternate parsers in arguments; more comprehensive
  // algorithm than simpleAlt
  function alt(/* vargs */) {
    /* var SIMPLE_ALT = parse.factories.simpleAlt.apply(null, arguments); */
    var args = this.prepArgs(arguments);
    var map  = {};
    var parserVersion = parserVersion_;

    var nullParser = this.grammar.fail;

    function testParser(p, ps) {
      // Use a specialized parser to capture whether p can consume one char,
      // but prevent p from parsing beyond one char.
      var trapPS = new TrapParserStream(ps);
      var ret = this.parse(p, trapPS);
      // This parser is a candidate iff:
      // (1) it parses successfully (even if it consumes no input), or
      // (2) it consumed a character.
      return ( !! ret ) || trapPS.goodChar;
    }

    function getParserForChar(ps) {
      if ( ps.head === ps.nullChar ) return nullParser;

      var c = ps.head;
      var p = map[c];

      if ( ! p ) {
        var alts = [];

        for ( var i = 0 ; i < args.length ; i++ ) {
          var parser = args[i];
          if ( testParser.call(this, parser, ps) ) alts.push(parser);
        }

        p = alts.length == 0 ? nullParser :
          alts.length == 1 ? alts[0] :
          this.factories.simpleAlt.apply(this, alts);

        map[c] = p;
      }

      return p;
    }

    return function(ps) {
      if ( parserVersion !== parserVersion_ ) {
        map = {};
        parserVersion = parserVersion_;
      }
      var p1 = getParserForChar.call(this, ps);
      var r1 = this.parse(
        p1,
        ps);
      // If alt and simpleAlt don't return same value then uncomment this
      // section to find out where the problem is occuring.
      /*
       var r2 = this.parse(SIMPLE_ALT, ps);
       if ( ! r1 !== ! r2 ) debugger;
       if ( r1 && ( r1.pos !== r2.pos ) ) debugger;
       */
      return r1;
    };
  },

  // Concatenate results of a parser tht returns a string-array.
  function str(p) {
    p = this.prep(p);
    return function(ps) {
      ps = this.parse(p, ps);
      return ps ? ps.setValue(ps.value !== null ? ps.value.join('') : '') :
      null;
    };
  },

  // Pick array indices out of parser result
  // E.g., pick([0, 2], seq(sym('label'), '=', sym('value')))
  function pick(as, p) {
    p = this.prep(p);
    return function(ps) {
      ps = this.parse(p, ps);
      if ( ! ps ) return null;
      var ret = [];
      for ( var i = 0 ; i < as.length ; i++ ) ret.push(ps.value[as[i]]);
      return ps.setValue(ret);
    };
  },

  // Like seq, except stores every other parser; useful with interleaving
  // token and separator parsers
  function seqEven(/* vargs */) {
    var args = this.prepArgs(arguments);

    var indices = [];
    for ( var i = 0; i < arguments.length; i += 2 ) indices.push(i);

    return this.factories.pick(
      indices, this.factories.seq.apply(this, arguments));
  },

  // Debug parser, p
  function debug(p) {
    return function(ps) {
      if ( ! ps.isSpeculative() )
        debugger;

      var old = DEBUG_PARSE;
      DEBUG_PARSE = 1;
      var ret = this.parse(p, ps);
      DEBUG_PARSE = old;

      if ( ! ps.isSpeculative() )
        debugger;

      return ret;
    };
  },

  // Disabled debugging on parser, p
  function nodebug(p) {
    return function(ps) {
      var old = DEBUG_PARSE;
      DEBUG_PARSE = 0;
      var ret = this.parse(p, ps);
      DEBUG_PARSE = old;
      return ret;
    };
  },

  // Log a parser's output
  function log(p) {
    return function(ps) {
      var ret = this.parse(p, ps);

      if ( ret && ! ps.isSpeculative() )
        console.log(p.label, ret.value);

      return ret;
    };
  },

  // Refer to interned parser name.
  // E.g., { os: plus('o'), boo: seq('b', sym('os')) }
  function sym(name) {
    return function(ps) {
      var p = this.grammar[name];

      if ( ! p )
        throw new Error('PARSE ERROR: Unknown Symbol <' + name + '>');

      return this.parse(p, ps);
    };
  },

  // Any single character
  function anyChar(ps) {
    // TODO: Why is this commented-out?
    return ps.head ? ps.tail/*.setValue(ps.head)*/ : null;
  }
);

parse.factories = stdlib.mapMap(
  parse.factories_,
  function(factory) { return factory.bind(parse); }
);

//
// Convenience parsers
//
(function($) {
  // Assign parse.grammar eagerly: other parsers depend on
  // lookup of parse.grammar.fail.
  var g = parse.grammar = {
    fail: decorateFunction(
      function fail(ps) { return null; },
      {
        label: 'failParser',
        toString: p_toString,
      }
    ),
  };
  g.alphaChar =  $.alt($.range('a','z'), $.range('A', 'Z'));
  g.alphaNumChar = $.alt($.alphaChar, $.range('0', '9'));
  g.wordChar = $.alt($.alphaNumChar, '_');
  g.whitespace_ = $.plus0($.alt(' ', '\t', '\n', '\r', '\f'));
  g.multilineComment_ = $.seq1(
    1,
    '/*',
    $.repeat0($.alt($.notChar('*'), $.seq('*', $.notChar('\/')))),
    '*\/');
  g.singleLineComment_ = $.seq(
    '//',
    $.repeat0($.notChars('\r\n')), $.alt('\r\n', '\n'));
  g.cStyleComment_ = $.plus0($.alt(g.singleLineComment_,
                                   g.multilineComment_));
})(parse.factories);

function invalidateParsers() {
  parserVersion_++;
}

// Code to expose parser factories and grammar API locally.
parse.getFactoryVarsCodeStr = function() {
  return 'var fs = parse.factories;\n' +
    Object.getOwnPropertyNames(parse.factories).map(function(key) {
      return 'var ' + key + ' = fs.' + key + ';';
    }).sort().join('\n') +
    'var g = parse.grammar;\n' +
    Object.getOwnPropertyNames(parse.grammar).map(function(key) {
      return 'var ' + key + ' = g.' + key + ';';
    }).sort().join('\n');
};
var fKeys = Object.getOwnPropertyNames(parse.factories);
var gKeys = Object.getOwnPropertyNames(parse.grammar);
for ( var i = 0; i < fKeys.length; i++ ) {
  console.assert(gKeys.indexOf(fKeys[i]) === -1,
                 'Identical parse library factory and grammar key: "' +
                 fKeys[i] + '"');
}

parse.ParserStream = ParserStream;
parse.StringParserStream = StringParserStream;
parse.SpeculativeParserStream = SpeculativeParserStream;
parse.TrapParserStream = TrapParserStream;
parse.ParserController = ParserController;
parse.SkipParserController = SkipParserController;
parse.TokenParserController = TokenParserController;
parse.invalidateParsers = invalidateParsers;

module.exports = parse;

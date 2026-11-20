"use strict";
// Language, translation and locale-aware formatting. Loaded first in the browser; required by the server for text it persists.
// Keys are the English source strings. English is the identity dictionary; pt-BR lives in i18n-pt.js.
(function (root) {
  var LANGS = ["en", "pt-BR"];
  var lang = "en";
  var dicts = { "pt-BR": root.I18N_PT || {} };
  if (!root.I18N_PT && typeof require === "function") {
    try {
      dicts["pt-BR"] = require("./i18n-pt.js");
    } catch (e) {}
  }
  var patternCache = {};

  function normalize(value) {
    return /^pt\b/i.test(String(value || "")) ? "pt-BR" : "en";
  }
  function fromBrowser() {
    try {
      return normalize((navigator.languages && navigator.languages[0]) || navigator.language);
    } catch (e) {
      return "en";
    }
  }
  function fill(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] === undefined || params[k] === null ? m : String(params[k]);
    });
  }
  function patterns(l) {
    if (patternCache[l]) return patternCache[l];
    var d = dicts[l] || {},
      list = [];
    Object.keys(d).forEach(function (k) {
      if (!/\{\w+\}/.test(k) || k.indexOf("|") >= 0) return;
      var names = [],
        src = k
          .split(/(\{\w+\})/)
          .map(function (part) {
            var m = /^\{(\w+)\}$/.exec(part);
            if (m) return names.push(m[1]), "([\\s\\S]+?)";
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("");
      list.push({ re: new RegExp("^" + src + "$"), names: names, value: d[k] });
    });
    return (patternCache[l] = list);
  }
  function lookup(l, key) {
    if (l === "en") return key;
    var d = dicts[l];
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    return undefined;
  }
  function translate(l, key, params) {
    var out = lookup(l, key);
    if (out === undefined) {
      if (l !== "en" && !params) {
        var list = patterns(l);
        for (var i = 0; i < list.length; i++) {
          var m = list[i].re.exec(key);
          if (m) {
            var p = {};
            list[i].names.forEach(function (n, j) {
              p[n] = m[j + 1];
            });
            return fill(list[i].value, p);
          }
        }
      }
      out = key;
    }
    return fill(out, params);
  }
  function plural(l, key, n, params) {
    var forms = String(lookup(l, key) === undefined ? key : lookup(l, key)).split("|");
    var cat = "other";
    try {
      cat = new Intl.PluralRules(l).select(n);
    } catch (e) {}
    var form = forms.length > 1 && cat === "one" ? forms[0] : forms[forms.length - 1];
    return fill(form, Object.assign({ n: n }, params));
  }

  var SYMBOL_CODES = { $: "USD", "US$": "USD", "R$": "BRL", "€": "EUR", "£": "GBP", "¥": "JPY" };
  function num(n, max) {
    return Number.isFinite(n) ? n.toLocaleString(lang, { maximumFractionDigits: max === undefined ? 2 : max }) : "";
  }
  function dateOf(v) {
    var d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  var fmt = {
    num: num,
    pct: function (ratio, max) {
      return Number.isFinite(ratio) ? (ratio * 100).toLocaleString(lang, { maximumFractionDigits: max === undefined ? 1 : max }) + "%" : "";
    },
    money: function (n, cur) {
      if (!Number.isFinite(n)) return "";
      var c = String(cur || "").trim() || (lang === "pt-BR" ? "R$" : "$"),
        code = SYMBOL_CODES[c] || (/^[A-Z]{3}$/.test(c) ? c : "");
      if (code) {
        try {
          return n.toLocaleString(lang, { style: "currency", currency: code, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
        } catch (e) {}
      }
      return c + (/[\p{L}\p{N}]$/u.test(c) || lang === "pt-BR" ? " " : "") + num(n, 2);
    },
    date: function (v) {
      var d = dateOf(v);
      return d ? d.toLocaleDateString(lang, { month: "short", day: "numeric" }) : "";
    },
    dateLong: function (v) {
      var d = dateOf(v);
      return d ? d.toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric" }) : "";
    },
    dateTime: function (v) {
      var d = dateOf(v);
      return d ? d.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) : "";
    },
    weekdayTime: function (v) {
      var d = dateOf(v);
      return d ? d.toLocaleString(lang, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
    },
    ago: function (v, now) {
      var d = dateOf(v);
      if (!d) return "";
      var m = Math.max(0, Math.round(((now === undefined ? Date.now() : now) - d.getTime()) / 60000));
      if (m < 1) return translate(lang, "just now");
      if (lang === "en") return m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
      var rtf =new Intl.RelativeTimeFormat(lang, { numeric: "always", style: "short" });
      if (m < 60) return rtf.format(-m, "minute");
      if (m < 1440) return rtf.format(-Math.round(m / 60), "hour");
      return rtf.format(-Math.round(m / 1440), "day");
    },
  };

  function setLang(value) {
    lang = LANGS.indexOf(value) >= 0 ? value : normalize(value);
    try {
      document.documentElement.lang = lang;
    } catch (e) {}
    return lang;
  }
  var STOP = {
    pt: /\b(que|não|nao|uma|para|com|mais|como|isso|esta|está|mas|por|dos|das|muito|ser|ter|você|voce|seu|sua|meu|minha|ideia|quero|preciso|fazer|vender|clientes?|um|os|as|em|de|da|do|na|no|é)\b/gi,
    en: /\b(the|and|that|this|with|for|have|not|you|are|was|but|from|they|what|will|idea|want|need|make|sell|customers?|an|of|to|in|is|it|my|our|your)\b/gi,
  };
  function detect(text) {
    var s = String(text || "").slice(0, 2000);
    if (!/[A-Za-zÀ-ÿ]{3}/.test(s)) return null;
    var p = (s.match(STOP.pt) || []).length + (/[ãõçáéíóúâêô]/i.test(s) ? 2 : 0),
      e = (s.match(STOP.en) || []).length;
    if (p >= 2 && p >= e * 1.5) return "pt-BR";
    if (e >= 2 && e >= p * 1.5) return "en";
    return null;
  }

  var KEY = "spark-lang";
  function cached() {
    try {
      var v = localStorage.getItem(KEY);
      return LANGS.indexOf(v) >= 0 ? v : "";
    } catch (e) {
      return "";
    }
  }
  function remember(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (e) {}
  }
  var ATTRS = ["aria-label", "title", "placeholder", "alt"];
  function applyDom(scope) {
    if (lang === "en" || typeof document === "undefined") return;
    var base = scope || document.body;
    if (!base) return;
    ATTRS.forEach(function (a) {
      var list = base.querySelectorAll("[" + a + "]");
      for (var i = 0; i < list.length; i++) list[i].setAttribute(a, translate(lang, list[i].getAttribute(a)));
    });
    var walker = document.createTreeWalker(base, 4),
      node,
      nodes = [];
    while ((node = walker.nextNode())) nodes.push(node);
    nodes.forEach(function (n) {
      var parent = n.parentNode && n.parentNode.nodeName;
      if (parent === "SCRIPT" || parent === "STYLE" || parent === "TEXTAREA") return;
      var raw = n.nodeValue,
        text = raw.trim().replace(/\s+/g, " ");
      if (!text) return;
      var out = translate(lang, text);
      if (out !== text) n.nodeValue = raw.replace(raw.trim(), out);
    });
  }

  root.I18N = {
    remember: remember,
    cached: cached,
    applyDom: applyDom,
    LANGS: LANGS,
    translate: translate,
    plural: plural,
    normalize: normalize,
    fromBrowser: fromBrowser,
    detect: detect,
    setLang: setLang,
    get lang() {
      return lang;
    },
    fmt: fmt,
    patternsFor: patterns,
    dict: function (l) {
      return dicts[l] || {};
    },
  };
  setLang(cached() || fromBrowser());
  root.tx = function (key, params) {
    return translate(lang, key, params);
  };
  root.tp = function (key, n, params) {
    return plural(lang, key, n, params);
  };
  root.fmt = fmt;
  if (typeof module !== "undefined" && module.exports) module.exports = root.I18N;
  else applyDom();
})(typeof self !== "undefined" ? self : globalThis);

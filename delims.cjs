"use strict";
function stripDelims(v) {
  let s = String(v ?? ""),
    prev;
  do {
    prev = s;
    s = s.replace(/<<<|>>>/g, "");
  } while (s !== prev);
  return s;
}
const clip = (v, max) => String(v ?? "").trim().slice(0, max);
module.exports = { stripDelims, clip };

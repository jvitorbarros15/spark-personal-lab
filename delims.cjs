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
module.exports = { stripDelims };

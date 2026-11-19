"use strict";
document.getElementById("phone-search").addEventListener("click", () => {
  const search = document.getElementById("search");
  search.scrollIntoView({block:"center"});
  search.focus();
});

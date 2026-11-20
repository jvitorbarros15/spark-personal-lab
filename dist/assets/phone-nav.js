"use strict";
document.getElementById("phone-search").addEventListener("click", () => {
  const search = document.getElementById("search");
  search.scrollIntoView({ block: "center" });
  search.focus();
});
{
  const more = document.getElementById("phone-more"),
    setMore = (open) => {
      document.body.classList.toggle("more-open", open);
      more.setAttribute("aria-expanded", String(open));
      if (open) document.querySelector("#nav a")?.focus();
    },
    isOpen = () => document.body.classList.contains("more-open"),
    mark = () => {
      const view = location.hash.slice(1).split("/")[0] || "home";
      for (const a of document.querySelectorAll(".phone-actions a")) a.toggleAttribute("aria-current", a.getAttribute("href") === "#" + view);
    };
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    setMore(!isOpen());
  });
  document.addEventListener("click", (event) => {
    if (isOpen() && (event.target.closest("#nav a") || !event.target.closest("#nav"))) setMore(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      setMore(false);
      more.focus();
    }
  });
  window.addEventListener("hashchange", mark);
  mark();
}

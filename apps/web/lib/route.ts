/**
 * The route a path names, however the page was reached.
 *
 * The site is a static export, so the same page answers to `/faq`, `/faq.html`
 * and `/faq/` depending on whether the host rewrites clean URLs. Anything
 * comparing `usePathname()` against a known route has to compare this instead —
 * a miss is silent, and shows up as a control that simply never appears.
 */
export const routeOf = (path: string): string => {
  const bare = path.replace(/\.html$/, "").replace(/\/+$/, "");
  return bare === "" ? "/" : bare;
};

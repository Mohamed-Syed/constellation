const STORAGE_KEY = "constellation-theme";

/**
 * Sets the `dark` class on `<html>` before React hydrates, so there's no
 * flash of the wrong theme. Reads `localStorage`, falling back to
 * `prefers-color-scheme` on first-ever load. Kept as a plain inline script
 * (not a client component) so it runs synchronously during initial paint.
 */
export function ThemeScript() {
  const code = `(function(){try{var k=${JSON.stringify(STORAGE_KEY)};var s=localStorage.getItem(k);var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
  // eslint-disable-next-line react/no-danger
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export { STORAGE_KEY as THEME_STORAGE_KEY };

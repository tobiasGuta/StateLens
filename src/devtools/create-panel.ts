export function createStateLensPanel(): void {
  chrome.devtools.panels.create("StateLens", "icons/statelens-32.png", "panel.html", () => {
    // Panel creation has no user data and must remain side-effect free.
  });
}

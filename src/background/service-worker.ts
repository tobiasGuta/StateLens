chrome.runtime.onInstalled.addListener(() => {
  // StateLens is deliberately local-only. The worker performs no network activity.
});

// Open, never toggle: another toolbar click does not close an existing panel.
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
});

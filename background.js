// Mark-View style: opening a local/remote .md in Chrome opens it in the slide viewer.
function viewerUrl(u){ return chrome.runtime.getURL('viewer.html') + '?src=' + encodeURIComponent(u.split('#')[0]); }
chrome.webNavigation.onBeforeNavigate.addListener(d => {
  if (d.frameId !== 0) return;
  chrome.tabs.update(d.tabId, { url: viewerUrl(d.url) });
}, { url: [{ schemes: ['file'], pathSuffix: '.md' }, { schemes: ['file'], pathSuffix: '.markdown' }] });
// toolbar icon: open the empty viewer (use Open .md / drag a file)
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }));

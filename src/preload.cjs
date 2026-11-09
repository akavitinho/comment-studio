const { contextBridge, ipcRenderer } = require('electron');
const methods = ['state', 'openGeoSource', 'addAccount', 'editAccount', 'deleteAccount', 'useProxyBrowser', 'addProxy', 'duplicateProxy', 'editProxy', 'deleteProxy', 'openProxyBrowser', 'closeProxyBrowser', 'openAccountBrowser', 'closeAccountBrowser', 'saveCampaign', 'startCampaign', 'stopCampaign', 'pauseCampaign', 'resumeCampaign', 'checkCampaign', 'openAttempt', 'openAccount', 'closeAccount', 'testConnection', 'testProxy', 'pickMediaVideos', 'pickMediaCover', 'pickMediaImages', 'pickMediaOutput', 'startMediaJob', 'cancelMediaJob', 'inspectDownloadLinks', 'startDownloadJob', 'cancelDownloadJob', 'openMediaOutput'];
methods.push('resumeAccount');
methods.push('pauseAccount');
methods.push('restartAccountCycle');
methods.push('saveXCampaign', 'startXCampaign', 'pauseXCampaign', 'resumeXCampaign', 'stopXCampaign', 'pauseXAccount', 'resumeXAccount', 'stopXAccount', 'checkXCampaign', 'openXAttempt');
methods.push('savePostingSchedule', 'savePostingSchedules', 'addPostingVideo', 'updatePostingVideo', 'removePostingVideo', 'controlPosting', 'startQueuedPostings');
methods.push('movePostingVideo', 'retryPostingVideo');
methods.push('clearPostingQueue');
methods.push('addSharedPostingVideos', 'controlSharedPosting');
methods.push('pickPostingVideoFolder', 'savePostingMediaSettings', 'selectPostingFolder', 'importPostingFolder');
methods.push('previewPostingSchedule');
methods.push('saveMetaSettings', 'connectMeta', 'disconnectMeta');
methods.push('savePostingStorage');
methods.push('openPublishedReel');
methods.push('videoThumbnail');
methods.push('postingCoverPreview');
methods.push('postingProfilePicture');
methods.push('refreshInstagramInsights');
methods.push('instagramAccountInsights');
methods.push('instagramOfficialMetrics');
contextBridge.exposeInMainWorld('onInsightsProgress', callback => {
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('studio:insights-progress', listener);
  return () => ipcRenderer.removeListener('studio:insights-progress', listener);
});
methods.push('saveTikTokAnalyticsSettings', 'connectTikTokAnalytics', 'disconnectTikTokAnalytics', 'refreshTikTokInsights');
methods.push('resolveUncertainPosting');
contextBridge.exposeInMainWorld('studio', Object.fromEntries(methods.map(method => [method, async payload => {
  const result = await ipcRenderer.invoke(`studio:${method}`, payload);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}])));
contextBridge.exposeInMainWorld('onAutomation', callback => {
  const listener = (_event, snapshot) => callback(snapshot);
  ipcRenderer.on('studio:automation', listener);
  return () => ipcRenderer.removeListener('studio:automation', listener);
});
contextBridge.exposeInMainWorld('onXAutomation', callback => {
  const listener = (_event, snapshot) => callback(snapshot);
  ipcRenderer.on('studio:x-automation', listener);
  return () => ipcRenderer.removeListener('studio:x-automation', listener);
});
contextBridge.exposeInMainWorld('onMediaProgress', callback => {
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('studio:media-progress', listener);
  return () => ipcRenderer.removeListener('studio:media-progress', listener);
});
contextBridge.exposeInMainWorld('onDownloadProgress', callback => {
  const listener = (_event, progress) => callback(progress);
  ipcRenderer.on('studio:download-progress', listener);
  return () => ipcRenderer.removeListener('studio:download-progress', listener);
});
contextBridge.exposeInMainWorld('onPostings', callback => {
  const listener = (_event, snapshot) => callback(snapshot);
  ipcRenderer.on('studio:postings', listener);
  return () => ipcRenderer.removeListener('studio:postings', listener);
});

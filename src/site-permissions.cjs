function allowInstagramNotifications(permission, url) {
  if (!url) return false;
  try {
    const site = new URL(url);
    const isInstagram = site.protocol === 'https:' && (site.hostname === 'www.instagram.com' || site.hostname === 'instagram.com');
    const isTikTok = site.protocol === 'https:' && (site.hostname === 'www.tiktok.com' || site.hostname === 'tiktok.com');
    if (!isInstagram && !isTikTok) return false;
    // Allow permissions needed for Stories, Highlights, file uploads
    const allowed = ['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'pointerLock', 'fullscreen', 'idle-detection', 'fileSystem', 'window-management', 'storage-access'];
    return allowed.includes(permission);
  } catch {
    return false;
  }
}

module.exports = { allowInstagramNotifications };

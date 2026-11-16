function allowInstagramNotifications(permission, url) {
  if (permission !== 'notifications' || !url) return false;
  try {
    const site = new URL(url);
    return site.protocol === 'https:' && (site.hostname === 'www.instagram.com' || site.hostname === 'instagram.com');
  } catch {
    return false;
  }
}

module.exports = { allowInstagramNotifications };

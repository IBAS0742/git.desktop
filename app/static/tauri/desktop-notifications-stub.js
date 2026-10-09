// Tauri build stub for the native `desktop-notifications` addon.
//
// The webview cannot load Node native addons, so notifications fall back to
// the HTML5 Notification API (see app/src/lib/notifications/show-notification.ts
// which checks supportsNotifications() first).
//
// Kept in sync with the API surface imported from
// vendor/desktop-notifications by renderer code.

exports.supportsNotifications = () => false

exports.supportsNotificationsPermissionRequest = () => false

exports.getNotificationSettingsUrl = () => null

exports.getNotificationsPermission = async () => 'default'

exports.requestNotificationsPermission = async () => 'default'

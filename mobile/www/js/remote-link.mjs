// Thin wrapper over the native RemoteLink plugin (RemoteLinkPlugin.kt). The
// native RemoteConnection owns the socket and the token; the WebView only sends and
// receives protocol frames. `window.Capacitor` comes from vendor/capacitor.js
// (no bundler, so no bare `@capacitor/core` import).

const plugin = window.Capacitor?.registerPlugin('RemoteLink');

function native() {
  if (!plugin) throw new Error('RemoteLink is only available in the Android app.');
  return plugin;
}

/** Pair + connect with a decoded pairing payload, or reconnect with the stored one. */
export const connect = (pairing) =>
  native().connect(pairing ? { url: pairing.url, token: pairing.token, certSha256: pairing.certSha256 } : {});

export const disconnect = () => native().disconnect();
export const unpair = () => native().unpair();

/** Send one protocol frame (object). Resolves to true if the socket took it. */
export async function send(frame) {
  const { sent } = await native().send({ text: JSON.stringify(frame) });
  return sent;
}

/** { state, detail, paired, url } — state: idle|connecting|connected|offline|auth-failed|kicked|unpaired */
export const getState = () => native().getState();

export const onMessage = (cb) => native().addListener('message', ({ text }) => cb(text));
export const onState = (cb) => native().addListener('state', cb);
export const onNotificationTap = (cb) => native().addListener('notificationTap', ({ agentId }) => cb(agentId));

export const requestNotificationPermission = () => native().requestNotificationPermission();

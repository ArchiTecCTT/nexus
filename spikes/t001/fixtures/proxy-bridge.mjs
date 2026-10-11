// Exécuté DANS le sandbox : expose le socket Unix du proxy egress sous forme d'un port TCP de loopback
// (127.0.0.1 du namespace réseau privé), pour les clients qui ne savent utiliser que HTTPS_PROXY=host:port.
import { createServer, connect } from 'node:net';

export function startBridge(socketPath, port = 0) {
  const server = createServer((c) => {
    const u = connect(socketPath);
    c.pipe(u).pipe(c);
    u.on('error', () => c.destroy());
    c.on('error', () => u.destroy());
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
}

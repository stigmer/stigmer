// A loopback port nothing listens on, for a test that needs a port to be
// refused or to time out.
//
// A test that dialled or checked the real server port (SERVER_PORT, 7234)
// shared it with every other test file running at the same time and with a
// developer's own `stigmer up` (stigmer#2767). Each test takes a port of its
// own from here instead. The number comes from a listener opened on port 0
// and closed again, so a test that needs something listening should open its
// own listener on port 0 and read the port back, which leaves no gap at all.
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

/** A free loopback port: bound once on port 0 to learn the number, then closed. */
export async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address() as AddressInfo;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}

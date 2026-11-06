// Publish the static UI bundled with the Python application.
import { cp, rm, rename } from "node:fs/promises";

await rm("web.next", { recursive: true, force: true });
await cp("out", "web.next", { recursive: true });
await rm("web", { recursive: true, force: true });
await rename("web.next", "web");

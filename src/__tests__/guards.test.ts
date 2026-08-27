import { guardDocumentation, guardGeneratedSurface, guardNoSuppressions } from "@intisy-ai/api/testing";

guardDocumentation({ dir: new URL("..", import.meta.url) });
guardNoSuppressions({ dir: new URL("..", import.meta.url) });
guardGeneratedSurface({
  files: [
    new URL("../generated/auth-contracts.ts", import.meta.url),
    new URL("../generated/auth-contracts.keys.ts", import.meta.url),
  ],
});

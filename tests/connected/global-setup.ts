import { runConnectedPreflight } from "./attestation-preflight";

export default async function globalSetup() {
  await runConnectedPreflight();
}

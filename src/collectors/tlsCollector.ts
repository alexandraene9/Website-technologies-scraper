import tls from "node:tls";
import { config } from "../config.js";
import type { PageSignals } from "../types.js";

export function collectTls(host: string): Promise<PageSignals> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: config.tlsTimeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      const issuer = cert?.issuer ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(" / ") : "";
      resolve({ layer: "tls", certIssuer: issuer || undefined });
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("tls timeout"));
    });
    socket.on("error", reject);
  });
}

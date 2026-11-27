import QRCode from "qrcode";
import { otpauthUri } from "./totp";

/** QR code (SVG markup) an authenticator app scans to add the account. Server only. */
export function setupQrSvg(secret: string, email: string): Promise<string> {
  return QRCode.toString(otpauthUri(secret, email), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

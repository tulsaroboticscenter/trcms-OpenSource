/** Renders a QR code image for a given string value. */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    if (!value) { setDataUrl(""); return; }
    QRCode.toDataURL(value, { width: size, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [value, size]);

  if (!dataUrl) return null;
  return <img src={dataUrl} width={size} height={size} alt={`QR code for ${value}`} style={{ display: "block" }} />;
}

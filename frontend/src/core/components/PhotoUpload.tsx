/**
 * PhotoUpload — reusable photo upload component.
 * Displays current photo (or initials avatar), click to upload a new one.
 * Shows upload progress and preview before saving.
 */
import { useState, useRef } from "react";
import { api } from "../api";
import { compressImage } from "../imageCompress";
import { Camera, Upload } from "lucide-react";

interface Props {
  currentUrl?: string | null;
  initials?: string;
  size?: number;
  onUploaded: (url: string) => void;
  endpoint?: string;    // defaults to /api/v1/uploads/photo
  disabled?: boolean;
}

export default function PhotoUpload({
  currentUrl,
  initials = "?",
  size = 80,
  onUploaded,
  endpoint = "/api/v1/uploads/photo",
  disabled = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    setError("");
    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      // Phone photos are often larger than the host's ~2 MB upload cap — downscale first.
      const upload = await compressImage(file);
      // If it's still too big, the browser couldn't decode/resize it (commonly an
      // iPhone HEIC/Live Photo). Uploading raw would just fail with a size error, so
      // stop here with an actionable message instead.
      if (upload.size > 1_900_000) {
        setError("This photo couldn't be resized to fit. It may be an iPhone HEIC or Live Photo — take a screenshot of it and upload that, or choose a different picture.");
        setPreview(null);
        return;
      }
      const form = new FormData();
      form.append("file", upload);
      const { data } = await api.post(endpoint, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      // Store the relative URL ("/uploads/..."); it resolves against the
      // same origin the app is served from (works in dev and behind Plesk).
      const fullUrl = data.url;
      onUploaded(fullUrl);
      setPreview(null);
    } catch (e: unknown) {
      const resp = (e as { response?: { status?: number; data?: { detail?: string } } })?.response;
      // Prefer the server's specific reason (e.g. "uploads folder isn't writable").
      setError(resp?.data?.detail
        ?? (resp?.status === 413
          ? "That photo is too large for the server. Try a smaller image or a screenshot."
          : "Upload failed. Please try again, or choose a different photo."));
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }

  const displayUrl = preview || currentUrl;
  const borderRadius = size / 2;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* Avatar / photo */}
      <div
        style={{
          width: size, height: size, borderRadius,
          background: displayUrl ? "transparent" : "#1a3a5c",
          overflow: "hidden", cursor: disabled ? "default" : "pointer",
          border: uploading ? "3px solid #4dabf7" : "2px solid #e2e8f0",
          position: "relative",
        }}
        onClick={() => !disabled && !uploading && fileRef.current?.click()}
      >
        {displayUrl ? (
          <img src={displayUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="Profile" />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff", fontSize: size * 0.3, fontWeight: 700 }}>
            {initials.toUpperCase()}
          </div>
        )}
        {/* Hover overlay */}
        {!disabled && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: 0, transition: "opacity 0.2s",
            borderRadius,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}
          >
            {uploading
              ? <Upload size={size * 0.25} color="#fff" />
              : <Camera size={size * 0.25} color="#fff" />
            }
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
      />

      {/* Error tooltip */}
      {error && (
        <div style={{
          position: "absolute", top: "110%", left: 0, background: "#c62828",
          color: "#fff", fontSize: 11, padding: "4px 8px", borderRadius: 5,
          whiteSpace: "nowrap", zIndex: 10,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

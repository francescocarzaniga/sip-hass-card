import { sipCore } from "./sip-core";

/**
 * Where a card gets its picture from. Same keys as the popup's extension
 * config, so a source can be copied between the two.
 */
export interface MediaSource {
    /** Home Assistant camera entity, used when no go2rtc stream is set or go2rtc fails */
    camera_entity?: string | null;
    /** go2rtc stream name */
    go2rtc_stream?: string | null;
    /** Alias of `go2rtc_stream` */
    stream_name?: string | null;
    /** Base URL of go2rtc's web UI as the browser reaches it, e.g. `https://go2rtc.example.com` */
    go2rtc_url?: string | null;
    /** Alias of `go2rtc_url` */
    go2rtc_stream_url?: string | null;
    /** Reach go2rtc through the Home Assistant add-on's ingress (needs the Supervisor) */
    go2rtc_ingress?: boolean | null;
    /** Add-on slug for `go2rtc_ingress`; auto-detected when omitted */
    go2rtc_addon_slug?: string | null;
    /** `webrtc` or `mse` (default) */
    live_provider?: string | null;
}

export function streamName(source?: MediaSource | null): string {
    return source?.stream_name || source?.go2rtc_stream || "";
}

function mode(source?: MediaSource | null): string {
    return source?.live_provider === "webrtc" ? "webrtc" : "mse";
}

/** Turns a go2rtc base/API/player URL into the `stream.html` player URL for a stream */
export function playerUrl(base: string, stream: string, playMode: string): string {
    let url = base.trim();
    if (url.includes("/api/homekit")) {
        url = url.split("/api/homekit")[0];
    } else if (url.includes("/api/webtorrent")) {
        url = url.split("/api/webtorrent")[0];
    }
    if (!url.includes("stream.html")) {
        url = `${url.replace(/\/$/, "")}/stream.html`;
    }
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}src=${encodeURIComponent(stream)}&mode=${encodeURIComponent(playMode)}&width=100%`;
}

/** Player URL for a source that has a direct go2rtc URL (no ingress), or "" */
export function directPlayerUrl(source?: MediaSource | null): string {
    const stream = streamName(source);
    const base = source?.go2rtc_stream_url || source?.go2rtc_url || "";
    if (!stream || !base || source?.go2rtc_ingress) return "";
    return playerUrl(base, stream, mode(source));
}

/** Stable identity of what a source shows, used to keep the same element across call state changes */
export function sourceKey(source?: MediaSource | null): string {
    if (!source) return "";
    const stream = streamName(source);
    if (stream) {
        const via = source.go2rtc_ingress ? `ingress:${source.go2rtc_addon_slug || ""}` : source.go2rtc_url || source.go2rtc_stream_url || "";
        return `go2rtc|${via}|${stream}|${mode(source)}|${source.camera_entity || ""}`;
    }
    return source.camera_entity ? `camera|${source.camera_entity}` : "";
}

async function findAddonIngressUrl(hass: any, slug: string): Promise<string> {
    let info: any = undefined;
    if (slug) {
        try {
            info = await hass.callWS({ type: "supervisor/api", endpoint: `/addons/${slug}/info`, method: "get" });
        } catch (err) {
            console.warn(`SIP Core: go2rtc add-on slug ${slug} failed, trying auto-discovery`, err);
        }
    }
    if (!info) {
        const result = await hass.callWS({ type: "supervisor/api", endpoint: "/addons", method: "get" });
        const addon = (result?.addons || []).find((a: any) => {
            const s = String(a?.slug || "").toLowerCase();
            const n = String(a?.name || "").toLowerCase();
            return s.includes("go2rtc") || n.includes("go2rtc");
        });
        if (addon?.slug) {
            info = await hass.callWS({ type: "supervisor/api", endpoint: `/addons/${addon.slug}/info`, method: "get" });
        }
    }
    return info?.ingress_url || info?.ingress_entry || "";
}

const ingressCache = new Map<string, Promise<string>>();

/**
 * Player URL through the go2rtc add-on's ingress. Rejects when there is no
 * Supervisor or no go2rtc add-on, so the caller can fall back.
 */
export function ingressPlayerUrl(hass: any, source: MediaSource): Promise<string> {
    const stream = streamName(source);
    const key = `${source.go2rtc_addon_slug || ""}|${source.go2rtc_url || source.go2rtc_stream_url || ""}|${stream}|${mode(source)}`;
    let pending = ingressCache.get(key);
    if (!pending) {
        pending = (async () => {
            const session = await sipCore.ensureHassioSession();
            if (!session) throw new Error("No Supervisor ingress session (not running Home Assistant OS/Supervised?)");
            const base =
                source.go2rtc_stream_url || source.go2rtc_url || (await findAddonIngressUrl(hass, source.go2rtc_addon_slug || ""));
            if (!base) throw new Error("No go2rtc add-on found. Set go2rtc_addon_slug or go2rtc_url.");
            return playerUrl(base, stream, mode(source));
        })();
        // Don't cache failures, so a later render can retry
        pending.catch(() => ingressCache.delete(key));
        ingressCache.set(key, pending);
    }
    return pending;
}

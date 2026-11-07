import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";

/**
 * Where the RNNoise worklet and WASM binaries are served from.
 * They are copied next to `sip_core.js` at build time and registered as
 * static paths by the integration (see `__init__.py`).
 */
const FILES_BASE = "/sip_core_files";

/** RNNoise is trained on 48 kHz audio and only works at that sample rate. */
const SAMPLE_RATE = 48000;

/** How long to wait for a suspended AudioContext to start before giving up. */
const RESUME_TIMEOUT_MS = 1000;

/** Noise suppression options, set in the SIP Core config as `noise_suppression`. */
export interface NoiseSuppressionConfig {
    /** Denoise the local microphone before it is sent to the other party. */
    microphone?: boolean;
    /** Denoise the audio received from the other party before it is played. */
    remote?: boolean;
    /**
     * The browser's own microphone processing (default `true` each). On Android
     * these switch on the phone's built-in voice-call effects, which can gate or
     * crackle on speakerphone; set them to `false` to bypass them.
     */
    browser_echo_cancellation?: boolean;
    browser_noise_suppression?: boolean;
    browser_auto_gain?: boolean;
}

/** True when any `browser_*` switch is set, i.e. SIP Core must open the microphone itself */
export function hasBrowserProcessingOverrides(config?: NoiseSuppressionConfig): boolean {
    return (
        config?.browser_echo_cancellation !== undefined ||
        config?.browser_noise_suppression !== undefined ||
        config?.browser_auto_gain !== undefined
    );
}

let wasmPromise: Promise<ArrayBuffer> | null = null;

function loadWasm(version: string): Promise<ArrayBuffer> {
    if (wasmPromise === null) {
        wasmPromise = loadRnnoise({
            url: `${FILES_BASE}/rnnoise.wasm?v=${version}`,
            simdUrl: `${FILES_BASE}/rnnoise_simd.wasm?v=${version}`,
        }).catch((err) => {
            // Allow a retry on the next call instead of caching the failure.
            wasmPromise = null;
            throw err;
        });
    }
    return wasmPromise;
}

async function resumeContext(ctx: AudioContext): Promise<void> {
    if (ctx.state === "running") return;
    // `resume()` stays pending until a user gesture when autoplay is blocked
    // (e.g. auto answer or `?call=` without a click), so don't wait forever.
    await Promise.race([ctx.resume(), new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS))]);
    if ((ctx.state as AudioContextState) !== "running") {
        throw new Error(`AudioContext is ${ctx.state} (autoplay blocked?)`);
    }
}

/**
 * Runs the audio of a MediaStream through RNNoise.
 *
 * `stream` holds the denoised audio track plus any video tracks of the input.
 * The input stream is not owned: `close()` releases the processing graph but
 * leaves the input tracks running, the caller stops them.
 */
export class DenoisedStream {
    readonly stream: MediaStream;

    private constructor(
        stream: MediaStream,
        private ctx: AudioContext,
        private node: RnnoiseWorkletNode,
        private keepAlive: HTMLAudioElement | null,
    ) {
        this.stream = stream;
    }

    /**
     * @param input stream whose first audio track is denoised
     * @param version SIP Core version, used to bust the static file cache
     * @param isRemote `true` for a WebRTC receive stream. Chrome only feeds a
     *   remote stream into Web Audio while it is also attached to a media
     *   element, so a muted one is kept playing alongside.
     */
    static async create(input: MediaStream, version: string, isRemote = false): Promise<DenoisedStream> {
        if (input.getAudioTracks().length === 0) {
            throw new Error("Stream has no audio track");
        }

        let keepAlive: HTMLAudioElement | null = null;
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        try {
            if (isRemote) {
                keepAlive = new Audio();
                keepAlive.muted = true;
                keepAlive.srcObject = input;
                keepAlive.play().catch(() => {
                    /* muted playback is best effort */
                });
            }

            const [wasmBinary] = await Promise.all([
                loadWasm(version),
                ctx.audioWorklet.addModule(`${FILES_BASE}/rnnoise-worklet.js?v=${version}`),
            ]);

            const source = ctx.createMediaStreamSource(new MediaStream(input.getAudioTracks()));
            const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
            // Voice is mono: downmix so RNNoise only runs once per frame.
            node.channelCount = 1;
            node.channelCountMode = "explicit";
            node.channelInterpretation = "speakers";
            const destination = ctx.createMediaStreamDestination();
            source.connect(node).connect(destination);

            await resumeContext(ctx);

            const output = new MediaStream([...destination.stream.getAudioTracks(), ...input.getVideoTracks()]);
            console.info(`SIP Core: RNNoise enabled for ${isRemote ? "remote" : "microphone"} audio`);
            return new DenoisedStream(output, ctx, node, keepAlive);
        } catch (err) {
            ctx.close().catch(() => {});
            if (keepAlive) keepAlive.srcObject = null;
            throw err;
        }
    }

    close(): void {
        this.stream.getAudioTracks().forEach((track) => track.stop());
        try {
            this.node.destroy();
        } catch (err) {
            console.debug("SIP Core: error destroying RNNoise node:", err);
        }
        this.ctx.close().catch(() => {});
        if (this.keepAlive) {
            this.keepAlive.pause();
            this.keepAlive.srcObject = null;
        }
    }
}
